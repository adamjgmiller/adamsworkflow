---
description: Turn GitHub issues (or an existing PR) into validated, reviewed, ready-to-merge PRs — validity-gates and sizes each issue, resolves via per-issue stage-agents, reviews via /pr-auto-review; optional deploy handoff.
argument-hint: "[<issue#>...] [review #<pr>] [deploy #<pr>] [and deploy | and ship | waterfall]"
---

Turn one or more GitHub issues (or an existing PR) into a reviewed, ready-to-merge PR — and optionally ship it. Two execution paths, picked in Step 2. The **default Task path** lifts the judgment-bearing stages onto main-loop **stage-agents**: one per issue for resolve — each fans out its own leaf children per this file's Appendix (the retired `/issue-auto-resolve`'s per-issue recipe) — and the review stage invokes **`/pr-auto-review` for real** (it always-delegates internally now). The **Path-B Workflow** path remains for fixed-shape fan-outs and background runs: there you author and run a Workflow script that reproduces the care at the *script* level, because Workflow-spawned agents still cannot nest sub-agents (on that fabric the fan-out has to live in the script, not in a delegated command).

The skill's own job is the things the underlying commands don't do:
1. **Validate each issue is still worth doing** — already-fixed / obsolete / false-positive / superseded-by-comment → early-exit, no PR. Tiered: quick by default, adversarial for auto-filed/stale/uncertain.
2. **Size each change** (simple vs meaningful) and scale the process to it — independently per issue.
3. **Route entry/exit** — start from issues, from a PR (review-only), or from a PR (deploy-only); stop at a ready PR unless deploy is requested.
4. **Own the deploy judgment** — the one stage that *can't* be delegated at all (it needs `AskUserQuestion`, which neither a workflow nor a dispatched sub-agent carries), handled main-loop with the care encoded.

Usage: `/ship-issues [<issue#>...] [review #<pr>] [deploy #<pr>] [and ship | and deploy | waterfall]`

Examples:
- `/ship-issues 366 367 369` — resolve all three (each sized independently) → reviewed ready PRs, stop.
- `/ship-issues 366 367 369 and deploy` — …then waterfall-deploy them.
- `/ship-issues review #374` — skip resolve; just run the adversarial PR review on an existing PR → promote if clean.
- `/ship-issues deploy #374` — skip everything; just merge-and-deploy that PR.

## Hard architectural facts (read first)

- **Two fabrics, opposite spawn capability** (`~/.claude/docs/field-notes.md` §1):
  - **Workflow agents CANNOT spawn sub-agents** (no Agent/Task-dispatch tool in their toolset at all). They CAN: Bash, Read/Edit/Write, the **Skill** tool, ToolSearch/MCP, and the **codex CLI** directly. So on the Workflow fabric every fan-out (plan critique, per-lens review, dual-source) must be modeled at the **Workflow-script level** via `parallel()` / a `while` loop — never by telling a workflow agent to "run /pr-auto-review". Path-B's script-level fan-out stays **mandatory** for whatever runs on this fabric. If you are a workflow agent reading this by section-citation: you hold no Agent tool — the fan-out lives in your script, not in you.
  - **Task-fabric sub-agents CAN spawn their own sub-agents** (a dispatched `general-purpose`/stage-runner agent holds the `Agent` tool; `Explore`/`Plan` types do not). This is what makes Step 2A possible: resolve and review lift **off** the JS Workflow onto main-loop stage-agents that nest and invoke the real commands.
