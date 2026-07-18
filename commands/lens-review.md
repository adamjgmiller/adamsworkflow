---
description: Read-only per-lens review fan-out — one Opus + one Codex reviewer per lens, deduped and validated against the diff, standard finding format. The widest review tier; loop it via `/review-fix-loop /lens-review`. Never fixes.
argument-hint: "[<scope-hint>] [lens1 lens2 ...]"
---

Review a change through a **fan-out of per-lens, dual-source reviewers** — one Opus reviewer and one Codex reviewer per lens, each focused on a single concern — then dedup and validate against the actual diff and emit the standard finding format. **Read-only**: this command never fixes, never mutates git state. Its whole reason to exist is to be the review half of `/review-fix-loop /lens-review`, giving per-lens breadth on *every* round of the loop (where `/review-fix-loop /dual-review` gives only one general Opus + one general Codex per round, and `/pr-auto-review` fans out lenses only once as a seed).

Usage: `/lens-review [<scope-hint>] [lens1 lens2 ...]`

Examples:
- `/lens-review` (auto-detect scope, auto-pick lenses)
- `/lens-review security perf` (auto-detect scope, only these two lenses)
- `/review-fix-loop /lens-review` (the headline composition — the loop caps this command at 3 rounds by default)

This command extracts and generalizes `pr-auto-review` Steps 7–8 (the per-lens fan-out + dedup/validate) into a standalone, PR-independent, read-only review. It is **not** PR-bound: scope handling mirrors `/dual-review` (works on uncommitted changes, a branch range, or a single commit).

> **Severity contract (load-bearing, every path).** Every finding — primary Opus leaves, fallback inline pass, and the final assembled report — uses exactly `critical | high | medium | low | nit`; never legacy `Major`/`Minor` labels. `/review-fix-loop` Step 2b buckets `FIX` on `severity is critical/high`; a stray `Major` matches nothing and a real bug never gets auto-fixed. If any child drifts, normalize before emitting: `Major → high`, `Minor → low`.

---

## Step 0 — Parse `$ARGUMENTS`

- **Scope hint** (optional): a leading token that hints scope (`uncommitted`, a range, a SHA). Usually omitted — scope is auto-detected in Step 1, or handed in verbatim by a dispatcher.
- **Lens override** (optional): one or more lens names (`security`, `perf`, `blast-radius`, …), read from your `$ARGUMENTS` — whether you were invoked directly (`/lens-review <lenses>`) or a dispatcher forwarded them as your `$ARGUMENTS` (e.g. `review-fix-loop /lens-review <lenses>` injects the pass-through into the 2a brief as your `$ARGUMENTS` — see *Composition note*). If present, use exactly that set and skip the auto-pick menu in Step 2 (still apply the cap and the goal-fit intent rules). A value of `(none)` or empty means **no override** → fall through to the Step 2 auto-pick menu; never treat `(none)`/`none` as a lens name.

State the parsed plan back in one line.

## Step 1 — Establish scope once, here

Both reviewers — across **all** lenses — must see the **same** diff, or dedup is meaningless. The scope is established **once**, here, and injected verbatim into every reviewer; no lens reviewer ever re-detects.

**Anchor the worktree first.** Record `WORKTREE` = the loop/dispatcher-supplied worktree root if given (the `/review-fix-loop` 2a brief carries one), else `git rev-parse --show-toplevel` (run from your cwd). Every git command in this command — scope detection below, baseline capture, the integrity check, validation diffs — runs from `WORKTREE`: `cd "$WORKTREE"` at the start of every Bash call, or use `git -C "$WORKTREE"`. Your cwd does not persist between Bash calls and the session-default cwd may be a *different* checkout (`~/.claude/docs/field-notes.md` §2) — an unanchored command silently targets the wrong tree.

