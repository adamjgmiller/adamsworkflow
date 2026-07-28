---
description: Plan or execute a multi-stage task with a build journal, per-stage stage-runners, and verify loops — the staged-execution engine. For a full docs→PR pipeline from a raw request, use build-system instead.
argument-hint: (paste a plan, a request, or a plan-file path — mode is inferred)
---

You are taking on a multi-stage task. The user may hand you a rough request,
a ready plan, a plan file path, or a reference to a plan already produced
earlier in the conversation. Your job is to triage the situation, pick the
right mode (plan or execute), and then drive the work with a durable build
journal, per-stage verify loops, and aggressive sub-agent delegation.

You are a conductor, not a performer. Most per-step work — editing files,
running verifies, diagnosing failures, reviewing the cumulative diff —
belongs to delegated agents that return condensed reports. In execute mode
the unit of delegation is a whole stage: one stage-runner per stage, which
runs the stage's cycle loop internally and fans out its own leaf children
(a *stage* = a coupling boundary, not a plan-numbering unit — see Division
of labor).
The orchestrator holds coordination state, makes the judgment calls
(advance / retry / halt / replan), and handles the tasks no sub-agent can
do at all — above all, talking to the user. This keeps the main context
clean so you can stay coherent across a long run.

Scope: this command is the staged-execution engine. A raw feature request that warrants
docs + PR ceremony belongs to the Build System skill; that skill may use `/orchestrate`
as its build-phase driver *instead of* its own build loop — one driver or the other,
never nested. Use `/orchestrate` directly when you have (or will write) a plan and want
execution without that pipeline. On pushing: any autonomous-push pre-approval your
global CLAUDE.md may carry doesn't reach this command — its documented exit is a local
branch handed back for approval, so the never-push gate below stands.

## Triage

Before doing anything, read the situation and pick one of four outcomes.
Don't ask the user unless the situation is genuinely ambiguous after this
check — one question at most, not a checklist.

Signals to weigh, in rough priority order:

1. **Session state: are we in plan mode?** (The tool is `ExitPlanMode`.)
   If yes, the user expects a plan, not execution. Go to **plan**.

2. **Recent conversation context.** Has the user (or you) produced and
   approved a plan earlier in this conversation that the paste or the
   user's message refers to? If the paste is terse ("go", "do it", "run
   it", "implement", or a plan filename) and context carries an approved
   plan, go to **execute** against the in-context plan.

3. **File reference.** Does the message name a plan file (e.g.
   `plans/foo.md`, `docs/plans/foo.md`)? Read it. If it's clearly a plan
   (stages, steps, verify criteria), go to **execute**. State intent in
   one sentence — *"Loading `<file>`; executing."* — and proceed in the
   same response. The user's next message will be either silence (a
   go-ahead) or a redirect. Don't pause waiting for a hypothetical
   interrupt.

4. **Paste shape.** Inspect the pasted text:
   - **Plan-shaped** (explicit stages / numbered steps / verify hooks /
     acceptance criteria) → go to **execute**.
   - **Request-shaped** (goal + rough direction, no stages, no verify) →
     go to **plan**.
   - **Mixed** (part request, part plan fragments) → go to **plan**,
     incorporating the fragments into the structured output.

5. **Leading verb as tiebreaker.** If the message opens with
   "Plan" / "Draft" / "Design", prefer **plan**. If "Implement" /
   "Execute" / "Run" / "Build" / "Do", prefer **execute**. These override
   signal #4 when present but don't override #1 (plan mode).

6. **Still ambiguous?** Default to execute mode. Announce your
   interpretation in one sentence — *"Reading this as execute against
   <X>; proceeding."* — and proceed in the same response. The user can
   redirect with their next message. Only ask a clarifying question
   when the *goal itself* is unclear (not the plan-vs-execute split) —
   in that case, one concrete question with options, then wait.

Report your triage decision in one sentence at the top of your first
response — e.g.
*"Treating this as execute-ready against the plan in context; creating
a journal at `plans/<topic>-execution.md`."*

