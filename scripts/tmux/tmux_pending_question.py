#!/usr/bin/env python3
"""Decide whether Claude Code is currently blocked on a user-facing prompt.

Helper for tmux_window_indicator.sh. Reads a Claude Code transcript
(JSONL; path = argv[1]) and reports whether the MOST RECENT main-chain
(non-sidechain) AskUserQuestion / ExitPlanMode tool_use is still
unresolved (has no matching tool_result yet).

That is the authoritative signal for "Claude is waiting on the human."
It is needed because the idle_prompt Notification that drives the ⚠
indicator is ambiguous: the payload is byte-identical whether Claude is
genuinely blocked on a question or the main loop is merely idling while a
sub-agent / long tool runs. Keying off the transcript instead of the
window state removes the "sub-agent finished -> false ⚠" misfire, because
sub-agent (sidechain) activity never produces a main-chain blocking
tool_use.

Output contract (consumed by tmux_window_indicator.sh):
    "1"  -> a question / plan prompt is open; raise ⚠
    "0"  -> not blocked on the user; leave the indicator alone
    ""   -> undecidable (missing/unreadable file, or readable content that
            is not a recognizable transcript); the caller falls back to its
            legacy heuristic
Always exits 0 so the shell command substitution stays clean under `set -e`.
"""
import json
import sys

# Tools whose tool_use blocks the turn waiting for the human to respond.
# NOTE: tool_result blocks are matched inside `message.content[]`, which is
# where current Claude Code transcripts record them; if a future version
# relocates them, the resolution check would need updating.
BLOCKING = {"AskUserQuestion", "ExitPlanMode"}


def decide(path):
    """Tri-state verdict: True (prompt open), False (none open), None (undecidable).

    None is returned only when the file had content but not one line parsed as
    a JSON object — i.e. it is not a recognizable transcript (corrupt / wrong
    format), so the caller should fall back rather than trust a "0". An empty
    file, or a valid transcript with no open prompt, is False. Isolated
    unparseable lines (e.g. a partially-written final line) are skipped.
    """
    resolved = set()      # tool_use_ids that have received a tool_result
    last_block_id = None  # id of the most recent main-chain blocking tool_use
    seen = 0              # non-empty lines encountered
    parsed = 0            # lines that parsed as a JSON object
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            seen += 1
            try:
                d = json.loads(line)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            parsed += 1
            msg = d.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            sidechain = bool(d.get("isSidechain"))
            for b in content:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "tool_use":
                    if not sidechain and b.get("name") in BLOCKING and b.get("id"):
                        last_block_id = b.get("id")
                elif t == "tool_result":
                    rid = b.get("tool_use_id")
                    if rid:
                        resolved.add(rid)
    if seen > 0 and parsed == 0:
        return None  # had content but nothing parsed -> not a transcript
    return last_block_id is not None and last_block_id not in resolved


def main():
    if len(sys.argv) < 2:
        print("")
        return
    try:
        verdict = decide(sys.argv[1])
    except Exception:
        print("")
        return
    print("" if verdict is None else ("1" if verdict else "0"))


if __name__ == "__main__":
    main()
