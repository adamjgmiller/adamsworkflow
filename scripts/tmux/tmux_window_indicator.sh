#!/usr/bin/env bash
# Update tmux window name with a Claude Code activity indicator.
# Invoked from hooks: `working` prepends ●, `attention` prepends ⚠, `idle` strips both.
# Strips any existing indicator before prepending so repeated fires don't stack.
# Also rewrites the default `claude` base name to the project/worktree folder
# (basename of `git rev-parse --show-toplevel`, falling back to basename of PWD)
# on the first fire — subsequent fires see a non-`claude` base and leave any
# manual rename intact.
# Early-exits when the resulting name equals the current name — important
# because PreToolUse can fire dozens of times per turn.
# For `attention`, inspects the JSON payload on stdin. permission_prompt
# events always flip the indicator (kept for completeness — empirically
# Claude Code does NOT fire Notification for inline TUI permission prompts,
# so this branch is dormant in practice). idle_prompt events ("Claude is
# waiting for your input") are AMBIGUOUS: the payload is byte-identical
# whether Claude is genuinely blocked on an AskUserQuestion/ExitPlanMode
# prompt OR the main loop is merely idling while a sub-agent / long tool
# runs. The old `●`-prefix heuristic conflated the two — a running sub-agent
# leaves the window `●`, so a finished sub-agent falsely raised ⚠ ("as if
# waiting for input"). We now disambiguate authoritatively from the
# transcript (its path is in the payload): a helper reports whether the most
# recent MAIN-chain blocking tool_use is still unanswered. Sub-agent
# (sidechain) activity and answered / end-of-turn states never qualify.
# If the helper can't run (no python3, unreadable transcript/helper) we fall
# back to the legacy `●` heuristic rather than going dark. Other Notification
# types (auth_success, push_notification, etc.) and non-attention idle
# prompts are logged to ~/.claude/.tmux_indicator_notifications.log
# and ignored.
# No-op when not running inside tmux or when tmux is unavailable.
set -euo pipefail

# Resolve this script's own directory so the Python helper is found no matter
# where the scripts are installed (they ship together in the same folder).
SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || printf '')"

