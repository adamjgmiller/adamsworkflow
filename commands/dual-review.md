---
description: Dual-source review — one Claude pass (/quick-review, its fresh-eyes rule honored) + one detached Codex run on the same scope, deduped and validated against the diff. The middle review tier; leaf-safe at any depth (needs no Agent tool).
---

Run two independent reviews of the recent work and synthesize the results.

**One path, every context.** Both reviewers run from *this* agent: Claude per quick-review's fresh-eyes rule (inline — unless the scope is your own session's edits and you hold `Agent`, then its pass is one fresh sub-agent whose report becomes Reviewer A's input), Codex as a detached background process collected via a sentinel file. This works identically at top level, inside a dispatched sub-agent, or in a Workflow agent — file-based handoff is the result channel that survives every context, including the ones task-notifications don't reach (Workflow agents, named teammates — `~/.claude/docs/field-notes.md` §4). Do not dispatch a child agent for the Codex side, and never touch another agent's `/tmp` files.

## Step 1 — Establish scope once, here

Both reviewers must see the same diff or dedup is meaningless.

**If your dispatcher handed you an explicit scope** (e.g. review-fix-loop's "Scope (do not redetect)" brief), **use it verbatim and skip detection.** Otherwise pick the first that matches:

1. `git status --porcelain` non-empty → scope is `uncommitted`.
2. Current branch ahead of `main` (fall back to `master`) → scope is `<merge-base>...HEAD` (compute the merge-base; pass the literal range as a string).
3. Otherwise → scope is `HEAD` (most recent commit). If even that seems irrelevant, stop and ask the user what to review (or, if you have no user channel — e.g. a Workflow agent — return the question as your result and stop).

Hold the scope as an explicit string. State it back to the user in one line before starting.

A dispatcher-supplied worktree applies to every git command **and the Codex launch** alike — `cd <worktree>` at the start of each Bash call (cwd resets between calls; field-notes §2), so Codex's own git reads hit the right checkout.

## Step 2 — Run both reviewers concurrently

Execute in this order:

1. **Preflight Codex**: `command -v codex`. If missing, skip the Codex side entirely, run only Reviewer A, and label the final report **`single-source`** — do not retry, and do not substitute a second Claude pass for Codex.

2. **Launch Codex detached (Reviewer B)**: follow `~/.claude/skills/codex-consult/SKILL.md` gotcha-3 step 1 in `review` mode against `<SCOPE>`. Compose the prompt from that skill's review-mode body — folding in, verbatim, any Pending/Decided lists your dispatcher provided as context the reviewers should not re-litigate — write it to `/tmp/codex-prompt-$JOB_ID.txt`, and launch via `( … ) & disown`. The launch returns in milliseconds. **Hold `JOB_ID` from the launch stdout in conversation context for the rest of this command** — it is the only valid handle on the job. Never glob `/tmp/codex-*` to find or clean a job (concurrent sessions share that namespace; a glob can read or kill someone else's run), and never store the ID in a shared path.

3. **Run Claude (Reviewer A)**: read and execute `~/.claude/commands/quick-review.md` against `<SCOPE>` — including its fresh-eyes rule: reviewing your own edits while holding `Agent` → its pass runs as one fresh sub-agent whose report you take unaltered as Reviewer A's input — never soften it, and Step 3 still dedups/validates the final report; every other case → execute it yourself inline (no Agent tool → always inline, which is what keeps this command leaf-safe). Its native finding format is the required shape (severity `critical|high|medium|low|nit`), so dedup against the Codex side lines up. Honor the context injection below — in the fresh-eyes case it goes into the sub-agent's brief. Codex runs in the background the whole time — do not poll mid-review.

4. **Collect Codex (Reviewer B)**: poll the sentinel per gotcha-3 step 2 — a separate Bash call with `timeout: 600000` running `until [ -f /tmp/codex-done-$JOB_ID.flag ]; do sleep 10; done`. Often the sentinel is already present and there is no real wait. Gotcha 4 applies: if the wait call returns auto-backgrounded, do a fast sentinel check **in the same response** and re-issue the poll if it isn't there yet — the flag file is the source of truth; never end the turn "waiting to be notified."

