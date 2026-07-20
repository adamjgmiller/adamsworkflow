# tmux indicators for Claude Code

Two small helpers that surface Claude Code's state in the **tmux window name**,
so you can tell at a glance — across many panes/windows — which session is
working, which is waiting on you, and which is idle.

## What each does

### `tmux_window_indicator.sh <state>`

Rewrites the current tmux window name with an activity glyph. It takes one
argument:

- `working` — prepends `●` (a tool is running / the turn is active).
- `attention` — prepends `⚠` (Claude is waiting on **you**).
- `idle` — strips any glyph (turn finished, nothing pending).

It strips any existing glyph before prepending (repeated fires never stack),
and early-exits when the name is already correct — important because the
`working` hook can fire many times per turn. On the first fire it also renames
the default `claude` window to the project/worktree folder name. It is a no-op
outside tmux.

For `attention` it reads the hook's JSON payload from **stdin**. The
`idle_prompt` notification ("Claude is waiting for your input") is ambiguous —
byte-identical whether Claude is genuinely blocked on a question or merely
idling while a sub-agent / long tool runs — so it disambiguates using the
transcript (see below) and only raises `⚠` when Claude is truly blocked.

### `tmux_pending_question.py <transcript_path>`

Helper for the `attention` path. Reads a Claude Code transcript (JSONL) and
prints:

- `1` — the most recent **main-chain** `AskUserQuestion` / `ExitPlanMode`
  tool call is still unanswered → Claude is waiting on you (raise `⚠`).
- `0` — nothing is blocking on you.
- `` (empty) — undecidable (unreadable/again-unrecognized transcript); the
  shell script falls back to a legacy heuristic.

Keying off the transcript (rather than window state) removes the
"sub-agent finished → false `⚠`" misfire: sub-agent (sidechain) activity never
produces a main-chain blocking tool call. The indicator script locates this
helper next to itself, so keep the two files in the same folder.

## Claude Code hook events they wire to

| State passed to the script | Claude Code hook event | When it fires                         |
| -------------------------- | ---------------------- | ------------------------------------- |
| `working`                  | `PreToolUse`           | before each tool call (turn is active)|
| `attention`                | `Notification`         | Claude notifies you (waiting/prompt)  |
| `idle`                     | `Stop`                 | the main agent finished responding    |

The `Notification` hook is the one that passes the JSON payload (with
`transcript_path`) on stdin; the `working`/`idle` hooks pass no arguments the
script needs.

## settings.json hooks snippet

Copy this into your Claude Code `settings.json` (adjust the path to wherever
you installed these scripts — they ship together in one folder):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "~/.claude/scripts/tmux/tmux_window_indicator.sh working" }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "~/.claude/scripts/tmux/tmux_window_indicator.sh attention" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "~/.claude/scripts/tmux/tmux_window_indicator.sh idle" }
        ]
      }
    ]
  }
}
```

Requirements: `tmux` (indicators are a no-op outside it), plus `python3` and
`jq` for the authoritative `attention` disambiguation (without them the script
degrades to a simpler heuristic rather than going dark).
