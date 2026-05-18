---
description: Dual-source review of recent work — Claude (/quick-review) + Codex (/codex-consult review) in parallel, deduped and validated against the actual diff
---

Run two independent reviews of the recent work and synthesize the results.

## Step 1 — Detect scope once, here in the main agent

Both reviewers must see the same diff or dedup is meaningless.

Pick the first that matches:

1. `git status --porcelain` non-empty → scope is `uncommitted`.
2. Current branch ahead of `main` (fall back to `master`) → scope is `<merge-base>...HEAD` (compute the merge-base; pass the literal range as a string).
3. Otherwise → scope is `HEAD` (most recent commit). If even that seems irrelevant, stop and ask the user what to review.

Hold the scope as an explicit string. State it back to the user in one line before spawning reviewers.

## Step 2 — Run both reviewers (parallel if you can, inline if you can't)

Whether you can fan out depends on whether you have the `Agent` tool — sub-agents don't (Claude Code doesn't expose `Agent` to dispatched sub-agents at all), so this skill has to work in two modes. Either way, both reviewers see the same `<SCOPE>` and produce findings in the same shape; Step 3 onward doesn't care which mode ran.

**Top-level mode (you have `Agent`):** send a single message with two Agent calls (foreground, parallel — not background). Both `general-purpose`, `model: opus`. Use the briefs below as the Agent prompts verbatim.

**Sub-agent mode (no `Agent` — e.g., this skill was reached via `/review-fix-loop` dispatching a review sub-agent):** sub-agents can't fan out via `Agent`, but you can still reclaim parallelism by launching Codex detached *before* doing your own Claude review. codex-consult's launch step (gotcha 3, step 1) returns in milliseconds; Codex's actual run happens in the background while you run Claude inline. Execute in this order:

1. **Preflight Codex**: `command -v codex`. If missing, skip Codex entirely and run only Reviewer A — label the final report single-source and proceed. Do not retry.

2. **Launch Codex detached (Reviewer B, launch step only)**: follow `~/.claude/skills/codex-consult/SKILL.md` gotcha-3 step 1 in `review` mode against `<SCOPE>`. Write the assembled prompt to `/tmp/codex-prompt-$JOB_ID.txt`, run Codex via `( ... ) & disown`, capture the `JOB_ID` from the launch step's stdout. **Remember `JOB_ID` across the rest of this skill's execution** — it's the only handle on the background job. Reviewer B's brief below tells you what to keep from Codex's output.

3. **Run Claude inline (Reviewer A)**: read and execute `~/.claude/commands/quick-review.md` yourself against `<SCOPE>`. Produce findings in the shape Reviewer A's brief below specifies. Codex runs in the background — do not poll or wait. If you reach step 4 before Codex finishes, the wait there handles it.

4. **Collect Codex (Reviewer B, wait + capture)**: poll the sentinel at `/tmp/codex-done-$JOB_ID.flag` per codex-consult gotcha-3 step 2, then read `/tmp/codex-out-$JOB_ID.log`. Often the sentinel is already present — no real wait. If Codex errored or the log is truncated, surface the `JOB_ID` and `exit=N` so Step 3's proof-of-execution check passes; do not fall back to a second Claude review. Gotcha 4 (stay engaged after an auto-backgrounded wait) still applies — if the wait Bash call returns auto-backgrounded, do the sentinel check in the same response.

Don't flag the inlining as a defect — it's expected at this nesting level. Label the report `concurrent single-process dual-source` (vs. `parallel dual-source` for top-level fan-out) so the parent knows which path ran, but treat both as first-class outcomes.

**Reviewer A — Claude `/quick-review`**

Brief:

> You are a second-opinion reviewer. Read and follow this file as your full instructions:
>
>   `~/.claude/commands/quick-review.md`
>
> Scope (do not redetect): `<SCOPE>`
>
> Format — use this exact shape per finding so the parent can dedup against the Codex side:
>
>     N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
>        Location: <file>:<line>  (or "cross-cutting")
>        Finding: <2-4 sentences>
>        Suggestion: <concrete fix, or "needs human judgment">
>
> After the numbered list, a "Notes" section for cross-cutting observations. If nothing's worth flagging, say so explicitly.

**Reviewer B — Codex `/codex-consult review`**

Brief:

> You are a **Codex runner**, not a reviewer. Your job is to execute Codex and pass through its output. You do not decide whether a review is warranted — that decision was already made by the parent that dispatched you. Skipping is a failure mode, not an optimization: do not skip based on diff triviality, perceived redundancy with the other reviewer, or your own assessment of need. The parent specifically wants Codex's independent take.
>
> Read and follow this skill as your full instructions:
>
>   `~/.claude/skills/codex-consult/SKILL.md`
>
> Run in `review` mode against scope: `<SCOPE>`.
>
> Return, in this order:
>
> 1. **Proof of execution**: the `JOB_ID` and the sentinel `exit=N` line (from `/tmp/codex-done-$JOB_ID.flag`). Without these, the parent will treat the run as skipped.
> 2. **Codex's findings** in the prescribed shape from the skill — pass through the raw findings list and Notes section, don't paraphrase or summarize.
>
> If Codex isn't installed, say so plainly with the `command -v codex` output. If a run errors mid-flight, return the `JOB_ID`, sentinel exit code, and whatever log content exists. In neither case do you fall back to your own review.

## Step 3 — Dedup and validate, in this main agent, against the actual diff

Don't skip — this is why we paid the main-context cost.

1. **Verify both reviewers actually ran.** Reviewer B must have returned a `JOB_ID` and a sentinel `exit=N` line. If either is missing, the sub-agent skipped Codex despite the brief — re-dispatch Reviewer B with explicit emphasis on the non-skip clause, or, if the user is waiting, surface the skip to them and label the resulting report single-source. Do not silently proceed with Claude-only findings as if dual-review succeeded.

2. **Read the actual diff for `<SCOPE>`** — `git diff` for uncommitted, `git diff <base>...HEAD` for branch range, `git show <SHA>` for a commit. Validation must be grounded in real diff content, not in the reviewers' summaries.

3. **Dedup by `(file, ~line, topic)`.** Findings on the same line about the same issue → merge into one with attribution `(flagged by both)`. Single-source findings → keep with `(Claude only)` or `(Codex only)`. Don't drop a finding just because one reviewer missed it.

4. **Validate each finding.** For each one, confirm the cited file/line exists in the diff and the cited code actually behaves as described. Drop or downgrade findings whose citation is hallucinated or whose claim doesn't survive contact with the diff.

5. **Surface divergence.** If the two reviewers gave contradictory takes on the same issue (one "fine", one "broken"), call that out explicitly rather than picking a winner — divergent takes are the highest-value flags for human attention.

## Step 4 — Report

Present the validated, deduped findings in `[SEVERITY] / Location / Finding / Suggestion` format, with attribution and divergence notes. Close with: count by severity, overall assessment, items needing human judgment.

This command is review-only. Do not fix anything — leave that to the user (or to `/adamsreview:fix`, etc.) after they've seen the report.

## Failure modes

- **Codex unavailable**: report Claude's findings alone, label clearly as single-source, suggest the user install Codex if they want the cross-check.
- **No diff in scope**: stop early after step 1, tell the user there's nothing to review.
- **Reviewers contradict the diff**: that's what step 3 catches — drop the bad finding and note it.
