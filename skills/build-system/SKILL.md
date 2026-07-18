---
name: build-system
description: Adam's end-to-end build pipeline — docs sized to the work (PRD + Plan for
  large/ambiguous, a single Spec for medium, neither for small) → Build → Draft PR →
  Final Review, autonomous by default, with adversarial Codex + sub-agent review loops at
  each gate. Use inside a repo for any meaningful feature or change request that warrants
  more than a quick edit, unless the user scopes the work smaller.
---

# Build System

Take a meaningful change from raw request to merge-ready PR: **Docs (tiered) → Build →
Draft PR → Final Review**. Autonomous by default; adversarial review at every gate.

## When to run
- Inside a repo, for any request substantial enough to warrant more than a quick edit.
- Skip for trivial edits, one-liners, pure Q&A, or when the user scopes it smaller.
- Unsure whether the full pipeline fits? Ask once with AskUserQuestion, then commit to
  the path (Phase 0 owns the docs-tier choice).

## How this composes
This is a conductor. It owns the phase structure and the entry point from a raw request,
and delegates the heavy machinery to skills that already do it well:
- Interrogate intent → `grill-me`
- Codex second opinions / adversarial reviews → `codex-consult` (review / critique / ask;
  it encodes the Codex CLI gotchas)
- Code review-fix loops → `review-fix-loop /lens-review` (per-lens Opus+Codex breadth,
  looped to convergence — the default for non-trivial/risky diffs) or `review-fix-loop
  /dual-review` (one general Opus + Codex; lighter, for small/low-risk passes). Both carry
  convergence, regression, and steady-state detection.
- Per-lens PR review + automated-reviewer scrape + promote → `pr-auto-review`
- Plain execution of a staged plan → `orchestrate`

Reach for a **Workflow** when the fan-out is deterministic (one agent per build step or
per review lens). Reach for **plain sub-agents** (or a short Workflow that returns to you)
when your judgment is needed *between* sets — e.g., deciding whether another review round
is warranted. Never bury a review→fix→re-review loop inside a Workflow: "is this clean
enough to stop?" is a judgment call, and Workflows can't branch on judgment. The two
fan-out mechanisms differ in a load-bearing way: a **Workflow `agent()` is always a leaf**
(it cannot spawn), while a **direct sub-agent CAN spawn its own children** — so brief every
fanned-out agent explicitly as a **leaf** or a **stage-agent**; see *Depth & recursion
contract* below.

If launched under `/auto-run`, that command governs the autonomy and decision-log layer —
defer to its durable state.

## Depth & recursion contract
This skill is a **top-level conductor** — run it in the main loop. The hard top-level
reservation is **user interaction**, not spawn depth: anything that needs a live
AskUserQuestion / approval gate / interview (grill-me, the Autonomy stops) stays in the
main loop. The two fan-out fabrics behave differently
(`~/.claude/docs/field-notes.md` §1):

1. **Task fabric (Agent tool): a dispatched sub-agent CAN spawn its own sub-agents.** A
   `general-purpose` sub-agent holds the Agent tool (`Explore`/`Plan` types do not). This
   enables the **stage-agent** pattern: delegate one *non-interactive* stage or loop to a
   single sub-agent that fans out its own leaf children and returns a compact digest. A
   stage-agent's leaf dispatches are async-only (the Agent tool has no foreground mode):
   each leaf's result arrives as a task-notification carrying its final text, re-waking
   the stage-agent if it has stopped — count the dispatches and collect every leaf's
   notification before advancing the stage (field-notes §4). A
   stage-agent still cannot talk to the user — if it hits a human-only decision it must
   STOP and return that decision *packaged* — the question, the options it weighed, its
   recommendation, plus its work state so far (cumulative diff/SHA) under a halt outcome —
   for the conductor to surface via AskUserQuestion (escalate, don't resolve and don't
   block).
