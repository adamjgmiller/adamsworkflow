---
description: Loop a review command, fix high-confidence findings, re-review until convergence — Opus throughout
---

Loop a review command and fix findings until convergence or a hard stop.

Usage: `/review-fix-loop <review-command> [up to N times] [don't commit]`

Examples:
- `/review-fix-loop /quick-review`
- `/review-fix-loop /quick-dual-review up to 3 times`
- `/review-fix-loop /quick-review don't commit`

## Step 0 — Parse `$ARGUMENTS`

- **Review command** (required): first `/...` token (e.g., `/quick-review`, `/quick-dual-review`). Missing → stop and ask.
- **Max rounds** (optional): `up to N times` or `up to N` → cap at N. Default 5. Hard ceiling 10 — refuse anything larger and say why.
- **No-commit mode** (optional): triggered by `don't commit`, `no commit`, or `--no-commit`.

State the parsed plan back in one line before starting (e.g., *"Looping `/quick-dual-review` up to 5 rounds, auto-commit per round."*).

## Step 1 — Establish `LOOP_BASE`

Record the current HEAD SHA as `LOOP_BASE` (`git rev-parse HEAD`). If `git status --porcelain` is non-empty, commit the pre-loop state:

```bash
git add -A && git commit -m "checkpoint: pre-/review-fix-loop state"
```

Mandatory **even in `--no-commit` mode** — each round's review needs cumulative state in HEAD. Step 4 resets at the end if `--no-commit`.

State: *"Captured pre-loop state at `<LOOP_BASE_SHA>`."*

If `--no-commit` mode is on, also state: *"Per `--no-commit`: I'll commit per round internally, then soft-reset back to uncommitted changes at the end. Interrupt now if that's not what you want."*

## Step 2 — Round loop

For each round `r` in `1..max_rounds`:

### 2a. Run the review

Spawn a sub-agent (`general-purpose`, `model: opus`) with this brief:

> Read and follow this file as your full instructions:
>
>   `~/.claude/commands/<review-command-without-slash>.md`
>
> Scope (do not redetect): `<LOOP_BASE_SHA>...HEAD`
>
> Use the prescribed finding format. Do not modify files.
>
> **Already pending human judgment** (round > 1 only; omit this block if `HUMAN_PENDING` is empty):
>
> The following findings have already been surfaced for the user to decide on. The orchestrator will dedupe automatically — do **not** invest analysis re-litigating these, and do not re-explain them in your report. You **should** still flag genuinely new issues in the same files or near the same lines (regressions, adjacent bugs, fixes that worsened things) — the suppression is per-finding, not per-area.
>
> - `<file:line>` — `<one-line summary>` — *pending since round N*
> - ...
>
> If you are dispatching to `/quick-dual-review` (sub-agent mode), splice the bulleted "already pending" list above into **both** the Codex assembled prompt and the inline `/quick-review` you run, so neither reviewer wastes cycles re-litigating these.

If the review command is `/quick-dual-review`, the sub-agent will hit that skill's **sub-agent mode**, which handles parallelism internally — don't brief it on the mechanism. Expect the report labeled `concurrent single-process dual-source`. Pending-HUMAN forwarding is best-effort — orchestrator dedup in Step 2b catches any duplicates.

### 2b. Bucket findings (orchestrator decides, on Opus, in main context)

For each finding, assign:

- **FIX** — severity is `critical`/`high` (always), OR severity is `medium`/`low`/`nit` AND the fix is **low-effort** (small, single file, mechanical) AND **low-risk** (no cross-cutting impact, no behavior change beyond stated intent).
- **HUMAN** — design decisions, or anything the reviewer flagged as "needs human judgment." Not for the loop to fix. Accumulated across rounds and surfaced together at the end (see Step 5) — the loop does **not** stop on HUMAN findings.
- **DEFER** — everything else: high-effort fixes, ambiguous findings, pre-existing issues outside the change scope, low-confidence fixes.

Your call — read the diff and suggestion, judge. Don't delegate.

**Accumulating HUMAN across rounds**: maintain a `HUMAN_PENDING` set keyed by `(file, ~line, topic)` — same dedup key as the regression check. Each round, merge this round's HUMAN findings in; don't re-surface ones already present. A HUMAN finding stays in `HUMAN_PENDING` even if a later round no longer flags it — leave it for the user to dismiss.

**Why no stop on HUMAN**: trade-off is explicit — some `FIX` work may be re-done if a design answer invalidates it, in exchange for one consolidated decision pass. If a HUMAN finding looks load-bearing (likely to invalidate fixes in the same area), prefer to bucket related FIXes as DEFER rather than fixing them this round — that contains the blast radius without halting the whole loop.

### 2c. Stop checks (before fixing)

Stop *before* attempting fixes if any:

- **FIX bucket empty** → stop. Convergence. (HUMAN findings, if any, are surfaced in Step 5 — they don't count as non-convergence.)
- **Steady state**: this round's findings ⊆ previous round's DEFER set ∪ `HUMAN_PENDING`, no new ones → stop. No progress possible.
- **Regression**: this round's "newly introduced" count (vs. last round on unchanged code, keyed by `(file, ~line, topic)`) exceeds last round's fixed count → stop. Fixes are making it worse.

### 2d. Group + spawn fix sub-agents

Group FIX findings using judgment:

- **Single sub-agent** for: small mechanical fixes across files (token-efficient), OR a cluster of related findings (one bug class, related lines).
- **One sub-agent per file** when each file has substantive, independent fixes.
- **Parallel sub-agents** for groups in different files — send concurrent Agent calls in a single message.

Each fix sub-agent (`general-purpose`, `model: opus`) brief:

> Apply the following fixes:
>
> 1. `<file:line>` — `<finding>` — `<suggestion>`
> 2. ...
>
> Rules:
> - Minimal, targeted edits. No scope creep, no opportunistic refactors, no adjacent cleanup.
> - If a fix turns out harder than expected (suggestion oversimplified, cross-cutting impact, behavior change beyond intent) → **skip it**. Report skipped with one-sentence reasoning.
> - For each fix applied: file:line, one-line description, before/after snippets (3-5 lines each).
> - For each skipped: file:line, the original suggestion, why skipped.

Collect results. Skipped findings move to DEFER for this round.

### 2e. Commit the round

```bash
git add -A && git commit -m "fix(round <r>): <K> fixes from <review-command>

<one-line summary per fix, max ~5 lines>"
```

Skip if no fixes were applied — next round will detect steady state.

### 2f. Continue or stop

Loop back to 2a until a stop condition fires or `r == max_rounds`.

## Step 3 — Capture stop reason

One of: `convergence` | `steady-state` | `regression` | `max-rounds`.

(There is intentionally no `human-needed` stop reason — HUMAN findings accumulate in `HUMAN_PENDING` and surface in Step 5 regardless of how the loop stopped.)

## Step 4 — Finalize git state

**Auto-commit mode**: leave commits in place. Tell user how many were added on top of `LOOP_BASE`.

**`--no-commit` mode**: soft-reset to LOOP_BASE:

```bash
git reset --soft <LOOP_BASE_SHA>
```

This collapses the per-round commits and pre-loop checkpoint back into staged uncommitted changes. Tell the user: *"Per `--no-commit`: squashed N loop commits back to uncommitted changes (staged) on top of `<LOOP_BASE_SHA>`. Run `git reset` if you want them unstaged instead."*

## Step 5 — Report

Present:

```markdown
# Review-Fix Loop — <review-command>

**Rounds run**: <N> of <max>
**Stop reason**: <reason> — <one-line elaboration>
**Final git state**: <"<K> commits on top of <LOOP_BASE_SHA>" | "uncommitted changes on top of <LOOP_BASE_SHA>">

## Per-round summary

| Round | Findings | Fixed | Deferred | Human (new) | Introduced |
|-------|----------|-------|----------|-------------|------------|
| 1     | …        | …     | …        | …           | …          |
| …     |          |       |          |             |            |

"Human (new)" counts HUMAN findings added to `HUMAN_PENDING` that round — duplicates of earlier rounds are not counted again.

## Fixes applied

(grouped by round/commit, file:line + one-line description per fix)

## Human judgment needed

(All `HUMAN_PENDING` findings, deduped across rounds. The loop did **not** act on these — they need a decision from you.)

For each:
- [SEVERITY] file:line — summary
- The design question or judgment call, in one sentence
- First seen: round N
- If applicable: which FIXes from later rounds touched the same area and may need to be re-evaluated once the design is decided

If empty, say so: *"No human-judgment findings surfaced."*

## Outstanding

For each unfixed finding *that is not a HUMAN finding* (i.e., DEFER, skipped fixes, pre-existing issues):
- [SEVERITY] file:line — summary
- Recommendation: **follow-on fix** | **skip** | **pre-existing** | **file an issue**
- Reason: one sentence

## Regressions caught

(findings introduced by a fix that were caught and fixed in a subsequent round, if any)

## Notes

(codex unavailability, sub-agent skips, anything else worth surfacing)
```

## Failure modes

- **Review command not recognized**: bail at step 0.
- **Max rounds > 10**: bail at step 0.
- **Pre-loop checkpoint commit fails** (e.g., only gitignored changes): bail with the git error.
- **All fix sub-agents skip everything in a round**: DEFER everything, next round detects steady state.
- **Parallel sub-agents conflict on shared file** (shouldn't happen with proper grouping): revert that round's partial work, fall back to sequential within the round.
