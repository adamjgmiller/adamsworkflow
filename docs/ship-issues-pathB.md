# ship-issues Path-B — the Workflow-fabric variant (parked: cold but supported)

**Status.** Extracted from `~/.claude/commands/ship-issues.md` to keep the hot command
lean. Path-B is **not retired**: it remains the documented route when it genuinely earns
its keep — **fixed-shape fan-outs** (a known lens battery over a known diff, no mid-stage
judgment) and **running the whole pipeline detached in the background** while the
conductor stays free. For everything else, the Task path (ship-issues Step 2A) is the
default. ship-issues' final report records which fabric ran — consult that telemetry
before investing here.

**Read this WITH ship-issues.md** — Step 0–1.5 (routing, sizing, validity gate), the
Appendix (per-issue resolve recipe: the briefs this script cites), and the hard rules
all still govern. This doc replaces only Step 2B's body.

## Fabric facts (why the script owns every fan-out)

Workflow agents CANNOT spawn sub-agents (no Agent tool — field-notes §1). They CAN:
Bash, Read/Edit/Write, the **Skill** tool, ToolSearch/MCP, and the **codex CLI**
directly. So on this fabric every fan-out (plan critique, per-lens review, dual-source)
is modeled at the **script** level via `parallel()` / a `while` loop — never by telling
a workflow agent to run a fan-out command (reached without `Agent`, those commands either
bail (`pr-auto-review`, `auto-merge-main`) or degrade below the care bar
(`lens-review`'s labeled `degraded-fanout` fallback) — either way the fan-out must live in the
script). If you are a workflow agent reading this by section-citation: you hold no
Agent tool — the fan-out lives in your script, not in you.

## The care bar, reproduced at script level

| Native command care | Path-B Workflow reproduction (script-level) |
|---|---|
| plan dual-critique, ≤3 rounds (Appendix F) | **meaningful only**: `parallel(opus-critique, codex-critique)` → revise plan → loop ≤3 |
| resolution review-fix loop | **meaningful only**: `while(review-fan-out → fix → re-review)` until converge |
| `pr-auto-review` per-lens Opus+Codex fan-out | `parallel(lens-agents + codex-per-lens)`; simple = 1–2 lenses, meaningful = wide set |
| `review-fix-loop` convergence/steady-state/regression/max-rounds | script `while`: stop on **convergence** (clean round) / **steady-state** (fix round fixed 0 or didn't push) / **regression** / **max-rounds** |
| draft-then-ready promotion | open draft → `gh pr ready` only if the PR-review loop converged clean + tests pass/skipped |
| validate the *suggested fix* against real code | resolve agent must verify cited lines/behavior before editing (issues' own fixes are often wrong — e.g. wrong column name) |

Validity gate on this fabric: a **front validate workflow** with the same
primary-validator + adversarial-refuter pair per issue (ship-issues Step 1.5).

## The per-issue stage chain

Author **one Workflow script** (via the Workflow tool) that pipelines the issues, each
carrying its own `intensity`:

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
                        stop on clean / steady-state / regression / MAX
       R4 open DRAFT PR (Closes #<N>; body: provenance, decisions, review outcome, any post-deploy ops note)
       R5 PR ADVERSARIAL REVIEW
            simple    → ONE pass: parallel(1–2 lens-agents + codex) → dedup → fix obvious → done
            meaningful→ while(round<MAX): parallel(WIDE lenses + codex-per-lens) → dedup/validate → fix → RERUN lenses
                        stop on clean / steady-state / regression / MAX
       R6 promote: gh pr ready  iff (PR-review converged clean AND tests pass/skipped)
```

Reference template to adapt (JS). Tunables encode the intensity dial:

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
// codexLens agent (`model: 'sonnet'` — Codex-driver): "use codex-consult skill in review mode, or run `codex` CLI non-interactively on `git diff <base>...HEAD`"
//   <base> = origin/main for issue branches (scaffolded off it); for the `review #<pr>` entry use the PR's actual `baseRefName` — origin/main on a stacked PR folds the parent PR's commits into the reviewed diff
```

Notes:
- **Codex per lens** runs *inside* an agent (workflow agents have Skill + Bash). If
  `codex` absent, run Opus-only and note it.
- **Worktree-only scaffold — never touch the main checkout.** Create each
  branch+worktree in a serial scaffold stage (not concurrently — avoids `.git` lock
  races): `git -C <repo> worktree add -b <branch> <repo>/.claude/worktrees/<slug>
  origin/main` (slug = branch with `/`→`-`; append `-2`/`-3` if the path exists;
  symlink `.env` into it — ship-issues §D cites the canonical materialization block).
  EVERY later stage must `cd` into that worktree path. **NEVER**
  `git checkout`/`git switch` a feature branch in the main repo, **NEVER**
  `gh issue develop --checkout`, **NEVER** `gh pr checkout` — all mutate the main
  checkout. This applies to `simple` and `meaningful` identically. Clean up at the
  end — only worktrees this run created, and only once their PR is merged/closed with
  all work pushed: `git worktree remove <path>` (`--force` only when the leftover dirt
  is this run's own artifacts) + `git branch -D` for squash-merged branches. Never
  remove a pre-existing worktree, and never delete a branch with unpushed work.
- **The PR-review stage scrapes existing PR signal too** — before fanning out lenses,
  an optional external PR bot can be folded in here if your repos use one: trigger it
  (unless the PR already carries its review for the current head), then pull the PR's
  comments + review submissions (`gh pr view <pr> --json comments,reviews` + `gh api
  repos/:owner/:repo/pulls/<pr>/comments --paginate` — without `--paginate` the REST
  endpoint returns only the first 30; thread-resolution state lives only in GraphQL —
  also fetch `reviewThreads { isResolved, comments }` via `gh api graphql` per
  pr-auto-review Step 6, so the skip-resolved rule below is satisfiable): bot findings
  and human comments. Dedup against them and treat any maintainer comment as
  authoritative (same rule as issues).

## Proven authoring mechanics (fold these into the script you write)

- **Reuse the command prose by section-citation; don't re-write it.** Brief agents as
  *"follow `~/.claude/commands/ship-issues.md` Appendix A–E"* or *"use the prescribed
  findings format in `pr-auto-review.md` Step 7 (the Opus lens reviewer brief)"* — the
  agent reads the cited sections itself. Keeps the authored script thin and the
  source-of-truth in the command files (no drift). This is what makes "write the
  workflow fresh each run" safe.
- **Schema every agent return** (so you parse nothing): `FINDINGS{source,
  findings[]{severity,location,summary,detail,suggestion}, notes}` ·
  `SYNTH{meaningful[]{severity,location,summary,fix,attribution}, dropped[]{summary,reason}}`
  · `SETUP{ok,branch,worktree,error}` · `FIX{ok,fixed_count,pushed,notes}` ·
  `FINALIZE{promoted,tests,comment_url}`.
- **Dual-source per lens = a paired leaf**: `parallel(opusLeaf, codexLeaf)` (per-lens
  model per the model-selection policy for `opusLeaf` — Opus default, Fable only for a
  lens passing the policy's escalation test; `codexLeaf` is a Codex-driver →
  `model: 'sonnet'`). **Brief the `opusLeaf` (and every review-stage lens agent)
  read-only on the tree** — workflow agents hold Edit/Write, so a lens agent must be
  told it reviews and returns findings only: never edit/create/delete files, mutate
  git state, or mutation-test the shared worktree (running the suite as-is is fine);
  only the resolve / `fix(m)` stage edits. The codex leaf invokes the `codex-consult`
  skill (review mode) — already read-only via `--sandbox read-only` — and **degrades
  gracefully**: codex-absent/error → return `findings:[] notes:"codex-unavailable"`,
  never throw.
- **Re-scrape bot/human review signal EACH PR-review round** (not just once): human
  comments land mid-loop, and after a round pushes fixes, re-trigger your external bot
  (if one is in play) if its take on the new head is wanted — a push alone may
  re-trigger nothing. Skip resolved threads + prior workflow / `/pr-auto-review`
  summary comments.
- **Track the stop reason** per PR — `convergence` / `steady-state` (a fix round fixed
  0 or didn't push) / `regression` (findings rose) / `max-rounds` — and surface it +
  any unfixed/dropped findings (with rationale) in the single summary PR comment.
  (Same rule the Task path enforces via the RESOLVE bundle + `/pr-auto-review`'s
  comment — the data path is identical on both fabrics.)
- **Promote iff** `clean` AND tests pass/skipped AND **no unfixed meaningful
  findings** — else leave draft with the reason.
- **Fault-isolate each issue**: wrap each item's chain so one failure returns
  `{ok:false, stage, error}` and the rest continue; report which stage failed.
- **Keep `pipeline()` — no barrier.** Each issue flows resolve→review independently
  (lower wall-clock). Don't regress to all-resolves-then-all-reviews for independent
  issues.

## `review #<pr>` entry on this fabric

Skip R1–R4; run only R5–R6. **Find or create a worktree on the PR's branch and work
there — never `gh pr checkout` into the main repo.** Reuse an existing worktree on that
branch if one exists — with uncommitted changes present, record the dirty set and stash
it for the run, restoring after the push (pr-auto-review Step 3's WIP discipline: stash
by message under its `claude-stash.lock` flock, pop with `--index` in the same locked
lookup+pop, never force-resolve a conflicting pop); otherwise fetch
the branch and `git worktree add <repo>/.claude/worktrees/<slug> <branch>` — for a
fork PR, materialize the ref per pr-auto-review Step 3's fork branch (`FORK_REMOTE` +
`pr-<N>` local ref) first.

## Path-B failure modes

- **workflow agent tries to spawn a sub-agent** → it can't (no Agent tool); that's a
  script-authoring bug — move the fan-out up into `parallel()`.
- Everything else per ship-issues' shared failure modes (validity-gate outcomes, codex
  unavailability, non-converging PR review → leave draft with open findings in the
  body, tests failing after the fix-loop → draft, CI as final gate).