2. **Workflow fabric (`agent()` in a JS script): agents CANNOT spawn.** They carry no
   Agent/Task-dispatch tool at all. Every Workflow `agent()` is a leaf — one level,
   single-pass, no user contact. Never tell a Workflow agent to run a sub-agent-spawning
   skill.

**Leaf agents do self-contained, single-pass work only** — review one lens, run Codex on
a scope, run tests, apply one specific fix. Tools: Bash/Read/Grep/Edit/Write. Never tell a
leaf to spawn sub-agents, run a sub-agent-spawning skill, or ask the user. Brief every
fanned-out agent explicitly as **leaf** or **stage-agent** — never leave it ambiguous.

**Depth budget:** keep nesting within ~3–4 levels (a legibility convention —
field-notes §5). Counting: Agent dispatch = +1; skill/command inline = +0; detached
CLI launch = +0. Sum depth across composed delegations (e.g. `main → stage-agent →
per-PR agent → lens codex-runner child` = 3) and deliberately collapse a level when
stacks run deep.

Where each delegated skill runs:

| Skill | Runs at | Notes |
|---|---|---|
| `codex-consult` | **Leaf-safe** | Drives Codex as an external CLI via Bash; never spawns. Pass it an explicit mode + diff scope (e.g. `review`, `<merge-base>...HEAD`) so the leaf never stops to ask which mode or that Codex is missing; have it return the JOB_ID + sentinel exit code as proof. |
| `dual-review` | **Leaf-safe** | Both reviewers driven from whatever agent invokes it: Claude (`/quick-review`) per its fresh-eyes rule — inline, or one fresh sub-agent when the invoker is reviewing its own session's edits and holds `Agent` — plus Codex detached behind a sentinel file. Works at any depth (top level, sub-agent, Workflow agent); leaf-safe — needs no `Agent` tool. Pass an explicit scope. A successful cross-check is labeled `concurrent single-process dual-source`; on missing Codex or a failed Codex run it degrades to a labeled `single-source` report — a leaf never re-dispatches. |
| `lens-review` | **Conductor or stage-agent** | Per-lens fan-out — one Opus + one `codex-runner` leaf per lens, then dedup/validate against the diff — so its PRIMARY path needs the Agent tool: main loop **or a stage-agent that holds it**; never a Workflow `agent()` or a leaf (there it degrades to a single-process `degraded-fanout` pass). Read-only — it never fixes; pair it with `review-fix-loop /lens-review` for the loop. Pass an explicit scope; pin a specific lens set on **either** form (`review-fix-loop /lens-review <lenses>` forwards it every round via the loop's pass-through, or `/lens-review <lenses>` directly), or omit it to auto-pick per round. |
| `grill-me` | **Top-level only** | Its job is a live AskUserQuestion interview; a delegated agent can't reach the user, and there's no inline substitute. For autonomous requirement-clarification inside a fan-out, use a non-interactive approach. |
| `review-fix-loop` | **Conductor or stage-agent** | Itself a multi-round conductor that fans out review/fix/consult/apply sub-agents — so it needs the Agent tool: run it from the main loop **or from a delegated stage-agent that holds Agent**. Never from a Workflow `agent()` or a leaf. If a leaf must do review-and-fix, inline the essence: review + minimal Edits in one pass — no looping, no spawning. |
| `pr-auto-review` | **Conductor or stage-agent** | Heavy orchestrator — per-lens reviewer pairs + embedded `review-fix-loop` + its own worktree — so it needs the Agent tool: main loop **or a stage-agent that holds it**. Never from a Workflow `agent()` or a leaf. (A degraded single-agent inline form exists — lenses applied sequentially, no fan-out — but prefer the real form.) pr-auto-review bundles its own per-PR concurrency cap (with within-PR fan-out accounting) — rely on it; don't re-derive a budget here, and never brief a stage-agent to lift it. |
| `orchestrate` | **Top-level only** | Per-stage build conductor with **user gates** (plan approval, halt-on-repeated-verify-failure) — interactivity, not spawn-depth, is what pins it to the main loop. Use *either* build-system's own Build loop *or* `orchestrate` as the top-level driver — never nest one in the other. |

Pattern to copy: the conductor (or its stage-agent) fans out **one leaf per lens / per
build slice**; each leaf returns findings or a bounded diff; whoever dispatched keeps
dedup, the fix decision, the review *loop*, and convergence judgment. Whatever needs the
**user** stays with the conductor in the main loop — that reservation never delegates.

## Shared primitives

Referenced by every phase; defined once here.

### Autonomy & decision authority
Run the whole pipeline without stopping for input. You are the decision-maker; the human
is a consultant for a narrow class of questions only.
- **Routine calls** — decide and proceed.
- **Tough calls you're unsure about** — get a second opinion from `codex-consult` (and/or
  a sub-agent), synthesize, log the decision in the umbrella file, proceed. Don't escalate
  to the human.