**Then determine scope.** If a dispatcher handed you an explicit scope (e.g. `/review-fix-loop`'s 2a brief: `Scope (do not redetect): <REVIEW_BASE_SHA>...HEAD`) — or Step 0 parsed a scope hint from your arguments — **use it verbatim and skip detection.** Otherwise pick the first that matches (identical to `/dual-review` Step 1), every probe anchored to `WORKTREE`:

1. `git -C "$WORKTREE" status --porcelain` non-empty → scope is `uncommitted`.
2. Current branch ahead of `main` (fall back to `master`) → scope is `<merge-base>...HEAD` (compute via `git -C "$WORKTREE" merge-base`; hold the literal range string).
3. Otherwise → scope is `HEAD` (most recent commit). If even that seems irrelevant, stop and ask the user what to review (or, with no user channel — a dispatched/Workflow agent — return the question as your result and stop).

Hold the scope as an explicit string. State it back in one line before starting.

**Capture the dispatcher's Pending/Decided block, if present.** When `/review-fix-loop` (round > 1) hands you an "Already known to the loop" block with **Pending** and **Already decided** bulleted lists, hold both lists verbatim. You will (a) inject them into every lens brief and Codex prompt in Step 3, and (b) honor the **suppress-not-placeholder** discipline (Step 3) — because this is a citation-validating format (Step 4), a placeholder line with no real citation reads as a hallucination to your own validator.

**External PR bot side-trigger (optional; branches with an open PR only).** An optional external PR review bot can be folded in here if your repos use one: when the current branch has an open PR (`gh pr view --json number,isDraft 2>/dev/null`, run from `WORKTREE`), trigger the bot *here*, before the Step 3 dispatch, so it runs concurrently with the fan-out; its output is collected and folded into the findings at Step 4 (bounded wait — never a stall). One trigger per pushed head state — under `/review-fix-loop` that means round 1 triggers and later rounds skip the trigger (loop fixes are unpushed, so a re-trigger would re-review the same remote state) but still run Step 4's no-wait late-arrival check. Record the bot status for the Step 5 Notes. This one PR comment is the command's sole sanctioned external side effect — the tree and git state stay untouched. No bot on your repos → skip this paragraph and all Step 4 collection for the run.

## Step 2 — Choose the lens set

If Step 0 supplied a lens override, use it. Otherwise pick the lenses the diff actually warrants. Menu (your judgment — not a hard list), generalized from PR to **the change under review**:

- **Always reasonable**: blast-radius (every writer, every consumer, parallel paths), security, completeness (edge cases, partial implementations, missing error handling), tests (coverage, quality, asserting the right thing), docs (comment accuracy, stale references). Plus **goal-fit** — but only with an intent signal (see below).
- **Conditional on content**: UI/UX (when `.tsx`/`.jsx`/`.svelte`/`.vue`/`.css` etc. touched), perf (hot paths, large data structures, N+1), migrations / data integrity (`.sql`, migrations dirs, schema files), breaking changes (public API, exported symbols, config schema), concurrency (locks, async, atomic ops, shared state).
- **Change-specific**: whatever else fits — your judgment.

**Cap the set at 7 lenses.** Each lens is a paired Opus + Codex dispatch, and under `/review-fix-loop` this fan-out re-runs every round (see the cost discussion in the *Composition note* below). If more than 7 apply, merge overlapping ones or drop the lowest-value. **State the resolved lens set, its count, and each lens's chosen reviewer model back in one line before dispatching** (`opus` default; `fable` for a lens whose subject is genuinely complex or critical — name the reason in a word or two per elevation) — this is also what lets the model-tier rule pass (the orchestrator sizes a known, small fan-out before any dispatch; see Step 3), and it puts the per-lens Opus-vs-Fable call on the record instead of leaving it an implicit default.

**No browser in the fan-out.** The UI/UX lens here is **source-reading only** — leaves read the changed CSS/component code; they never render it in a browser. Browser-based *visual fidelity* (measured rendering — the L8 gate) must **never** be a lens in this fan-out: the lens leaves run **concurrently**, and the Playwright MCP browser is a **session-global singleton** (one shared tab across the main loop and every sub-agent → the same MCP server), so two leaves driving it at once silently overwrite each other's page with **no error** — and read-only reviewer leaves have no dev server to render against anyway. Visual fidelity is a **serialized solo step** owned by the conductor or a single dedicated visual leaf (see build-system Phase 3 / the L8 lens), not a concurrent per-lens dispatch.

**goal-fit intent ladder.** The goal-fit lens measures the change against its *stated objective* — it needs an authoritative intent source. Resolve in order:

1. **Dispatcher-supplied intent** in the brief, if any → use it. (`/review-fix-loop`'s 2a brief forwards a `Change intent:` line whenever the orchestrator knows the goal — from the PR body, `plans/<branch>.md` Goal, or the conversation — so this is the primary source inside the loop.)
2. **`plans/<branch>.md` Goal** (per the worktree-plans convention), if the file exists → use it.
3. **Commit subjects over the SCOPE range** — *only when scope is a `<base>...HEAD` range* (`git -C "$WORKTREE" log --format=%s <base>..HEAD`); skip `uncommitted`/`HEAD` scopes, which have no new-commit history to mine (fall through to item 4 and drop goal-fit). Use as *inferred* intent, mark the goal-fit lens **low-confidence**. Caveat: inside a fix loop the range includes the loop's own `fix(round N): …` commits, so inferred intent degrades round over round.
4. **None of the above** → **drop goal-fit from the set** with a one-line note in the report Notes ("goal-fit skipped: no intent signal"). Do not run it blind and emit per-round low-confidence noise.

## Step 3 — Fan out per-lens reviewers (capability-detected)

**Codex preflight, once.** Before any fan-out, run `command -v codex` a single time. If it fails, run **every** lens Opus-only and skip all Codex dispatches (primary) / the detached Codex (fallback); label the report `single-source`. Do **not** make N children each rediscover that Codex is missing.

Detect your own capability: do you hold the `Agent` tool?

- **Inside `/review-fix-loop`** the 2a review-agent is always a freshly-dispatched `general-purpose` review agent (model per the model-selection policy), which **does** carry `Agent` → the **PRIMARY** fan-out path runs there. (`/review-fix-loop` has no `Agent`-less mode of its own — every lane spawns — so if the loop is ever reached spawn-free, the whole loop already fails before this fallback would matter.)
- The **FALLBACK** path matters only for genuinely `Agent`-less contexts: a Workflow `agent()` node, or `Explore`/`Plan` sub-agent types.

### PRIMARY — fan out one Opus + one Codex reviewer per lens

**Capture the baseline first** (anchored to `WORKTREE`): `FANOUT_HEAD=$(git -C "$WORKTREE" rev-parse HEAD)` and the current dirty set `git -C "$WORKTREE" status --porcelain`. Hold both.

Then launch **all** lens reviewers in **one message** — for each lens, one Opus child + one `codex-runner` child. Dispatches are async (async-only at depth; the main-level `run_in_background: false` sync opt-in is never right for this fan-out — the lens pairs must run concurrently) — each child's result arrives as a task-notification carrying its final text, attached to your next tool result or re-waking you if you've ended your turn (field-notes §4). Count your dispatches and collect **all** results (`2 × |lenses|`; `|lenses|` when the Codex preflight failed and only Opus children launched) before doing anything else — the risk is proceeding on partial results or double-dispatching a lens whose notification just hasn't landed yet, not stalling.

**Opus lens reviewer** (`general-purpose`, one per lens — per-lens model per the model-selection policy: `opus` default, `fable` only for a lens passing the policy's escalation test, decided per-lens, never above your tier). Brief — compose per lens, folding in that lens's definition:

> Scope (do not redetect): `<SCOPE>` — review exactly this diff; do not re-detect scope.
> Get the diff: `<the per-scope diff command from Step 4>` run from `<WORKTREE>` (`cd <WORKTREE>` first).
>
> You are reviewing through the **<lens-name>** lens specifically. Don't try to be comprehensive across all concerns — stay focused on the lens.
> Lens definition: <one-paragraph what to look for through this lens>.
> Change intent (goal-fit lens only): <intent from the Step 2 ladder>.
>
> [Include this entire block **only** if the dispatcher supplied Pending/Decided lists; omit it wholesale otherwise (e.g. round 1) — there is nothing to suppress: Include both bulleted lists verbatim here. The following are already known to the review loop — do **not** re-flag them, and because findings are validated against the diff, **suppress them entirely** (emit no line at all — a placeholder without a real citation reads as a hallucination). You **should** still flag genuinely new issues in the same files/lines (regressions, adjacent bugs, a fix that worsened things).]
>
> Use this exact finding format:
>
>     N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
>        Location: <file>:<line>  (or "cross-cutting")
>        Finding: <2-4 sentences — the issue and why it matters through THIS lens>
>        Suggestion: <concrete fix, or "needs human judgment">
>
> After the numbered list, a "Notes" section. If nothing's worth flagging through this lens, say so explicitly.
>
> You are a **leaf**: do not spawn sub-agents, do not contact the user — return only your findings.
>
> **Read-only on the shared worktree.** Every lens reviewer reads this same checkout concurrently and a fix loop may run right after you. Never edit/create/delete files; never run git mutations (`add`/`commit`/`checkout`/`restore`/`stash`/`clean`/`reset`); never mutation-test the tree. Running the suite as-is is fine — to judge whether tests would catch a mutation, reason statically and report it as a finding; don't run the experiment. (Especially load-bearing for the **tests** lens.)

**Codex lens reviewer** — dispatch the named **`codex-runner`** agent, one per lens, foreground. Its definition (`~/.claude/agents/codex-runner.md`) carries the full contract (codex-consult SKILL.md gotchas 1–4, `review` mode, `--sandbox read-only`, never skip / never substitute, return `JOB_ID` + sentinel `exit=N` + verbatim findings). Supply the variables: the `<SCOPE>` to review, **the `<WORKTREE>` to run in** (so Codex's `--sandbox read-only` contextual file reads hit the loop's tree, not the session-default checkout — the committed-range diff resolves from the object DB regardless, but surrounding-source reads don't; brief the runner to `cd <WORKTREE>` before launching `codex exec`), the lens constraint (the def folds a supplied lens constraint into the Codex prompt verbatim), the change intent for the **goal-fit** lens (same text as its Opus brief — Codex can't infer the authoritative goal), and — if present — the Pending/Decided lists (the def folds any additional context block verbatim too). Each lens gets its own `JOB_ID`. If the agent type is unknown ("Agent type not found" — stale session registry), dispatch a `general-purpose` child briefed to read and follow the def file as its full contract, plus the same variables — and pin that child `model: sonnet` (Codex-driver; the def's frontmatter pin does NOT transfer when the def is merely read as prose).

**Slot cost.** PRIMARY costs `2 × |lenses|` foreground agent slots (Opus + codex-runner per lens) — strictly more than the FALLBACK's `1` inline pass + `1` slot-free detached Codex. Trim the lens set if slot pressure appears.

**Model-tier compliance.** The set is counted and capped in Step 2 before any dispatch — the known-small-fan-out exception applies, so Opus-per-lens is allowed; without the cap this would be the "large count" case the model policy forbids.

**Worktree-integrity check (after the join, before returning).** Once all lens pairs have returned, diff against the baseline (`FANOUT_HEAD` + the captured dirty set). The leaves are briefed read-only and Codex is sandboxed read-only, but verify rather than trust. Handle by context:

- **You own the tree** (standalone top-level invocation): actively restore, three branches — (a) stray edits to baseline-clean files → `git -C "$WORKTREE" restore <those-paths>`; (b) HEAD moved (`HEAD != FANOUT_HEAD`) → `git -C "$WORKTREE" reset --soft "$FANOUT_HEAD"`, then review/discard the now-staged stray diff; (c) a stray edit collides with a path the user already had dirty (can't be cleanly separated) → **stop and flag**, never force-restore (losing in-flight work is worse than a dirty review).
- **You were dispatched read-only** (the `/review-fix-loop` 2a brief says "Do not modify files" — the loop owns all git state): **detect and report only** — never run `restore`/`reset` yourself. Surface any leak as a **high-severity** Notes item prefixed `WORKTREE-LEAK:` naming the exact paths, so the orchestrator (which owns git state) can restore them **immediately after the 2a review returns, before Lane 1 FIX edits the tree** — review-fix-loop's 2a `/lens-review` note instructs exactly this scan-and-restore, so the flag is actionable, not dead. The deeper guarantee is still the read-only briefing + Codex `--sandbox read-only` making a leak unlikely in the first place; the `WORKTREE-LEAK:` flag is defense-in-depth for the rare case a briefed leaf disobeys.

A non-empty baseline dirty set when invoked from a fix loop (where the tree should be clean post-2e) is itself worth a Notes line — it may be a prior round's leaked edit rather than user work. Either way, never clobber it.

### FALLBACK — single-process, spawn-free (Agent-less contexts only)

When you don't hold `Agent`, degrade like `/dual-review`: **one inline Claude pass** structured across the chosen lens checklist + **one detached-Bash Codex `review`** covering all lenses. This is a single inline pass (no per-lens fan-out) — it inherits the caller's model and costs one Claude pass regardless of lens count. **Do not** parallelize lenses into sub-agents here; being spawn-free is the entire point of the fallback.

- The inline Claude pass walks each chosen lens as a checklist and emits the finding format above — **with the same `critical|high|medium|low|nit` vocab** (walk the lens set yourself — don't substitute a generic `/quick-review` pass — and normalize any stray legacy `Major`/`Minor`).
- The Codex side follows codex-consult SKILL.md gotchas 1–4 (close stdin; `codex exec --sandbox read-only`; detached launch; poll the sentinel; stay engaged after auto-background). Use the review-mode body verbatim (one flat findings list) and attribute findings to lenses post-hoc in Step 4. Capture `JOB_ID`, gate on the sentinel, read `exit=N`, extract only the findings block; **if extraction is empty, log why before marking the Codex side failed** — record `exit=N`, marker presence, and byte count (a blank result is a symptom of a non-zero exit / error page / marker drift, not an extraction bug — codex-consult's fallback prints exactly this), so the report names the real cause. A clean `exit=0` answer that **explicitly reports no findings** is a successful dual-source run with zero Codex findings — not a failure. On non-zero/truncated/genuinely-empty output, mark the Codex side failed with `JOB_ID` + `exit=N` evidence and label the report `single-source` — **never** substitute a second Claude pass.
- Capture `FANOUT_HEAD` + dirty set and run the **same** integrity check here too — the detached Codex is exactly the untrusted external writer the check exists for.
- Label the report `degraded-fanout` **in addition to** the codex-availability label. Be honest about the fidelity drop: the single all-lens Codex job means **per-lens Codex divergence is not computed**, and a single non-zero/truncated exit drops the Codex side for **all** lenses at once (whole-batch, not per-lens).

## Step 4 — Dedup + validate, against the actual diff

Don't skip — running two sources per lens is the point.

**Collect the external bot first (when Step 1 triggered one).** Before dedup, pull the triggered review's output: `gh pr view <N> --json reviews` + `gh api "repos/:owner/:repo/pulls/<N>/comments" --paginate`, filtered to the bot's login at/after this run's trigger. If it hasn't landed yet, wait a bounded window — one foreground until-loop polling every ~30–60s, up to ~5 minutes (well under the 10-min Bash ceiling) — then proceed without it. Under `/review-fix-loop` rounds > 1 (trigger skipped): a single no-wait check for output that landed after round 1's window. Each bot inline comment becomes a candidate finding with source `@<bot>`, entering items 4–5 below like any reviewer's: same dedup key (attribution merges — `(flagged by: opus[security], @<bot>)`), same validation against the SCOPE diff. Assign severity yourself per the standard vocab (bot severity labels rarely map), and remember the bot reviewed the *pushed head* — with uncommitted/unpushed scope its line numbers can drift and some findings won't apply; drop those as out-of-scope rather than guessing.

1. **Read the actual diff for `<SCOPE>`** as ground truth (anchored to `WORKTREE`) — `git -C "$WORKTREE" diff HEAD` for uncommitted (staged + unstaged), plus untracked files via `git -C "$WORKTREE" status --porcelain` (read new files directly — an untracked-only change otherwise reviews and validates as an empty diff); `git -C "$WORKTREE" diff <A>...<B>` for a range (the **literal** scope string — the right endpoint is usually `HEAD`, but an explicit `A...B` scope is honored verbatim so reviewers and validator see the same diff); `git -C "$WORKTREE" show <SHA>` for a single commit. Validate against real diff content, never the reviewers' summaries.
2. **Enforce Codex proof.** A `codex-runner[lens]` return lacking a `JOB_ID` + `exit=N` line is a failed/skipped Codex run for that lens → treat that lens as **Opus-only**, flag it, never accept its findings as dual-source. (Mirrors `/dual-review` Step 3.1 — never present single-source as dual-source.)
3. **Consume per-lens Codex partials.** Per lens: codex `exit=0` with a parseable answer — findings, **or an explicit no-findings statement** (a routine, healthy result on convergence rounds) → dual-source synthesis for that lens; `exit≠0` / truncated / genuinely empty / missing proof → that lens goes Opus-only, labeled `single-source[lens]`, with the `JOB_ID` + `exit` surfaced as evidence. (PRIMARY degrades **per-lens**; the FALLBACK's single all-lens Codex job degrades **whole-batch**.)
4. **Dedup by `(file, ~line, topic)`** — same key `/review-fix-loop` and `/pr-auto-review` use. Findings from multiple sources on the same issue merge into **one** entry. **Attribution is a trailing parenthetical** appended at the end of the merged finding — `(flagged by: opus[security], codex[security])` — **never** embedded in the one-line summary, Location, or Finding text (that would shift the parse and pollute the normalized `topic`).
5. **Validate each finding.** Confirm the citation is real and the issue is **caused by the scoped diff** — a blast-radius finding may legitimately cite an unchanged caller or consumer the diff breaks; validate those against the checkout rather than dropping them for being outside the diff. Drop or downgrade hallucinated/unsupported findings.
6. **Collapse divergence into one finding.** When Opus[lens] and Codex[lens] contradict on the same `(file, ~line, topic)` (one "fine", one "broken"), emit **one** numbered finding keyed by that topic, assigned the **higher** of the two severities, with a `Divergence:` annotation naming each side's take. Do **not** emit a separate divergence section, and do **not** emit two competing entries — `/review-fix-loop` 2b's dual-source-divergence rule routes a single divergence-flagged finding to `AUTO_TECHNICAL` (consult). This command **surfaces** divergence; it never **resolves** it.

> Run dedup/validate **inline in your own context** — never fan out a per-finding validator sub-agent. The finding count is unknown/unbounded here, so any fan-out would be a Sonnet-only stage per the model-tier rule; keeping it inline sidesteps that entirely.

## Step 5 — Report

Emit, in this order:

1. **Header / Notes** (above the numbered list, or in a trailing Notes section — never interleaved with findings): the resolved **lens set**, and **two independent status labels** (kept separate so neither claims something the other contradicts):
   - **Codex axis** — `dual-source` (both reviewers ran) or `single-source` (Codex unavailable/failed report-wide). Under a `dual-source` report, an individual lens whose Codex partial failed still carries a per-lens `single-source[lens]` annotation (Step 4.3); the report-level `single-source` is reserved for the preflight-unavailable / all-lens-failed case.
   - **Fan-out axis** — `per-lens fan-out` (PRIMARY) or `degraded-fanout` (FALLBACK: one inline pass + one all-lens Codex job).
   So a healthy PRIMARY reads `dual-source` + `per-lens fan-out`; a healthy FALLBACK reads `dual-source` + `degraded-fanout`; no label ever asserts a fan-out that didn't happen.

   Plus per-lens **`JOB_ID` + `exit=N`** proof (PRIMARY: one per lens; FALLBACK: exactly one all-lens job, labeled as such), the external-bot status when one is in play (`included (N findings) | triggered, no response ≤5m | skipped (<why>) | no-pr`), and any goal-fit skip / `WORKTREE-LEAK:` / non-empty-baseline notes.
2. **The numbered findings** — contiguous, uninterrupted (so a downstream parser or human reads an uninterrupted findings block) — in `[SEVERITY: critical | high | medium | low | nit] / Location / Finding / Suggestion` format, sorted by severity then file, each with its trailing attribution parenthetical and (where applicable) `Divergence:` annotation.
3. **Close**: count by severity, overall assessment, items needing human judgment.

**Report-file handoff.** If the dispatcher's brief names a report file (e.g. `/review-fix-loop`'s `<RUN_DIR>/round-<r>-report.md`), write the complete report there verbatim **before** returning, then return the same text as your result. The path lives outside the worktree, so the write does not breach the read-only rule — it's the dispatcher's recovery channel if your completion notification is lost (field-notes §4).

**Review-only.** Do not fix anything, do not mutate git state. Fixing is the consumer's job (`/review-fix-loop`, or the user).

## Composition note — how `/review-fix-loop /lens-review` runs

`/review-fix-loop` 2a dispatches its review command as a fresh `general-purpose` review sub-agent (model per the model-selection policy) ("Read and follow this file… Scope (do not redetect)… Use the prescribed finding format. Do not modify files."). That agent reads this file and runs the **PRIMARY** fan-out (it carries `Agent`). Depth:

- **Standalone**: `main(0) → 2a review-agent(1) → lens children(2)`. Each `codex-runner` leaf at level 2 spawns nothing.
- **Headline / composed path** (`/pr-auto-review` runs `/review-fix-loop` inline): `main(0) → per-PR agent(1) → [review-fix-loop inline, +0] → 2a agent(2) → lens children(3)` = **depth 3** (field-notes §5), foreground fan-out at the leaf — that's the real ceiling, not 2.

This command depends on **three small generalizations in `review-fix-loop.md`** (each strictly additive — `/dual-review` behavior is unchanged), without which the composition silently degrades:

1. **2b divergence rule** generalized from the literal `/dual-review` to name `/dual-review` or `/lens-review` (at the per-lens level) → so per-lens divergences route to `AUTO_TECHNICAL` (consult) instead of defaulting to `USER_PREFERENCE` and being dumped on the user.
2. **2a Pending/Decided forwarding note** generalized to name `/lens-review` → so the loop tells the review-agent to fold the lists into its per-lens children.
3. **2a per-command behavior note** gains a `/lens-review` paragraph → so the orchestrator knows to expect the two-axis status labels (codex: `dual-source`/`single-source`; fan-out: `per-lens fan-out`/`degraded-fanout`) and to restore any `WORKTREE-LEAK:`-flagged paths after 2a returns (before Lane 1 FIX).

Plus a fourth, **optional and general** capability (not lens-specific): `review-fix-loop`'s Step 0 forwards any **pass-through args** after the review command into the 2a brief as the review sub-agent's `$ARGUMENTS`. So `review-fix-loop /lens-review security perf` pins `security perf` as the lens override **every round** (Step 0 reads it from the brief). It's optional because without it the looped form simply auto-picks per round — the usual default; pinning matters when you want a *specific* set looped to convergence (e.g. a narrow gate).

PRIMARY fans out `2 × |lenses|` agents, and under `/review-fix-loop` this re-runs **every round** (the loop caps this command at 3 rounds by default — 5 for other commands, ceiling 10) on top of the loop's own per-round FIX/CONSULT/APPLY agents. At 7 lenses × 5 rounds that would be ~70 lens dispatches + the loop's own — versus ~5–10 for `/review-fix-loop /dual-review`; that blow-up is why the loop defaults this command's cap to 3. Lens breadth is most valuable on **round 1**; the convergence rounds are mostly about whether the fixes held. To keep the headline path from being a cost trap:

- **Convergence to no meaningful findings is the goal; the 3-round default cap is the cost guard**, not a target (an explicit `up to N` overrides it — don't raise it without cause).
- **Narrow lenses on later rounds**: round 1 gets full breadth; from round 2, restrict to the lenses that actually fired findings (the loop's Pending/Decided context signals which areas are live).
- Keep the **Step 2 cap** (≤7) — it's what makes both the cost and the model-tier story hold.

## Intentional drops from `pr-auto-review` Steps 6–8

`pr-auto-review` Step 6's *general* scrape (human comments, other bots) and Step 8's `@login` attribution for arbitrary logins are intentionally dropped — there is not necessarily a GitHub PR, and broad PR-signal consumption stays `/pr-auto-review`'s job. The one exception is the review this command itself requested: the optional Step 1 external-bot side-trigger, collected and folded in at Step 4. External signal is therefore the dispatcher-supplied Pending/Decided lists plus (PR-bound scopes only) the triggered bot's findings; attribution is `opus[lens]` / `codex[lens]` / `@<bot>`.

## Failure modes

- **No diff in scope** → stop after Step 1, say there's nothing to review.
- **Codex unavailable** (preflight) → all lenses Opus-only, label `single-source`. Don't retry, don't substitute a second Claude pass.
- **Codex partial** → per-lens on PRIMARY (covered lenses dual-source, missed lenses Opus-only, flagged); whole-batch on the FALLBACK's single all-lens job.
- **`codex-runner` return lacks `JOB_ID`/`exit=N`** → treat that lens as a failed Codex run (Opus-only, flagged) — never accept as dual-source.
- **No intent signal for goal-fit** → drop the lens with a Notes line; don't run it blind.
- **External bot triggered but nothing landed within the ~5-min wait** → proceed without it, label the Notes (`triggered, no response ≤5m`); never extend the wait or block the report on an external reviewer.
- **Spawn unavailable** (`Agent`-less context) → FALLBACK single-process path, label `degraded-fanout`. (Never reached inside `/review-fix-loop`, whose 2a agent always carries `Agent`.)
- **Lens reviewer leaked edits** → integrity check; restore (own-the-tree) or detect-and-flag high-severity (dispatched read-only). Stop-and-flag, never clobber, on a user-dirty collision.

## Hard rules

- **Read-only.** Never fix, never mutate git state, except the own-the-tree integrity *restore* of stray leaks (never under a read-only dispatch). The optional Step 1 external-bot trigger comment is the sole sanctioned external side effect.
- **Same scope, every reviewer.** The Step 1 scope string is injected verbatim into every Opus brief and every Codex dispatch; no reviewer re-detects.
- **Severity vocab is `critical|high|medium|low|nit` on every path** — normalize stray `Major/Minor`.
- **Collect every lens child before the join** — dispatches are async-only; results arrive as task-notifications that re-wake you if you've stopped. Never start Step 4 until every dispatched child has reported (`2 × |lenses|`, or `|lenses|` Opus-only — field-notes §4).
- **Divergence is surfaced, never resolved** — one finding, higher severity, `Divergence:` annotation.
- **Dedup/validate stays inline** — never a per-finding validator fan-out.
- **Codex is `--sandbox read-only` on both paths** — never `workspace-write` / `--full-auto`.