## Division of labor

Applies to both modes, but matters most in execute mode.

**Delegate to sub-agents (the default — reach for this first):**
- **A whole execute-mode stage: one stage-runner per non-interactive
  stage.** A *stage* for dispatch purposes is a coupling boundary, not a
  plan-numbering unit — plan stages are commit cadence, agent boundaries
  are coupling boundaries. Merge tightly-coupled plan stages (chapters of
  one artifact, strictly sequential, shared invariants) into one
  stage-runner briefed to commit per plan-stage; fan out only at genuine
  artifact/module boundaries or parallelizable work. Dispatched
  sub-agents can spawn their own children
  (`~/.claude/docs/field-notes.md` §1), so the stage-runner runs the full build → verify → diagnose
  cycle internally — fanning out its own builder/verifier/diagnoser
  leaves — commits per the convention you brief, and returns one compact
  bundle. The next three bullets describe the children *it* fans out, not
  extra dispatches from you.
- Per-step build/edit work: the sub-agent reads the target files, makes the
  edits, and reports back what it changed.
- Verify runs whose output is verbose: the sub-agent runs the check,
  interprets pass/fail, and returns a condensed diagnosis on failure.
- Diagnose-and-retry cycles: the sub-agent gets the failure context,
  proposes and applies a fix, re-runs verify, reports the outcome.
- Investigative work during planning: codebase-wide searches, multi-file
  reads, architectural reconnaissance.
- The post-execution once-over: parallel review sub-agents read the
  cumulative diff and surface findings.

**Keep in the orchestrator (do not delegate — these are coordination):**
- Triage (mode selection).
- **Every user gate and every live-context step.** Plan approval
  (`ExitPlanMode`), the halt-after-3 report, push/PR authorization, and
  anything that reads the live conversation stay on the main loop —
  dispatched sub-agents carry no `AskUserQuestion` tool at all
  (field-notes §3). A delegated agent that hits a question only the user can
  answer returns it as *data* — a packaged pending decision — and you
  surface it (via `AskUserQuestion`, or `/askme` when several have
  queued). Never let a sub-agent guess its way past a gate.
- Reading and updating the build journal — cursor state is coordination,
  not work.
- **The top level of recursive trust-the-diff.** Reports describe
  *intent*; the diff is *truth* — at every level. The stage-runner
  reconciles its children's reports against the `git diff` it holds
  locally; you verify every commit SHA it returns is an ancestor of HEAD
  (`git merge-base --is-ancestor <sha> HEAD`) and spot-read the stage's diff before
  journaling or advancing. If a reported change isn't in the diff — or a
  reported SHA isn't on HEAD — it didn't happen: re-dispatch, don't
  advance. This is the single most common cause of orchestrators
  drifting from reality: a confident "I updated X, Y, Z and tests pass"
  report paired with an empty or partial diff. Trust the diff.
- Commit POLICY, not each commit. Scan `git log` once for the repo's
  commit-message convention and brief it verbatim into every
  stage-runner; the stage-runner executes its own stage's commits. Style
  consistency comes from one conductor briefing one convention — and
  SHA-verifying what comes back — rather than from one agent typing
  every message.
- Between-stage reassessment: has the stage's output invalidated a later
  stage's premise? A stage-runner never owns this — it sees its own
  stage, not the cumulative cross-stage picture.
- Advance / retry / halt decisions.
- Synthesis at the end of the once-over: deciding what to fix, what to
  flag, what to defer.
- Any fix at once-over time that requires cross-file judgment a reviewer
  agent couldn't apply on its own.

**Pick the sub-agent type by fit:**
- `stage-runner` — one per execute-mode stage; the named def at
  `~/.claude/agents/stage-runner.md` carries the role contract. If the
  type is unknown ("Agent type not found" — the agent registry loads at
  session start), dispatch `general-purpose` briefed to read and follow
  that file as its full contract.