- **Stop for the human only** when a decision (a) materially shapes user-facing behavior or
  product scope, (b) has no technical answer you're better-positioned to make, AND (c) you
  genuinely cannot proceed without it. Use AskUserQuestion. The human is a peer to consult
  on product/UX judgment — not a tiebreaker for technical questions.
- **Delegation never moves these stops off the main loop.** Keep AskUserQuestion-driven and
  live-context steps with the conductor — a dispatched sub-agent carries no AskUserQuestion
  tool at all. Brief every stage-runner with the stop conditions above as its
  reserved-for-the-human list: one that hits a stop returns the decision *packaged* under a
  halt outcome (package shape: see the *Depth & recursion contract*) — never resolved on
  its own, never blocked-on. More generally, a sub-agent with pending user questions
  returns them as **data**; the main loop surfaces them — AskUserQuestion directly, or
  `/askme` for a batch — then resumes or re-dispatches the stage.
- The user's request overrides these defaults: "stop after the plan" or "go straight to
  build" wins.

### The review loop
The pipeline's core primitive. Given an artifact (a plan, or a code diff):
1. Pick the relevant lenses (below) — typically 2–4; scale to size, risk, and surface area.
   Skip a lens that returned clean last round if nothing in your fixes touches it.
2. For each lens, fan out a Codex reviewer and one of your own sub-agents in parallel —
   both **leaf agents**: single-pass, no spawning — async dispatches; collect both
   leaves' completion task-notifications before the dedup/fix step
   (field-notes §4). For a code diff the Codex leaf is the
   named `codex-runner` agent (on "Agent type not found" — a stale session registry —
   dispatch `general-purpose` briefed to read and follow
   `~/.claude/agents/codex-runner.md`, pinned `model: sonnet` — Codex-driver) (brief it with the lens + scope; it returns
   JOB_ID + sentinel + raw findings); for a plan artifact, brief a leaf to run
   `codex-consult critique` instead (pin that leaf `model: sonnet` — Codex-driver) — `codex-runner` is review-mode-only. **Codex
   preflight, once**: run `command -v codex` a single time before the first fan-out; if it
   fails, run every round with your own sub-agents alone, label the affected reviews
   `single-source`, and note it — do not make N leaves each rediscover that Codex is missing.
3. Dedup findings by `(file, ~line, topic)`; fix every meaningful, critical, or blocking
   issue. Skip cosmetic nits unless cheap.
4. Commit the fixes (if in a repo), then re-run on the fixes, narrowing lenses to what
   changed.
5. Stop when a round surfaces no meaningful/critical/blocking issue — or after a hard
   ceiling of 5 rounds (absolute max 10). If you hit the ceiling with issues open, stop and
   surface them rather than looping forever.

