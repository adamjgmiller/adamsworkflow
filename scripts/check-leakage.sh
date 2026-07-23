#!/usr/bin/env bash
# check-leakage.sh — repo-maintenance gate that fails if personal / secret
# strings have leaked into anything that would be published.
#
# This is a REPO TOOL, not user config: install.sh deliberately does NOT
# install it into ~/.claude. Run it before publishing and in CI.
#
# MAINTENANCE NOTE: this gate is part of the tracked tree it scans, so it must
# always pass its OWN scan. When adding or documenting a detection pattern here,
# DESCRIBE the shape in prose and write any literal with [] character classes (as
# the patterns below do) — never paste a real private literal you mean to catch.
#
# Usage:
#   ./scripts/check-leakage.sh              # tracked tree + branch messages + history
#   ./scripts/check-leakage.sh --staged     # ALSO scan staged (index) content
#   ./scripts/check-leakage.sh --skip-history  # OMIT only the base..HEAD history-content scan
#   ./scripts/check-leakage.sh --no-terms   # tolerate a MISSING Layer-2 term file (warn, not fail)
#   ./scripts/check-leakage.sh --help
#
# Exit status:
#   0 = clean
#   1 = at least one hit (printed as file:line:match, or <short-sha>:path:line:match in history)
#   2 = usage error (unknown argument)
#   3 = gate ERROR — a scan did not complete (fail CLOSED, never reported clean)
#   4 = INCOMPLETE — Layer-2 term file missing and --no-terms not given (fail CLOSED)
#
# ---------------------------------------------------------------------------
# TWO LAYERS
#
# Layer 1 — committed generic patterns (safe to publish): shapes that are
#   almost never legitimate in this repo — routable IPv4 literals, real email
#   addresses, tailnet hostnames, absolute home paths, credential shapes, bare
#   single-label host URLs, and Claude Code commit-provenance strings (the
#   local-commit trailer key + session-URL stem). Documentation/loopback
#   placeholders are excluded so the gate stays green on legitimate mentions.
#
# Layer 2 — a private term list kept OUTSIDE the repo at
#   $HOME/.config/adamsworkflow/leakage-terms.txt (never committed). If that
#   file exists, every nonempty non-'#' line is matched case-insensitively as
#   a fixed string. Format: one term per line, '#' comments and blank lines
#   ignored. This is where personal hostnames / addresses / project names go —
#   things too specific to publish as a regex. Absent file => the gate FAILS
#   CLOSED (exit 4, "INCOMPLETE") rather than certifying clean with its most
#   important personal-string class silently off; pass --no-terms to downgrade
#   that to a warning and run Layer 1 only.
#
# HISTORY SCAN: by default the gate also scans the CONTENT of every commit in
#   <base>..HEAD (same Layer-1 patterns + exclusions and Layer-2 terms as the
#   tree scan). A private string added in one commit and removed by HEAD stays
#   in history where the tree/index/message scans never see it. --skip-history
#   omits ONLY this scan (a transient escape while a known-pending-rewrite hit
#   exists); tree, staged, and message scans still run.
#
# FAIL CLOSED: every scan distinguishes grep "no match" (clean) from a real git
#   error; on an unexpected error the gate exits non-zero rather than reporting
#   clean. Base resolution falls back to all of HEAD's history when there is no
#   merge-base, and only fails closed if even that cannot run.
# ---------------------------------------------------------------------------
set -euo pipefail

STAGED=0
SKIP_HISTORY=0
NO_TERMS=0
# Print the leading comment header (line-count-independent: every '#' line after
# the shebang, up to the first non-comment line).
usage() { awk 'NR==1{next} /^#/{print;next} {exit}' "$0"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --staged) STAGED=1 ;;
    --skip-history) SKIP_HISTORY=1 ;;
    --no-terms) NO_TERMS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

TERMS_FILE="${ADAMSWORKFLOW_LEAKAGE_TERMS:-$HOME/.config/adamsworkflow/leakage-terms.txt}"

# Fail CLOSED: a scan could not complete, so the gate MUST NOT certify clean.
# Callers invoke this only from the main shell (never inside $(...)/<(...)) so
# the exit propagates.
fail_closed() {  # fail_closed <context>
  echo "----" >&2
  echo "check-leakage: gate ERROR (scan did not complete) — failing closed. [$1]" >&2
  exit 3
}

