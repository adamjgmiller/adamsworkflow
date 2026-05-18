---
description: Run /adamsreview:fix, then loop /quick-dual-review on the fix delta until verified clean
---

Apply auto-fixable review findings, then verify them via a dual-source review loop scoped to the fix delta. Preserves `/adamsreview:fix`'s per-fix commits.

Usage: `/ar:fix-and-verify [up to N times]`

Pass-through args: `up to N times` (or `up to N`) is forwarded to the verify loop. Default 5, hard ceiling 10 (refuse anything larger and say why).

## Step 0 — Preconditions

- Must be inside a git repo. Otherwise stop with the git error.
- A recent `/adamsreview:review` artifact must exist for `/adamsreview:fix` to act on. If `/adamsreview:fix` reports no artifact, stop and tell the user to run `/adamsreview:review` first.

## Step 1 — Capture pre-fix state

Record `PRE_FIX_SHA = git rev-parse HEAD`. State it back: *"Pre-fix state: `<PRE_FIX_SHA>`."*

If `git status --porcelain` is non-empty, **stop and ask the user**. Pre-existing uncommitted changes would tangle into the verify scope (`PRE_FIX_SHA...HEAD`). Tell the user to commit or stash first.

## Step 2 — Apply fixes

Invoke `/adamsreview:fix`. Wait for it to complete and report.

- If it applied no fixes (no auto-fixable findings), **stop and report**. Nothing to verify.
- If it errored, **stop and surface the error**. Do not proceed to verification on a half-applied state.
- Otherwise, record `POST_FIX_SHA = git rev-parse HEAD` and continue. The original fix commits live in `PRE_FIX_SHA..POST_FIX_SHA` and stay intact through the rest of this command.

## Step 3 — Verify loop (delegated, with LOOP_BASE override)

Delegate to a sub-agent to keep the loop's intermediate volume out of main context. We only need the final report.

Spawn a sub-agent (`general-purpose`, `model: opus`) — single Agent call, foreground.

Brief:

> Read and follow `~/.claude/commands/review-fix-loop.md` as your full instructions, with these specific overrides:
>
> **Step 0 (Parse `$ARGUMENTS`) — pre-resolved for you:**
> - Review command: `/quick-dual-review`
> - Max rounds: `<N if user passed `up to N times`, else 5>`
> - Auto-commit mode (do NOT use `--no-commit`).
>
> **Step 1 (Establish LOOP_BASE) — override:**
> - Do **not** run `git rev-parse HEAD` to detect LOOP_BASE.
> - Use `LOOP_BASE = <PRE_FIX_SHA>` (passed by the parent: `<PRE_FIX_SHA>`).
> - The dirty-tree checkpoint behavior in step 1 still applies: if `git status --porcelain` is non-empty, commit a checkpoint as the file specifies. (Normally clean post-`/adamsreview:fix`; no checkpoint needed.)
> - `LOOP_BASE...HEAD` then covers the full fix delta plus anything the verify loop adds.
>
> Otherwise execute `/review-fix-loop` normally: round loop, bucketing, stop checks, parallel fix sub-agents, per-round commits, final report.
>
> **Return** the full step-5 report verbatim, **plus** the final stop reason as a single token on its own line at the end: one of `convergence` | `human-needed` | `steady-state` | `regression` | `max-rounds`.

## Step 4 — Verdict and report

Treat the user's "100% satisfied" bar literally — only `convergence` is a clean pass. Map the stop reason to a verdict:

| Stop reason | Verdict |
|---|---|
| `convergence` | **VERIFIED CLEAN.** Fixes are complete, correct, and introduce no new issues per dual-source review. |
| `human-needed` | **VERIFICATION INCOMPLETE.** Design decisions surfaced — needs user input before re-verifying. |
| `steady-state` | **VERIFICATION INCOMPLETE.** Findings remain that the loop will not auto-fix. Human review required. |
| `regression` | **VERIFICATION FAILED.** Fixes introduced regressions the loop could not clean up. |
| `max-rounds` | **VERIFICATION INCOMPLETE.** Loop hit its cap with findings still open. |

Open with the verdict line, then pass through the sub-agent's `/review-fix-loop` report verbatim.

Close with:

- **Fix delta summary** — `git diff --stat <PRE_FIX_SHA>...HEAD` so the user sees total surface area.
- **Original `/adamsreview:fix` commits preserved** — `git log --oneline <PRE_FIX_SHA>..<POST_FIX_SHA>` so the user can confirm the granular commits are intact.
- **Verify-loop commits added** — `git log --oneline <POST_FIX_SHA>..HEAD` (empty if `convergence` on round 1 with no further fixes).

## Failure modes

- **Pre-existing uncommitted changes at step 1**: bail. Tell the user to commit/stash first.
- **`/adamsreview:fix` finds nothing to fix**: stop after step 2, report. No verify loop needed.
- **`/adamsreview:fix` errors**: surface the error, do not delegate to the verify loop.
- **Sub-agent doesn't return a parseable stop reason**: re-prompt for it; if it still fails, default verdict to **VERIFICATION INCOMPLETE** and surface the ambiguity in the report.
- **Verify loop returns `regression` or `max-rounds`**: report failure/incomplete, leave git state in place. Do **not** auto-revert — the user decides whether to revert (`git reset --hard <PRE_FIX_SHA>`), hand-fix, or accept.