For code, the loop has two ready-made forms — both run from the conductor or inline in a
delegated stage-runner (below); both implement convergence/regression/steady-state; and
both are themselves fan-out conductors, so never invoke either from inside a Workflow
`agent()` or a leaf agent (see *Depth & recursion contract*):
- **`review-fix-loop /lens-review`** — per-lens Opus+Codex breadth on every round; the
  packaged form of the per-lens loop described in steps 1–5 above. **The default for
  non-trivial or risky diffs.** Pass your chosen set — `review-fix-loop /lens-review
  <lenses>` forwards it (pinned **every round** via the loop's pass-through), and its
  Pending/Decided context keeps later rounds focused on the live areas. **Omit** the lenses
  to let it auto-pick per round from what the diff touches (the same
  suggested-for-completeness logic in *The lenses* below) — auto-pick is the right default
  for broad coverage; pin a set when you need specific lenses guaranteed. Cost: ~2×lenses
  agents per round, so keep the set ≤7 and narrow on later rounds (the loop caps
  `/lens-review` at 3 rounds by default — convergence to no meaningful findings is the
  goal; the cap is the cost guard).
- **`review-fix-loop /dual-review`** — one general Opus + one general Codex per round;
  lighter and faster. Use for small, low-risk, or fast passes.

When unsure which fits, **lean toward `/lens-review`** — thoroughness is the safer default.

**Delegating a review-heavy phase (the default for Plan, Build, and Final Review):**
dispatch one named **`stage-runner`** agent per phase (`subagent_type: "stage-runner"`;
its definition at `~/.claude/agents/stage-runner.md` carries the full contract — on
"Agent type not found", a stale session registry, dispatch `general-purpose` briefed to
read and follow that file). Pass an explicit `model:` on every stage-runner dispatch —
default `opus` (conductor), `fable` only when a child of that phase may warrant Fable per
the policy's escalation test (per-phase call); unpinned dispatches inherit the session model (auto-Fable on a Fable
session). Brief it with the artifact, the lenses/angles, a convergence
budget, **the repo root/worktree** (every git command and the verify run from there —
`cd` at the start of each Bash call or `git -C`; sub-agent cwd does not persist between
calls), the repo's commit convention (commit fixes per round; **never push**), and the
Autonomy stop conditions as its reserved-for-the-human list. It runs the review loop
internally — for code, typically by running `review-fix-loop /lens-review` inline (per-lens;
the default for non-trivial diffs — forward the chosen lenses as pass-through args, or omit
to auto-pick per round), or `review-fix-loop
/dual-review` for a light pass — and returns the converged artifact + commit SHA(s) + a
deduped findings/decisions digest. On
return: verify the SHA resolves on HEAD (`git cat-file -e <sha>^{commit}`) before
journaling or advancing — the diff is truth, recursively — and surface any packaged
decision per the Autonomy section. **Depth:** phase-delegation already spends the first
level — don't stack it with a *dispatched* review-fix-loop and `pr-auto-review` blindly;
sum per the contract's counting rule, and prefer the stage-runner running review-fix-loop
inline (+0) to collapse a level. With `/lens-review`, that inline loop itself fans out
~2×lenses leaves per round — fine at depth 3 (`main → stage-runner → 2a agent → lens
children`), but don't *also* route the same phase through `pr-auto-review`.

### The lenses
A **suggested menu to guide toward completeness — not a fixed checklist.** Pick the lenses
that fit the change and override/add freely (perf, migrations, concurrency, accessibility…)
for whatever makes the review thorough for *this* situation. `/lens-review` follows the
same *meta-logic* (a suggested menu, overridable for thoroughness) with its own named menu;
it accepts arbitrary lens names, so the set you settle on here is what you hand it as its
override — forwarded through the loop (`review-fix-loop /lens-review <lenses>`) or on direct
invocation (`/lens-review <lenses>`); omit it to let lens-review auto-pick. The menu:
- **L1 — Diff-local scan**: off-by-ones, inverted conditions, identifier typos, dead
  branches, null-deref. Reads only the diff.
