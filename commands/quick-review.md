---
description: Single-pass review of recent work — bugs, regressions, side effects. The lightest review tier — inline by default, one fresh-eyes sub-agent when reviewing your own edits and you hold Agent; emits the standard finding format; also serves as the Claude side of /dual-review.
---

Do a thorough review for bugs, unintended side effects, and regressions.

> Needs no Agent tool — without one it always runs inline, so it stays safe as a delegated leaf at any depth. The one conditional dispatch is the fresh-eyes rule below.

## Pick scope

If you've been making changes in this conversation, review *those* changes — re-read the actual diff, not your recollection.

If you were freshly spawned with no prior edits this session, detect scope from git:

1. `git status --porcelain` non-empty → uncommitted changes.
2. Current branch ahead of `main` (fall back to `master`) → `<merge-base>...HEAD`.
3. Otherwise → the most recent commit (`HEAD`).

If a caller (e.g. `/dual-review`) handed you an explicit scope, use that — don't redetect.

State the scope you picked in one line at the top of your review.

## Fresh eyes — who runs the review

Self-review is the biased case: the author "knows what the code is supposed to do" and reads intent instead of behavior. So, with scope in hand:

- **The scope is edits you yourself authored this session (a delegated child's edits don't count) AND you hold the `Agent` tool** → don't review it yourself. Dispatch one fresh sub-agent (`general-purpose`, `model: opus` — real-reasoning leaf per the delegation policy, capped at the session/dispatcher tier like any dispatch; Fable only if the user named it) briefed to read and execute this file. The brief must carry: this file's path as its full instructions; the explicit scope (tell it not to redetect); the absolute repo/worktree path (its cwd resets on every Bash call — field-notes §2); one line of change intent if known (omit rather than guess); and review-only discipline (no file edits, no git mutations). Relay its report intact — you may append your own Notes, labeled as yours, but never soften its findings. Dispatch fails or the report comes back unusable → retry once, then fall back to reviewing inline and label the report `fresh-eyes unavailable — self-reviewed` — never silently self-review.
- **Every other case** → run it inline yourself: you hold no `Agent` tool (a delegated review leaf is already the fresh eyes; an authoring leaf that can't spawn has no alternative — accepted bias), or the changes aren't yours. Never chain: a sub-agent executing this file authored nothing, so it always lands in this inline branch.

## Lens

Apply the blast-radius lens from your global CLAUDE.md (see `CLAUDE-global.md` in this repo): every writer, every consumer, parallel code paths, full implementations not just signatures, fix the class not the instance, stale comments and docs.

Then, adapting to the change (skip irrelevant axes), check:

- **Correctness & edge cases** — boundaries, empty/null, off-by-one, wrong operator, bad assumptions.
- **Failure paths** — errors, nil returns, timeouts, partial failure, rollback.
- **Security** — authz/authn, injection, secrets, sensitive-data exposure.
- **Concurrency** — races on shared state, ordering assumptions.
- **Resource lifecycle** — leaks, cleanup, transaction boundaries.
- **Contracts** — API/back-compat, what callers expect.
- **Tests** — added or updated, and actually covering this change.

Read the full surrounding code, not just the diff hunks; weigh what's *missing* (tests, error handling, validation), not only what changed. Do a second skeptical pass before reporting.

## Report

Use the suite's shared finding format and severity vocabulary (`critical | high | medium | low | nit` — the same vocab /dual-review, /lens-review, and /review-fix-loop's FIX bucketing key on):

    N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
       Location: <file>:<line>  (or "cross-cutting")
       Finding: <2-4 sentences — what's wrong and why>
       Suggestion: <concrete fix, or "needs human judgment">

After the numbered list, a "Notes" section for cross-cutting observations. Mark each finding **high-confidence** or **speculative** — don't blur the two. If nothing material surfaces, say so explicitly rather than padding.

## Disposition

Report your findings — **review-only by default**. Do not modify files, mutate git state (`add`/`commit`/`checkout`/`restore`/`stash`/`clean`/`reset`), or mutation-test the working tree: when you run as a leaf in a fan-out, siblings read the same tree and a fix loop may run right after you. Running the test suite as-is is fine; to judge whether the tests would catch a mutation, reason about it statically and report it — don't run the experiment. **One exception**: if the same request explicitly asks you to fix what you find (e.g., "run /quick-review then fix what you find before reporting back"), do that as a separate fix phase *after* reporting, under the normal edit/commit rules — this never applies when you're a delegated leaf, which carries no such user request.
