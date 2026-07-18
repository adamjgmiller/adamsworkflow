#!/usr/bin/env bash
# check-leakage.sh — repo-maintenance gate that fails if personal / secret
# strings have leaked into anything that would be published.
#
# This is a REPO TOOL, not user config: install.sh deliberately does NOT
# install it into ~/.claude. Run it before publishing and in CI.
#
# Usage:
#   ./scripts/check-leakage.sh            # scan tracked tree + branch commit messages
#   ./scripts/check-leakage.sh --staged   # ALSO scan staged (index) content
#   ./scripts/check-leakage.sh --help
#
# Exit status: 0 = clean, 1 = at least one hit (each printed as file:line:match).
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
#   things too specific to publish as a regex. Absent file => Layer 2 skipped.
# ---------------------------------------------------------------------------
set -euo pipefail

STAGED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --staged) STAGED=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; sed -n '2,33p' "$0"; exit 2 ;;
  esac
  shift
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

TERMS_FILE="${ADAMSWORKFLOW_LEAKAGE_TERMS:-$HOME/.config/adamsworkflow/leakage-terms.txt}"

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
#   homepath : the placeholders /home/user and /home/<you> (the latter cannot
#              match the pattern anyway).
#   url      : loopback host 'localhost'.

IPV4_RE='\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'
IPV4_EXCL='^(127\.0\.0\.1$|0\.0\.0\.0$|255\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)'

EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_EXCL='(^noreply@anthropic\.com$|@example\.)'

TSNET_RE='[a-z0-9-]+\.ts\.net'
TSNET_EXCL=''

HOMEPATH_RE='/home/[a-z0-9_]+'
HOMEPATH_EXCL='^/home/user$'

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
scan_tracked() {
  local cat re excl var
  for cat in $CATS; do
    eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
    # -I skips binary files; -n line numbers; -o isolates the match.
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      local m; m="$(bare_match "$hit")"
      excluded "$m" "$excl" && continue
      report "$cat" "$hit"
    done < <(git grep -nIoE "$re" -- . 2>/dev/null || true)
  done
}

# ---- staged (index) content ----------------------------------------------
scan_staged() {
  local cat re excl
  for cat in $CATS; do
    eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      local m; m="$(bare_match "$hit")"
      excluded "$m" "$excl" && continue
      report "$cat(staged)" "$hit"
    done < <(git grep --cached -nIoE "$re" -- . 2>/dev/null || true)
  done
}

# ---- branch commit messages ----------------------------------------------
scan_messages() {
  local base sha subjectless cat re excl
  base="$(git merge-base main HEAD 2>/dev/null || git merge-base origin/main HEAD 2>/dev/null || true)"
  [ -n "$base" ] || { echo "[check-leakage] note: no merge-base with main/origin/main; skipping message scan" >&2; return 0; }
  for sha in $(git rev-list "$base"..HEAD 2>/dev/null || true); do
    local msg short
    msg="$(git log -1 --format=%B "$sha")"
    short="$(git rev-parse --short "$sha")"
    for cat in $CATS; do
      eval "re=\$${cat}_RE; excl=\$${cat}_EXCL"
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        local m; m="$(printf '%s' "${hit#*:}")"  # grep -noE on stdin => line:match
        excluded "$m" "$excl" && continue
        report "$cat(msg)" "commit ${short}:${hit}"
      done < <(printf '%s' "$msg" | grep -nIoE "$re" 2>/dev/null || true)
    done
    # Layer-2 terms in messages
    if [ -f "$TERMS_FILE" ]; then
      while IFS= read -r term || [[ -n "$term" ]]; do
        case "$term" in ''|\#*) continue ;; esac
        while IFS= read -r hit; do
          [ -n "$hit" ] || continue
          report "TERM(msg)" "commit ${short}:${hit}"
        done < <(printf '%s' "$msg" | grep -nIiF -- "$term" 2>/dev/null || true)
      done < "$TERMS_FILE"
    fi
  done
}

# ---- Layer-2 private terms over tracked tree ------------------------------
scan_terms_tracked() {
  [ -f "$TERMS_FILE" ] || { echo "[check-leakage] note: no private term file at $TERMS_FILE; Layer 2 skipped" >&2; return 0; }
  local term
  while IFS= read -r term || [[ -n "$term" ]]; do
    case "$term" in ''|\#*) continue ;; esac
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      report "TERM" "$hit"
    done < <(git grep -nIiF -- "$term" 2>/dev/null || true)
    if [ "$STAGED" -eq 1 ]; then
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        report "TERM(staged)" "$hit"
      done < <(git grep --cached -nIiF -- "$term" 2>/dev/null || true)
    fi
  done < "$TERMS_FILE"
}

scan_tracked
scan_terms_tracked
scan_messages
[ "$STAGED" -eq 1 ] && scan_staged

if [ "$HITS" -gt 0 ]; then
  echo "----"
  echo "check-leakage: FAIL — $HITS hit(s) above."
  exit 1
fi
echo "check-leakage: clean (Layer 1 patterns + $( [ -f "$TERMS_FILE" ] && echo "Layer 2 terms" || echo "no Layer 2 file" ); tracked tree + branch messages$( [ "$STAGED" -eq 1 ] && echo " + staged" ))."
exit 0