- **L2 — Structural / blast-radius**: traces writers, consumers, parallel code paths,
  invariants, and value-traces across files. (The global CLAUDE.md's Blast-radius discipline as a pass.)
- **L3 — CLAUDE.md compliance**: the diff against every rule in applicable CLAUDE.md files.
- **L4 — Comment compliance**: where the diff contradicts adjacent comments or docstrings.
- **L5 — UX**: destructive-action confirmations; empty/loading/error states; action
  feedback; affordances.
- **L6 — Security (lightweight)**: authz/authn gaps, injection, hardcoded secrets,
  sensitive-data exposure.
- **L7 — Holistic**: open-ended skeptical senior-engineer pass for cross-layer semantic
  bugs and behavior regressions the narrow lenses miss.
- **L8 — Visual fidelity** (frontend diffs only — CSS, templates, rendered components):
  **render** the changed UI in a real browser at desktop **and** mobile and inspect the
  *specific changed elements* with **measured geometry**, not a full-page glance —
  `getBoundingClientRect`/computed-style on the tightest case + a 4–6× zoom screenshot of
  any icon/glyph. Hunt the failure modes source-reading and structural tests are blind to:
  sub-pixel paint artifacts (fractional-px geometry that antialiases unevenly — *layout
  reports it as fine*), overflow/clipping of the longest text variant, ring/border/outline
  clearance, baseline/centering drift, contrast. Transient states (toasts, a 1.5s "Copied"
  latch) are invisible to click-then-screenshot — the gap between two tool calls (~10s
  measured) outlives them; drive and sample these inside a **single** `browser_evaluate`
  (click, then read the DOM at intervals). **Single-owner, serialized** — the Playwright
  browser is a *session-global singleton* (one shared tab across the main loop **and** every
  sub-agent → the same MCP server), so two agents driving it at once silently corrupt each
  other (one gets the other's page with **no error**); exactly **one** browser agent may run at
  a time. The conductor boots and owns the dev server (long-lived, serving the changed code)
  and passes its URL; the measured inspection itself is either run by the conductor **or
  delegated to a single serialized visual leaf** (a `stage-runner` — it holds Bash to reach the
  server + Playwright via ToolSearch). What's forbidden is a **concurrent** fan-out: do **not**
  hand this to `lens-review` (its per-lens leaves run in parallel and would collide on the
  shared browser; its read-only reviewer leaves have no dev server anyway). See Phase 3, Build.
  Rule of thumb that would have caught the real misses: *measure the longest/tightest variant
  and zoom every glyph — a glance for resemblance is not L8.*

### Artifacts
Write phase artifacts to the `plans/` layout (see your global CLAUDE.md → Plan artifacts), keyed to the
branch:
- PRD → `plans/<branch>-PRD.md`
- Plan → `plans/<branch>-PLAN.md`
- Spec (medium tier — one doc replacing PRD+Plan) → `plans/<branch>-SPEC.md`
- Build journal → `plans/<branch>-JOURNAL.md` (when the build has ≥2 stages)
- Umbrella → `plans/<branch>.md` (decisions, dead-ends, links to the above)
- Pre-existing issues → `plans/<branch>-PREEXISTING.md`

Commit every artifact; they merge with the branch and get reviewed in the PR diff. Run the
project's tests/lint/build (whatever CI runs) before each meaningful commit and before
promoting the PR; fix code or tests until green.

## Phases

### 0 — Size the docs (pick the tier first)
Pick the documentation tier before writing anything; record the choice + a one-line
reason in the umbrella:
- **Large or ambiguous** — product-shaped, multiple defensible directions, or my
  alignment genuinely needed → **PRD + Plan** (separate artifacts; Phases 1–2 both run).
- **Medium, requirements clear** — real design work, no open product questions →
  **single Spec** at `plans/<branch>-SPEC.md`: problem, approach, stages with verify
  criteria, risks/blast radius, test strategy — one doc doing PRD+Plan duty. Skip
  Phase 1; Phase 2 writes and reviews the Spec instead of a Plan.
- **Small** → neither (umbrella only; Phases 1–2 are skipped entirely) — and
  reconsider whether this pipeline is warranted at all.
Unsure between tiers? Ask once with AskUserQuestion, then commit to the path.

### 1 — PRD (large/ambiguous tier only)
1. Explore the codebase — delegate the mapping to one `stage-runner` dispatched as a
   mapper: brief it with the repo root/worktree to map (its children `cd` there or use
   absolute paths — sub-agent cwd does not persist between calls); it fans out its own
   per-area children and returns a compact surface map + open questions, instead of
   flooding main context with reads. (A Workflow still works when the fan-out shape is
   fixed.)
2. Run `grill-me` to align with the user on exactly what belongs in the PRD. The interview
   is live user interaction — it stays foreground; only the exploration delegates.
3. Write `plans/<branch>-PRD.md`. Commit it.

If the user said to flow straight through, continue without stopping; otherwise stop here
for review.

### 2 — Plan / Spec
1. Write `plans/<branch>-PLAN.md` from the PRD — or, on the Spec tier,
   `plans/<branch>-SPEC.md` directly from the request (reuse Phase 1 step 1's mapper
   delegation if the codebase is unfamiliar). Commit it. Everything below applies to
   whichever doc you wrote.
2. Unless the plan is trivial, delegate **the review loop** on it to one `stage-runner`
   (delegation brief above). For a complex plan, brief each reviewer with a distinct
   angle — soundness of approach, missed edge cases, simpler alternatives, blast radius.
   `codex-consult critique` is the Codex side of a plan review (so its Codex leaves run
   critique, not `codex-runner`'s review mode) — pin those Codex leaves `model: sonnet` (Codex-drivers). The stage-runner fixes, commits, and
   re-reviews to convergence internally.
3. On return, verify the SHA on HEAD, log the digest in the umbrella, and surface any
   packaged decision before flowing on.

Decide the plan's direction yourself; consult Codex on hard technical forks rather than the
human. Then flow into Build — unless the user asked to stop after the plan, or an
Autonomy-rule stop genuinely applies.

### 3 — Build
1. Execute the plan (directly, or via `orchestrate` for a staged build — a top-level driver;
   use it *or* this phase's own loop, never nested). Commit at each logical step and at the
   end of the initial implementation. Plan-stage numbering is commit cadence, not agent
   partition — a coupled single-artifact build is one runner even if the PLAN numbers five
   stages; split at artifact/coupling boundaries. On large single-runner builds, consider a
   fresh runner for the test-harness stage — independent eyes on committed seams — briefed
   against the spec/PLAN, not the builder's summary (else it tests what the code *does*,
   not what it *should*).
2. Delegate **the review loop** on the diff to one `stage-runner` (delegation brief
   above) — for code it typically runs `review-fix-loop /lens-review` inline (per-lens; the
   default for non-trivial diffs), or `review-fix-loop /dual-review` for a light pass. On
   return, verify the SHA on HEAD and surface any packaged decision.
3. **Visual gate (L8) — if the diff renders to a UI surface** (CSS, templates, components):
   *before* opening the Draft PR, the conductor boots and owns the project's dev server
   (long-lived, serving the changed code), then either runs the L8 **measured** inspection
   itself **or delegates it to a single serialized visual leaf** (a `stage-runner` given the
   server URL + the measured-inspection contract) — desktop + mobile,
   `getBoundingClientRect`/computed-style on the longest/tightest variant, a zoomed
   screenshot of every changed icon/glyph. The Playwright browser is a session-global
   singleton (field-notes §7) — exactly one browser agent at a time; never fan this
   out per-lens. Structural e2e + HTML-golden tests don't cover this (they assert
   presence/markup, not pixels). Fix any defect found and re-run the relevant lens before
   promoting.
4. If the repo is on GitHub and the user didn't say to stop: push and **open a Draft PR**.
5. **Automated-reviewer pass (optional)**: an optional external PR review bot can be
   folded in here if your repos use one. Trigger it on the fresh Draft PR (unless the PR
   already carries the bot's review for the current head — re-entrant runs must not
   double-trigger). Then poll the PR for its comments —
   as a background wait (a ~15-min poll exceeds the 10-min foreground Bash ceiling: use a
   `run_in_background` until-loop checking ~every minute, up to ~15 minutes, and read its
   captured output when it completes — never fire-and-forget; the completion notification
   re-wakes you at any depth, main loop or sub-agent alike (field-notes §4, re-probed
   2026-07-10)). If the window closes with nothing landed, note it and proceed — never
   block the pipeline on an external reviewer. For each substantive
   comment, decide whether to fix;
   fix, run the review loop on the fix, commit, push, and reply noting it's addressed.
   Re-trigger for each fresh cycle if your bot needs it, until a cycle
   yields no substantive automated comments (cap: 3 fix cycles, then
   summarize what's left). No bot on your repos → skip this step.

**Single-flight on the branch (worktree hazard):** a stage-agent may invoke
`pr-auto-review` against this branch ONLY after the build stage-runner has returned with
its work committed — never while another agent is actively mutating the branch's tree.
`pr-auto-review` reuses any existing worktree/checkout on the branch (its Step 3), so the
hazard is two agents writing one tree, not duplicate worktrees. This rule governs the rest
of the pipeline, Final Review included. Routing through `pr-auto-review` also requires a
push-contract amendment: the stage-runner's default is never-push, but `pr-auto-review`
executes its own side-effect tail (Step 11 push to the PR's head ref, Step 13 promote,
Step 14 footer comment) inside its per-PR agents and never bubbles it up — so a brief that
authorizes the route must explicitly extend push authorization to exactly that tail, and
the conductor's own push/ready-flip steps become verify-only for whatever the route
already did.

Then flow into Final Review — unless told to stop at the Draft PR.

### 4 — Final PR Review
A last, independent, **narrow** gate before recommending merge — fresh eyes looking only
for critical/blocking issues, not the broad sweep Build already did. Delegation fits
naturally here: the stage-runner starts with clean context — actual fresh eyes.
1. Choose the lenses that matter for this change; delegate the gate to one `stage-runner`
   briefed with them (delegation brief above): it runs `/lens-review <those lenses>` (a
   read-only, single-pass per-lens fan-out — one `codex-runner` + one own leaf per lens,
   deduped and validated against the diff), with the narrow set **pinned** so the gate stays
   focused. The stage-runner then fixes any critical/blocking finding and re-checks to
   certainty (a short `review-fix-loop /lens-review <those lenses>` on the fixes — the set
   stays pinned via the loop's pass-through, naturally focused by the open findings) before
   committing. (If it routes the gate through `pr-auto-review` instead, Build's
   single-flight
   rule applies.)
2. On return, verify the SHA on HEAD; push, reply to addressed comments, and surface any
   packaged decision. (Verify-only if the gate routed through `pr-auto-review` — its
   per-PR agent already pushed; see Build's push-amendment.)
3. When confident, flip the PR to **ready** and post a summary comment: what you reviewed,
   what was found, what you fixed or deliberately left, your confidence it's merge-ready,
   and any human steps still required before merge/deploy. (Likewise verify-only on the
   `pr-auto-review` route — its Step 13/14 already flipped and commented; don't duplicate.)

## Pre-existing issues
Throughout, log genuinely pre-existing problems (not introduced by your diff) to
`plans/<branch>-PREEXISTING.md`. In your final report, point the user there and offer to
walk them one at a time (AskUserQuestion) to decide which become GitHub issues. Don't fix
them inline unless they block the change.