[ -n "${TMUX_PANE:-}" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

state="${1:-idle}"

if [ "$state" = "attention" ]; then
  payload=$(cat 2>/dev/null || printf '')
  ntype=""
  msg=""
  transcript=""
  jq_ok=0
  if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
    ntype=$(printf '%s' "$payload" | jq -r '.notification_type // .type // .subtype // empty' 2>/dev/null || printf '')
    msg=$(printf '%s' "$payload" | jq -r '.message // .text // empty' 2>/dev/null || printf '')
    transcript=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null || printf '')
    # jq present AND it extracted at least one field => parse succeeded. A
    # payload that yields nothing (jq missing, malformed, or unexpected shape)
    # counts as a parse failure and takes the no-jq fallback below.
    if [ -n "$ntype" ] || [ -n "$msg" ] || [ -n "$transcript" ]; then
      jq_ok=1
    fi
  fi

  attention_worthy=0
  case "$ntype" in
    permission_prompt) attention_worthy=1 ;;
  esac
  case "$msg" in
    *permission*|*Permission*) attention_worthy=1 ;;
  esac

  # idle_prompt fires identically for a real AskUserQuestion/ExitPlanMode
  # prompt and for the main loop idling while a sub-agent / long tool runs.
  # Resolve the ambiguity from the transcript: `tmux_pending_question.py`
  # prints "1" when the most recent main-chain blocking tool_use is still
  # unanswered, "0" when it isn't, or "" when it could not decide (no
  # python3 / unreadable transcript or helper) — in which case we degrade to
  # the legacy `●`-prefix heuristic. A running OR finished sub-agent leaves
  # no pending main-chain blocking tool_use, so the "sub-agent finished -> ⚠"
  # false alarm can't happen on the authoritative path.
  is_idle_prompt=0
  case "$ntype" in idle_prompt) is_idle_prompt=1 ;; esac
  case "$msg" in *waiting\ for\ your\ input*) is_idle_prompt=1 ;; esac
  if [ "$is_idle_prompt" -eq 1 ] && [ "$attention_worthy" -eq 0 ]; then
    helper="${SELF_DIR}/tmux_pending_question.py"
    pending=""
    if [ -n "$transcript" ] && [ -r "$transcript" ] \
       && [ -r "$helper" ] && command -v python3 >/dev/null 2>&1; then
      pending=$(python3 "$helper" "$transcript" 2>/dev/null || printf '')
    fi
    if [ "$pending" = "1" ]; then
      attention_worthy=1
    elif [ -z "$pending" ]; then
      # Authoritative check unavailable: degrade to the legacy heuristic
      # (window already `●` ⇒ a tool is mid-flight). This can still mis-fire
      # on sub-agents, but only when the transcript check can't run.
      # `pending="0"` (helper ran, not blocked) intentionally skips this and
      # falls through to suppression below.
      current_name=$(tmux display-message -p -t "$TMUX_PANE" '#W' 2>/dev/null || printf '')
      case "$current_name" in
        "●"*) attention_worthy=1 ;;
      esac
    fi
  fi

  # No jq, or the payload didn't parse (jq_ok=0): we couldn't classify the
  # notification at all, so rather than going dark we fall back to the legacy
  # current-window heuristic (window already `●` ⇒ a tool is mid-flight and
  # Claude is plausibly waiting) and still raise the attention marker. With jq
  # present and parsed, jq_ok=1 and this is skipped — the jq path is unchanged.
  if [ "$jq_ok" -eq 0 ] && [ "$attention_worthy" -eq 0 ]; then
    current_name=$(tmux display-message -p -t "$TMUX_PANE" '#W' 2>/dev/null || printf '')
    case "$current_name" in
      "●"*) attention_worthy=1 ;;
    esac
  fi

  if [ "$attention_worthy" -eq 0 ]; then
    log="${HOME}/.claude/.tmux_indicator_notifications.log"
    {
      printf '%s\tntype=%s\tmsg=%s\tpayload=%s\n' \
        "$(date -Iseconds)" "${ntype}" "${msg}" "${payload}"
    } >> "$log" 2>/dev/null || true
    if [ -f "$log" ]; then
      tail -n 200 "$log" > "${log}.tmp" 2>/dev/null && mv "${log}.tmp" "$log" 2>/dev/null || true
    fi
    exit 0
  fi
fi

case "$state" in
  working)   prefix="●" ;;
  attention) prefix="⚠" ;;
  idle)      prefix=""   ;;
  *)         exit 0      ;;
esac

current=$(tmux display-message -p -t "$TMUX_PANE" '#W')
stripped=$(printf '%s' "$current" | sed -E 's/^[●⚠] *//')

base="$stripped"
# Decide whether the current name is a tmux/Claude-generated default that we
# should take over with the project folder name. Two signals:
#   * automatic-rename is still on  → tmux is auto-naming this window after the
#     running command, so no deliberate name exists yet. Our rename (below)
#     turns this off, as does a manual `rename-window`, so real names survive.
#   * the name is the launcher's default form: "claude" (node/npm install) or a
#     bare version like "2.1.159" (native install — the binary is named after
#     its version, so tmux reports the version as pane_current_command).
autoname=$(tmux display-message -p -t "$TMUX_PANE" '#{automatic-rename}' 2>/dev/null || printf '')
is_default=0
[ "$autoname" = "1" ] && is_default=1
case "$base" in
  claude|[0-9]*.[0-9]*.[0-9]*) is_default=1 ;;
esac
if [ "$is_default" = "1" ]; then
  if root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null); then
    base=$(basename "$root")
  else
    base=$(basename "$PWD")
  fi
fi

new="${prefix}${base}"
[ "$new" = "$current" ] && exit 0

tmux rename-window -t "$TMUX_PANE" "$new"
