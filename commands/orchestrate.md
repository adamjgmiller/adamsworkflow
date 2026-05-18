---
description: Plan or implement a multi-stage task with a build journal, per-stage verify loops, and sub-agent delegation
argument-hint: (paste a plan, a request, or a plan-file path — mode is inferred)
---

You are taking on a multi-stage task. The user may hand you a rough request,
a ready plan, a plan file path, or a reference to a plan already produced
earlier in the conversation. Your job is to triage the situation, pick the
right mode (plan or execute), and then drive the work with a durable build
journal, per-stage verify loops, and aggressive sub-agent delegation.

You are a conductor, not a performer. Most per-step work — editing files,
running verifies, diagnosing failures, reviewing the cumulative diff —
belongs to sub-agents that return condensed reports. The orchestrator holds
coordination state, makes the judgment calls (advance / retry / halt /
replan), and handles the tasks no sub-agent can reasonably do. This keeps
the main context clean so you can stay coherent across a long run.

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
- Reading and updating the build journal — cursor state is coordination,
  not work.
- **Reconciling sub-agent reports against `git diff`.** Sub-agent reports
  describe *intent*; the diff is *truth*. If a reported change isn't in
  the diff, it didn't happen — re-dispatch, don't advance. This is the
  single most common cause of orchestrators drifting from reality: a
  confident "I updated X, Y, Z and tests pass" report paired with an
  empty or partial diff. Trust the diff.
- `git add` + `git commit` using the repo's commit-message conventions
  (one orchestrator keeping commit style consistent beats briefing every
  sub-agent on it).
- Between-stage reassessment: has the stage's output invalidated a later
  stage's premise?
- Advance / retry / halt decisions.
- Synthesis at the end of the once-over: deciding what to fix, what to
  flag, what to defer.
- Any fix at once-over time that requires cross-file judgment a reviewer
  agent couldn't apply on its own.

**Pick the sub-agent type by fit:**
- `general-purpose` — default for per-step build/edit/verify work, and for
  the final once-over when briefed as a reviewer.
- `Explore` — investigation (deep codebase search, multi-location reads).
- `Plan` — in-stage replanning when a step's premise turns out wrong, or
  pre-plan reconnaissance during plan mode.
- `code-simplifier:code-simplifier` — when a step is explicitly "clean up / refactor".

**External reviewers (CLI-invoked, not sub-agent types):** Codex CLI —
a `general-purpose` sub-agent follows the `/codex-consult` skill
(`~/.claude/skills/codex-consult/SKILL.md`) in **`review` mode**, which
encodes the diff-scope decision tree, the two CLI gotchas, and a
prescribed findings format. Use alongside the `general-purpose` reviewer
for second opinions on high-stakes stages or final close-outs — Codex
is GPT-driven, so disagreements with the Claude-driven reviewer are
real signal.

When you dispatch a sub-agent, say so in the same turn — one line naming
the agent type and the scope. Don't narrate it after the fact.

Plugin-namespaced agents (those with `:` in the name, like
`code-simplifier:code-simplifier`) come from installed plugins and may
not be available in every environment. External CLI tools like `codex`
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

Don't write code in this mode. Produce a structured plan. Step 6 governs what happens after the plan is presented.

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
   with a companion `-execution.md` journal scaffold. Otherwise present
   the plan inline via `ExitPlanMode`.

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

