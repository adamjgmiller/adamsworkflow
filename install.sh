#!/usr/bin/env bash
# install.sh — mirror this repo's Claude Code config into ~/.claude/
#
# Installs: commands/ skills/ agents/ workflows/ scripts/ and docs/field-notes.md
# (the harness field notes the commands cite at ~/.claude/docs/field-notes.md).
# Skipped on purpose: README.md, CLAUDE.md, CLAUDE-global.md, docs/devbox.md,
# docs/design-sample.html (reference docs you merge into your own config by
# choice), and scripts/check-leakage.sh (a repo-maintenance tool, not config).
#
# Usage:
#   ./install.sh --symlink     # symlink each file (git pull updates live config)
#   ./install.sh --copy        # copy each file (independent edits, no auto-sync)
#   ./install.sh --dry-run     # show what would happen without doing it
#   ./install.sh --help
#
# Conflict handling:
#   If a target file already exists, it's backed up to <file>.bak-<timestamp>
#   before being replaced. Existing symlinks pointing into this same repo are
#   left alone (idempotent re-runs are a no-op). After installing, stale v1
#   symlinks (links into this clone whose source file no longer exists) are
#   removed — see the README's migration section.
set -euo pipefail

MODE=""
DRY_RUN=0
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${CLAUDE_HOME:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"

usage() {
  sed -n '2,21p' "$0"
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

# Directories walked in full. check-leakage.sh is pruned from scripts/ below.
WALK_DIRS=(commands skills agents workflows scripts)
for d in "${WALK_DIRS[@]}"; do
  if [[ ! -d "$REPO_DIR/$d" ]]; then
    echo "Error: expected $d/ next to install.sh (got: $REPO_DIR)" >&2
    exit 1
  fi
done

say() { echo "[install] $*"; }
do_cmd() {
  if (( DRY_RUN )); then
    echo "  DRY-RUN: $*"
  else
    eval "$@"
  fi
}

# install_one <relative-path-from-REPO_DIR>
# e.g. install_one commands/orchestrate.md
install_one() {
  local rel="$1"
  local src="$REPO_DIR/$rel"
  local dest="$TARGET_DIR/$rel"
  local dest_parent
  dest_parent="$(dirname "$dest")"

  do_cmd "mkdir -p \"$dest_parent\""

  if [[ -L "$dest" ]]; then
    local link_target
    link_target="$(readlink "$dest")"
    if [[ "$link_target" == "$src" ]]; then
      say "  ok    $rel (already symlinked to this repo)"
      return 0
    fi
    say "  backup $rel (existing symlink -> $link_target)"
    do_cmd "mv \"$dest\" \"$dest.bak-$STAMP\""
  elif [[ -e "$dest" ]]; then
    say "  backup $rel (existing file -> $dest.bak-$STAMP)"
    do_cmd "mv \"$dest\" \"$dest.bak-$STAMP\""
  fi

  if [[ "$MODE" == "symlink" ]]; then
    say "  link  $rel"
    do_cmd "ln -s \"$src\" \"$dest\""
  else
    say "  copy  $rel"
    do_cmd "cp \"$src\" \"$dest\""
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

say "Mode:    $MODE${DRY_RUN:+ (dry-run)}"
say "Source:  $REPO_DIR"
say "Target:  $TARGET_DIR"
say ""

# Walk every regular file under the config directories, preserving structure.
# Prune gitignored build junk and the repo-only leakage gate.
while IFS= read -r -d '' f; do
  rel="${f#$REPO_DIR/}"
  install_one "$rel"
done < <(find "${WALK_DIRS[@]/#/$REPO_DIR/}" \
              -type f \
              ! -name '*.pyc' \
              ! -path '*/__pycache__/*' \
              ! -name '*.bak-*' \
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
say "Done. Backups (if any) end in .bak-$STAMP."
say "Open Claude Code and your commands/skills should appear in the available list."
