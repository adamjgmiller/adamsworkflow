---
description: Autonomously merge main into a PR's branch, resolve conflicts preserving both intents, review the merge work, push, and comment on the PR — no human input mid-run
argument-hint: "[<pr-num> ...]"
---

Autonomously bring one or more PRs up to date with main: analyze for textual + semantic conflicts, merge main, resolve conflicts preserving both the PR's intent and main's new behavior, review the merge work, run tests, push, and comment. No stopping for human input — judgment calls land in the decision log and the PR comment. Only bails when git conflicts are genuinely unresolvable or tests can't be made to pass. Idempotent: skips quickly when the branch already contains current main.

Usage: `/auto-merge-main [<pr-num> [<pr-num>...]]`

Examples:
- `/auto-merge-main 45`
- `/auto-merge-main 45 46 47`
- `/auto-merge-main` (no args — use the PR for the current branch)

## Step 0 — Parse `$ARGUMENTS`

- **PR numbers** (optional): zero or more positive integers.
- **No args** → resolve the PR for the current branch via `gh pr view --json number,...`. If none, bail.
- State the parsed plan back in one line.

## Step 1 — Pre-flight

Hard blockers:

```bash
git rev-parse --git-dir >/dev/null
gh repo view --json nameWithOwner,defaultBranchRef >/dev/null
for N in <prs>; do gh pr view "$N" --json number,title,state,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,url >/dev/null; done
```

Capture the repo's default branch from `defaultBranchRef.name` — usually `main`, sometimes `master`. Use that as `BASE_BRANCH` throughout (rest of this doc says `main`, substitute).

Soft blockers:

- `command -v codex` missing → tough-decision protocol and `/review-fix-loop` degrade to Claude only. Note in the final report.

## Step 2 — Dispatch (one stage-agent per PR — N=1 included; max 4 in flight)

Always delegate, the single-PR case included — the merge/review/test volume for even one PR (conflict reading, `/review-fix-loop` rounds, test output) shouldn't land in this dispatching context for a ~20-line deliverable. The N=1 path is the N>1 path with one agent.