- `general-purpose` — default for one-off delegated work and the final
  once-over reviewer; also the type the stage-runner's own leaf children
  typically run as.
- `Explore` — investigation (deep codebase search, multi-location reads).
  Note `Explore`/`Plan` types lack the `Agent` tool — fine for leaves,
  never as a stage-runner stand-in.
- `Plan` — replanning when a returned halt invalidates a stage's premise,
  or pre-plan reconnaissance during plan mode.

**External reviewers (Codex CLI):** dispatch the named `codex-runner`
agent — its def (`~/.claude/agents/codex-runner.md`) carries the full
runner contract: follow the `codex-consult` skill (diff-scope decision
tree, CLI gotchas, prescribed findings format) in **`review` mode**,
return `JOB_ID` + sentinel `exit=N` + findings verbatim, never skip,
never substitute its own review. Use alongside the `general-purpose`
reviewer for second opinions on high-stakes stages or final close-outs —
Codex is GPT-driven, so disagreements with the Claude-driven reviewer are
real signal. The two reviewers are **siblings** you dispatch
side-by-side; the Claude reviewer never spawns the Codex one. Brief the
`general-purpose` reviewer **read-only** — it reads and reports, never
edits files or mutates git state.

When you dispatch a sub-agent, say so in the same turn — one line naming
the agent type and the scope. Don't narrate it after the fact.

Plugin-namespaced agents (those with `:` in the name) come from
installed plugins and may not be available in every environment.
External CLI tools like `codex`
may not be installed either. Before dispatching a plugin agent, verify
it appears in your available agent types list; before briefing a
sub-agent to invoke the `codex` CLI, verify with `command -v codex`.
If either is missing, fall back to running with whichever reviewers
*are* available rather than failing the dispatch.

**How to write the sub-agent prompt.** The sub-agent starts with zero
context from this conversation. See the `Agent` tool's own prompt-writing
guidance for the full picture — in short: brief it like a smart colleague
who just walked in. Include the stage goal, target files (absolute paths),
the verify criterion, any prior cycle's failure + diagnosis, and what
"report back" should look like. Terse command-style prompts produce
shallow, generic work. Don't push synthesis onto the sub-agent ("based on
your findings, fix the bug") — decide what you want done, then say so.

## Plan mode

Don't write code in this mode. Produce a structured plan. Item 6 below governs what happens after the plan is presented.

1. Read the request (pasted prose, prior context, or referenced file).
   Identify: the end-goal, natural stage boundaries, inter-stage
   dependencies, and what "done" looks like per stage.

2. **If the request requires investigation to plan well** (you'd need to
   understand unfamiliar code, map call sites, or survey an approach
   space), dispatch an `Explore` or `Plan` sub-agent first with a scoped
   prompt. Incorporate its findings into the plan. Don't try to
   investigate inline — it bloats the context before execute mode even
   starts.

3. Restructure into explicit stages. Each stage must have:
   - **Goal** — one sentence.
   - **Steps** — concrete actions (edits, commands, dispatches, lookups).
     Name the sub-agent type where it matters (e.g. "dispatch `Explore`
     to map callers").
   - **Verify** — how you'll know the stage succeeded. Name the actual
     check: a test command, a smoke script, `grep`, a manual eyeball.
   - **Rollback** — what to do if verify fails more than 3 times.

4. Flag risks: cross-stage coupling, ambiguous acceptance criteria,
   inputs you'd need that aren't present.

5. If the plan is long-lived (>5 stages or will likely span multiple
   sessions), offer to write it to the repo's planning directory (check
   for `plans/`, `docs/plans/`, or similar — use the existing convention)
   with a companion `-execution.md` journal scaffold — except when the
   plans/ layout is in force (linked worktree, build-system engaged, or
   running under `/auto-run`), where the scaffold is the branch's
   `plans/<branch>-JOURNAL.md` sidecar instead (under `/auto-run`, its
   resolved `STATE_STEM`: `plans/<STATE_STEM>-JOURNAL.md`; matching
   execute mode item 2), so neither build-system nor auto-run ends up
   with two journals. Otherwise present the plan inline via `ExitPlanMode`.