2. **Decide on a build journal.** Create one at
   `<planning-dir>/<topic>-execution.md` when *any* of these hold:
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
   Current: <stage-id> step <N> — <short status>

   ## Stage <id> — <name>
   - <ISO-time> start
   - <ISO-time> <step description> — <outcome> (commit <sha>, <test delta>)
   - ...
   - <ISO-time> stage complete
   ```

   The orchestrator (you) owns the journal end-to-end. Sub-agents don't
   write to it — they report results, and you translate those results
   into journal entries.

3. **Per-stage loop** — for each stage in plan order, run the **cycle**
   below up to **3 times**. A stage advances when its verify passes
   within those 3 cycles; if all 3 fail, halt and report to the user.
   A cycle = build → spot-check → verify → (on pass: commit & advance |
   on fail: diagnose, then next cycle).

   **One cycle:**

   a. **Build.** Dispatch a sub-agent with the stage's goal, target
      files, and verify criterion. Prompt: *"Make the edits; report back
      what you changed. Do not commit."* On cycles 2 and 3, include the
      prior cycle's failure report and diagnosis as context. Pick the
      sub-agent type by fit (see Division of labor).

   b. **Spot-check.** Orchestrator reads the diff (`git diff`). If the
      diff doesn't match intent, skip verify and go to (d) — a wasted
      build burns a cycle.

   c. **Verify.** Run the stage's verify check. For mechanical verifies
      (tests exit 0, smoke passes, type-check succeeds), the builder
      can report the result inline or the orchestrator runs the command
      directly. For semantic verifies (intent match, behavior
      preservation, regression scan), dispatch a separate verify
      sub-agent so the builder doesn't grade its own homework.

      - **On pass:** orchestrator commits at natural breakpoints (scan
        `git log` for the repo's commit-message style). One commit per
        cohesive change; don't batch a whole stage into one commit
        unless the stage is atomic. Log the stage to the journal with
        commit SHA(s) and verify delta. Advance the cursor. **Stage
        complete — exit cycle loop.**

      - **On fail:** go to (d).

   d. **Diagnose.** On cycles 1 and 2, dispatch a diagnose sub-agent
      with the failure report (and the diff, if spot-check was the
      failure) to identify root cause. The diagnosis feeds the next
      cycle's build prompt. On cycle 3, the orchestrator inspects
      directly — if two delegated cycles missed the same issue, a third
      delegate rarely helps. Increment cycle count; return to (a) if
      cycle ≤ 3, else halt.

      **Halt early when the root cause requires a decision the plan
      doesn't cover.** Routine bugs in prior-stage code — typos, missed
      cases, small corrections that preserve the original intent —
      should be fixed in-line by the next cycle's builder. Record those
      as a separate commit with a message that names the upstream
      patch (e.g. *"fix: parseTimestamp now uses UTC (patch from stage
      2)"*) so the log stays honest about what landed where. Halt only
      when continuing would require redesigning the plan: the plan's
      premise is invalidated, the verify check itself is wrong, or the
      fix would substantively *reshape* a prior stage's intent (a
      rewrite, not a patch).

   **After 3 failed cycles:** halt and report to the user with the
   accumulated failure + diagnosis reports. Never skip verify, weaken
   the check, or edit the plan silently to make progress. When halting,
   offer the user a concrete choice: *revert stage X*, *replan stage Y*,
   or *adjust the verify* — don't just dump the failure.

4. **Between stages (orchestrator-only):** don't delegate this. Read the
   journal's most recent entries, scan the cumulative diff if relevant,
   and decide whether the next stage's premise still holds. Also
   reconcile the journal: every commit SHA the journal records should
   still resolve on HEAD (`git cat-file -e <sha>`) — if a commit got
   reverted or rebased away, fix the journal before continuing, so the
   record doesn't silently lie about what's landed. If replanning is
   needed, dispatch a `Plan` sub-agent with the updated context. If
   nothing's changed, just proceed. One or two sentences to the user
   about what you checked is usually right.

5. **Post-execution once-over.** Dispatch review sub-agents **in a single
   message with multiple tool uses** so they run concurrently:
   - `general-purpose` reviewer (always) — briefed to do a once-over
     for bugs, unintended side effects, and regressions.
   - A second `general-purpose` sub-agent following the `/codex-consult`
     skill in **`review` mode** — for high-stakes work, if `command -v
     codex` succeeds. Brief it to read
     `~/.claude/skills/codex-consult/SKILL.md`, run with branch-range
     scope (`<merge-base>...HEAD`), and return findings in the skill's
     prescribed format. The skill encodes the diff-scope decisions and
     CLI gotchas — don't restate them in the brief.

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
  don't depend on each other's output, dispatch both builders in a
  single message (multiple `Agent` tool-use blocks) so they run
  concurrently. Spot-check and commit them separately on pass — one
  commit per stage keeps the journal readable. Parallelize only when
  it's clearly safe; when in doubt, stay sequential. If any parallel
  builder fails, serialize the retry — diagnose and re-dispatch each
  independently rather than running parallel failure recovery.
- Commit at natural breakpoints; don't batch. One commit per cohesive
  change — a stage might be one commit or two (e.g., a helper + its
  wiring), but rarely more.
- Never skip or weaken a verify to make progress.
- When the verify involves semantic judgment (does the fix match intent,
  is the refactor behavior-preserving, did the edit introduce regressions
  elsewhere), dispatch a separate verify sub-agent so the builder doesn't
  grade its own homework. For mechanical verifies (tests exit 0, smoke
  passes, type-check succeeds), one agent doing both build and verify is
  fine.
- Never push or open a PR without explicit approval — the final report
  hands back to the user for that.
- Blast-radius discipline before each commit: every writer, every
  consumer, parallel code paths, full function bodies, stale comments.
- Always spot-read the diff before committing a sub-agent's work — trust
  but verify.