- **Deploy is main-loop, always.** Neither a background workflow nor a dispatched sub-agent can pause for input — dispatched sub-agents carry **no AskUserQuestion tool at all** (field-notes §3) — and deploy must pause on safety-window conflicts / failures. The run ends at a ready, green, conflict-checked PR; deploy is a separate main-loop step.
- **Keep-interactive, stated as the inverse rule:** anything `AskUserQuestion`-driven or live-context stays on the main loop. A stage-agent that hits a question only the human can answer doesn't improvise and doesn't hang — it **returns the pending question as data** in its bundle; the main loop surfaces it (e.g. via `/askme`).
- **Dual-source survives on both paths.** Task path: Codex rides inside the real machinery — `/pr-auto-review`'s codex-runner children, and the resolve stage-agent's codex-critique/codex-lens leaves (via the codex-consult skill). Workflow path: workflow agents have the Skill tool + the `codex` CLI — drive it inline (codex-consult skill, or write prompt to a temp file → run `codex` → poll), one per lens.
- **ALL work happens in a git WORKTREE — NEVER in the main checkout.** Every stage (resolve, test, review, fix — `simple` *and* `meaningful`), on **both paths**, `cd`s into a worktree at `<repo>/.claude/worktrees/<slug>` (Claude's default location, slug = branch with `/`→`-`) cut off `origin/main`. **Never** `git checkout` / `git switch` a feature branch in the main repo, **never** `gh issue develop --checkout`, **never** `gh pr checkout` — every one of those mutates the main checkout (diverges artifact sets, leaves the main tree on a feature branch). The main checkout stays on its original branch, untouched, for the whole run. There is **no "too small for a worktree" exception** — a one-line `simple` fix still gets its own worktree.

## The care bar — meet it natively or reproduce it, never skip it

On the Task path (Step 2A) the left column runs **for real**: the review stage *is* `/pr-auto-review`, and the resolve stage-agent fans out the same critique/lens batteries itself per the Appendix. The right column is the **Path-B (Step 2B)** bar — on the Workflow fabric you reproduce that care at script level:

| Native command care | Path-B Workflow reproduction (script-level) |
|---|---|
| plan dual-critique, ≤3 rounds (Appendix F) | **meaningful only**: `parallel(opus-critique, codex-critique)` → revise plan → loop ≤3 |
| resolution review-fix loop (was `/issue-auto-resolve`) | **meaningful only**: `while(review-fan-out → fix → re-review)` until converge |
| `pr-auto-review` per-lens Opus+Codex fan-out | `parallel(lens-agents + codex-per-lens)`; simple = 1–2 lenses, meaningful = wide set |
| `review-fix-loop` convergence/regression/max-rounds | script `while`: stop on **convergence** (clean round) / **regression** / **max-rounds** |
| draft-then-ready promotion | open draft → `gh pr ready` only if the PR-review loop converged clean + tests pass |
| validate the *suggested fix* against real code | resolve agent must verify cited lines/behavior before editing (issues' own fixes are often wrong — e.g. wrong column name) |

## Step 0 — Parse `$ARGUMENTS` + route

- **Issue numbers** → full pipeline from Resolve (Step 2).
- **`review #<pr>`** → start at the review stage only — no resolve. Default: invoke `/pr-auto-review <pr>` for real (Step 2A's review stage); on Path-B: R5–R6 over the existing PR.
- **`deploy #<pr>` / `ship #<pr>`** → skip to Deploy (Step 4).
- **Trailing `and deploy` / `and ship` / `waterfall`** → run Deploy (Step 4) after the PRs are ready. `waterfall` (or ≥2 PRs) → waterfall mode.
- **Default exit**: stop at ready PR(s). Deploy only when explicitly asked.
- State the parsed plan in one line (e.g. *"Resolving #366,#367,#369 — sized independently — to ready PRs; no deploy."*).

## Step 1 — Pre-flight + classify intensity (per issue, independently)

Pre-flight (bail with one clear error if any fail): in a git repo, `gh` authenticated, every issue/PR resolvable (`gh issue view` / `gh pr view`). Soft: `command -v codex` missing → dual-source degrades to Opus-only; note it, and **pass the result into every stage-agent brief / the workflow args** — agents don't re-run this check.

For **each** issue, read it **with all comments** — `gh issue view <N> --json number,title,body,labels,comments,url` (or `gh issue view <N> --comments`). **Plain `gh issue view <N>` shows the body but NOT comment bodies — it is not enough.** Read every comment, in order. **A maintainer's later comment is authoritative and overrides the body**: it may answer an open question (resolving a `needs-decision`), pick between options, narrow or expand scope, correct the suggested fix, or say "don't fix — obsolete now." The most recent maintainer guidance wins; if a comment already answers the issue's open question, act on it — do **not** re-ask or fall back to the body's original framing. Then size it — **do not assume one intensity for the batch**:

| | **Simple** | **Meaningful** |
|---|---|---|
| Signals | labeled `mechanical`/`quick-win`/docs · single file · ~<30 LOC · comment/string/rename/config · no behavior or contract change | touches pipeline/store/auth/security/concurrency/$-or-delivery paths · multi-file or cross-cutting · changes behavior or a public contract · needs new tests · issue was `needs-decision` or the fix has judgment calls |
| Loops | **one** review pass total (PR-review only) | **two** convergence loops (resolution loop **and** PR-review loop) |
| Lenses | 1–2 + Codex, one pass | wide set (blast-radius/security/completeness/tests/concurrency/docs) + Codex, rerun to converge |
| Ceremony | branch + PR + **umbrella `plans/<branch>.md`**; skip critique + PRD/PLAN/JOURNAL sidecars | full: plan critique + sidecars as warranted |

(The Lenses row governs the resolve stage-agent's pre-PR loop and Path-B's script knobs. On the Task path's review stage, `/pr-auto-review` picks its own lens set per-PR from what the diff actually touches — a one-line simple diff naturally draws a small set; don't fight its judgment.)

**Tie-break: when unsure, treat as meaningful.** Over-reviewing a one-liner costs minutes; under-reviewing a core change ships a bug.

For multi-issue: classify each independently; optionally group issues that touch the **same files** onto one branch/PR to avoid a later merge conflict (only when they're genuinely the same change-surface).

## Step 1.5 — Validity gate (per issue — early-exit before any resolve work)

Don't resolve blind. An issue can be **already fixed**, **obsolete**, a **false positive**, or **superseded by a comment** — resolving it then wastes a full cycle or produces a spurious change. Gate every issue against **current HEAD** first:

1. **Real?** The cited code actually exhibits the described defect — verify the file:lines + behavior yourself; don't trust the report (auto-filed/bot reports routinely mis-cite or mis-describe).
2. **Unresolved?** Not already fixed/mitigated — the fix may have landed in a later PR, a guard added, the code refactored away. Check `git log`/blame on the cited files since the issue's `createdAt`.
3. **Not superseded** — no maintainer comment saying *fixed in #X / obsolete / wontfix / dup of #Y* (you already read all comments in Step 1 — honor them).
4. **Suggested fix sane?** The issue's proposed fix matches reality (a real lesson: one issue's suggested `WHERE slug=?` fix would've thrown — the actual column had a different name).

**Rigor scales** (don't over-verify a hand-picked issue; don't under-verify a stale/auto-filed one):
- **Light (default)** — one code-grounded validity pass folded into the Step 1 read. For issues you hand-picked or are confident in.
- **Adversarial (auto-escalate)** — run the validation as its own fan-out (the pattern that caught 3 false-positives out of 6 issues plus a wrong suggested fix in one real batch). **Task path (default): dispatch one validation stage-agent per issue** (`general-purpose` or the `stage-runner` def — it needs the `Agent` tool to fan out its pair; `Explore`/`Plan` types can't spawn) — it fans out a primary validator + an independent adversarial refuter as leaf children (async dispatches — collect both leaves' completion task-notifications before returning a verdict, field-notes §4; read/grep against current HEAD only; read-only on the tree — no edits, no git-state mutation, no mutation-testing; no spawning beyond the pair, no user contact) and returns a verdict + code-grounded evidence as data. **Path-B: a front validate workflow** with the same primary+refuter pair per issue. Either way the verdict is pure read-side work: high intermediate volume, compact output, fully autonomous. Escalate when the issue is **auto-filed by a routine/bot** (footer/label tell), **stale** (filed >~2 weeks ago — code has moved), part of a **larger batch**, or the light pass came back **uncertain**. Validation stage-agents count against Step 2A's 4-in-flight stage-agent budget when the two stages overlap; depth: `main(0) → validation stage-agent(1) → validator/refuter leaves(2)`.

**Outcomes** (this is a gate, not a formality):
- **CONFIRMED** → proceed to Resolve (Step 2).
- **ALREADY-RESOLVED / OBSOLETE / FALSE-POSITIVE** → **do not resolve, do not open a PR.** Report it with code-grounded evidence and recommend closing the issue (post a closing comment if authorized). A skip here is a *valuable* result, not a failure.
- **UNCERTAIN after the adversarial pass** → don't auto-resolve a dubious issue. The verdict arrives as data; **surfacing it is the main loop's job and this valve never delegates**: present the evidence to the user and let them decide.

A full run is just this gate plus the stages after it: **validate → (confirmed only) → resolve → review → deploy.**

## Step 2 — Resolve → review (pick the execution path first)

Two ways to run the same stage chain. Default to **2A**; use **2B** where the Workflow layer genuinely earns its keep:

| | **2A — Task stage-agents (default)** | **2B — Path-B Workflow** |
|---|---|---|
| Fabric | main loop dispatches per-issue stage-agents that nest | JS Workflow script; its agents are leaves |
| Right for | judgment-bearing resolve + review (the normal case) | genuinely **fixed-shape** fan-outs (a known lens battery over a known diff, no mid-stage judgment) · running the whole pipeline detached in the **background** while the conductor stays free |
| Review stage | invoke `/pr-auto-review` for real | reproduce at script level (mandatory on this fabric — its agents hold no Agent tool, so a delegated fan-out command could only degrade to its inline fallback; ship-issues' care bar requires the real fan-out, reproduced in the script) |

### Step 2A — per-issue resolve stage-agents + `/pr-auto-review` for real (default)

```
main loop (conductor)
  scaffold: branch + worktree per issue, SERIAL (Appendix D)   # the .git lock-race throttle — carried
                                                               # over from the workflow's serial scaffold
  dispatch ONE resolve stage-agent per CONFIRMED issue (≤4 in flight; background, so
  │                                                    later issues resolve while early PRs review)
  │    R1 resolve   simple     → verify cited code → apply fix → commit
  │                 meaningful → plan (Appendix E) → fan out critique leaves (Appendix F, ≤3 rounds) → execute
  │    R2 test      → Appendix G (detect, fix-loop ≤5)
  │    R3 pre-PR review (meaningful only) → fan out lens + codex leaves → dedup/validate vs own diff
  │                 → fix → re-review; stop on convergence / steady-state / regression / max-rounds — RECORD the stop reason
  │    R4 push branch → open DRAFT PR (Appendix I body) → RETURN the per-issue bundle
  └─ per returned bundle: verify SHA → REVIEW: invoke /pr-auto-review <pr> for real
       (R5 + R6 live inside it: it spawns a per-PR review agent that runs the lens fan-out,
        the fix loop, the promote-if-clean check, and posts the PR comment itself)
```

**Dispatch.** Per confirmed issue, dispatch the named **`stage-runner`** agent (its definition at `~/.claude/agents/stage-runner.md` carries the generic contract — leaves never spawn further or contact the user, diff-is-truth reconciliation, escalate-don't-resolve, never-push-unless-authorized). If the agent type is unknown ("Agent type not found" — stale session registry; defs load at session start), dispatch a `general-purpose` agent briefed to read and follow the def file as its full contract. Dispatch each stage-agent with an explicit `model:` — default `opus` (conductor); escalate a given issue's agent to `fable` only when that issue is complex/critical enough that its own leaves may warrant Fable (per-issue call, made holding the issue list); never leave it to inheritance — an unpinned dispatch inherits the session model (auto-Fable on a Fable session). Note each stage-agent's task handle at dispatch; completions arrive as task-notifications carrying each bundle, re-waking you between dispatches (field-notes §4) — as each bundle lands, advance that issue to review while the others run. The brief supplies the variables:

> Goal: resolve issue #<N> ("<title>") at intensity <simple|meaningful> to an open **draft** PR. Targets: worktree `<path>` (already scaffolded, branch `<branch>`); all work happens there — never the main checkout: `cd <path>` as your first action and at the start of every Bash call (your cwd does not persist between calls, and the session-default cwd IS the main checkout — git operations there would silently land in the wrong tree); or `git -C <path>` / absolute paths throughout. D's `cd` is the one line of that appendix you still perform yourself. Recipe: follow `~/.claude/commands/ship-issues.md` Appendix B–I, except D (your dispatcher already ran it — the worktree exists) — B read the issue (all comments; latest maintainer guidance wins), C investigate (you MAY fan out leaf children for genuinely broad investigation), E plan files, F plan critique (meaningful only — dispatch the Opus + Codex critique briefs as your own parallel leaves, ≤3 rounds), G test fix-loop ≤5, H tough-decision protocol (never bail to the user; a condition reserved for the human returns **packaged as data**), I draft-PR body. Every leaf child you dispatch — C's investigation leaves, F's critique pair, H's consult pair, the review-loop lens/codex leaves below — is async (the Agent tool has no foreground mode): its result arrives as a task-notification carrying its final text, re-waking you if you've stopped. Count each fan-out's dispatches and collect every leaf's notification before moving on (pr-auto-review Step 7 encodes the same rule; field-notes §4). Meaningful only: run the pre-PR review loop — fan out lens leaves (per-lens model per the model-selection policy) + a codex leaf (codex-consult `review` mode, `model: sonnet` — Codex-driver; codex available: <yes|no>) — brief each lens leaf read-only: it reviews and returns findings, never edits files, mutates git state, or mutation-tests the shared worktree; only you (the stage-agent) apply fixes — dedup/validate against your own `git diff`, fix, re-review; stop on convergence / steady-state / regression / max-rounds (cap 3); record the stop reason and every unfixed/dropped finding with rationale. Verify: tests per Appendix G; (meaningful) a clean final review round. Budget: 3 review rounds, 5 test-fix attempts. Commit/push contract: commit per the repo's convention; push ONLY `<branch>`; open the draft PR — **never `gh pr ready`** (promotion belongs to the review stage), never touch `main`, never another branch. Return the per-issue bundle (schema below) as your digest. Reserved for the human: anything irreversible outside your commit/push contract; promotion (`gh pr ready`); scope expansion beyond issue #<N>; any destructive ambiguity — return these packaged as data.

**Concurrency cap (Task-side — explicit, not inherited): at most 4 resolve/validation stage-agents in flight** (waves of 4, or dispatch the next as one returns — matching the suite's per-PR cap). Account for **within-issue fan-out**: the real concurrent-agent number is stage-agents × their leaves — 4 meaningful resolves each running a critique pair or a lens battery is ~8–16 leaves on top of the 4 agents. The Workflow ~16-concurrent cap is a Workflow-*tool* limit and **stops governing what's lifted off the JS layer** (field-notes §6) — stay under budget, and if 4 proves tight, drop to 3 (trim in-flight count, never the care). When the pipeline is hot on both stages, resolve stage-agents and `/pr-auto-review`'s per-PR agents coexist — hold the next resolve dispatch if combined load looks tight; never trim the review side's cap.

**Pipeline, no barrier** *(carried over from the workflow design — load-bearing, not a Workflow incidental)*: each issue flows resolve→review **independently**. As each resolve bundle returns, that issue's PR goes to review while other issues are still resolving. **Do not regress to all-resolves-then-all-reviews.**

**Fault isolation, per item** *(carried over — load-bearing, not a Workflow incidental)*: one issue's failure returns `{ok:false, stage, error}` in its bundle (or the dispatch itself errors — record it as that issue's failure); **the rest continue**. Report which stage failed per item.

**Review stage = `/pr-auto-review`, invoked for real** (inline by this conductor — read and execute its file; an inline command costs no depth). It now **always** spawns one per-PR review agent — single-PR runs included — and carries **its own concurrency cap of 4**; that cap governs the review side, **inherited — never stack a second ship-issues cap on top of it**. When several PRs come ready together, batch them into one invocation and let its cap pace them. Its Step 14 PR comment carries unfixed findings + rationale, and its Step 16 per-item block returns stop/promotion state to this conductor — that's R5+R6, met natively. One Path-B care-bar item is per-invocation on this path, not per-round: `/pr-auto-review` scrapes bot/human PR signal once (its Step 6). If its run pushed fixes, late human comments — or external-bot output from a re-trigger; a push alone may re-trigger nothing — may land after it returns; in the once-over, re-check (`gh pr view <pr> --json comments,reviews`) and re-invoke `/pr-auto-review <pr>` if substantive new findings appeared (its before=/after= idempotency makes re-runs cheap).

**Per-issue bundle** (the resolve stage-agent's entire return — the conductor parses nothing else):

```
RESOLVE{ ok, issue, branch, worktree, pr_url, intensity, sha,
         plan_critique:{rounds, outcome},                       # meaningful only
         prepr_review:{rounds, stop_reason: convergence|steady-state|regression|max-rounds,
                       unfixed[]{summary, rationale}, dropped[]{summary, reason}},  # meaningful only
         tests: ran|skipped|failing-after-5,
         decisions[]{decision, rationale, consult_outcome, meaningful},
         pending_user_questions[],                              # the keep-interactive escape: data, not asks
         notes, error?{stage, error} }
```

Stop-reason + unfixed/dropped findings must survive **two hops**: the stage-agent writes them into the draft-PR body itself (Appendix I's Review-loop section), and the conductor carries them into the once-over + final report. The review stage's equivalents arrive via `/pr-auto-review`'s PR comment + per-item block. Keep both data paths intact — **never let a stop reason or a dropped finding die inside an agent.**

**Conductor, on each bundle**: verify the reported SHA is actually on that branch: `git -C <worktree> merge-base --is-ancestor <sha> HEAD` (worktrees share one object store, so a bare `cat-file -e` passes for any object anywhere in the repo — ancestry is the real check) before advancing the issue to review — trust the diff, not the report. Surface any `pending_user_questions` (via `/askme`) at the next natural pause.

**Depth + counting** (Agent dispatch = +1, inline command = +0; field-notes §5): resolve = `main(0) → per-issue stage-agent(1) → critique/lens/codex leaves(2)` — 2 levels. Review = `/pr-auto-review` inline (+0) → `its per-PR agent(1) → lens + codex-runner children(2)`, and its inline fix-loop's review sub-agent(2) — no codex child; dual-review's Codex side is detached Bash inside it — 2 levels. Both inside the ~3–4 convention. Don't add levels: **this conductor — not the resolve stage-agent — invokes `/pr-auto-review`** (a stage-agent holding `Agent` *can* invoke it, but that pushes the chain to 3; reserve that for when the conductor's context is critically tight, and say so in the report).

### Step 2B — Path-B Workflow (fixed-shape / background — kept, not retired)

Author **one Workflow script** (via the Workflow tool) that pipelines the issues, each carrying its own `intensity`. On this fabric every fan-out is a `parallel()` / `while` **in the script** (the fact block: workflow agents can't nest). The per-issue stage chain:

```
scaffold(group)                       # branch+worktree off origin/main; umbrella plans file always; sidecars if meaningful
  └─ pipeline over issues (independent; no barrier):
       R1 resolve
            simple    → implement-agent (verify cited code first, apply fix, commit)
            meaningful→ plan-agent → parallel(opus-critique, codex-critique) → revise ≤3 → execute-agent
       R2 test         → targeted pytest, fix-loop ≤5 (meaningful: + add coverage where a contract moved)
       R3 PRE-PR REVIEW
            simple    → SKIP (one loop total)
            meaningful→ while(round<MAX): parallel(lens-agents + codex) → dedup/validate → fix → re-review
                        stop on clean / regression / MAX
       R4 open DRAFT PR (Closes #<N>; body: provenance, decisions, review outcome, any post-deploy ops note)
       R5 PR ADVERSARIAL REVIEW
            simple    → ONE pass: parallel(1–2 lens-agents + codex) → dedup → fix obvious → done
            meaningful→ while(round<MAX): parallel(WIDE lenses + codex-per-lens) → dedup/validate → fix → RERUN lenses
                        stop on clean / regression / MAX
       R6 promote: gh pr ready  iff (PR-review converged clean AND tests pass)
```

Reference template to adapt (JS — Path-B; same shape proven in this session). Tunables encode the intensity dial:

```js
export const meta = { name: 'ship-issues', description: 'resolve → review → ready PR (intensity-scaled)', phases: [
  {title:'Scaffold'},{title:'Resolve'},{title:'Test'},{title:'Pre-PR review'},{title:'PR review'},{title:'Finalize'}] }

const REPO = '<repo abs path>'
// per-issue: { n, intensity:'simple'|'meaningful', branch, spec, lenses, test_targets }
const ITEMS = args   // pass the sized issue list in as Workflow args

const knobs = (it) => it.intensity === 'meaningful'
  ? { plan_critique:true, prepr_loop:true, pr_lenses: it.lenses /* wide */, MAX_ROUNDS:3 }
  : { plan_critique:false, prepr_loop:false, pr_lenses: it.lenses.slice(0,2), MAX_ROUNDS:1 }

// scaffold each branch+worktree off origin/main (serial, avoids .git lock races); umbrella plans file always.
// then: pipeline(ITEMS, resolveStage, testStage, prePrReviewStage, finalizeOpenDraft, prReviewStage, promoteStage)
// resolveStage: meaningful → planAgent → parallel(opusCrit, codexCrit·`model:'sonnet'`) → revise → executeAgent ; simple → executeAgent
// prReviewStage: while(round<MAX){ const f = await parallel([...lenses.map(opusLens), codexLens]); const m = await dedup(f);
//                 if(!m.length){converged=true;break} if(m.length>prev){break/*regression*/} await fix(m) }
// codexLens agent (`model: 'sonnet'` — Codex-driver): "use codex-consult skill in review mode, or run `codex` CLI non-interactively on `git diff origin/main...HEAD`"
```

Notes:
- **Codex per lens** runs *inside* an agent (workflow agents have Skill + Bash). If `codex` absent, run Opus-only and note it.
- **Worktree-only scaffold — never touch the main checkout.** Create each branch+worktree in a serial scaffold stage (not concurrently — avoids `.git` lock races): `git -C <repo> worktree add -b <branch> <repo>/.claude/worktrees/<slug> origin/main` (slug = branch with `/`→`-`; append `-2`/`-3` if the path exists; symlink `.env` into it — see §D for the full snippet). EVERY later stage must `cd` into that worktree path. **NEVER** `git checkout`/`git switch` a feature branch in the main repo, **NEVER** `gh issue develop --checkout`, **NEVER** `gh pr checkout` — all mutate the main checkout. This applies to `simple` and `meaningful` identically. Clean up at the end — only worktrees this run created, and only once their PR is merged/closed with all work pushed: `git worktree remove <path>` (`--force` only when the leftover dirt is this run's own artifacts) + `git branch -D` for squash-merged branches. Never remove a pre-existing worktree, and never delete a branch with unpushed work.
- **The PR-review stage scrapes existing PR signal too** — before fanning out lenses, an optional external PR bot can be folded in here if your repos use one (trigger it unless already triggered for the current head), then pull the PR's comments + review submissions (`gh pr view <pr> --json comments,reviews` + `gh api repos/:owner/:repo/pulls/<pr>/comments`): bot findings and human comments. Dedup against them and treat any maintainer comment as authoritative (same rule as issues). (On the Task path, `/pr-auto-review` Step 6 does the scrape + dedup natively; the maintainer-comment-is-authoritative rule is this command's own addition on both paths.)

#### Proven authoring mechanics (carried over from a prior hand-built workflow — fold these into the script you write)

- **Reuse the command prose by section-citation; don't re-write it.** Brief agents as *"follow `~/.claude/commands/ship-issues.md` Appendix A–E"* or *"use the prescribed findings format in `pr-auto-review.md` Step 7 (the Opus lens reviewer brief)"* — the agent reads the cited sections itself. Keeps the authored script thin and the source-of-truth in the command files (no drift). This is what makes "write the workflow fresh each run" safe.
- **Schema every agent return** (so you parse nothing): `FINDINGS{source, findings[]{severity,location,summary,detail,suggestion}, notes}` · `SYNTH{meaningful[]{severity,location,summary,fix,attribution}, dropped[]{summary,reason}}` · `SETUP{ok,branch,worktree,error}` · `FIX{ok,fixed_count,pushed,notes}` · `FINALIZE{promoted,tests,comment_url}`.
- **Dual-source per lens = a paired leaf**: `parallel(opusLeaf, codexLeaf)` (per-lens model per the model-selection policy for `opusLeaf` — Opus default, Fable only for a lens passing the policy's escalation test; `codexLeaf` is a Codex-driver → `model: 'sonnet'`). **Brief the `opusLeaf` (and every `prePrReviewStage` / `prReviewStage` lens agent) read-only on the tree** — workflow agents hold Edit/Write, so a lens agent must be told it reviews and returns findings only: never edit/create/delete files, mutate git state, or mutation-test the shared worktree (running the suite as-is is fine); only the resolve / `fix(m)` stage edits. The codex leaf invokes the `codex-consult` skill (review mode) — already read-only via `--sandbox read-only` — and **degrades gracefully**: codex-absent/error → return `findings:[] notes:"codex-unavailable"`, never throw.
- **Re-scrape bot/human review signal EACH PR-review round** (not just once): human comments land mid-loop, and after a round pushes fixes, re-trigger your external bot (if one is in play) when its take on the new head is wanted — a push alone may re-trigger nothing. Skip resolved threads + prior workflow / `/pr-auto-review` summary comments.
- **Track the stop reason** per PR — `convergence` (clean round) / `steady-state` (a fix round fixed 0 or didn't push) / `regression` (findings rose) / `max-rounds` — and surface it + any unfixed/dropped findings (with rationale) in the single summary PR comment. (Same rule the Task path enforces via the RESOLVE bundle + `/pr-auto-review`'s comment — the data path is identical on both fabrics.)
- **Promote iff** `clean` AND tests pass/skipped AND **no unfixed meaningful findings** — else leave draft with the reason.
- **Fault-isolate each issue**: wrap each item's chain so one failure returns `{ok:false, stage, error}` and the rest continue; report which stage failed.
- **Keep `pipeline()` — no barrier.** Each issue flows resolve→review independently (lower wall-clock). The prior workflow used an all-resolves-then-all-reviews barrier; don't regress to that for independent issues.

When entry is **`review #<pr>`** on Path-B: skip R1–R4; run only R5–R6. **Find or create a worktree on the PR's branch and work there — never `gh pr checkout` into the main repo.** Reuse an existing worktree on that branch if one exists (respect its uncommitted work); otherwise fetch the branch and `git worktree add <repo>/.claude/worktrees/<slug> <branch>`. (On the Task path this paragraph is `/pr-auto-review`'s own Step 3 — it finds-or-creates the worktree with the same discipline.)

### Whichever path ran — the once-over

After the stage-agents' bundles / the workflow return, **read the actual diffs in main context and do the once-over** (the self-report is not enough — verify at the edges: diff, tests, the specific risk for this change). This is non-negotiable before any deploy.

## Step 3 — Checkpoint (only if deploy was requested)

Report the ready PR(s) + each one's review-round count + promotion status. If deploy was requested, **confirm go/no-go before touching prod** (production is downstream; this is the one place to pause for the human even in an otherwise-autonomous run).

## Step 4 — Deploy (MAIN-LOOP — the delegation carve-out)

Neither a workflow nor a dispatched sub-agent can do this: deploy must pause on safety-window conflicts / failures, and a dispatched sub-agent carries **no AskUserQuestion tool** — every ask a deploy command encodes (dirty tree, red checks, permission-probe failure, a stale in-flight job, the anomaly valve) would be swallowed. Run it **inline on the main loop**, reproducing the deploy command's care. If your repo encodes its deploy choreography in its own command(s) — single-PR merge-and-deploy, multi-PR waterfall — **follow them inline** (the main loop holds the user channel, so every encoded ask can fire). Do **not** dispatch a per-deploy sub-agent — it can't fire those asks. Honor:

- **Deploy-safety pre-check** before each deploy — if the repo encodes a pre-deploy probe battery (in-flight pipelines, live jobs/campaigns, imminent cron), run it via the repo's own single-sourced probe — never restate or reimplement the probes here. Auto-wait until clear; never deploy into a conflict window.
- **Waterfall merge-main judgment**: deliberate ship-issues override of an unconditional merge-main step: before merging PR #N+1, run `git merge-tree --write-tree origin/main <branch>` — merge `main` in first **only if it's behind AND the diffs overlap**; if disjoint, skip `/auto-merge-main` and let the squash-merge handle it.
- **Multi-worktree gh quirk**: `gh pr merge --squash --delete-branch` may exit 1 with *"'main' is already used by worktree …"* — that's local checkout failure only; verify `state=MERGED` on the remote, then delete the branch manually.
- **Post-deploy ops ordering**: deploy the code FIRST, then run any backfill (e.g. a migration backfill) against prod — never before. Capture a before/after to confirm it landed. Authorize the prod mutation explicitly.
- **Stop on failure**: red `ci.yml` on main, `deploy.yml` failure/rollback → stop and report; no fix-forward.

## Step 5 — Final report

Per-item: issue → PR url → intensity → review rounds (pre-PR / PR; Task path: the PR-side rounds map to `/pr-auto-review`'s Step 16 block fields — use what the block provides, don't invent a number) → promoted? → deployed? + any post-deploy ops result. Push notification: `/ship-issues done — <P> ready, <D> deployed, <F> failed.`

## Hard rules

- Never invoke `/pr-auto-review` (or any other fan-out command) from *inside* a workflow agent — they fan out, and workflow agents can't; reproduce their work at the script level there (the per-issue resolve recipe lives in the Appendix). The inverse holds on the Task fabric: **this conductor invoking `/pr-auto-review` for real IS the review stage** (Step 2A).
- Never let the workflow — or any dispatched stage-agent — do the deploy: deploy is main-loop, inline (Step 4).
- **Keep-interactive**: the Step 3 go/no-go, every Step 4 deploy pause, and the Step 1.5 UNCERTAIN valve stay on the main loop, always. Sub-agents return pending questions as **data** in their bundles; the main loop surfaces them (e.g. via `/askme`). A stage-agent never improvises through a decision reserved for the human.
- **Cap the lifted fan-out**: at most 4 resolve/validation stage-agents in flight (Step 2A). The review stage runs under `/pr-auto-review`'s own cap of 4 — **inherited; never stack a second cap on it**. Scaffold worktrees serially from the main loop — never let concurrent stage-agents `git worktree add` against the same repo (`.git` lock races).
- Never commit to `main`, never force-push, never `--no-verify`, never `--admin`-merge. Open PRs as draft; promote only on a clean converged review — promotion is the **review stage's** job (`/pr-auto-review` Step 13's conditions, or Path-B's R6); the resolve stage-agent never runs `gh pr ready`.
- **ALL work in a worktree — never check out a feature branch in the main checkout.** No `git checkout`/`git switch` of a feature branch, no `gh issue develop --checkout`, no `gh pr checkout` in the main repo. The main checkout stays on its original branch the entire run — `simple` changes included; there is no size exception.
- Right-size: never run two convergence loops (or a worktree-plan critique) on a `simple` change; never skip the second loop on a `meaningful` one.
- Verify each issue's *suggested fix* against the real code before applying it.
- **Never resolve an unvalidated issue** (Step 1.5). Early-exit with no PR on already-resolved / obsolete / false-positive, and report it for closing — a skip is a valid outcome. Escalate auto-filed / stale / uncertain issues to the adversarial validate pass.
- **Read ALL comments, not just the body** — on every issue *and* PR (`--json comments` / `--comments`; plain `gh issue view`/`gh pr view` does NOT include comment bodies). A maintainer's answering comment is authoritative: it can resolve an open question, change scope, pick an approach, or cancel the fix. Latest maintainer guidance wins.
- Read the returned diffs in main context and do the once-over before promoting/deploying.

## Failure modes

- **issue already resolved / obsolete / false-positive** → Step 1.5 early-exit; no PR; report with code-grounded evidence + recommend closing. Not a failure.
- **codex unavailable** → dual-source degrades to Opus-only across all lenses (both paths); flag once.
- **workflow agent tries to spawn a sub-agent** → it can't (that fabric has no Agent tool); that's a script-authoring bug — move the fan-out up into `parallel()`.
- **resolve stage-agent fails mid-stage** → its bundle (or the dispatch error) reports `{ok:false, stage, error}`; the other issues continue — fault isolation is per-issue. Report which stage failed.
- **stage-agent hits a human-only question** → it returns the pending question as data in its bundle (Appendix H governs what it may decide itself); the main loop surfaces it. It must never guess through a reserved decision and never hang.
- **tests fail after fix-loop** → leave the PR draft, note it; CI is the final gate.
- **PR-review doesn't converge (hits MAX / regression)** → the PR stays draft with the open findings: Task path — `/pr-auto-review` leaves it draft and its comment + per-item block carry the unfixed findings and stop reason; Path-B — leave draft with the open findings in the body. Do not promote.
- **deploy safety-window won't clear** → auto-wait (bounded waits have no time cap); escalate only when the wait is **non-converging** (a wedged run with no terminal state and no crash log, a stale `running` job, or no probe-derived endpoint).
- **review #<pr> on a fork without maintainer-edit** → fixes go as patches in a PR comment, don't promote.

## Notes on coupling

- **Two fabrics by design.** Resolve/review run on the Task fabric (Step 2A — main-loop stage-agents that nest, plus `/pr-auto-review` invoked for real); fixed-shape and background runs stay on the Workflow fabric (Step 2B), where script-level fan-out remains mandatory because **Workflow agents still cannot nest** (field-notes §1). Path-B is not obsolete.
- User-level command; the deploy stage assumes a repo with its own encoded deploy choreography. In a repo without one, stop at ready PRs (Step 4 is a no-op) unless an equivalent deploy command exists.

---

## Appendix — per-issue resolve recipe (absorbed from the retired `/issue-auto-resolve`)

This was the body of `/issue-auto-resolve`, kept here as citable source-of-truth. On the Task path these sections are the **resolve stage-agent's brief** (cited from Step 2A); on Path-B they're the **script's section-citations** (cited from the authoring mechanics) — either way, brief agents as *"follow `~/.claude/commands/ship-issues.md` Appendix <letters>"* so the consuming layer stays thin and the source-of-truth lives here (no drift). Text is harmonized with this skill's hard rules (worktree-only; the two-fabric rule — a Workflow agent running these sections cannot nest sub-agents, a Task stage-agent fans out its own leaf children). The old command's orchestration steps (dispatch, execute-the-plan, /review-fix-loop invocation, final report) are superseded by this skill's main body and are not reproduced. `/pr-auto-review` and `/auto-merge-main` used to cite the old Steps 9/11 — they now carry their own copies; G/H below serve resolve agents. **One dispatch rule governs every fan-out below (C investigate, F critique pair, H consult pair, the pre-PR lens loop): dispatches are async-only — each leaf's result arrives as a task-notification that re-wakes a stopped parent; count the fan-out's dispatches and collect every leaf's notification before advancing the stage (field-notes §4).**

### A. Pre-flight (per repo)

Hard blockers — bail with one clear error if any fail:

```bash
git rev-parse --git-dir >/dev/null                          # in a git repo
gh repo view --json nameWithOwner >/dev/null                # has GitHub remote, gh authenticated
for N in <issues>; do gh issue view "$N" --json number,title,state,body >/dev/null; done
```

Soft blockers — warn and continue: `command -v codex` fails → dual-source consults degrade to Claude-only. Note in the final report.

### B. Read the issue

```bash
gh issue view <N> --json number,title,body,labels,assignees,comments,url
```

Read the body and **all comments** fully (Step 1's rule applies: the latest maintainer guidance is authoritative and overrides the body). Note labels (e.g., `bug`, `feature`, `breaking-change`) — they shape the scope.

### C. Investigate the codebase

Grep, read, and understand the code paths the issue touches. Trace the blast radius per your global CLAUDE.md: every writer, every consumer, parallel code paths, full implementation (not just signatures). (Fabric note: a **Workflow agent** running this recipe can't nest sub-agents — when investigation is genuinely broad there, the breadth lives in the script's agent fan-out, not in a delegated search. A **Task resolve stage-agent** MAY delegate genuinely broad investigation to its own leaf children — brief each as a leaf: no further spawn, no user contact, read-only on the tree (no edits, no create/delete, no git-state mutation, no mutation-testing).)

### D. Branch + worktree

Worktree-only, per the hard rules — never check out the branch in the main repo, never `--checkout` variants. (On the Task path the **conductor** runs this section serially per issue before dispatching stage-agents — concurrent `git worktree add` against one repo races on `.git` locks; on Path-B the script's serial scaffold stage runs it.)

```bash
# Optional: link the branch to the issue on the remote (PR auto-closes the issue on merge).
# NEVER gh issue develop --checkout. If skipping this, rely on "Closes #<N>" in the PR body.
gh issue develop <N>
BRANCH=$(gh issue develop --list <N> --json refName --jq '.[0].refName')
git fetch origin "${BRANCH}:${BRANCH}" 2>/dev/null || git fetch origin "$BRANCH"

# Materialize a worktree at Claude's default location (append -2/-3 on collision).
# Anchor at the MAIN checkout root, not the current worktree: `git rev-parse
# --show-toplevel` would nest .claude/worktrees/ inside a worktree if run from one.
# `--git-common-dir` resolves to the shared <main>/.git from anywhere; its parent
# is the main root. (--path-format=absolute needs git >= 2.31.)
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$GIT_COMMON")
SLUG="${BRANCH//\//-}"                              # slashes → dashes for the dir name
WORKTREE="${REPO_ROOT}/.claude/worktrees/${SLUG}"
SUFFIX=""; i=2
while [ -e "${WORKTREE}${SUFFIX}" ]; do SUFFIX="-${i}"; i=$((i+1)); done
WORKTREE="${WORKTREE}${SUFFIX}"
# .claude/worktrees/ is git-excluded by Claude's native worktree feature; add the
# exclude here too so this Bash-created worktree never shows in `git status`.
# Leading \n guards an exclude file that lacks a trailing newline.
grep -qxF '**/.claude/worktrees/' "${GIT_COMMON}/info/exclude" 2>/dev/null \
  || printf '\n**/.claude/worktrees/\n' >> "${GIT_COMMON}/info/exclude"
git worktree add "$WORKTREE" "$BRANCH"
# (No gh issue develop? Create branch at add time: git worktree add -b <branch> "$WORKTREE" origin/main)
cd "$WORKTREE"
# Belt-and-suspenders .env symlink so tests / the app see real secrets. (If your
# setup installs a post-checkout githook that symlinks .env on `git worktree add`,
# this inline copy just covers the window before that hook exists.) Don't clobber
# a real .env — only link if absent or already a symlink.
if [ -e "${REPO_ROOT}/.env" ] && { [ -L "${WORKTREE}/.env" ] || [ ! -e "${WORKTREE}/.env" ]; }; then
  ln -sfn "${REPO_ROOT}/.env" "${WORKTREE}/.env"
fi
```

### E. Plan files

Per the global CLAUDE.md worktree-plans convention. **`plans/<branch>.md`** (umbrella, always):

```markdown
---
branch: <branch>
base: main
started: <YYYY-MM-DD>
issue: #<N>
command: /ship-issues
---

# <Branch title>

**Goal**: <one-line restatement of the issue's intent>

**Issue**: #<N> — <title> — <url>

## Linked docs
- [Plan](<branch>-PLAN.md)
- [Journal](<branch>-JOURNAL.md) (if created)

## Decisions

(append meaningful decisions here as they're made — both technical and scope/intent calls — with rationale and consult outcome if applicable)

## Status

(append entries as the workflow progresses — investigated, planned, plan critiqued, executed, reviewed, pushed)
```

**`plans/<branch>-PLAN.md`** (meaningful intensity only):

```markdown
# Implementation plan: <branch>

## Problem
(restate the issue and what success looks like)

## Approach
(high-level design)

## Steps
(numbered, concrete)

## Risks / blast radius
(what else could break, what to watch for)

## Test strategy
(how we'll verify)
```

**`plans/<branch>-JOURNAL.md`** — create **only if** a running log will genuinely help (multiple non-obvious decisions, multi-day work, surprising discoveries). Judgment call; default no.

### F. Plan-critique briefs (meaningful intensity only, ≤3 rounds)

In workflow form the two critiques are a script-level `parallel()`; in Task form the resolve stage-agent dispatches the two briefs below as its own parallel leaf children (one message, both Agent calls). Either way: revise the plan between rounds; stop on no-meaningful-concerns or after round 3 (record remaining concerns in the umbrella with rationale for proceeding).

**Opus critique agent brief** (`model: opus`/`fable` per the model-selection policy):

> Critique the plan at `plans/<branch>-PLAN.md` for the issue #<N> ("<title>"). Issue body and the codebase are available — read what you need.
>
> Surface: unstated assumptions, missing edge cases, blast-radius gaps, plan steps that gloss over real complexity, scope creep, alternatives the plan didn't justify rejecting.
>
> Return your findings in three sections: **Concerns** (numbered, with one-line summary + 1-3 sentence rationale + the specific plan section), **Suggested revisions** (concrete, minimal), **Alternatives worth considering** (one sentence each on what they'd buy / cost).
>
> If the plan is sound, say so plainly. Do not pad.
>
> Read-only: you're critiquing, not editing — never modify the plan file, source files, or git state (the resolve agent revises the plan between rounds, not you). Return findings only.

**Codex critique** (dispatch this codex leaf `model: sonnet` — Codex-driver): via the `codex-consult` skill in `critique` mode (gotchas 1-4 of that skill apply: prompt to a temp file, launch detached, poll the sentinel; `<EMBEDDED_CONTENT>` = the PLAN file contents, focus brief = "issue #<N>: <title>").

**Synthesis**: dedup concerns by topic (both sources → merge with attribution; single-source kept with attribution). Validate each concern against the plan — drop hallucinations. A concern is **meaningful** if a thoughtful senior engineer would say "fix this before executing"; skip nits and already-addressed items. Log each revision in the umbrella Decisions section. Commit the plan files when converged: `git add plans/ && git commit -m "plan: <branch> (after N critique rounds)"`.

### G. Test detect + fix-loop (≤5 attempts)

Detect the project's test command:

- `package.json` → `npm test` / `pnpm test` / `yarn test` (whichever matches the lockfile)
- `pyproject.toml` with pytest config → `pytest`
- `Cargo.toml` → `cargo test`
- `go.mod` → `go test ./...`
- `Makefile` with `test:` target → `make test`
- `.tool-versions` or `mise.toml` hints → respect them

If no test command is detectable → skip, note that no tests ran. Run the suite foreground when it fits the ~10-min Bash ceiling; background a longer run and await its completion notification — it re-wakes you with the output (field-notes §4); never proceed with the run pending. If tests fail, fix-loop up to **5 attempts** (brief: "fix these failing tests, minimal edits, do not weaken the assertions; never return with a test run still pending — hold each run's result before acting"). Exhaustion semantics are caller-specific: the resolve flow notes "tests failing after 5 fix attempts" and leaves the PR draft — CI is the final gate. (`/auto-merge-main` bails instead; its contract is "cleanly".)

### H. Tough-decision protocol

Anywhere in the resolve flow the agent faces a genuinely tough judgment call it would have stopped to ask a human about (ambiguous issue intent, security-sensitive choice, scope expansion, conflicting requirements, plan vs. reality divergence) — **never bail to the user:**

1. **Frame the decision** — one paragraph: what's being decided, the options, the trade-offs.
2. **Fan out two consults in parallel**: an opinion agent (`model: opus`/`fable` per the model-selection policy) and Codex (`codex-consult` `ask` mode, dispatched `model: sonnet` — Codex-driver), both briefed with the decision statement + relevant context (and explicitly read-only — form the opinion by reading the code; never edit files or mutate git state), asked for **Recommendation / Rationale (2-3 sentences) / Confidence (high|medium|low) / Needs user input? (yes|no)**. (Fabric note: a Task stage-agent dispatches the Opus opinion as a leaf child and runs Codex via a codex leaf; a Workflow agent cannot dispatch — it forms the Opus-side opinion inline itself and drives Codex via the codex-consult skill. H's tough calls otherwise shouldn't ride Path-B — see the 2B routing rule.)
3. **Synthesize** with the `review-fix-loop.md` Lane 2 tiebreakers, lexicographic: reversibility → behavior preservation → blast radius → higher confidence → least action (prefer the leave-as-is / no-op option when one is present) → first option in the framing (note which terminal rule fired explicitly in the log). (The confidence / least-action / first-option extensions are a deliberate divergence from Lane 2, whose real chain is the first three criteria then escalate true ties to the user via its report; this protocol runs unattended.)
4. **Log** in the umbrella Decisions section: decision, options, consult outcome (converged | resolved-divergence | tied), rationale, and `meaningful: yes` if a human would want to review it in the PR.
5. **Proceed.**

This is the autonomy escape valve, not a license to ask the user — the user sees the decisions in the PR body and decision log. (One boundary stands above it: a condition your dispatch brief *reserves for the human* — e.g. anything irreversible outside your commit/push contract — is not a tough call to consult on; return it **packaged as data** in your bundle and let the main loop surface it.)

### I. Draft-PR body + per-item report block

PR body (always opens as **draft**; promotion is the PR-review stage's job):

```markdown
## Summary
<1-3 bullets on what changed and why>

Closes #<N>

## Plan
<one-paragraph summary; full plan in plans/<branch>-PLAN.md if created>

## Meaningful decisions
<bulleted list of umbrella Decisions flagged `meaningful: yes`, with rationale and consult outcome>

## Review loop
- Plan critique: <N> rounds, <converged | proceeded with noted concerns> (meaningful only)
- Implementation review: <rounds, stop reason, fixes>
- Unfixed/dropped findings: <none | one line each with rationale>
- Tests: <ran|skipped|failing after 5 attempts>

---
*Generated by `/ship-issues` via Claude Code.*
```

Per-item report block (Path-B: returned by the workflow; Task path: assembled by the conductor from the RESOLVE bundle + `/pr-auto-review`'s per-item block — for the PR-review rounds, use what its Step 16 block provides; don't invent a number), assembled into the final report:

```markdown
### Issue #<N> — <title>
**PR**: <url> (draft|ready)  **Branch**: <branch>  **Intensity**: <simple|meaningful>

**Meaningful decisions** (<count>): <bullet per decision with one-line rationale>
**Review loop**: plan critique <rounds/outcome> · PR review <rounds, stop reason> · tests <status>
**Unfixed/dropped findings** (<count>): <one line each with rationale — must match the PR's review comment>
**Notes**: <codex unavailable | test fix exhausted | validity-gate outcome | pending user questions | etc.>
```