6. **Auto-transition to execute mode by default** once the plan is
   presented (inline approval via `ExitPlanMode`, or after writing the
   plan to disk per step 5). Only wait for an explicit go-ahead when
   the user signaled plan-only intent in the original request (e.g.
   *"plan it"*, *"just draft"*, *"don't execute"*, *"review the plan
   first"*) or when the plan surfaced risks at step 4 that materially
   change scope — in that case, state the risks in one sentence and
   wait for direction.

## Execute mode

1. **Load plan.** If the user referenced a plan file, read it. If they
   pasted the plan inline, treat the paste as the plan. If the plan is
   in conversation context, work from that. If an execution journal
   already exists for this plan, read it — the cursor line tells you
   where to resume.

   If you notice context has been compacted mid-run (the cursor line
   feels unfamiliar, or journal entries you wrote are gone from working
   memory), re-read the journal from disk before advancing. The cursor
   line is the source of truth, not your recollection.

   **Branch first:** if HEAD is on the default branch, create/enter a
   working branch (or worktree) before dispatching any mutating stage —
   stage commits never land on main (your global CLAUDE.md's
   never-commit-to-main rule; review-fix-loop Step 1 runs the same
   preflight).

2. **Decide on a build journal.** Create one at
   `<planning-dir>/<topic>-execution.md` — except when the plans/ layout is in
   force (linked worktree, build-system engaged, or running under `/auto-run`,
   whose durable state expects `plans/<branch>-JOURNAL.md`: your global CLAUDE.md § Plan
   artifacts), where the journal is the branch's `plans/<branch>-JOURNAL.md`
   sidecar instead (under `/auto-run`, its resolved `STATE_STEM`:
   `plans/<STATE_STEM>-JOURNAL.md`), so the umbrella's index can reference it
   and neither build-system nor auto-run ends up with two journals. Create it
   when *any* of these hold:
   - Plan has >2 stages, OR
   - Any stage expects retry/verify loops, OR
   - Work will likely span multiple sessions / context-compaction events, OR
   - Commit SHAs need to accumulate as a record.

   Skip the journal when: the work is a single atomic change with one
   verify step, OR the plan itself fits in ~10 lines and one commit.
   If you skip, say so explicitly in your first response so the user
   knows the decision was deliberate.

   Journal shape (append-only, stages grow downward):

   ```
   # <Topic> execution journal

   ## Cursor
   Current: <stage-id> — dispatched | complete — <short status>
   (stage-granular by design: recovery re-runs the whole stage from cycle 1;
   mid-stage step state is ephemeral and never a resumable position)

   ## Stage <id> — <name>
   - <ISO-time> start
   - <ISO-time> <step description> — <outcome> (commit <sha>, <test delta>)
   - ...
   - <ISO-time> stage complete
   ```

   The orchestrator (you) owns the journal end-to-end. Sub-agents don't
   write to it — they report results, and you translate those results
   into journal entries. Stated deliberately, as a tradeoff we accept: a
   stage-runner's internal cycle state (which cycle it's on, child
   reports, diagnoses) is ephemeral and never journaled. A crash or
   compaction mid-stage loses it, and journal-cursor recovery re-runs
   the WHOLE stage from cycle 1. Per-cycle journaling would put the
   journal back in your hot loop and forfeit the context win — instead,
   keep stages sized so a full re-run is tolerable.