# Layer-2 term file gating. Absent + no --no-terms => run Layer 1 but end on the
# INCOMPLETE verdict (fail closed). Absent + --no-terms => documented warning,
# Layer 2 simply skipped. Present => normal (--no-terms is a no-op).
INCOMPLETE=0
if [ ! -f "$TERMS_FILE" ]; then
  if [ "$NO_TERMS" -eq 1 ]; then
    echo "[check-leakage] WARNING: Layer-2 term file absent ($TERMS_FILE); --no-terms given — personal-string (Layer 2) checks are OFF for this run." >&2
  else
    INCOMPLETE=1
  fi
fi

HITS=0
report() {  # report <category> <file:line:match>
  printf 'LEAK [%s] %s\n' "$1" "$2"
  HITS=$((HITS + 1))
}

# ---------------------------------------------------------------------------
# Layer-1 pattern definitions. Each entry: a category label, an ERE, and an
# ERE of match-level EXCLUSIONS (matches that are legitimate). An empty
# exclusion means "no legitimate form".
# ---------------------------------------------------------------------------
# NOTE ON EXCLUSIONS (documentation / loopback placeholders that are fine):
#   IPv4     : loopback 127.0.0.1, unspecified 0.0.0.0, broadcast 255.x.x.x,
#              and the RFC-5737 documentation ranges 192.0.2.x / 198.51.100.x
#              / 203.0.113.x.
#   email    : the Anthropic no-reply trailer and any address at example.* .
#   homepath : the placeholders /home/user and /Users/user (and /home/<you>,
#              which cannot match the pattern anyway).
#   url      : loopback host 'localhost'.

IPV4_RE='\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'
IPV4_EXCL='^(127\.0\.0\.1$|0\.0\.0\.0$|255\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)'

EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_EXCL='(^noreply@anthropic\.com$|@example\.)'

TSNET_RE='[a-z0-9-]+\.ts\.net'
TSNET_EXCL=''

# Absolute home paths: Linux /home/<name>, macOS /Users/<name>, and the root
# account's home directory. The root alternative requires a trailing slash + a
# path character (written with a [] class, like CSESSION below, so this gate
# does not flag its own source, and this comment avoids the literal form), so a
# real root-home path leak matches while bare "/root" prose (docs, commit
# messages) and /rootfs, /rootkit do NOT.
HOMEPATH_RE='/home/[a-z0-9_]+|/Users/[A-Za-z0-9_]+|[/]root/[A-Za-z0-9._-]'
HOMEPATH_EXCL='^(/home/user|/Users/user)$'

CRED_RE='AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY'
CRED_EXCL=''

# Bare single-label host URL, e.g. a LAN/tailnet hostname with a port. A dotted
# host (real domain, IP) is intentionally NOT matched here — dotted hosts fall
# to the IPv4 / tailnet patterns instead.
URL_RE='http://[a-z0-9-]+:[0-9]+'
URL_EXCL='^http://localhost:'

# Claude Code commit-provenance strings that must never reach a published file:
# the local-commit trailer key and the session-URL stem the harness stamps into
# commits. Both are written with [] character classes so this gate does not
# match its own source (the raw literals never appear contiguously here).
CSESSION_RE='Claude-Session[:]'
CSESSION_EXCL=''

CSESSURL_RE='claude[.]ai/code/session_'
CSESSURL_EXCL=''

CATS='IPV4 EMAIL TSNET HOMEPATH CRED URL CSESSION CSESSURL'

# scan_text_stream <category> <regex> <exclusion-regex> <source-label>
# reads name:line:content? no — we feed pre-located matches. See callers.

# Strip the "file:line:" (or "label:line:") prefix from a `grep -noE` line and
# return the bare match (which may itself contain ':').
bare_match() { local r="${1#*:}"; printf '%s' "${r#*:}"; }

excluded() {  # excluded <match> <exclusion-regex>
  [ -n "$2" ] && printf '%s' "$1" | grep -qiE "$2"
}