- **For each PR (1..N)** → spawn one `general-purpose` stage-agent — dispatch with an explicit `model:`: default `opus` (conductor); escalate a given PR's agent to `fable` only when it passes the policy's escalation test (per-PR call); never leave it to inheritance (an unpinned dispatch inherits the session model): *"Follow `~/.claude/commands/auto-merge-main.md` Steps 3–14 for PR #N (BASE_BRANCH=`<value>`). Every child you spawn (the 7b resolver, Step 10 consult leaves, the review loop's sub-agents) dispatches async — its result arrives as a task-notification that re-wakes you if you've stopped; collect every child's notification before advancing (field-notes §4). You own the irreversible tail — the merge-main-into-branch commit, the push to the PR's own head ref, the PR comment — execute those yourself; never sub-delegate them to your own children. If you hit **any** bail condition in the Hard rules list (that list is authoritative — every condition in it, not a subset), execute its bail exactly as written (abort/comment) and report it in your per-item block; never improvise past a bail, never swallow one. Return the per-item report block (Step 13)."*
- **Cap: at most 4 per-PR stage-agents in flight**; start the next as one returns. (If 4 proves tight in practice, drop to 3.) The cap is not optional: each stage-agent fans out children of its own (the review loop's 2a review sub-agent, Step 10 consult children, the Step 7b resolver), so the real concurrent-agent number is PRs-in-flight × within-PR children (`~/.claude/docs/field-notes.md` §6). Stay under it.
- Collect all blocks. For each `merged + pushed` block, spot-verify the report against the remote: `gh pr view <N> --json headRefOid` should start with the block's branch SHA — the block describes intent, the ref is truth. On a prefix mismatch, don't fail the block outright — `git fetch origin <pr-branch>` and check `git merge-base --is-ancestor <reported-sha> <headRefOid>`: if the reported SHA is an ancestor of the current head, the merge landed and someone pushed after it (accept; note the trailing push); only a SHA unreachable from the head means the merge didn't land.
- No `Agent` tool in your own toolset (e.g. this file reached via a Workflow agent's Skill tool)? Then you can't spawn — run Steps 3–14 inline yourself, one PR at a time — executing the delegated pieces in your own context: resolve 7b's conflicts yourself, serially, applying the resolver brief's rules; replace Step 8's loop with one inline `/dual-review` pass (its single path needs no `Agent` tool; expect the `concurrent single-process dual-source` label), **apply its critical/high findings yourself with minimal targeted edits and commit them per the repo's convention**, then treat any critical finding you could not fix as a Step 8 bail — a single pass yields no regression signal, so this criterion deliberately replaces Step 8's regression bail on this path; fix tests yourself (Step 9); run Step 10's Codex side via codex-consult inline. Capability is detected, never assumed.

## Step 3 — Worktree setup

Same as `/pr-auto-review` Step 3 — find an existing worktree on the PR's branch and reuse it; else create one under `<repo>/.claude/worktrees/<slug>` per that step's snippet (fetch without checkout, flock-serialized `git worktree add`, `.env` symlink). Never check out the PR branch in the main checkout. Respect uncommitted work in an existing worktree.

For an existing worktree with uncommitted changes specifically for `/auto-merge-main`: this is **dangerous** — `git merge` won't run cleanly. Bail with a clear comment posted to the PR:

```
/auto-merge-main: branch's local worktree at <path> has uncommitted changes; cannot safely merge main without losing them. Commit or stash them and re-run.

---
*Generated by `/auto-merge-main <N>` via Claude Code @ branch=<short-sha> main=<short-sha>.*
```

This is the rare exception to the "never bail" rule — pushing a half-merged tree on top of someone's local work is worse than asking them to clean up first.

## Step 4 — Update local refs

```bash
git fetch origin "$BASE_BRANCH"
git fetch origin <pr-branch>                                # ensure local branch matches remote
```

If local branch is behind remote, fast-forward (`git pull --ff-only`). If diverged, that's a separate problem — bail with a comment on the PR (with the standard footer).

## Step 5 — Idempotency check (skip if branch already contains current main)

`/auto-merge-main` is expensive (conflict analysis, merge, review-fix-loop, tests). Re-running against a branch that already contains the current `main` tip is a no-op — detect that here and bail with a brief comment.

The check is **git-state-based**, not comment-parse-based — it works regardless of prior runs, force-pushes, or footer format drift.

```bash
MAIN_HEAD=$(git rev-parse "origin/$BASE_BRANCH")
BRANCH_HEAD=$(git rev-parse HEAD)

if git merge-base --is-ancestor "$MAIN_HEAD" "$BRANCH_HEAD"; then
  ALREADY_UP_TO_DATE=yes
else
  ALREADY_UP_TO_DATE=no
fi
```

Two cases:

1. **`ALREADY_UP_TO_DATE=no`** → main has commits the branch doesn't have. Proceed to Step 6.
2. **`ALREADY_UP_TO_DATE=yes`** → branch already contains `origin/main`'s tip. No work to do. Bail.

For the bail case, look up the most recent prior `/auto-merge-main` comment (best-effort, for "since when" context in the bail message) and post a brief skip comment:

```bash
LAST_RUN_DATE=$(gh api "repos/:owner/:repo/issues/<N>/comments" --paginate \
  --jq '[.[] | select(.body | test("Generated by `/auto-merge-main .*` via Claude Code @"))]
        | sort_by(.created_at) | last | .created_at' \
  | head -1)

if [ -n "$LAST_RUN_DATE" ] && [ "$LAST_RUN_DATE" != "null" ]; then
  BAIL_HEADER="no new commits on \`$BASE_BRANCH\` since the last /auto-merge-main run on $LAST_RUN_DATE"
else
  BAIL_HEADER="branch is already up-to-date with \`$BASE_BRANCH\`"
fi

COMMENT_BRANCH_SHORT=$(git rev-parse --short HEAD)
COMMENT_MAIN_SHORT=$(git rev-parse --short "origin/$BASE_BRANCH")

gh pr comment <N> --body "$(cat <<EOF
## /auto-merge-main

**Skipped**: $BAIL_HEADER. Nothing to merge.

If you want to force a re-run (e.g., to re-verify after an upstream change you suspect should have flowed through), push a \`--allow-empty\` commit to \`$BASE_BRANCH\` or to this branch, then re-invoke.

---
*Generated by \`/auto-merge-main <N>\` via Claude Code @ branch=$COMMENT_BRANCH_SHORT main=$COMMENT_MAIN_SHORT.*
EOF
)"
```

(Note the heredoc uses unquoted `EOF` — necessary so `$BAIL_HEADER`, `$COMMENT_BRANCH_SHORT`, `$COMMENT_MAIN_SHORT` expand. Backticks and backslash-escapes around literal `$BASE_BRANCH` mentions inside the bash heredoc keep them as literal Markdown in the comment.)

Return the skip per-item block (Step 13 covers the format).

**Why git-state-based, not comment-parsed**:

- A previous run posting comments doesn't change git state. The agent should re-run if main has moved, regardless of whether a prior comment exists.
- Force-pushes that drop the previous merge commit (e.g., author rebased) leave `is-ancestor` returning false — the agent correctly re-merges.
- A user manually merging main into the branch and then running `/auto-merge-main` correctly bails (no work needed).
- Failed prior runs don't change git state (the merge was aborted), so `is-ancestor` still returns false → re-run, which is what we want (user may have fixed the upstream issue).

## Step 6 — Conflict analysis (pre-merge)

Surface predictable conflicts *before* attempting the merge, so the agent can prepare.

```bash
git log --oneline <merge-base>..origin/main                 # what's coming in
git log --oneline <merge-base>..HEAD                        # what the PR has
git diff <merge-base> origin/main -- $(git diff --name-only <merge-base>..HEAD)
```

Read main's commits ahead. Read the PR's commits. Look for:

- **Textual conflicts**: files touched by both sides.
- **Semantic conflicts**: symbols (functions, classes, types, constants) main renamed/removed/moved that the PR still references; shared types/schemas where main changed the shape; same-name additions (routes, migrations, env vars, config keys, CLI flags, DB columns); behavioral changes to shared helpers; removed files the PR still references.

For any semantic conflict that looks load-bearing, run the **tough-decision protocol** (Step 10) before merging — *"merge X is coming in, PR uses Y assumption; how to reconcile?"* — so when conflicts hit, the resolution direction is already decided.

Record the analysis in the umbrella's Decisions section (or initialize the umbrella if it doesn't exist — see Step 12). Record resolution directions concretely — Step 7b's resolver is briefed with this analysis verbatim and applies pre-decided directions without re-deciding them.

## Step 7 — Merge main

```bash
git merge origin/main --no-edit
```

Outcomes:

### 7a. Clean merge (no conflicts)

Proceed to Step 8.

### 7b. Merge with conflicts — one resolver agent for the whole merge

`git status` shows conflicted files. Don't grind through them in your own context (the both-sides-plus-base reading is exactly the volume delegation exists for), and **never fan out per-file resolver children** — resolutions in one file often inform another, and parallel children restaging a conflicted index is a footgun. Dispatch **one** `general-purpose` resolver sub-agent **per merge** — with an explicit `model:`: default `opus` (it's a conductor that runs Step 10 consults), `fable` only per the policy's escalation test; never leave it to inheritance — serial within itself, and touch nothing in the worktree while it runs.