3. **Per-stage loop** — for each stage in plan order, dispatch **one
   stage-runner** (type `stage-runner`; stale-registry fallback per *Pick
   the sub-agent type by fit*). Pass an explicit `model:` on every
   stage-runner dispatch — `opus` (a conductor; Fable only if the user
   named it); never leave it to inheritance — an unpinned dispatch inherits
   the session model, auto-Fabling the conductor on a Fable session.
   The stage-runner runs the stage's cycle
   internally, up to
   **3 times**, fanning out its own builder/verifier/diagnoser leaves,
   and returns one compact bundle: outcome (`pass`|`fail`|`halt`),
   cumulative diff + commit SHA(s), the verify result (concrete final
   pass/fail counts, never "pending"), a findings/decisions digest, and any
   packaged human-decision. A stage that genuinely needs live user input
   mid-stage (rare; plan-flagged) stays on the main loop instead —
   delegate only non-interactive stages.

   Depth check: you(0) → stage-runner(1) → its leaves(2) — comfortably
   inside the ~3–4-level convention (Agent dispatch = +1, inline skill/command = +0;
   field-notes §5).

   **The brief** — the def's variables, filled per stage, plus this
   command's own rules:

   - **Goal / Targets (absolute paths) / Verify** — straight from the
     plan stage.
   - **Repo root:** `<abs path>` — run the verify command and every
     git operation from here (`cd` at the start of each Bash call or
     `git -C`; sub-agent cwd does not persist between calls).
   - **Leaf dispatches: async-only.** Each leaf's result arrives as a
     task-notification carrying its final text (re-waking you if
     you've stopped) — count your dispatches and collect every leaf's
     notification before advancing the stage (field-notes §4).
   - **Budget: 3 cycles.**
   - **Commit contract:** commit at natural breakpoints per the repo's
     convention — include the convention verbatim (you scanned `git log`
     for it once); blast-radius discipline before each commit; leaf
     children never commit.
   - **Push contract: NEVER.** This command's never-push gate (Working
     rules) carries down into every stage-runner brief, every time — no
     stage-runner may push or open a PR.
   - **Patch-vs-halt:** routine bugs found in prior-stage code — typos,
     missed cases, small corrections that preserve the original intent —
     patch in-line, as a separate commit whose message names the
     upstream patch (e.g. *"fix: parseTimestamp now uses UTC (patch from
     stage 2)"*) so the log stays honest about what landed where. Return
     `halt` — packaged, mid-budget, unresolved — the moment continuing
     would require redesigning the plan: the plan's premise is
     invalidated, the verify check itself is wrong, or the fix would
     substantively *reshape* a prior stage's intent (a rewrite, not a
     patch). The stage-runner never replans on its own, and it does
     **not** own between-stage premise reassessment — that's yours
     (step 4).
   - **Verify contract:** never skip or weaken the verify to make
     progress — a verify you believe is wrong is a `halt` (patch-vs-halt
     above), not an edit.
   - **Conditions reserved for the human:** any decision the plan flags
     for the user, plus the patch-vs-halt boundary above.

   **The cycle the stage-runner runs** (brief it on this shape — it's
   the same loop this command used to run at top level):

   a. **Build.** Fan out a builder leaf with the stage's goal, target
      files, and verify criterion. Prompt: *"Make the edits; report back
      what you changed. Do not commit."* On cycles 2 and 3, include the
      prior cycle's failure report and diagnosis as context.

   b. **Spot-check.** The stage-runner inventories `git status
      --porcelain --untracked-files=all` and reads the full pending
      state: `git diff` (unstaged), `git diff --cached` (anything the
      builder staged), and the untracked files the porcelain lists —
      bare `git diff` alone shows neither staged edits nor new files,
      and stages commonly create files. If the work doesn't match
      intent, skip verify and go to (d) — a wasted build burns a cycle.

   c. **Verify.** Run the stage's verify check. For mechanical verifies
      (tests exit 0, smoke passes, type-check succeeds), the builder
      can report the result inline or the stage-runner runs the command
      itself. For semantic verifies (intent match, behavior
      preservation, regression scan), a separate verify leaf, so the
      builder doesn't grade its own homework.

      - **On pass:** the stage-runner commits per its briefed
        convention — one commit per cohesive change; don't batch a
        whole stage into one commit unless the stage is atomic — and
        returns its bundle. **Stage complete — exit cycle loop.**

      - **On fail:** go to (d).

   d. **Diagnose.** On cycles 1 and 2, a diagnose leaf gets the failure
      report (and the diff, if spot-check was the failure) to identify
      root cause; the diagnosis feeds the next cycle's build prompt. On
      cycle 3, the stage-runner inspects directly — if two delegated
      cycles missed the same issue, a third delegate rarely helps.
      Increment cycle count; return to (a) if cycle ≤ 3, else return
      `fail` with the accumulated failure + diagnosis reports.

   **On return (conductor work — never delegate this):**

   - **Verify the SHAs.** Every commit SHA in the bundle must be an
     ancestor of HEAD: `git merge-base --is-ancestor <sha> HEAD` (run
     from the checkout the stage was to land on — the conductor's working
     tree; for worktree-isolated parallel stages, after the integration
     merge, per the parallel bullet). Not a bare existence check —
     worktrees share one object store, so mere existence passes for any
     object anywhere in the repo, including a commit landed in the wrong
     tree. This is recursive trust-the-diff: the stage-runner reconciled
     its children against its local diff; you verify its claim against
     actual repo state. A SHA that isn't an ancestor means the stage
     didn't land on this branch — treat it as a fail and re-dispatch;
     don't advance.
   - **Spot-read the stage's diff** (`git show --first-parent <sha>` /
     `git diff`; `--first-parent` is a no-op on normal commits but keeps
     a merge SHA from showing an empty combined diff)
     against the bundle's digest — trust but verify, one level up.
   - **Journal** the stage (commit SHAs, verify delta, notable
     decisions); advance the cursor.
   - **On `halt` (packaged decision):** surface it to the user via
     `AskUserQuestion` (or `/askme` if several have queued) before any
     replanning. The packaged decision is data; the asking is yours.
   - **On `fail` after the 3-cycle budget: halt and report to the user**
     with the accumulated failure + diagnosis digest. Never skip verify,
     weaken the check, or edit the plan silently to make progress. When
     halting, offer the user a concrete choice: *revert stage X*,
     *replan stage Y*, or *adjust the verify* — don't just dump the
     failure.

