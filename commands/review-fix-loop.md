---
description: Loop a review command (/quick-review, /dual-review, /lens-review), fix critical/high + safe low-risk findings each round, re-review until convergence, steady-state, regression, or max rounds (default 5).
argument-hint: "<review-command> [its args] [scope <ref|A...B>] [up to N times] [don't commit]"
---

Loop a review command and fix findings until convergence or a hard stop.

Usage: `/review-fix-loop <review-command> [<args for the review command>] [scope <ref|A...B>] [up to N times] [don't commit]`

Examples:
- `/review-fix-loop /quick-review`
- `/review-fix-loop /dual-review up to 3 times`
- `/review-fix-loop /quick-review don't commit`
- `/review-fix-loop /lens-review security perf` (forwards `security perf` to `/lens-review` as its lens override)

## Step 0 — Parse `$ARGUMENTS`

- **Review command** (required): first `/...` token (e.g., `/quick-review`, `/dual-review`). Missing → stop and ask.
- **Max rounds** (optional): `up to N times` or `up to N` → cap at N. Default 5 — except **3 when the review command is `/lens-review`** (each of its rounds is a ~2×lenses fan-out; the cap is a cost guard, not a target — convergence to no meaningful findings is the goal and always wins the race, and an explicit `up to N` overrides either default). Hard ceiling 10 — refuse anything larger and say why.
- **No-commit mode** (optional): triggered by `don't commit`, `no commit`, or `--no-commit`.
- **Explicit scope** (optional): `scope <base-ref>` or `scope <A...B>` — consumed by the loop, never forwarded as pass-through (the explicit `scope` keyword keeps it from colliding with lens names and other pass-through args). Sets `REVIEW_BASE` in Step 1: a bare ref is the base; a range's left side is the base (the right side must be `HEAD` — the loop always reviews up to HEAD). Must resolve via `git rev-parse`; bail with the error if it doesn't.
- **Pass-through args** (optional): whatever remains after removing the review-command token, the max-rounds phrase, the no-commit phrase, and the scope phrase. Forwarded **verbatim** to the review command as *its* `$ARGUMENTS` (injected into the 2a brief). Empty if nothing remains; commands that take no arguments (e.g. `/quick-review`) ignore them. Example: `/review-fix-loop /lens-review security perf up to 2 times` → review command `/lens-review`, max rounds 2, pass-through `security perf` (which `/lens-review` consumes as its lens override).
- **Seed findings** (optional, dispatcher-supplied — not parsed from `$ARGUMENTS`): a caller that already holds a deduped, **validated** findings list in the prescribed format (e.g. `/pr-auto-review` Step 9 after its own fan-out + validation) may pass it as a `Seed findings:` block in its brief (or hold it in context when running the loop inline, as `/pr-auto-review` does). Round 1 then skips the 2a review dispatch entirely and goes straight to 2b bucketing on the seed list; rounds 2+ dispatch the review command as normal — convergence still comes from fresh reviews. Seeds must already be validated against the diff; the loop does not re-validate them.

State the parsed plan back in one line before starting (e.g., *"Looping `/lens-review security perf` up to 3 rounds, auto-commit per round."*).

## Step 1 — Establish `LOOP_BASE` and loop state

Record the current HEAD SHA as `LOOP_BASE` (`git rev-parse HEAD`) and the loop's working tree as `WORKTREE` (`git rev-parse --show-toplevel`) — every lane brief below anchors its sub-agent to `WORKTREE`, and **the loop's own git commands (this checkpoint, 2e's commits, Step 4's reset) all run from it too** (when this loop runs inline inside a worktree-resident stage-agent, the session-default cwd is a *different* checkout). **If HEAD is on the default branch, create a working branch first** (name it `review-fix/<short LOOP_BASE SHA>` unless your dispatcher named one — Steps 4–5 report it) — before the checkpoint below, in every mode *including* `--no-commit`, and regardless of which ladder rule sets `REVIEW_BASE` (the global CLAUDE.md's never-commit-to-main rule: the checkpoint and per-round commits must never land on main even transiently — an interrupted run would strand them there; Step 4's reset then leaves you on the working branch with the changes staged). Then, if `git status --porcelain` is non-empty, commit the pre-loop state:

```bash
git add -A && git commit -m "checkpoint: pre-/review-fix-loop state"
```

Mandatory **even in `--no-commit` mode** — each round's review needs cumulative state in HEAD. Step 4 resets at the end if `--no-commit`.

**Set `REVIEW_BASE`** — the left anchor of every round's review scope (2a's `Scope: <REVIEW_BASE_SHA>...HEAD`). First match wins:

1. Explicit `scope` arg from Step 0 → its base.
2. The checkpoint commit fired (tree was dirty) → `LOOP_BASE`. The loop reviews the just-checkpointed uncommitted work — the common "loop right after in-session edits" flow.
3. Tree was clean → `LOOP_BASE...HEAD` would be empty, handing every reviewer a nothing-diff while "do not redetect" suppresses their own scope detection. Anchor at `git merge-base HEAD main` (fall back `master`) instead — the work under review is the branch, exactly what the review commands' own detection ladders would have picked.
4. That merge-base equals HEAD (clean tree on the default branch itself) → `HEAD~1`, the sibling commands' "most recent commit" fallback. If even that is clearly not what's wanted (root commit, or the last commit is unrelated to anything reviewable), stop and ask for an explicit scope.