# ---- tracked working tree -------------------------------------------------
# NOTE (fail closed): each scan captures git grep's output AND its exit code in
# the main shell (never via <(...), whose subshell would swallow fail_closed's
# exit). grep exit 1 = no match (clean); exit >=2 = real error => fail closed.
scan_tracked() {
  local cat re excl hit m out rc
  for cat in $CATS; do
    eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
    # -I skips binary files; -n line numbers; -o isolates the match.
    rc=0
    out="$(git grep -nIoE "$re" -- . 2>/dev/null)" || rc=$?
    [ "$rc" -ge 2 ] && fail_closed "tracked scan [$cat]"
    [ -n "$out" ] || continue
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      m="$(bare_match "$hit")"
      excluded "$m" "$excl" && continue
      report "$cat" "$hit"
    done <<< "$out"
  done
  return 0
}

# ---- staged (index) content ----------------------------------------------
scan_staged() {
  local cat re excl hit m out rc
  for cat in $CATS; do
    eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
    rc=0
    out="$(git grep --cached -nIoE "$re" -- . 2>/dev/null)" || rc=$?
    [ "$rc" -ge 2 ] && fail_closed "staged scan [$cat]"
    [ -n "$out" ] || continue
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      m="$(bare_match "$hit")"
      excluded "$m" "$excl" && continue
      report "$cat(staged)" "$hit"
    done <<< "$out"
  done
  return 0
}

# ---- commit range resolution (shared by messages + history) ---------------
# Prefer the merge-base with main / origin/main (branch commits only). With no
# merge-base, fall back to ALL commits reachable from HEAD (with a note) rather
# than silently skipping. Only fail closed if even that cannot run. Sets the
# global COMMIT_SHAS (may be empty when base == HEAD).
resolve_commit_shas() {
  local base rc=0 out
  base="$(git merge-base main HEAD 2>/dev/null || git merge-base origin/main HEAD 2>/dev/null || true)"
  if [ -n "$base" ]; then
    out="$(git rev-list "$base"..HEAD 2>/dev/null)" || rc=$?
    [ "$rc" -ne 0 ] && fail_closed "commit range (git rev-list ${base}..HEAD)"
  else
    echo "[check-leakage] note: no merge-base with main/origin/main; scanning ALL commits reachable from HEAD." >&2
    out="$(git rev-list HEAD 2>/dev/null)" || rc=$?
    [ "$rc" -ne 0 ] && fail_closed "commit range (git rev-list HEAD)"
  fi
  COMMIT_SHAS="$out"
}