4. **Between stages (orchestrator-only):** don't delegate this — a
   stage-runner sees one stage and can't reassess a cross-stage premise.
   Read the journal's most recent entries, scan the cumulative diff if
   relevant,
   and decide whether the next stage's premise still holds. Also
   reconcile the journal: every commit SHA the journal records should
   still be an ancestor of HEAD (`git merge-base --is-ancestor <sha> HEAD`)
   — if a commit got rebased away, fix the journal before continuing, so the
   record doesn't silently lie about what's landed. (A `git revert` leaves the
   original SHA an ancestor — this check cannot see reverts; a stage that
   reverts earlier work must journal that itself.) If replanning is
   needed, dispatch a `Plan` sub-agent with the updated context. If
   nothing's changed, just proceed. One or two sentences to the user
   about what you checked is usually right.

5. **Post-execution once-over.** Dispatch review sub-agents **in a single
   message with multiple tool uses** so they run concurrently. The two
   reviewers are **siblings** you dispatch side-by-side — both leaves;
   neither spawns the other:
   - `general-purpose` reviewer (always; model per the model-selection policy) — briefed to do a once-over
     for bugs, unintended side effects, and regressions.
   - The named `codex-runner` agent — for high-stakes work, if `command
     -v codex` succeeds. Its def (`~/.claude/agents/codex-runner.md`)
     carries the full runner contract (codex-consult's diff-scope
     decisions and CLI gotchas, `review` mode, `JOB_ID` + sentinel
     `exit=N` + verbatim findings) — don't restate the mechanics in the
     brief; supply only the scope: branch-range (`<merge-base>...HEAD`).
     If the type is unknown (stale registry), dispatch `general-purpose`
     briefed to read and follow that file, pinned `model: sonnet` (Codex-driver; the def's pin doesn't transfer via prose).

   When Codex is available, dispatch **both** reviewers in one message —
   concurrent tool-uses on the same turn.

   Hand each reviewer the cumulative diff and the plan as context.
   Ask for: edge cases, callers/writers the stages didn't touch,
   assumptions that shifted mid-execution, plan steps that got silently
   scoped out, stale comments or docs.

   **Then synthesize (orchestrator work):** read the review agents'
   findings as a set — dedup overlapping points. When reviewers
   disagree, treat the disagreement as a signal for direct orchestrator
   inspection. Decide what to fix, what to flag, what to defer. For each fix:
   - Mechanical or file-scoped → dispatch a sub-agent to apply it.
   - Cross-file, requires synthesis, or a judgment call no reviewer
     could make on its own → orchestrator fixes directly.
   Fix in the same turn unless genuinely out of scope.

