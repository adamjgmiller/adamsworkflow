#!/usr/bin/env bash
# install.sh — mirror this repo's Claude Code config into ~/.claude/
#
# Installs: commands/ skills/ agents/ workflows/ scripts/ and docs/field-notes.md
# (the harness field notes the commands cite at ~/.claude/docs/field-notes.md).
# Skipped on purpose: README.md, CLAUDE.md, CLAUDE-global.md, docs/devbox.md,
# docs/design-sample.html (reference docs you merge into your own config by
# choice), and scripts/check-leakage.sh (a repo-maintenance tool, not config).
# Of docs/, only field-notes.md is installed — everything else under docs/
# (index.html and .nojekyll, the GitHub Pages site) is not installed.
#
# Usage:
#   ./install.sh --symlink     # symlink each file (git pull updates live config)
#   ./install.sh --copy        # copy each file (independent edits, no auto-sync)
#   ./install.sh --dry-run     # show what would happen without doing it
#   ./install.sh --help
#
# Conflict handling:
#   If a target file already exists, it's backed up to <file>.bak-<timestamp>
#   before being replaced (copy mode skips files already byte-identical). In
#   symlink mode, symlinks already pointing into this repo are left alone, so
#   re-runs are a no-op; copy mode replaces such a symlink with a real copy.
#   After installing, stale v1 symlinks (links into this clone whose source
#   file no longer exists) are removed — see the README's migration section.
set -euo pipefail

MODE=""
DRY_RUN=0
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# CLAUDE_HOME only controls where THIS installer writes files; Claude Code
# itself reads config from ~/.claude unless you also set CLAUDE_CONFIG_DIR to
# the same path, so relocating with CLAUDE_HOME alone installs where Claude
# Code won't look.
TARGET_DIR="${CLAUDE_HOME:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"

usage() {
  sed -n '2,24p' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --symlink) MODE="symlink" ;;
    --copy)    MODE="copy" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
  shift
done

if [[ -z "$MODE" ]]; then
  echo "Error: pick one of --symlink or --copy." >&2
  echo >&2
  usage 1
fi