**Merge-conflict-resolver brief** — this inline brief is the canonical contract (single consumer; cite this section if ever needed elsewhere, don't create a named def). Dispatch with the worktree path and Step 6's recorded analysis pasted in:

> You are resolving all conflicts of a single `git merge origin/main` in `<worktree>`. **All git commands run from `<worktree>` — the conflicted merge index exists only there.** `cd <worktree>` at the start of every Bash call (or use `git -C <worktree>` / absolute paths throughout); your cwd does not persist between calls, and the session-default cwd has no merge in progress. Work serially in your own context — never spawn per-file children. For each conflicted file:
>
> 1. **Read both sides + the base**: `git diff --base <file>`, `git diff --ours <file>`, `git diff --theirs <file>`. Understand what main changed, what the PR changed, what was original.
> 2. **Determine intent**: what was main's commit trying to accomplish? what is the PR trying to accomplish? Often the conflict is two valid edits to the same code — both intents matter.
> 3. **Resolve preserving both**:
>    - If main's change is orthogonal to the PR's → apply both side-by-side.
>    - If main's change supersedes the PR's mechanism (e.g., main renamed a helper, PR called the old name) → adapt the PR's call to the new mechanism, preserving the PR's semantic.
>    - If main's change conflicts semantically with the PR's intent → check the pre-decided directions below first.
> 4. **Stage the resolution**: `git add <file>`.
> 5. **Verify the resolution makes sense**: re-read the resolved file in full. Does the combined edit do what both sides wanted?
>
> **Pre-decided directions (apply, don't re-decide)**: <paste Step 6's semantic-conflict analysis + every pre-decided resolution direction from the umbrella's Decisions section, verbatim>. For a conflict those cover, apply the recorded direction. Only for a conflict Step 6 did **not** pre-decide, run a fresh tough-decision consult (Step 10's protocol; frame: *"main does X; PR does Y; X and Y are incompatible — which wins, or how to reconcile?"*) and log the outcome for your return. If both consults come back no-confidence: fall back to "preserve the PR's intent, adapt the PR's surface to main's new API"; if even that is unclear, return the conflict as unresolvable.
>
> **You never commit, never push, never comment on the PR, never `git merge --abort`** — your dispatcher owns the irreversible tail. If a conflict is structurally impossible to resolve safely, STOP and return that verdict packaged (file, reason, what you tried); your dispatcher executes 7c.
>
> **Return**: per-file one-line resolution summaries, consult outcomes for any fresh decisions, and any unresolvable verdict.

On return, reconcile the resolver's report against the index — `git diff --staged` is truth; a reported resolution that isn't staged means re-dispatch, not commit. No conflict markers left and every conflicted file accounted for, then:

```bash
git commit --no-edit                                        # uses the default merge commit message
```

Depth note: dispatcher(0) → stage-agent(1) → resolver(2) → its consult children(3) — the edge of the ~3–4 depth convention (field-notes §5); the resolver nests nothing deeper.

### 7c. Genuinely unresolvable conflict

If the resolver returns a conflict as structurally impossible to resolve safely (e.g., main deleted a file the PR substantially extended, and adapting the PR to main's new approach requires a from-scratch rewrite it can't confidently do), **bail**:

```bash
git merge --abort
```

Post a PR comment (Step 14) with `Outcome: failed — unresolvable conflict in <file>: <reason>`. This is one of the bail conditions in the Hard rules list (which is authoritative on the full set). The abort and the comment are yours, the stage-agent's — the resolver only packages the verdict.

## Step 8 — Review the merge work

Single invocation of `/review-fix-loop /dual-review`. The diff scope is the merge commit + any conflict-resolution edits — `/review-fix-loop`'s internal scope detection handles it (branch ahead of base).

Run the loop **inline** in this stage-agent — invoking the slash command inline costs no nesting level; dispatching it as a child adds one for nothing. The loop's 2a review sub-agent is `general-purpose`; the dual-review it runs executes both reviewers within itself — Claude inline (this loop's review sub-agent authored nothing, so quick-review's fresh-eyes rule lands inline) plus Codex as a detached process gated on a sentinel file (no codex-runner child; works at any depth). Expect the `concurrent single-process dual-source` label. What nesting buys here: the review churn isolated from this agent's per-PR context — **not** a parallel Claude sibling. Chain: dispatcher(0) → this stage-agent(1) → the loop's review sub-agent(2) — comfortably inside the convention; add nothing below it.

Capture: rounds, fixes applied, decisions made, escalations.

If the loop hits regression (its 'newly introduced' counter exceeds last round's 'fixed') → that's signal the merge resolution introduced bugs. Don't push. Bail with a comment.

## Step 9 — Detect + run tests (loop fix up to 5 attempts)

Detect the project's test command (`package.json` → `npm test`/`pnpm test`/`yarn test` per lockfile; `pyproject.toml` with pytest config → `pytest`; `Cargo.toml` → `cargo test`; `go.mod` → `go test ./...`; `Makefile` with `test:` target → `make test`; respect `.tool-versions`/`mise.toml` hints). If no test command is detectable → skip, note that no tests ran. Run the suite foreground when it fits the ~10-min Bash ceiling; background a longer run and await its completion notification — it re-wakes you with the output (field-notes §4); never proceed with the run pending.

If tests fail post-merge, fix-loop up to 5 attempts (sub-agent brief: "All commands run from `<worktree>` — `cd <worktree>` at the start of every Bash call; your cwd does not persist between calls. Fix these failing tests, minimal edits, do not weaken the assertions; never return with a test run still pending — hold each run's result before acting (field-notes §4)"). After 5: **bail** with comment `Outcome: failed — tests broken after merge, 5 fix attempts didn't recover. <test-output-summary>`. Don't push test-broken state.

(`/auto-merge-main`'s contract is "bring the branch up to date *cleanly*" — pushing broken tests undermines that. The PR remains in its pre-merge state; user investigates and re-runs.)

## Step 10 — Tough-decision protocol (reference)

Anywhere the agent faces a judgment call it would have stopped to ask about:

1. Frame the decision.
2. Fan out an opinion leaf (`model: opus`/`fable` per the model-selection policy) + a Codex `ask` driver leaf (`model: sonnet`) in parallel — collect both leaves' completion task-notifications before synthesizing (async dispatch; field-notes §4).
3. Synthesize with the `review-fix-loop.md` Lane 2 tiebreakers (reversibility → behavior preservation → blast radius → confidence → least action → first option in framing).
4. Log in `plans/<branch>.md` Decisions section; surface meaningful ones in the PR comment.
5. Proceed.

Never bail to the user mid-run. (The confidence / least-action / first-option extensions are a deliberate divergence from Lane 2, whose real chain is the first three criteria then escalate true ties to the user via its end-of-loop report; this protocol runs unattended, so ties resolve to the leave-as-is / no-op option when one is present, else the first option in the framing — and get logged.)

Use heavily in Step 6 (semantic conflict analysis) and Step 7b (conflict resolution direction — run there by the resolver, for conflicts Step 6 did not pre-decide).

The opinion leaf is a real `Agent` dispatch — inside the per-PR stage-agent this protocol is another nesting consumer at the same depth as the review loop's children. Count its children toward the stage-agent's depth/concurrency budget (Step 2's cap assumes you do); from the Step 7b resolver, the consult children already sit at the ~3–4 convention's edge — never deeper.

## Step 11 — Push

```bash
# Commit any straggler review/test-fix edits first — `git push` ships only commits,
# and Step 3 bailed on dirty worktrees, so any dirt here is this run's own work.
if [ -n "$(git status --porcelain)" ]; then git add -A && git commit -m "fix: post-merge review/test fixes"; fi
git push                                                    # to PR head ref
COMMENT_BRANCH_SHORT=$(git rev-parse --short HEAD)
COMMENT_MAIN_SHORT=$(git rev-parse --short "origin/$BASE_BRANCH")
```

`COMMENT_BRANCH_SHORT` and `COMMENT_MAIN_SHORT` are used in Step 14's footer. `COMMENT_MAIN_SHORT` is not strictly required for idempotency (Step 5 uses git state), but it's useful forensic context.

This is the run's only push and it goes to the PR's **own head ref** — `$BASE_BRANCH` is never pushed, and nothing here authorizes the stage-agent's children to push anything (the irreversible tail stays with the stage-agent).

Failure handling:

- **Fork without maintainer-edit** → can't push the merge. Bail with a comment: *"Couldn't push merged state — fork without maintainer-edit. Enable 'Allow edits by maintainers' and re-run."* (Patches in a comment aren't useful for a merge — it's a multi-commit operation; user needs to merge themselves.) Capture `COMMENT_*` SHAs at the pre-push branch state for the failure comment.
- **Non-fast-forward rejection** → branch moved underneath us. Re-fetch; if trivial rebase, do it and retry; if not, bail with comment.

## Step 12 — Append `plans/<branch>.md` (always)

Per the global CLAUDE.md worktree-plans convention. Create-or-append. If umbrella missing, create the scaffold first. Append:

```markdown
## /auto-merge-main run, <YYYY-MM-DD>

**Branch SHA (post-merge)**: `<COMMENT_BRANCH_SHORT>`
**Main SHA (merged)**: `<COMMENT_MAIN_SHORT>`
**Main commits merged**: <count> (`<merge-base>..origin/main`)
**Conflicts**: <count> textual, <count> semantic
**Tough decisions during resolution**: <count>
**Review loop**: <stop reason, fixes, decisions, escalations>
**Tests**: <ran (passed) | ran (failed after attempts) | skipped>
**Outcome**: <merged + pushed | failed: <reason> | skipped: already up-to-date>

### Conflict resolutions
- <file> — <one-line description of how it was resolved> — consult outcome: <if any>

### Meaningful decisions
- <bullet per decision flagged meaningful>
```

Commit the plans file update.

For the skip case (Step 5 bail): the plans file update is optional. If the umbrella exists, append a one-line entry noting the skip date and main SHA; if not, don't create one just to record a skip.

## Step 13 — Per-item report block

Return:

```markdown
### PR #<N> — <title>
**URL**: <url>  **Outcome**: <merged + pushed | failed: <reason> | skipped-no-changes>
**Branch SHA**: `<COMMENT_BRANCH_SHORT>`  **Main SHA**: `<COMMENT_MAIN_SHORT>`

**Main commits merged**: <count>
**Conflicts resolved**: <count> textual, <count> semantic
**Review loop**: <summary>
**Tests**: <status>

**Meaningful decisions** (<count>):
- <bullet per decision with one-line rationale>

**Notes**:
- <Codex unavailable | regression detected | etc., if applicable>
```

For the **skipped-no-changes** case (Step 5 bail), use this trimmed block:

```markdown
### PR #<N> — <title>
**URL**: <url>  **Outcome**: skipped-no-changes
**Branch SHA**: `<COMMENT_BRANCH_SHORT>`  **Main SHA**: `<COMMENT_MAIN_SHORT>`

Branch already contains current `<BASE_BRANCH>`. No merge needed.
```

## Step 14 — Post PR comment

```bash
gh pr comment <N> --body "$(cat <<EOF
## /auto-merge-main

**Outcome**: <Merged main into branch and pushed | Failed: <reason>>

### Main commits merged
<count> commits from \`<merge-base>..origin/main\`

### Conflicts
- Textual: <count>
- Semantic: <count>

### Conflict resolutions [omit section if zero]
- \`<file>\` — <how resolved> — <consult outcome if applicable>

### Meaningful decisions made (<count>) [omit if zero]
- <decision> — <rationale> — consult outcome: <converged | resolved-divergence | tied>

### Review loop
<stop reason, fixes applied, decisions, escalations>

### Tests
<ran (passed) | ran (failed N times after fix attempts) | skipped>

---
*Generated by \`/auto-merge-main <N>\` via Claude Code @ branch=$COMMENT_BRANCH_SHORT main=$COMMENT_MAIN_SHORT.*
EOF
)"
```

The `@ branch=<sha> main=<sha>` is forensic context; idempotency in Step 5 does not depend on parsing it (git state is authoritative). Don't omit it — operators reading the comment expect to see the SHAs.

(Note unquoted `EOF` so `$COMMENT_BRANCH_SHORT` and `$COMMENT_MAIN_SHORT` expand. Backslash-escapes on literal backticks keep them as Markdown in the comment.)

## Step 15 — Final report (dispatcher)

Assemble per-item blocks — N=1 gets the same flow with one block. Push notification:

```
/auto-merge-main done — <M> merged, <S> skipped (up-to-date), <F> failed.
```

## Hard rules

- Never force-push. Never delete branches. Never use `git reset --hard` to "clean up" a bad merge — use `git merge --abort` if mid-merge, otherwise `git revert <merge-sha>`.
- Never push a merge with broken tests (Step 9 bail).
- Never push a merge with regression detected by `/review-fix-loop` (Step 8 bail).
- Never push to fork PRs without maintainer-edit (Step 11 bail).
- Never bail to the user except per the explicit bail conditions: unresolvable conflict (7c), test exhaustion (9), regression (8), uncommitted-work-in-worktree (3), unresolvable push failure (11), branch-state divergence (4), or idempotent skip (5 — which is a no-op, not a failure). Everything else → tough-decision protocol, log, proceed.
- Keep-interactive: anything `AskUserQuestion`-driven or needing the live conversation stays on the main loop — dispatched stage-agents carry no `AskUserQuestion` tool at all. This command has no such step by design (judgment calls go to Step 10); but if a nested invocation ever surfaces a question only the human can answer, return it as **data** in the per-item block and let the main loop surface it (e.g. via `/askme`) — never improvise the answer, never hang.
- Step 2's 4-in-flight cap holds for any caller — an outer command driving this one inherits it; it doesn't re-derive or lift it.
- Always honor `git merge --abort` if a merge gets too tangled to safely commit; bail with comment rather than push a half-baked tree.
- Idempotency is git-state-based (Step 5's `merge-base --is-ancestor` check) — do not change the bail trigger to comment-parsing, which is fragile to force-push and footer drift.

## Failure modes

- **Branch behind remote in non-trivial way** → bail at Step 4 with comment, don't merge.
- **Uncommitted work in worktree** → bail at Step 3 with comment, don't merge.
- **Idempotent skip: branch already contains current main** → Step 5 skip; post brief comment; per-item block reads `skipped-no-changes`. Not a failure.
- **Unresolvable git conflict** → `git merge --abort`, bail with comment listing the file and reason.
- **Tough-decision consult both no-confidence on a semantic-conflict resolution** → fall back to "preserve PR's intent, adapt PR's surface to main's new API." If even that's unclear, bail with comment.
- **`/review-fix-loop` regression detected** → don't push, post comment with the regression details.
- **Tests failing after 5 fix attempts** → don't push, post comment.
- **Fork without maintainer-edit** → bail with comment asking user to enable it.
- **Push rejected non-fast-forward** → try once to rebase merged state onto current remote; if non-trivial, bail.
- **Codex unavailable** → degrade to Claude-only consults. Flag once.
- **One per-PR stage-agent fails** → the others continue. Failed item's block reads `### PR #<N> — failed: <reason>`.