6. **Final report:** stages completed, commits created, verify deltas
   (e.g., `N → M assertions`, `0 → 0 failures`), once-over findings
   resolved vs. deferred, anything flagged for the user. One or two
   paragraphs — don't produce a separate review artifact.

## Working rules (both modes)

- Delegate first, do-it-yourself second. If you find yourself reading
  files or editing inline during execute mode, pause and ask whether a
  sub-agent should be doing it. The exceptions are listed in *Keep in
  the orchestrator* above, plus genuinely trivial changes (single-line
  fix, import add, comment update) where briefing overhead would exceed
  the edit — do those inline and log to the journal.
- **Parallel stages when safe.** Sequential stages are the default, but
  if two adjacent stages touch disjoint files *and* their verifies
  don't depend on each other's output, they may run concurrently —
  **each in its own worktree** (`isolation: 'worktree'` on the Agent
  dispatch; trustworthy as of v2.1.210). Disjoint files do NOT make one
  shared checkout safe: the runners would share one index and HEAD —
  `index.lock` races, sibling uncommitted diffs polluting each other's
  trust-the-diff spot-checks, sibling edits swept into commits.
  **Integration is yours, not theirs**: when the bundles return, merge
  each stage's commits into the working branch yourself, in stage order
  (`git merge <stage-tip-sha>` — disjoint files make these trivial),
  THEN run the ancestry check and journal against the post-merge HEAD —
  one commit-set per stage keeps the journal readable. Remember each
  stage-runner fans out its own children — two concurrent stages is
  more like four-to-six concurrent agents; count the real number before
  adding a third. Parallelize only when it's clearly safe; when in
  doubt, stay sequential. If any parallel stage-runner fails, serialize
  the retry — diagnose and re-dispatch each independently rather than
  running parallel failure recovery.
- Commit at natural breakpoints; don't batch. One commit per cohesive
  change — a stage might be one commit or two (e.g., a helper + its
  wiring), but rarely more. In execute mode this rule rides inside every
  stage-runner's commit contract; you enforce it by spot-reading what
  comes back.
- Never skip or weaken a verify to make progress.
- When the verify involves semantic judgment (does the fix match intent,
  is the refactor behavior-preserving, did the edit introduce regressions
  elsewhere), dispatch a separate verify sub-agent so the builder doesn't
  grade its own homework. For mechanical verifies (tests exit 0, smoke
  passes, type-check succeeds), one agent doing both build and verify is
  fine.
- Never push or open a PR without explicit approval — the final report
  hands back to the user for that. This gate carries down: every
  stage-runner brief sets its push contract to NEVER, no exceptions —
  delegation must never launder a push.
- Blast-radius discipline before each commit: every writer, every
  consumer, parallel code paths, full function bodies, stale comments.
  The stage-runner does the committing, so this rides in its brief.
- Trust but verify, recursively: the stage-runner spot-reads its
  children's work against its local diff before committing; you
  spot-read the returned stage diff and ancestry-check every reported
  SHA (`git merge-base --is-ancestor <sha> HEAD`) before journaling.
  Reports describe intent; the diff is truth — at both levels.