# ---- branch commit messages ----------------------------------------------
scan_messages() {
  local sha msg short cat re excl hit m term out rc
  for sha in $COMMIT_SHAS; do
    msg="$(git log -1 --format=%B "$sha")"
    short="$(git rev-parse --short "$sha")"
    for cat in $CATS; do
      eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
      rc=0
      out="$(printf '%s' "$msg" | grep -nIoE "$re" 2>/dev/null)" || rc=$?
      [ "$rc" -ge 2 ] && fail_closed "message scan [$cat @ $short]"
      [ -n "$out" ] || continue
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        m="$(printf '%s' "${hit#*:}")"  # grep -noE on stdin => line:match
        excluded "$m" "$excl" && continue
        report "$cat(msg)" "commit ${short}:${hit}"
      done <<< "$out"
    done
    # Layer-2 terms in messages
    if [ -f "$TERMS_FILE" ]; then
      while IFS= read -r term || [[ -n "$term" ]]; do
        case "$term" in ''|\#*) continue ;; esac
        rc=0
        out="$(printf '%s' "$msg" | grep -nIiF -- "$term" 2>/dev/null)" || rc=$?
        [ "$rc" -ge 2 ] && fail_closed "message term scan [$term @ $short]"
        [ -n "$out" ] || continue
        while IFS= read -r hit; do
          [ -n "$hit" ] || continue
          report "TERM(msg)" "commit ${short}:${hit}"
        done <<< "$out"
      done < "$TERMS_FILE"
    fi
  done
  return 0
}

# ---- historical commit CONTENT (base..HEAD blobs) -------------------------
# The tree/index/message scans never see a private string that was added in one
# commit and later removed by HEAD. This scans the CONTENT of every commit in
# range for the SAME Layer-1 patterns (with the SAME per-category exclusions)
# and Layer-2 terms. git grep on a <rev> prefixes each line with "<rev>:", which
# is stripped so the remainder (path:line:match) matches the tree-scan shape;
# each hit is reported as <short-sha>:path:line:match.
scan_history() {
  local sha short cat re excl hit rest m term out rc
  for sha in $COMMIT_SHAS; do
    short="$(git rev-parse --short "$sha")"
    for cat in $CATS; do
      eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
      rc=0
      out="$(git grep -nIoE "$re" "$sha" -- . 2>/dev/null)" || rc=$?
      [ "$rc" -ge 2 ] && fail_closed "history scan [$cat @ $short]"
      [ -n "$out" ] || continue
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        rest="${hit#"$sha":}"          # strip "<full-sha>:" => path:line:match
        m="$(bare_match "$rest")"
        excluded "$m" "$excl" && continue
        report "$cat(history)" "${short}:${rest}"
      done <<< "$out"
    done
    # Layer-2 terms in history content (explicit -e so a rev-scoped fixed-string
    # pattern is unambiguous even for terms that begin with '-').
    [ -f "$TERMS_FILE" ] || continue
    while IFS= read -r term || [[ -n "$term" ]]; do
      case "$term" in ''|\#*) continue ;; esac
      rc=0
      out="$(git grep -nIiF -e "$term" "$sha" -- . 2>/dev/null)" || rc=$?
      [ "$rc" -ge 2 ] && fail_closed "history term scan [$term @ $short]"
      [ -n "$out" ] || continue
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        rest="${hit#"$sha":}"
        report "TERM(history)" "${short}:${rest}"
      done <<< "$out"
    done < "$TERMS_FILE"
  done
  return 0
}

# ---- Layer-2 private terms over tracked tree ------------------------------
# Absence of the term file is handled up front (INCOMPLETE / --no-terms); here we
# simply skip when it is not present.
scan_terms_tracked() {
  [ -f "$TERMS_FILE" ] || return 0
  local term hit out rc
  while IFS= read -r term || [[ -n "$term" ]]; do
    case "$term" in ''|\#*) continue ;; esac
    rc=0
    out="$(git grep -nIiF -- "$term" 2>/dev/null)" || rc=$?
    [ "$rc" -ge 2 ] && fail_closed "term scan [$term]"
    if [ -n "$out" ]; then
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        report "TERM" "$hit"
      done <<< "$out"
    fi
    if [ "$STAGED" -eq 1 ]; then
      rc=0
      out="$(git grep --cached -nIiF -- "$term" 2>/dev/null)" || rc=$?
      [ "$rc" -ge 2 ] && fail_closed "staged term scan [$term]"
      if [ -n "$out" ]; then
        while IFS= read -r hit; do
          [ -n "$hit" ] || continue
          report "TERM(staged)" "$hit"
        done <<< "$out"
      fi
    fi
  done < "$TERMS_FILE"
  return 0
}

resolve_commit_shas

scan_tracked
scan_terms_tracked
scan_messages
[ "$SKIP_HISTORY" -eq 1 ] || scan_history
[ "$STAGED" -eq 1 ] && scan_staged

if [ "$HITS" -gt 0 ]; then
  echo "----"
  echo "check-leakage: FAIL — $HITS hit(s) above."
  exit 1
fi
if [ "$INCOMPLETE" -eq 1 ]; then
  echo "----"
  echo "check-leakage: INCOMPLETE — Layer-2 term file missing ($TERMS_FILE); cannot certify clean." >&2
  echo "  Provide the term file, or pass --no-terms to run Layer 1 only and accept the gap." >&2
  exit 4
fi
echo "check-leakage: clean (Layer 1 patterns + $( [ -f "$TERMS_FILE" ] && echo "Layer 2 terms" || echo "no Layer 2 file (--no-terms)" ); tracked tree + branch messages$( [ "$SKIP_HISTORY" -eq 1 ] || echo " + history" )$( [ "$STAGED" -eq 1 ] && echo " + staged" ))."
exit 0
