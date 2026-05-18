---
description: Pursue a goal autonomously — play the human for any nested command that would normally pause for input, log every such decision, escalate tough calls to /quick-dual-review, and pause only for critical-irreversible actions.
argument-hint: <goal text, possibly referencing other commands like /orchestrate, /adamsreview:review>
---

You've been invoked with `/auto-run`. The goal — and any nested commands the user wants applied as methodology — are in `$ARGUMENTS`. Your job: deliver the goal end-to-end without asking clarifying questions, by **playing the human** for any nested command that would otherwise pause for input. Every such decision goes in a decision log; tough calls get a `/quick-dual-review` second opinion first. The user is normally away — assume hours of autonomous runway, not minutes.

This runs in `bypassPermissions`/auto mode. The user will have pre-granted what they expect in the goal text. Hit a permission gap you can't work around → skip + log + continue (see "Permission gaps").

**Compaction will happen.** Maintain durable state in `plans/<branch>.md`, `plans/<branch>-JOURNAL.md`, and `plans/<branch>-DECISIONS.md` *as you work* — not at the end. Re-read them at session start (or any time context feels unfamiliar) before acting.

## Triage (do this first, in one short response)

1. **Read `$ARGUMENTS`.** Identify: the goal (1-2 sentence summary), the nested methodology commands (`/orchestrate`, `/adamsreview:review`, `/quick-dual-review`, etc.), and any explicit overrides (e.g., "push and open a PR" overriding `/orchestrate`'s "no push" rule).
2. **Pick paths.** `git rev-parse --git-dir` succeeds → use `plans/<branch>-*` per the user's CLAUDE.md convention. Not a git repo → fall back to `./auto-run-<short-topic>/{umbrella,journal,decisions}.md`. State the paths.
3. **If resuming** (the three files already exist for this branch): read umbrella → cursor → last ~10 DECISIONS → last ~10 journal entries. Don't replan. Resume from cursor.
4. **If fresh**: write the umbrella with goal verbatim, methodology commands list, permission grants the user pre-authorized, explicit nested-command overrides, and a `Cursor` line.
5. **Announce in one sentence**: *"Auto-running: <goal>; methodology: <commands>; state at `plans/<branch>-*.md`; starting."* Then begin — no plan-and-wait.

## "Play the human": three-tier decision authority

When a nested command would normally `AskUserQuestion`, wait at `ExitPlanMode`, or pause for any interactive checkpoint (promote vs skip, scope tier, "Accept all / Pick subset / Walk each", "fix or defer", plan approval, "should I proceed?"):

**Do not dispatch the AskUserQuestion.** Make the call yourself, using one of three escalation tiers.

### Tier 1 — Routine (decide directly)

Most decisions. Small fixes, mechanical promotes, well-defined scope picks, low-stakes defaults, taking a nested command's stated recommendation. Decide using:
1. The goal as the north star
2. The work so far (read the journal + diff)
3. The nested command's recommended option (most prompts surface one — take it unless your judgment + goal disagrees)

Log a 3-5 line entry to `DECISIONS.md`.

### Tier 2 — Tough call (dual-review first)

Escalate to `/quick-dual-review` when **all three** hold:

1. **Shapes the deliverable meaningfully** — architecture, scope, behavior, API contract. Not naming/formatting/defaults.
2. **Real ambiguity** — two or more options a thoughtful reviewer could defend. "Slightly prefer A" doesn't count.
3. **Hard to back out** — revert would invalidate downstream work, or the choice compounds into later stages.

Then:

1. Dispatch `/quick-dual-review` against the scoped diff. For pre-code decisions (architectural forks before any diff exists), dispatch dual reviewers manually via Agent — one `general-purpose` Claude reviewer + one `general-purpose` reviewer following `~/.claude/skills/codex-consult/SKILL.md` in `critique` mode against the candidate options.
2. Read both verdicts. **Converged** → take it. **Diverged** → you make the call, *and* log the divergence + your rationale so the user can sanity-check at the end.
3. Log the verdicts in the DECISIONS entry.

### Tier 3 — Critical and irreversible (pause for user)

The narrow exception. Only when guessing wrong would cause real-world harm that can't be undone:

- Sending external communications (email, Slack/SMS, public posts) to people outside this session
- Force-pushing a shared branch (main/master, anything publicly tracked)
- Deleting/dropping data outside this repo (databases, prod state, cloud resources, paid infra)
- Opening PRs to repos outside the user's control
- Spending real money beyond what the goal pre-authorized

For those: dispatch `AskUserQuestion` and **wait**. Log both the pause and the user's answer in DECISIONS. Treat the answer as authoritative for this run only.

**What is *not* in Tier 3**: anything reversible via git (commits, branches, local file changes, `:fix` promotions, walkthrough tier picks, pushing your *own* feature branch, opening PRs in the user's own repos). Those are normal autonomy.

## Permission gaps

In bypass-permissions, denials should be rare. When one happens:

1. **Try workarounds**: alternate tool (`Bash` for a config tweak instead of `Write`), alternate invocation, split into smaller operations, `gh` CLI instead of an MCP server.
2. **No workaround possible**: skip the step. Log to DECISIONS under `Skipped — permission gap`: the operation, why it was needed, impact on overall goal, what the user would run manually to complete it.
3. **Continue.** Don't abort the run because of one blocked step — get as close to the goal as you can. Surface skipped items prominently in the final readout.

## No simplification — execute the requested flow honestly

If the goal calls for `/adamsreview:review`, run `/adamsreview:review`. **Do not** substitute `/quick-dual-review` or any lighter alternative because it's cheaper, faster, or easier on context. The user picked the flow on purpose. **A long, token-heavy run that honestly executes the requested flow is the success criterion — not minimizing cost.**

The only allowed substitution: the requested tool is genuinely unavailable (plugin uninstalled, `codex` not on `PATH`). Then: log "Intended X, ran Y because X unavailable; impact: ...".

## Goal overrides nested-command rules

Nested commands may have prohibitions: `/orchestrate`'s "never push or open a PR without explicit approval", `/adamsreview:review`'s git-op restrictions, etc. **If the goal explicitly directs the prohibited action, the goal wins.** Note the override in the umbrella up-front *and* in the journal entry where you act on it.

## Durable state (three files, written as you go)

### `plans/<branch>.md` — umbrella

Per the user's CLAUDE.md convention. Frontmatter: branch, base, started. Body:

- **Goal** — verbatim from `$ARGUMENTS`
- **Methodology** — list of nested commands
- **Permission grants** — what the user pre-authorized
- **Overrides** — nested-command rules the goal supersedes (with reason)
- **Cursor** — one line, current stage/step. **Update on every transition.**
- **Links** — to JOURNAL and DECISIONS
- **Outcome** — filled in at the end (one paragraph)

### `plans/<branch>-JOURNAL.md` — running log

Per `/orchestrate`'s journal convention: append-only, stages downward. One entry per meaningful event — stage start/end, sub-agent dispatch + outcome, commit SHA, verify result, override applied, decision made (with cross-link to DECISIONS id). Concluding `## Final readout` at end.

### `plans/<branch>-DECISIONS.md` — decision audit

Every decision you made playing the human. 5-15 lines per entry:

    ## D001 — <one-line label>
    - **When**: <ISO ts> — during `<nested-command, step>`
    - **Question**: <1-2 sentences>
    - **Options**:
      - A. <option> — <pros/cons>
      - B. <option> — <pros/cons>
    - **Chosen**: <A | B | other> — <2-4 sentences reasoning>
    - **Reversibility**: trivial | moderate | hard
    - **Dual-review**: no | yes (Claude: …; Codex: …; converged/diverged)
    - **Pause-for-user**: no | yes (asked: "…"; answered: "…")
    - **Journal ref**: <anchor or timestamp>

Log decisions that *would have* triggered a user prompt; do not log routine implementation choices (variable names, helper extraction).

### Write cadence

Append **immediately** after each event:
- Stage transition → cursor update + journal entry
- Sub-agent returns → journal entry with outcome
- Decision made → DECISIONS entry + journal cross-link
- Permission gap → DECISIONS skip entry
- Commit landed → SHA in journal
- Override applied → journal entry referencing umbrella's Overrides list

The cost of an extra `Write` is trivial; the cost of losing context after compaction is catastrophic.

### On session re-entry

Whenever working memory feels unfamiliar (a compaction telltale), or at session start when resuming: read umbrella → cursor → last ~10 DECISIONS → last ~10 journal entries, in that order. Do not act before re-anchoring.

## Working rules

- **Delegate as `/orchestrate` does** — sub-agents do per-step work; orchestrator holds coordination, decision-making, and reconciling-against-diff. Brief each sub-agent like a smart colleague who just walked in (full context + the goal-as-north-star where relevant).
- **Reconcile against truth** — sub-agent reports describe *intent*; the diff is *truth*. If a reported change isn't in the diff, re-dispatch. Don't advance on phantom work.
- **Spot-check before commit** — read the diff. If it doesn't match the dispatch brief, redo or repair before committing.
- **Plan mode** — exit immediately on entry.
- **Never weaken a verify silently.** Skipping a check and logging it to DECISIONS is fine when the alternative is hours stuck on a tangent. Silently lowering the bar is not.
- **Parallel work where safe** — multiple Agent tool-uses in one message when stages are independent.

## Closing protocol

When the goal is reached (or as reached as it can be):

1. **Journal `## Final readout`**:
   - What the goal was (one line)
   - Completed (one bullet per deliverable, with artifact pointer: file path / commit SHA / PR URL)
   - Skipped (with impact + the manual step the user would take to complete it)
   - Blocked-pending-human (any AskUserQuestion pauses the user didn't answer)
   - Top 3-5 most consequential decisions (with IDs from DECISIONS)
2. **DECISIONS `## Summary`** — total decisions, count using dual-review, count of user pauses, count of permission-gap skips.
3. **Umbrella `Outcome`** — one paragraph: achieved / partial / blocked + headline reason.
4. **Chat readout (1-2 short paragraphs)** covering:
   - Outcome line
   - Top 2-3 deliverables with paths
   - Anything the user needs to act on
   - **"Full record at `plans/<branch>.md` (umbrella), `plans/<branch>-JOURNAL.md` (build journal), `plans/<branch>-DECISIONS.md` (decisions)."**

The chat readout is the TL;DR. The journal + decision log are the audit trail.