# Refuse to install into the source repo or any directory inside it: the find
# walk below streams, so a target under the repo would recurse over files we
# just installed, and target == repo would overwrite the sources. REPO_DIR is
# already canonical (cd+pwd); canonicalize the target the same way when it
# already exists, else fall back to an absolute form.
if ! target_abs="$(cd "$TARGET_DIR" 2>/dev/null && pwd)"; then
  case "$TARGET_DIR" in
    /*) target_abs="$TARGET_DIR" ;;
    *)  target_abs="$PWD/$TARGET_DIR" ;;
  esac
fi
if [[ "$target_abs" == "$REPO_DIR" || "$target_abs" == "$REPO_DIR"/* ]]; then
  echo "Error: target ($target_abs) is the source repo or a directory inside it." >&2
  echo "Pick a target outside $REPO_DIR (unset CLAUDE_HOME to use ~/.claude)." >&2
  exit 1
fi

# Directories walked in full. check-leakage.sh is pruned from scripts/ below.
WALK_DIRS=(commands skills agents workflows scripts)
for d in "${WALK_DIRS[@]}"; do
  if [[ ! -d "$REPO_DIR/$d" ]]; then
    echo "Error: expected $d/ next to install.sh (got: $REPO_DIR)" >&2
    exit 1
  fi
done

say() { echo "[install] $*"; }
# do_cmd <argv...> — run a command directly (no eval, no re-splitting of args).
# Dry-run prints the argv %q-quoted so it stays copy-pasteable and unambiguous.
do_cmd() {
  if (( DRY_RUN )); then
    printf '  DRY-RUN:'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

# backup_path <dest> — echo a non-colliding "<dest>.bak-<STAMP>" path. STAMP has
# one-second resolution, so two installs in the same second could otherwise
# target the same backup name; append .1, .2, … until the name is free so
# neither run clobbers the other's backup.
backup_path() {
  local candidate="$1.bak-$STAMP" n=1
  while [[ -e "$candidate" ]]; do
    candidate="$1.bak-$STAMP.$n"
    n=$((n + 1))
  done
  printf '%s' "$candidate"
}

# install_one <relative-path-from-REPO_DIR>
# e.g. install_one commands/orchestrate.md
install_one() {
  local rel="$1"
  local src="$REPO_DIR/$rel"
  local dest="$TARGET_DIR/$rel"
  local dest_parent
  dest_parent="$(dirname "$dest")"

  do_cmd mkdir -p "$dest_parent"

  if [[ -L "$dest" ]]; then
    local link_target
    link_target="$(readlink "$dest")"
    # An exact-match symlink into this repo is a finished symlink install and a
    # no-op ONLY in symlink mode. In copy mode we must replace it with a real
    # file, so fall through to back the symlink up first.
    if [[ "$link_target" == "$src" && "$MODE" == "symlink" ]]; then
      say "  ok    $rel (already symlinked to this repo)"
      return 0
    fi
    local bak; bak="$(backup_path "$dest")"
    say "  backup $rel (existing symlink -> $link_target)"
    do_cmd mv "$dest" "$bak"
  elif [[ -e "$dest" ]]; then
    # Copy mode: an existing byte-identical copy is a true no-op — skip the
    # needless backup churn (and the same-second STAMP collision it risks).
    if [[ "$MODE" == "copy" ]] && cmp -s "$src" "$dest"; then
      say "  ok    $rel (identical copy already in place)"
      return 0
    fi
    local bak; bak="$(backup_path "$dest")"
    say "  backup $rel (existing file -> $bak)"
    do_cmd mv "$dest" "$bak"
  fi

  if [[ "$MODE" == "symlink" ]]; then
    say "  link  $rel"
    do_cmd ln -s "$src" "$dest"
  else
    say "  copy  $rel"
    do_cmd cp "$src" "$dest"
  fi
}

# v1-migration: after installing, drop stale v1 symlinks under commands/ and
# skills/ — links that point INTO this clone but whose source file no longer
# exists (renamed/removed between v1 and v2). Regular files and symlinks
# pointing anywhere else are never touched.
migrate_v1() {
  local removed=0 base dir link tgt
  for base in commands skills; do
    dir="$TARGET_DIR/$base"
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' link; do
      tgt="$(readlink "$link")"
      case "$tgt" in
        "$REPO_DIR"/*)
          if [[ ! -e "$tgt" ]]; then
            if (( DRY_RUN )); then
              echo "migrated: (dry-run) would remove stale v1 link $link"
            else
              rm "$link"
              echo "migrated: removed stale v1 link $link"
            fi
            removed=1
          fi
          ;;
      esac
    done < <(find "$dir" -type l -print0 2>/dev/null)
  done
  if (( removed )); then
    say ""
    say "Removed stale v1 symlink(s) above (source renamed/removed since v1)."
    say "See the README's migration section for the v1 -> v2 renames."
  fi
}

dry_label=""; (( DRY_RUN )) && dry_label=" (dry-run)"
say "Mode:    $MODE$dry_label"
say "Source:  $REPO_DIR"
say "Target:  $TARGET_DIR"
say ""

# Walk every regular file under the config directories, preserving structure.
# Prune gitignored build junk (incl. .DS_Store), .gitignore files themselves,
# and the repo-only leakage gate. Note: pruning .gitignore also drops
# scripts/.gitignore, so scripts/ has two exclusions (check-leakage.sh and its
# .gitignore) even though the README names only check-leakage.sh.
while IFS= read -r -d '' f; do
  rel="${f#"$REPO_DIR"/}"
  install_one "$rel"
done < <(find "${WALK_DIRS[@]/#/$REPO_DIR/}" \
              -type f \
              ! -name '*.pyc' \
              ! -path '*/__pycache__/*' \
              ! -name '*.bak-*' \
              ! -name '.gitignore' \
              ! -name '.DS_Store' \
              ! -path "$REPO_DIR/scripts/check-leakage.sh" \
              -print0)

# The harness field notes the commands cite by path.
if [[ -f "$REPO_DIR/docs/field-notes.md" ]]; then
  install_one docs/field-notes.md
else
  say "  warn  docs/field-notes.md not found — skipped (commands cite it at ~/.claude/docs/)"
fi

migrate_v1

say ""
say "Done. Backups (if any) are named <file>.bak-$STAMP (a .N suffix is added if that name was already taken)."
say "Open Claude Code and your commands/skills should appear in the available list."
