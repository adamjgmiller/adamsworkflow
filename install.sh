#!/usr/bin/env bash
# install.sh — mirror this repo's commands/ and skills/ into ~/.claude/
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
#   left alone (idempotent re-runs are a no-op).
#
set -euo pipefail

MODE=""
DRY_RUN=0
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${CLAUDE_HOME:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"

usage() {
  sed -n '2,14p' "$0"
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

if [[ ! -d "$REPO_DIR/commands" || ! -d "$REPO_DIR/skills" ]]; then
  echo "Error: expected commands/ and skills/ next to install.sh (got: $REPO_DIR)" >&2
  exit 1
fi

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

say "Mode:    $MODE${DRY_RUN:+ (dry-run)}"
say "Source:  $REPO_DIR"
say "Target:  $TARGET_DIR"
say ""

# Walk every regular file under commands/ and skills/, preserving structure.
while IFS= read -r -d '' f; do
  rel="${f#$REPO_DIR/}"
  install_one "$rel"
done < <(find "$REPO_DIR/commands" "$REPO_DIR/skills" -type f -print0)

say ""
say "Done. Backups (if any) end in .bak-$STAMP."
say "Open Claude Code and your commands/skills should appear in the available list."