`LOOP_BASE` — not `REVIEW_BASE` — remains the anchor for Step 4's `--no-commit` reset, Step 5's commit count, and the `RUN_DIR` key: soft-resetting to a merge-base would collapse the user's own pre-loop commits into staged changes.

State: *"Captured pre-loop state at `<LOOP_BASE_SHA>`; review scope `<REVIEW_BASE_SHA>...HEAD`."*

Also set `RUN_DIR` = `<session scratchpad>/review-fix-loop/<short LOOP_BASE SHA>` and reset it (`rm -rf` then `mkdir -p` — a prior run at the same `LOOP_BASE`, e.g. a re-run after a `--no-commit` reset, would otherwise leave stale round reports the recovery path could mistake for this run's). Each round's 2a review agent writes its full report to `RUN_DIR/round-<r>-report.md` before returning — the recovery channel that survives lost completion notifications (field-notes §4).

Initialize, for use across rounds (tracked in the orchestrator's conversation context — the only on-disk artifacts are the 2a round-report files in `RUN_DIR`):

- `USER_PENDING`: set of findings to surface to the user at the end. Three kinds, distinguished by a `kind` field:
  - `preference` — bucketed directly as `USER_PREFERENCE` at intake (2b).
  - `consult-escalated` — bucketed as `AUTO_TECHNICAL`, then escalated when the dual-source consult couldn't confidently resolve it (2d synthesis).
  - `re-flag` — a `DECIDED_TECH` item the reviewer raised again in a later round (2b short-circuit).
  Deduped by `(file, ~line, topic)`. Accumulated across rounds. Surfaced in Step 5.
- `DECIDED_TECH`: set keyed by `(file, ~line, topic)`. Records each technical decision the loop resolved and applied via dual-source consult: `{ round, decision, rationale, consult_outcome, reflag_count }`. The `reflag_count` enables the persistent-re-flag rule (2b).

**Defining `(file, ~line, topic)`** (load-bearing — used for dedup, short-circuits, and regression detection):

- `file` and `~line` (line ± a small window for code that's shifted) are straightforward.
- `topic` = the underlying behavior change requested. Two findings share a topic if they would be addressed by **the same code edit** — not just because they sit on the same line. **Concrete heuristic**: same tag if the proposed minimal edit would touch overlapping lines AND have equivalent observable effect; different tags otherwise. Worked example of a pair that should *not* collapse: "add null-check on X" (tag: `null-handling`) and "memoize X to avoid recomputation" (tag: `cache-policy`) may both touch the same line, but their effects diverge — distinct topics. When the reviewer's wording varies but the proposed edit converges, treat as the same topic. The orchestrator normalizes topics to short tags during bucketing (e.g., `validation-strictness`, `null-handling`, `cache-policy`) so cross-round and cross-reviewer matching is reliable.

## Step 2 — Round loop

For each round `r` in `1..max_rounds`:

### 2a. Run the review

**Round 1 with Seed findings:** skip this step — take the seed list directly into 2b. Every later round dispatches normally.

**Dispatch it and collect its result before 2b.** Dispatches are async by default (async-only at depth; a main-level `run_in_background: false` sync opt-in exists — field-notes §4) — the review child's completion arrives as a task-notification carrying its report, attached to your next tool result or re-waking you if you've ended your turn. The same holds for every dispatch in this loop — the 2a review agent, Lane 1/3 fixers, the Lane 2 Claude consult: collect each one's notification before acting on its lane. Belt-and-braces: the 2a brief below makes the child write `RUN_DIR/round-<r>-report.md` before returning — if its notification is ever lost, recover from the file instead of re-dispatching blind.

Spawn a sub-agent (`general-purpose`, `model: opus` per the model-selection policy) with this brief:

> Read and follow this file as your full instructions:
>
>   `~/.claude/commands/<review-command-without-slash>.md`
>
> Your `$ARGUMENTS` for that file (pass-through from this loop's invocation): `<pass-through args, or "(none)" when the invocation supplied none>`. Treat this as that command's `$ARGUMENTS` and interpret exactly as its own Step 0 would — e.g. for `/lens-review` they are its lens override. `(none)` means no arguments were supplied (the command falls back to its own default); commands that take no arguments ignore this line.
>
> Scope (do not redetect): `<REVIEW_BASE_SHA>...HEAD`
>
> Change intent (include this line **only** if you know the goal — from the PR body, `plans/<branch>.md` Goal, this conversation, or the dispatcher): `<one-line objective of the change under review>`. Omit it entirely if genuinely unknown — a wrong guess is worse than none. (Goal-fit-style lenses anchor on this; review commands that don't use it ignore it.)
>
> Operate in `<WORKTREE>`: `cd <WORKTREE>` at the start of every Bash call (or `git -C <WORKTREE>` / absolute paths). Your cwd does not persist between calls, and the session-default cwd may be a different checkout — a SHA range resolves against the shared object DB from anywhere, so a wrong-tree review *looks* plausible while validating against the wrong files.
>
> Use the prescribed finding format. Do not modify files — with one exception: before returning, write your complete final report verbatim to `<RUN_DIR>/round-<r>-report.md` (a scratchpad path outside the worktree; it is the loop's recovery channel if your completion notification is lost — field-notes §4), then return the same report as your result.
>
> **Already known to the loop** (round > 1 only; omit this block if both `USER_PENDING` and `DECIDED_TECH` are empty):
>
> The following findings have already been surfaced to the user or resolved by the loop. The orchestrator will dedupe automatically — don't invest analysis re-litigating these. If the prescribed format requires an entry for each finding you encounter AND the format does **not** validate citations against the diff (e.g., `/quick-review`-style numbered output), include a one-line placeholder referencing the prior round (e.g., *"see round N — pending"* or *"see round N — decided"*) rather than a full re-explanation. For formats that validate citations against the diff (e.g., `/dual-review` step 3.4), simply suppress these items — a placeholder line without a real code citation reads as a hallucination to the validator. You **should** still flag genuinely new issues in the same files or near the same lines (regressions, adjacent bugs, fixes that worsened things) — the suppression is per-finding, not per-area. Items currently in `USER_PENDING` with `kind: re-flag` (decided items the reviewer raised again — see the persistent-re-flag rule) appear *only* in the Pending list below, not the Decided list, so you don't see conflicting framings of the same item.
>
> Pending (need user input):
> - `<file:line>` — `<one-line summary>` — *pending since round N*
> - ...
>
> Already decided this loop (via dual-source consult):
> - `<file:line>` — `<one-line summary>` — *decided in round N: <action>*
> - ...
>
> If you are dispatching to a dual-source review command (`/dual-review` or `/lens-review`), include both bulleted lists above verbatim — each folds them into its own reviewers (`/dual-review` into the Codex prompt body and its `/quick-review` pass (inline in this context — a loop round child authored nothing); `/lens-review` into every per-lens Opus brief and every per-lens Codex prompt), so no reviewer wastes cycles re-litigating these items.

If the review command is `/dual-review`, the dispatched review sub-agent runs both reviewers within itself — Claude inline plus Codex as a detached process gated on a sentinel file (works at any nesting depth; it spawns no children); it handles the mechanism internally, don't brief it on it. Expect the report labeled `concurrent single-process dual-source`; a `single-source` label means Codex was unavailable or its run failed/was unusable (the report carries the evidence) — note that degradation rather than retrying it. Pending forwarding is best-effort — orchestrator dedup in Step 2b catches any duplicates.

If the review command is `/lens-review`, the dispatched review sub-agent fans out one Opus + one Codex reviewer **per lens** as its own children, then dedups/validates and returns the standard finding format with per-lens Opus-vs-Codex divergences flagged. Because 2a dispatches it as a fresh `general-purpose` review agent (model per the model-selection policy) which carries the `Agent` tool, the fan-out runs; expect two status labels — codex: `dual-source` or `single-source` (Codex unavailable, lenses ran Opus-only); fan-out: `per-lens fan-out`. (Its `degraded-fanout` fallback can't occur under this dispatch — 2a always carries the `Agent` tool — so don't wait on it.) Per-lens divergences it flags are routed by the dual-source-divergence rule in 2b below. **If its report carries a high-severity `WORKTREE-LEAK:` Notes flag** (a read-only lens leaf leaked an edit it couldn't restore itself), restore the named paths — `git -C <WORKTREE> restore --staged --worktree -- <paths>` (plain `restore` pulls from the index, so a staged leak survives it; delete leaf-created untracked paths too) — **immediately, before Lane 1 FIX edits the tree**, else 2e's `git add -A` would sweep the stray edit into the round commit.

### 2b. Bucket findings (orchestrator decides, in its own context)

For each finding, assign:

- **FIX** — severity is `critical`/`high` (always), OR severity is `medium`/`low`/`nit` AND the fix is **low-effort** (small, single file, mechanical) AND **low-risk** (no cross-cutting impact, no behavior change beyond stated intent).
- **AUTO_TECHNICAL** — design or trade-off questions with a defensible "better" answer when weighing correctness, risk, maintainability, performance, and complexity. The reviewer hedged ("needs human judgment") but a senior engineer with full context would just decide. Examples: "is this validation strict enough?", "should this be cached?", "is N+1 acceptable here?", "is `X` or `Y` the right concurrency primitive?". Resolved this round via dual-source consult (see 2d).
- **USER_PREFERENCE** — depends on user preference, UX taste, business intent, or organizational convention not visible in the code. Examples: "should this error toast auto-dismiss?", "is this naming consistent with your conventions?", "does this match your product intent?". Added to `USER_PENDING` with `kind: preference`, surfaced in Step 5. The loop does not act on these.
- **DEFER** — everything else: high-effort fixes, ambiguous findings, pre-existing issues outside the change scope, low-confidence fixes.

Default to `USER_PREFERENCE` when classification between `AUTO_TECHNICAL` and `USER_PREFERENCE` is genuinely ambiguous — over-surface, don't over-decide.

**Dual-source divergence defaults to `AUTO_TECHNICAL`** — when the underlying review (`/dual-review`, or `/lens-review` at the per-lens level) already flags a finding as divergent between its two reviewers (one says "fine", the other says "broken"), that's exactly the case the consult is designed to settle. Classify as `AUTO_TECHNICAL` unless the divergence itself is a preference/UX question.

Your call — read the diff and suggestion, judge. Don't delegate.

#### Pre-classification short-circuits

Before classifying any finding, check its `(file, ~line, topic)` against these sets, in order. A match short-circuits classification entirely (the finding doesn't go to `FIX`, `AUTO_TECHNICAL`, `USER_PREFERENCE`, or `DEFER` — it routes per the matched rule below):

1. **`DECIDED_TECH` match** — the reviewer is re-flagging an item the loop already decided. (Placeholder lines the 2a brief itself requested — *"see round N — pending/decided"* — are **not** re-flags: discard them here without touching `reflag_count`; only a finding that substantively re-argues the item counts.)
   - Increment that entry's `reflag_count`.
   - **If `reflag_count >= 2`** (this is the 2nd or later re-flag of the same item): drop the short-circuit and treat the finding as a fresh `AUTO_TECHNICAL`. Persistent re-flagging is signal worth re-consulting. Include the prior decision in the new consult brief as context. **Outcome handling**:
     - If the re-consult resolves — Lane 3 applies it cleanly, or it resolves `leave as-is` (no apply step) → *replace* (not duplicate) the existing `DECIDED_TECH` entry, reset `reflag_count` to 0, and **remove the item's earlier `kind: re-flag` entry from `USER_PENDING`** — it's freshly decided, no longer awaiting the user.
     - For any other outcome that lands the item in `USER_PENDING` with `kind: consult-escalated` — whether the consult itself escalated (truly-tied tiebreaker, both-no-confidence, hallucinated citation), OR the consult resolved but Lane 3 skipped the apply (couldn't apply cleanly to the current code, etc.) — *remove* the prior `DECIDED_TECH` entry entirely, and the new `consult-escalated` entry *replaces* any earlier `kind: re-flag` entry for the item. The next round's re-flag (if any) then hits the `USER_PENDING` short-circuit (rule 2) rather than re-triggering the persistent rule against a stale entry.
   - **Otherwise** (1st re-flag): move it to `USER_PENDING` with `kind: re-flag` and note *"previously decided in round N as: <action>; reviewer re-flagging — may want a second look"*. The re-flag itself is signal worth surfacing.

2. **`USER_PENDING` match** — the reviewer is raising an item the user already has in their inbox.
   - Don't re-classify; don't re-consult.
   - Leave the existing `USER_PENDING` entry as-is; the user already sees it.

#### Dedup discipline

`USER_PREFERENCE` and consult-escalated findings merging into `USER_PENDING` are deduped by `(file, ~line, topic)` — don't re-add ones already present. A pending item stays put even if a later round no longer flags it — leave it for the user to dismiss.

#### Why resolve `AUTO_TECHNICAL` inline rather than at the end

Each decision is subject to the same convergence guarantee FIXes get — a later round can catch a bad call, an adjacent regression, or unlock a `DEFER`'d fix that was waiting on the decision. The `DECIDED_TECH` short-circuit (with the persistent-re-flag escape hatch above) is the safety valve that prevents infinite re-deciding while preserving the loop's ability to revisit if signal accumulates.

### 2c. Stop checks (before fixing)

Stop *before* attempting fixes if any of these fire:

- **Convergence**: `FIX` bucket empty AND `AUTO_TECHNICAL` bucket empty → stop. Both action lanes are quiet. (`USER_PENDING` additions don't count as non-convergence — they're surfaced in Step 5 regardless of how the loop stopped.)
- **Steady state**: this round's findings, by `(file, ~line, topic)`, are all in `previous round's DEFER ∪ USER_PENDING` — and any of them bucketed as `FIX`/`AUTO_TECHNICAL` this round are ones a fix agent already attempted and skipped in a prior round → stop. No progress possible. (An item *newly* actionable — e.g. an earlier fix just made it cheap — is progress and blocks this stop; a previously-skipped item re-appearing is not, else a hard `critical` that Lane 1 keeps skipping re-buckets `FIX` every round and spins the loop to max-rounds. `USER_PENDING` already contains this round's re-flags after the 2b short-circuit, so no separate union term is needed.)
- **Regression**: this round's "newly introduced" count (vs. last round on unchanged code, keyed by `(file, ~line, topic)`) exceeds last round's `(fixed + decided)` count → stop. The loop's code changes are making things worse.
  - "decided" = `AUTO_TECHNICAL` items the consult resolved and the apply lane committed (`leave as-is` resolutions stay out of this denominator — they mutate no code).
  - **Escalations are not in the denominator** — they don't touch code, so they can't introduce or fix regressions. The Escalated column in the Step 5 table tracks them separately for visibility.
  - Re-flags of `DECIDED_TECH` items are excluded from "newly introduced" — they're the same item, surfaced via `USER_PENDING`, not a regression.
  - Round 1 has no previous round, so the regression check is skipped on round 1 by definition.
  - **Skip the check when last round's `(fixed + decided) == 0`** — there's no code-mutation denominator to compare against, so any single newly-introduced finding would trivially trip the formula. Steady-state or convergence will catch any genuine stuckness instead.

### 2d. Fix lane → Consult lane → Apply lane (serial)

Three lanes run this step. They are **serial**, not parallel — sequencing matters because the consult reasons about code state and a parallel FIX lane would rewrite it underneath. Within each lane, sub-agents are parallel where independent.

#### Lane 1 — FIX (parallel sub-agents)

Group `FIX` findings using judgment:

- **Single sub-agent** for: small mechanical fixes across files (token-efficient), OR a cluster of related findings (one bug class, related lines).
- **One sub-agent per file** when each file has substantive, independent fixes.
- **Parallel sub-agents** for groups in different files — send concurrent Agent calls in a single message.

Each fix sub-agent (`general-purpose`, `model: opus` per the model-selection policy) brief:

> Apply the following fixes:
>
> 1. `<file:line>` — `<finding>` — `<suggestion>`
> 2. ...
>
> Rules:
> - Operate in `<WORKTREE>`: `cd <WORKTREE>` at the start of every Bash call (or absolute paths). Your cwd does not persist between calls; the session-default cwd may be a different checkout — edits there silently miss the loop's tree.
> - Minimal, targeted edits. No scope creep, no opportunistic refactors, no adjacent cleanup.
> - If a fix turns out harder than expected (suggestion oversimplified, cross-cutting impact, behavior change beyond intent) → **skip it**. Report skipped with one-sentence reasoning.
> - For each fix applied: file:line, one-line description, before/after snippets (3-5 lines each).
> - For each skipped: file:line, the original suggestion, why skipped.

Wait for all FIX sub-agents to return before starting the CONSULT lane. Skipped FIX findings move to `DEFER` for this round.

#### Lane 2 — CONSULT (dual-source second opinion)

Skip this lane entirely if `AUTO_TECHNICAL` is empty.

Dispatched **after** the FIX lane completes, so both reviewers see the post-FIX working tree state — which is also what the apply lane will edit. **Two reviewers, batched** — all this round's tech decisions in one brief per reviewer, not one consult per decision. Bounded cost: 2 reviewer-invocations per round regardless of decision count.

Run both reviewers concurrently: send a single message containing the Claude consult Agent call **and** the Bash call that launches Codex detached.

##### Claude consult sub-agent

`general-purpose`, `model: opus` per the model-selection policy. Brief:

> You are giving a focused technical second opinion on decisions a code-review loop is about to make. You are **not** doing a fresh review — only weigh in on the listed items. **Read-only**: you're advising, not editing — never modify files or mutate git state; read the cited code and return recommendations only.
>
> Operate in `<WORKTREE>`: `cd <WORKTREE>` at the start of every Bash call (or absolute paths) — your cwd does not persist between calls, and the session-default cwd may be a different checkout whose version of the cited files differs.
>
> For each decision below, read the cited code, weigh the trade-offs (correctness, risk, maintainability, performance, complexity), and return:
>
>     <index>. Recommendation: <one of: "apply original" | "leave as-is" | "do specific edit: <describe>">
>        Rationale: <2-3 sentences — what tipped you toward this>
>        Confidence: high | medium | low
>        Needs user input?: yes / no. If yes, explain what only the user can answer (preference, UX, business intent, org convention).
>
> Decisions:
>
> 1. `<file:line>` — `<finding>` — original suggestion: `<suggestion>` — (prior decision, if 2nd+ re-flag: `<earlier action and round>`)
> 2. ...

##### Codex consult — direct invocation via the gotcha-3 pattern

**Do not route through `/codex-consult ask`** — its fixed 3-section output (Direct answer / Alternatives considered / What I'd want to verify) can't carry the per-decision shape we need. Invoke Codex directly per the launch-detached-then-wait-on-sentinel pattern from `~/.claude/skills/codex-consult/SKILL.md` (gotchas 1–4 all apply: `codex exec --sandbox read-only`, stdin closed, sentinel-gated wait, stay engaged after auto-background).

Compose this prompt body and write to `/tmp/codex-prompt-$JOB_ID.txt`:

```
You are giving a focused technical second opinion on decisions a code-review
loop is about to make. Read-only — do not propose to write code, just answer.

You may read files in the current working directory if needed.

For each decision below, read the cited code, weigh the trade-offs
(correctness, risk, maintainability, performance, complexity), and return:

  <index>. Recommendation: <one of: "apply original" | "leave as-is" | "do specific edit: <describe>">
     Rationale: <2-3 sentences — what tipped you toward this>
     Confidence: high | medium | low
     Needs user input?: yes / no. If yes, explain what only the user can answer.

Decisions:

1. <file:line> — <finding> — original suggestion: <suggestion> — (prior decision, if 2nd+ re-flag: <earlier action and round>)
2. ...

Be specific. If a recommendation rests on an assumption you can't verify
from the code, say so under Rationale.
```

Launch detached per gotcha-3 step 1 **from the loop's tree** — fold `cd <WORKTREE> &&` into the detached launch command (Codex reads its cwd; an unanchored launch reads the session-default checkout) — remember `JOB_ID`, poll the sentinel in a separate Bash call (`timeout: 600000`) per step 2.

##### Codex availability — handled at per-item granularity, not whole-batch

- `command -v codex` fails entirely → every item this round runs `single-source` on Claude alone. Flag once in the report.
- Codex sentinel arrives non-zero, or its log is truncated → check which decisions Codex covered in its output. Items Codex returned recommendations for → use them in synthesis. Items Codex missed → fall back to `single-source` on Claude for those items only. Flag in report.

#### Lane 2 synthesis — orchestrator decides each item

For each `AUTO_TECHNICAL` item, first **validate citations** (mirrors `/dual-review` step 3.4): confirm the cited `(file, ~line)` exists in the **post-FIX working tree** (with line-window tolerance) and the cited code behaves as described. Drop or escalate any recommendation whose citation is hallucinated. If both reviewers had the same hallucination, escalate to `USER_PENDING` (`kind: consult-escalated`) for sanity check rather than silently dropping.

**Additionally**: if Lane 1's edit this round already resolved or superseded an item (visible in the consult's post-FIX read), drop it. A Lane 1 edit at the same location is **not** by itself staleness — the consult deliberately runs after Lane 1 and reasons about the post-FIX tree, so a recommendation that still stands against the current code is applied normally. The next round's reviewer re-checks the area regardless.

Then synthesize per item:

- **Both reviewers converge on the same action** → take that. Consult outcome: `converged`.
  - "Same action" = both pick the same one of `apply original` | `leave as-is` | `do specific edit`. For the specific-edit case, the proposed edits must be **textually equivalent** (same lines changed, same resulting code) — different concrete edits, even on the same line, do not converge.
- **Diverge, both reasoned** → apply tiebreakers strictly lexicographically (walk top-to-bottom; first criterion that distinguishes the options decides — don't score numerically, don't let a lower-priority criterion outweigh a higher one):
  1. **Reversibility** — prefer the option easier to undo later.
  2. **Behavior preservation** — prefer the option that doesn't change observable behavior beyond what the original finding required.
  3. **Blast radius** — prefer the option touching fewer lines / files.
  4. **Truly tied** (no criterion above distinguishes) → escalate to `USER_PENDING` (`kind: consult-escalated`), attach both rationales as briefing. Do **not** coin-flip.
  Consult outcome: `resolved-divergence`.
- **One high-confidence + one low-confidence** → take the high-confidence side, note the asymmetry. Consult outcome: `resolved-divergence`.
- **One or both say "needs user input"**:
  - If at least one returns a high-confidence non-user-input recommendation → take that, note the dissent. Consult outcome: `resolved-divergence`.
  - Otherwise → reclassify as `USER_PREFERENCE`, add to `USER_PENDING` with `kind: consult-escalated`, attach both rationales as briefing. Do not enter into `DECIDED_TECH`.
- **Codex missed an item Claude covered** (Codex partial failure / truncation) → proceed `single-source` on Claude for those items only. Flag in report. (Claude inline produces one structured response per dispatch — it doesn't fail per-item the way Codex can, so the symmetric case doesn't arise.)

**Unattended variant (canonical home — the autonomous commands cite this).** A tough-decision protocol running with **no user channel** (`pr-auto-review` Step 15, `auto-merge-main` Step 10, `ship-issues` Appendix H) extends the chain past "truly tied" instead of escalating: **reversibility → behavior preservation → blast radius → higher confidence → least action (prefer the leave-as-is / no-op option when one is present) → first option in the framing** — logging which terminal rule fired. The extension is a deliberate divergence from this lane's own terminal rule (Lane 2 escalates true ties to the user via its end-of-loop report); it lives here, next to the base chain, so the three carriers can cite one statement instead of drifting. Carriers logging a consult outcome use Lane 2's vocab — `converged | resolved-divergence | single-source` — annotated with the terminal rule when the extended chain decided (e.g. `resolved-divergence (least action)`); `tied` is not an outcome (the chain always resolves).

#### Lane 3 — APPLY (serial, single sub-agent)

`leave as-is` outcomes need no apply: enter them into `DECIDED_TECH` directly — they never pass through Lane 3 (and never count as "skipped"). If no remaining decisions require an edit (all `leave as-is` or escalated to user), skip this lane.

Spawn one fix sub-agent with the synthesized actions as a fix list. Same brief format as the FIX lane. Skipped decisions move to `USER_PENDING` with `kind: consult-escalated` and note *"loop decided <action> but couldn't apply cleanly: <why>"* — user gets the item back with full context.

**Update `DECIDED_TECH` for decisions that applied successfully — and for `leave as-is` resolutions, which have no apply step to fail.** For each, set `(file, ~line, topic) → { round: r, decision, rationale, consult_outcome, reflag_count: 0 }`. If this is a re-consult of an item that was already in `DECIDED_TECH` (per the persistent-re-flag rule in 2b), *replace* the existing entry rather than duplicating it.

### 2e. Commit the round

```bash
git add -A && git commit -m "fix(round <r>): <K> fixes + <M> decisions from <command>

<one-line summary per fix and per decision, max ~12 lines; truncate with '... and N more' if longer>"
```

`<command>` is the review-command string with the leading slash stripped (e.g., `dual-review`, not `/dual-review`) — cleaner in git history.

One-liner format: `fix: <file:line> — <one-liner>` or `decision: <file:line> — <one-liner> (<rationale>)`. Subject line: drop `<K> fixes` when `K == 0` (decision-only round) and/or drop `+ <M> decisions` when `M == 0` (fix-only round). Skip the commit when the tree has no changes to commit (`git status --porcelain` empty — both counters 0, or every decision was `leave as-is`) — the next round's 2c checks register the stop (convergence or steady-state per their own rules; don't pre-assign the label here — Step 3's stop reason feeds callers' promotion gates).

### 2f. Continue or stop

Loop back to 2a until a stop condition fires or `r == max_rounds`.

## Step 3 — Capture stop reason

One of: `convergence` | `steady-state` | `regression` | `max-rounds`.

(There is intentionally no `human-needed` stop reason. `USER_PENDING` accumulates regardless of how the loop stopped and surfaces in Step 5. `AUTO_TECHNICAL` findings are resolved inline within the round they appear; consult-escalations land in `USER_PENDING` like any other user-pending item.)

## Step 4 — Finalize git state

**Auto-commit mode**: leave commits in place. Tell user how many were added on top of `LOOP_BASE` — and, when Step 1 created a working branch, name it: *"on `<working-branch>`; your original `<default>` is untouched."*

**`--no-commit` mode**: soft-reset to `LOOP_BASE`:

```bash
git reset --soft <LOOP_BASE_SHA>
```

This collapses the per-round commits and pre-loop checkpoint back into staged uncommitted changes. Tell the user: *"Per `--no-commit`: squashed N loop commits back to uncommitted changes (staged) on top of `<LOOP_BASE_SHA>`. Run `git reset` if you want them unstaged instead. Note: if you had pre-existing staged vs unstaged changes when the loop started, that distinction is collapsed — everything returns as staged."* When Step 1 created a working branch, append: *"— you are on `<working-branch>`; `<default>` is untouched."*

The staging-distinction loss is intentional simplicity: stashing staged-only state separately to preserve the distinction adds machinery for an edge case where the user can just re-stage as they want.

## Step 5 — Report

Present:

```markdown
# Review-Fix Loop — <review-command>

> ⚠ **<K> critical/high finding(s) remain unfixed** — see Outstanding. *(Include this banner only when a critical- or high-severity finding sits unfixed in Outstanding or among skipped fixes; omit the line entirely when none do.)*

**Rounds run**: <N> of <max>
**Stop reason**: <reason> — <one-line elaboration>
**Final git state**: <"<K> commits on top of <LOOP_BASE_SHA>" | "uncommitted changes on top of <LOOP_BASE_SHA>"><", on working branch <name>" when Step 1 created one>

## Per-round summary

| Round | Findings | Fixed | Decided | Escalated | Deferred | User pref (new) | Re-flags | Introduced |
|-------|----------|-------|---------|-----------|----------|-----------------|----------|------------|
| 1     | …        | …     | …       | …         | …        | …               | …        | …          |
| …     |          |       |         |           |          |                 |          |            |

- "Decided" — `AUTO_TECHNICAL` findings the loop resolved this round via dual-source consult **and applied successfully** (`leave as-is` resolutions count — a deliberate no-op is a decision).
- "Escalated" — `AUTO_TECHNICAL` findings the consult couldn't confidently resolve, escalated to `USER_PENDING` (`kind: consult-escalated`).
- "User pref (new)" — `USER_PREFERENCE` findings newly added (excludes ones already pending from earlier rounds, and excludes consult-escalations, which are in "Escalated").
- "Re-flags" — findings the reviewer raised that matched `DECIDED_TECH` (added to `USER_PENDING` as `kind: re-flag`). Items that hit the persistent-re-flag rule and went through re-consult are *not* in this column — they're in "Decided" or "Escalated" depending on outcome. A single underlying topic can therefore appear in Re-flags one round (1st re-flag) and Decided or Escalated a later round (2nd re-flag triggers re-consult).

## Fixes applied

(grouped by round/commit, file:line + one-line description per fix)

## Decisions made (dual-source consulted, applied inline)

For each `AUTO_TECHNICAL` finding the loop resolved across all rounds:
- [SEVERITY] file:line — summary
- Round N — Decision: <action> | Rationale: <one sentence>
- Consult outcome: `converged` | `resolved-divergence` | `single-source` (Codex unavailable / partial)

If empty, omit this section.

(Items that were re-flagged after a decision appear in "User input needed" below — the entry there names the prior decision so you can sanity-check the call. This section does *not* duplicate that annotation.)

## User input needed

Items requiring genuine user input. Three kinds, distinguished by `kind`:

- `preference` — UX taste, business intent, or organizational convention not derivable from the code.
- `consult-escalated` — the dual-source pair couldn't confidently settle it. Both reviewers' notes attached.
- `re-flag` — a decided item the reviewer raised again (1st re-flag only; persistent re-flags trigger re-consult, see Decisions made). The prior decision is named so you can sanity-check it.

For each:
- [SEVERITY] file:line — summary
- The question or judgment call, in one sentence
- First seen: round N
- Kind: `preference` | `consult-escalated` | `re-flag` (with annotation per kind above)
- If applicable: which fixes or decisions in this loop touched the same area and may need to be re-evaluated once you respond

If empty, say so: *"No user-input findings surfaced."*

## Outstanding

For each unfixed finding that is neither in `USER_PENDING` nor `DECIDED_TECH` (i.e., DEFER, skipped fixes, pre-existing issues):
- [SEVERITY] file:line — summary
- Recommendation: **follow-on fix** | **skip** | **pre-existing** | **file an issue**
- Reason: one sentence

## Regressions caught

(findings introduced by a fix or decision that were caught and fixed in a subsequent round, if any)

## Notes

(Codex unavailability or partial failures, sub-agent skips, consult fallbacks, anything else worth surfacing)
```

## Failure modes

- **Review command not recognized**: bail at step 0.
- **Max rounds > 10**: bail at step 0.
- **2a review agent lost** (killed, or its completion notification never arrived): Read `RUN_DIR/round-<r>-report.md` — the agent writes it before returning. File present → proceed to 2b on it. Absent → re-dispatch the round's review once and collect its notification (field-notes §4).
- **Pre-loop checkpoint commit fails** (hook rejection, committer identity unset): bail with the git error. (Ignored-only changes never reach it — porcelain lists nothing, the checkpoint is skipped, and the loop proceeds on the clean-tree scope path; gitignored work is out of scope by design.)
- **All fix sub-agents skip everything in a round**: DEFER everything; next round detects steady state.
- **Parallel sub-agents conflict on shared file** (shouldn't happen with proper grouping): revert that round's partial work, fall back to sequential within the round.
- **Codex unavailable for the entire run** (`command -v codex` fails): every consult that round runs `single-source` on Claude; flag once in the report. Do not bail the loop.
- **Codex partial failure / errored mid-batch**: per-item — items Codex covered get dual-source synthesis; items Codex missed run `single-source` on Claude. Flag in report.
- **Dual-source consult both no-confidence** on an `AUTO_TECHNICAL` item: reclassify as `USER_PREFERENCE` (`kind: consult-escalated`), surface to user with both reviewers' notes attached. Do not enter into `DECIDED_TECH`.
- **Decision-apply sub-agent skips a synthesized decision**: kick the item to `USER_PENDING` with `kind: consult-escalated` and note *"loop decided <action> but couldn't apply cleanly: <why>"*. Do not enter into `DECIDED_TECH`.
- **Lane 3 can't apply a synthesized action cleanly to the post-FIX tree** (e.g. the original suggestion's edit text predates Lane 1's changes and no longer maps): skip it — the apply sub-agent should **not** retry aggressively — route to `USER_PENDING` (`kind: consult-escalated`) with note *"decided <action> but it no longer applies cleanly to the current code — re-evaluate manually"*, move on. (A Lane 1 edit at the same location is not by itself a reason to skip — the consult reasoned about the post-Lane-1 tree; see Lane 2 synthesis.) The next round's reviewer will see the post-FIX code and surface anything still problematic.
- **Hallucinated consult citation** (Codex or Claude recommends an action against a `(file, ~line)` that doesn't exist in the post-FIX working tree — Lane 2's validation basis; a citation outside the diff is fine when the code is real): drop the recommendation. If both reviewers had the same hallucination, escalate to `USER_PENDING` (`kind: consult-escalated`) for sanity check.
- **Persistent re-flag of a decided item** (`reflag_count >= 2`): drop the short-circuit, treat as fresh `AUTO_TECHNICAL`, re-consult. Include the prior decision in the new consult brief as context. On successful resolution (applied cleanly, or `leave as-is`), replace (not duplicate) the existing `DECIDED_TECH` entry, reset `reflag_count` to 0, and remove the stale `USER_PENDING` re-flag entry (2b's rule).