5. **Extract, don't ingest**: once the sentinel exists, read the `exit=N` line from the flag file, then pull only the findings block from the log instead of cat-ing the whole file:

   ```bash
   sed -n '/^[[:space:]]*1\. \[SEVERITY/,$p' /tmp/codex-out-$JOB_ID.log
   ```

   If extraction comes back empty, **log why before falling back** — a blank result is a *symptom* (format drift in the `1. [SEVERITY` anchor, or Codex returning error text instead of findings), not a bug in the `sed`. Record `exit=N`, whether the anchor matched (`grep -qE '^[[:space:]]*1\. \[SEVERITY' /tmp/codex-out-$JOB_ID.log && echo y || echo n`), and the extracted byte count, so a downstream reader pins the real cause instead of guessing. Then fall back to reading the log file directly and say so in the report. If `exit=N` is non-zero or the log is clearly truncated, surface the `JOB_ID` and exit line as evidence and proceed with the Codex side marked failed — do not invent findings, and do not paper over the failure.

6. **Clean up this job's files** by substituting the literal `JOB_ID` (gotcha-3 cleanup step) — never a wildcard.

If Codex completed with usable output, label the report **`concurrent single-process dual-source`** (`single-process` asserts the Codex side — detached from this agent, no codex-runner child — so it holds on both Reviewer A paths, inline and fresh-eyes); otherwise the `single-source` failure labeling from steps 2.1/2.5 and the Failure modes applies.

**Reviewer A — context injection** *(quick-review's native format already matches the Codex side)*

> Scope (do not redetect): `<SCOPE>`
>
> For `uncommitted` scope: read `git diff HEAD` plus untracked files from `git status --porcelain` — the same ground truth step 3.2 validates against (plain `git diff` would review a narrower diff than the Codex side sees).
>
> [If a dispatching loop handed you Pending/Decided lists: honor them per its instructions — don't re-litigate those items. The same lists go verbatim into the Codex prompt body in step 2.2.]

## Step 3 — Dedup and validate, against the actual diff

Don't skip — this is the point of running two sources.

1. **Verify both reviewers actually ran.** The report must carry the `JOB_ID` and the sentinel `exit=N` line from your own step-2 launch — proof Codex executed rather than being skipped. If Codex was unavailable at preflight or errored mid-run, label the report `single-source` with the evidence. Never silently present Claude-only findings as if dual-review succeeded.

2. **Read the actual diff for `<SCOPE>`** — `git diff HEAD` for uncommitted (staged + unstaged — plain `git diff` misses staged work the Codex prompt *does* review), plus untracked files via `git status --porcelain` (read them directly); the **literal** scope string for a branch range (`git diff <A>...<B>` — the same string every reviewer got, not a rewritten `...HEAD`); `git show <SHA>` for a commit. Validation must be grounded in real diff content, not in the reviewers' summaries — a ground truth narrower than what the reviewers saw drops real findings as hallucinated.

3. **Dedup by `(file, ~line, topic)`.** Findings on the same line about the same issue → merge into one with attribution `(flagged by both)`. Single-source findings → keep with `(Claude only)` or `(Codex only)`. Don't drop a finding just because one reviewer missed it.

4. **Validate each finding.** Confirm the citation is real and the issue is **caused by the scoped diff** — a blast-radius finding may legitimately cite an unchanged caller or consumer the diff breaks; validate those against the checkout rather than dropping them for being outside the diff. Drop or downgrade findings whose citation is hallucinated or whose claim doesn't survive contact with the code.

5. **Surface divergence.** If the two reviewers gave contradictory takes on the same issue (one "fine", one "broken"), call that out explicitly rather than picking a winner — divergent takes are the highest-value flags for human attention.

## Step 4 — Report

Present the validated, deduped findings in `[SEVERITY] / Location / Finding / Suggestion` format, with attribution and divergence notes, plus the `JOB_ID` + `exit=N` proof line (on the `single-source` path there is no job — include the Codex-unavailable or failure evidence from step 3.1 instead). Close with: count by severity, overall assessment, items needing human judgment.

This command is review-only. Do not fix anything — leave that to the user (or a follow-up fix pass, e.g. `/review-fix-loop`) after they've seen the report.

## Failure modes

- **Codex unavailable** (preflight): report Claude's findings alone, label `single-source`, suggest installing Codex for the cross-check.
- **Fresh-eyes dispatch fails / unusable report** (fresh-eyes case only): quick-review's own fallback applies — retry once, then Reviewer A runs inline, labeled `fresh-eyes unavailable — self-reviewed` in the report.
- **No diff in scope**: stop early after step 1, tell the user there's nothing to review.
- **Codex non-zero exit / truncated log**: Codex side marked failed with `JOB_ID` + `exit=N` evidence; report goes out `single-source`.
- **Findings extraction empty**: read the full log instead; note the fallback in the report.
- **Reviewers contradict the diff**: step 3 catches it — drop the bad finding and note it.
