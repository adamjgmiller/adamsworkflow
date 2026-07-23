---
description: Autonomously merge main into a PR's branch, resolve conflicts preserving both intents, review the merge work, push, and comment on the PR — no human input mid-run
argument-hint: "[<pr-num> ...]"
---

Autonomously bring one or more PRs up to date with main: analyze for textual + semantic conflicts, merge main, resolve conflicts preserving both the PR's intent and main's new behavior, review the merge work, run tests, push, and comment. No stopping for human input — judgment calls land in the decision log and the PR comment. Bails only per the Hard-rules bail list (unresolvable conflicts and unfixable tests being the common cases). Idempotent: skips quickly when the branch already contains current main.

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
# gh pr view exits 0 for MERGED/CLOSED PRs too (probe-verified, gh 2.93) — the
# state test, not the exit code, is the open-PR gate; the exit code only
# catches missing/inaccessible PRs. Merging main into a dead PR's branch would
# push to a branch nobody will merge and comment on a closed PR.
for N in <prs>; do
  STATE=$(gh pr view "$N" --json state --jq .state) || exit 1
  [ "$STATE" = "OPEN" ] || { echo "PR #$N state=$STATE — not open"; exit 1; }
done
```

Capture the repo's default branch from `defaultBranchRef.name` — usually `main`, sometimes `master`. Use that as `BASE_BRANCH` throughout (rest of this doc says `main`, substitute).

Soft blockers:

- `command -v codex` missing → tough-decision protocol and `/review-fix-loop` degrade to Claude only. Note in the final report.

## Step 2 — Dispatch (one stage-agent per PR — N=1 included; max 4 in flight)

Always delegate, the single-PR case included — the merge/review/test volume for even one PR (conflict reading, `/review-fix-loop` rounds, test output) shouldn't land in this dispatching context for a ~20-line deliverable. The N=1 path is the N>1 path with one agent.

- **For each PR (1..N)** → spawn one `general-purpose` stage-agent — dispatch with an explicit `model:`: default `opus` (conductor); escalate a given PR's agent to `fable` only when it passes the policy's escalation test (per-PR call); never leave it to inheritance (an unpinned dispatch inherits the session model): *"Follow `~/.claude/commands/auto-merge-main.md` Steps 3–14 for PR #N (BASE_BRANCH=`<value>`). Every child you spawn (the 7b resolver, Step 10 consult leaves, the review loop's sub-agents) dispatches async — its result arrives as a task-notification that re-wakes you if you've stopped; collect every child's notification before advancing (field-notes §4). You own the irreversible tail — the merge-main-into-branch commit, the push to the PR's own head ref, the PR comment — execute those yourself; never sub-delegate them to your own children. If you hit **any** bail condition in the Hard rules list (that list is authoritative — every condition in it, not a subset), execute its bail exactly as written (abort/comment) and report it in your per-item block; never improvise past a bail, never swallow one. Return the per-item report block (Step 13)."*
- **Cap: at most 4 per-PR stage-agents in flight**; start the next as one returns. (If 4 proves tight in practice, drop to 3.) The cap is not optional: each stage-agent fans out children of its own (the review loop's 2a review sub-agent, Step 10 consult children, the Step 7b resolver), so the real concurrent-agent number is PRs-in-flight × within-PR children (`~/.claude/docs/field-notes.md` §6). Stay under it.
- Collect all blocks. For each `merged + pushed` block, spot-verify the report against the remote: `gh pr view <N> --json headRefOid` should start with the block's branch SHA — the block describes intent, the ref is truth. On a prefix mismatch, don't fail the block outright — `git fetch origin <pr-branch>` and check `git merge-base --is-ancestor <reported-sha> <headRefOid>`: if the reported SHA is an ancestor of the current head, the merge landed and someone pushed after it (accept; note the trailing push); only a SHA unreachable from the head means the merge didn't land.
- No `Agent` tool in your own toolset (e.g. this file reached via a Workflow agent's Skill tool)? **Bail before any side effect** with a clear error: this command requires the Task fabric — re-run it from the main loop or a spawn-capable stage-agent. There is no degraded inline mode (capability is detected, never assumed; the resolver, review loop, and consult machinery all presume spawning).

## Step 3 — Worktree setup

Same as `/pr-auto-review` Step 3 — find an existing worktree on the PR's branch and reuse it; else create one under `<repo>/.claude/worktrees/<slug>` per that step's snippet (fetch without checkout, flock-serialized `git worktree add`, `.env` symlink). Never check out the PR branch in the main checkout. Respect uncommitted work in an existing worktree.

For an existing worktree with uncommitted changes specifically for `/auto-merge-main`: this is **dangerous** — `git merge` won't run cleanly. Bail with a clear comment posted to the PR:

```
/auto-merge-main: branch's local worktree at <path> has uncommitted changes; cannot safely merge main without losing them. Commit or stash them and re-run.

---
*Generated by `/auto-merge-main <N>` via Claude Code @ branch=<short-sha> main=<short-sha>.*
```

This is one of the Hard-rules bail conditions — pushing a half-merged tree on top of someone's local work is worse than asking them to clean up first.

## Step 4 — Update local refs

```bash
git fetch origin "$BASE_BRANCH"
git fetch origin <pr-branch>                                # ensure local branch matches remote
```

**Fork PR** (Step 1's `headRepositoryOwner` ≠ the repo owner): the head branch lives on the fork, not `origin`, so the second fetch fails — fetch from the per-PR fork remote the Step 3 snippet defines (`FORK_REMOTE=pr-<N>-fork`, URL derived there): `git fetch "$FORK_REMOTE" <pr-branch>`; if the reused worktree predates that remote, create it per pr-auto-review Step 3's fork branch. Step 11's push names the same `$FORK_REMOTE` explicitly (its failure handling covers the no-maintainer-edit case).

If local branch is behind remote, fast-forward **from the ref you just fetched**: `git merge --ff-only "origin/<pr-branch>"` (`"$FORK_REMOTE/<pr-branch>"` for fork PRs). Not bare `git pull --ff-only` — it follows the branch's *configured upstream*, which in a scaffolded worktree is typically unset (errors) or can name a different remote than the PR head. If diverged, that's a separate problem — bail with a comment on the PR (with the standard footer).

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
        | sort_by(.created_at) | last | .created_at // empty' \
  | tail -1)   # tail, not head: --paginate runs the --jq filter per page (oldest page
               # first) — the last line is the newest match. The `// empty` keeps
               # matchless pages silent: without it a newer page with no match emits
               # a literal `null` line that tail would pick over an earlier real date

if [ -n "$LAST_RUN_DATE" ] && [ "$LAST_RUN_DATE" != "null" ]; then
  BAIL_HEADER="branch already contains current \`$BASE_BRANCH\` (last /auto-merge-main run: $LAST_RUN_DATE)"
else
  BAIL_HEADER="branch is already up-to-date with \`$BASE_BRANCH\`"
fi

COMMENT_BRANCH_SHORT=$(git rev-parse --short HEAD)
COMMENT_MAIN_SHORT=$(git rev-parse --short "origin/$BASE_BRANCH")

gh pr comment <N> --body "$(cat <<EOF
## /auto-merge-main

**Skipped**: $BAIL_HEADER. Nothing to merge.

If you want to force a re-run (e.g., to re-verify after an upstream change you suspect should have flowed through), push a \`--allow-empty\` commit to \`$BASE_BRANCH\`, then re-invoke (an empty commit on this branch leaves the ancestry check unchanged and skips again).

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
- Failed prior runs don't change lasting git state (7c aborts the merge and restores `plans/`; the Step 8/9/11 bails reset to `PRE_MERGE_HEAD`), so `is-ancestor` still returns false → re-run, which is what we want (user may have fixed the upstream issue).

## Step 6 — Conflict analysis (pre-merge)

Surface predictable conflicts *before* attempting the merge, so the agent can prepare.

```bash
git log --oneline <merge-base>..origin/main                 # what's coming in
git log --oneline <merge-base>..HEAD                        # what the PR has
git diff --name-only <merge-base>..HEAD | while IFS= read -r f; do
  git diff <merge-base> origin/main -- "$f"   # per-file: space-safe, empty-safe
done
```

Read main's commits ahead. Read the PR's commits. Look for:

- **Textual conflicts**: files touched by both sides.
- **Semantic conflicts**: symbols (functions, classes, types, constants) main renamed/removed/moved that the PR still references; shared types/schemas where main changed the shape; same-name additions (routes, migrations, env vars, config keys, CLI flags, DB columns); behavioral changes to shared helpers; removed files the PR still references.

For any semantic conflict that looks load-bearing, run the **tough-decision protocol** (Step 10) before merging — *"merge X is coming in, PR uses Y assumption; how to reconcile?"* — so when conflicts hit, the resolution direction is already decided.

Record the analysis in the umbrella's Decisions section (or initialize the umbrella if it doesn't exist — see Step 12). Record resolution directions concretely — Step 7b's resolver is briefed with this analysis verbatim and applies pre-decided directions without re-deciding them.

## Step 7 — Merge main

```bash
PRE_MERGE_HEAD=$(git rev-parse HEAD)      # Step 8's review-scope anchor — capture BEFORE merging
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

On return, reconcile the resolver's report against the index — unresolved state is `git ls-files -u` (empty = every conflict staged as resolved; a listed path means re-dispatch, not commit). Inspect the actual resolutions with `git diff --staged`, knowing a file deliberately resolved to HEAD's version stages an entry identical to HEAD and shows **no** diff line there — absence from the cached diff is not absence of a resolution. No conflict markers left and `ls-files -u` empty, then:

```bash
git commit --no-edit                                        # uses the default merge commit message
```

Depth note: dispatcher(0) → stage-agent(1) → resolver(2) → its consult children(3) — the edge of the ~3–4 depth convention (field-notes §5); the resolver nests nothing deeper.

### 7c. Genuinely unresolvable conflict

If the resolver returns a conflict as structurally impossible to resolve safely (e.g., main deleted a file the PR substantially extended, and adapting the PR to main's new approach requires a from-scratch rewrite it can't confidently do), **bail**:

```bash
git merge --abort
git restore -- plans/ 2>/dev/null; git clean -fd -- plans/
```

The plans restore is load-bearing: Step 6's analysis append is still uncommitted here
(`merge --abort` preserves dirt on merge-untouched paths), and leftover dirt makes the
next run's Step 3 bail blaming the user — breaking the re-run this bail exists to
enable. Step 3 bailed on any pre-existing dirt, so everything under `plans/` at this
point is this run's own; the analysis regenerates on a re-run (Step 6), and this
bail's PR comment carries the verdict.

Post a PR comment (Step 14) with `Outcome: failed — unresolvable conflict in <file>: <reason>`. This is one of the bail conditions in the Hard rules list (which is authoritative on the full set). The abort and the comment are yours, the stage-agent's — the resolver only packages the verdict.

## Step 8 — Review the merge work

Single invocation of `/review-fix-loop /dual-review scope <PRE_MERGE_HEAD>` (the SHA captured in Step 7). The explicit scope pins the review to the merge commit + any conflict-resolution edits. Never omit it: post-merge, HEAD contains main, so the loop's clean-tree fallback would anchor at `merge-base HEAD main` = main's tip — ballooning the "merge review" to the whole PR diff and auto-fixing unrelated pre-existing PR code (the same trap pr-auto-review Step 9 guards with its explicit `scope <PR_BASE_SHA>`).

Run the loop **inline** in this stage-agent — invoking the slash command inline costs no nesting level; dispatching it as a child adds one for nothing. The loop's 2a review sub-agent is `general-purpose`; the dual-review it runs executes both reviewers within itself — Claude inline (this loop's review sub-agent authored nothing, so quick-review's fresh-eyes rule lands inline) plus Codex as a detached process gated on a sentinel file (no codex-runner child; works at any depth). Expect the `concurrent single-process dual-source` label. What nesting buys here: the review churn isolated from this agent's per-PR context — **not** a parallel Claude sibling. Chain: dispatcher(0) → this stage-agent(1) → the loop's review sub-agent(2) — comfortably inside the convention; add nothing below it.

Capture: rounds, fixes applied, decisions made, escalations.

If the loop hits regression (its 2c stop: 'newly introduced' exceeding last round's fixed + decided) → that's signal the merge resolution introduced bugs. Don't push. Restore the worktree first — `git reset --hard "$PRE_MERGE_HEAD"` (this run's own unpushed merge/fix commits only; the Hard-rules carve-out) — so the local branch's tracked state matches the remote PR again, then bail with a comment.

## Step 9 — Detect + run tests (loop fix up to 5 attempts)

Detect the project's test command (`package.json` → `npm test`/`pnpm test`/`yarn test` per lockfile; `pyproject.toml` with pytest config → `pytest`; `Cargo.toml` → `cargo test`; `go.mod` → `go test ./...`; `Makefile` with `test:` target → `make test`; respect `.tool-versions`/`mise.toml` hints). If no test command is detectable → skip, note that no tests ran. Run the suite foreground when it fits the ~10-min Bash ceiling; background a longer run and await its completion notification — it re-wakes you with the output (field-notes §4); never proceed with the run pending.

If tests fail post-merge, fix-loop up to 5 attempts (sub-agent brief: "All commands run from `<worktree>` — `cd <worktree>` at the start of every Bash call; your cwd does not persist between calls. Fix these failing tests, minimal edits, do not weaken the assertions; never return with a test run still pending — hold each run's result before acting (field-notes §4)"). After 5: **bail** — restore the worktree first (`git reset --hard "$PRE_MERGE_HEAD"` — discards this run's own unpushed merge + test-fix commits; the Hard-rules carve-out — then `git clean -fd`: untracked leftovers from a failed attempt survive a hard reset, and Step 3 guaranteed a clean tree at run start, so anything untracked now is this run's own), then comment `Outcome: failed — tests broken after merge, 5 fix attempts didn't recover. <test-output-summary>`. Don't push test-broken state.

(`/auto-merge-main`'s contract is "bring the branch up to date *cleanly*" — pushing broken tests undermines that. The PR remains in its pre-merge state — and the reset restores the local worktree's tracked state to match, keeping Step 5 honest on a re-run; user investigates and re-runs.)

## Step 10 — Tough-decision protocol (reference)

Anywhere the agent faces a judgment call it would have stopped to ask about:

1. Frame the decision.
2. Fan out an opinion leaf (`model: opus`/`fable` per the model-selection policy) + a Codex `ask` driver leaf (`model: sonnet`) in parallel — collect both leaves' completion task-notifications before synthesizing (async dispatch; field-notes §4).
3. Synthesize with `review-fix-loop.md` Lane 2's **unattended variant** (the canonical statement of the extended chain: reversibility → behavior preservation → blast radius → higher confidence → least action → first option in the framing — logging which terminal rule fired).
4. Log in `plans/<branch>.md` Decisions section; surface meaningful ones in the PR comment.
5. Proceed.

Never bail to the user mid-run.

Use heavily in Step 6 (semantic conflict analysis) and Step 7b (conflict resolution direction — run there by the resolver, for conflicts Step 6 did not pre-decide).

The opinion leaf is a real `Agent` dispatch — inside the per-PR stage-agent this protocol is another nesting consumer at the same depth as the review loop's children. Count its children toward the stage-agent's depth/concurrency budget (Step 2's cap assumes you do); from the Step 7b resolver, the consult children already sit at the ~3–4 convention's edge — never deeper.

## Step 11 — Push

```bash
# Commit any straggler review/test-fix edits first — `git push` ships only commits,
# and Step 3 bailed on dirty worktrees, so any dirt here is this run's own work.
if [ -n "$(git status --porcelain)" ]; then git add -A && git commit -m "fix: post-merge review/test fixes"; fi
# Capture the merged-state SHAs for the plans record NOW — before the plans commit and the
# push — so they name the merge+fixes state (Step 12's template uses these, not the post-push
# COMMENT_* below, which would include the plans commit itself).
MERGE_RESULT_SHORT=$(git rev-parse --short HEAD)
MAIN_MERGED_SHORT=$(git rev-parse --short "origin/$BASE_BRANCH")
# Append + commit plans/<branch>.md NOW (Step 12's template) — BEFORE the push, so one
# push carries merge + fixes + plans and the record reaches the PR. Committing plans
# after the push would strand it locally: the record never appears in the PR diff, and
# the reused worktree diverges from remote after any later author push.
git push origin "HEAD:<pr-branch>"                          # same-repo PR
# Fork PR (maintainer-edit): git push "$FORK_REMOTE" "HEAD:<pr-branch>"
# Always name remote + refspec: a bare `git push` (no upstream set on this branch)
# either fails or — under push.default=current/autoSetupRemote — creates a junk
# origin/<pr-branch> and "succeeds" without updating the PR (the silent
# wrong-destination push pr-auto-review Step 12 documents).
COMMENT_BRANCH_SHORT=$(git rev-parse --short HEAD)
COMMENT_MAIN_SHORT=$(git rev-parse --short "origin/$BASE_BRANCH")
```

`COMMENT_BRANCH_SHORT` and `COMMENT_MAIN_SHORT` are the post-push captures used in Step 14's footer and the Step 13 block — distinct from the pre-push `MERGE_RESULT_SHORT`/`MAIN_MERGED_SHORT` the Step 12 plans record uses. `COMMENT_MAIN_SHORT` is not strictly required for idempotency (Step 5 uses git state), but it's useful forensic context.

This is the run's only push and it goes to the PR's **own head ref** — `$BASE_BRANCH` is never pushed, and nothing here authorizes the stage-agent's children to push anything (the irreversible tail stays with the stage-agent).

Failure handling:

- **Fork without maintainer-edit** → can't push the merge. Bail with a comment: *"Couldn't push merged state — fork without maintainer-edit. Enable 'Allow edits by maintainers' and re-run."* (Patches in a comment aren't useful for a merge — it's a multi-commit operation; user needs to merge themselves.) Capture `COMMENT_*` SHAs at the pre-push branch state for the failure comment.
- **Non-fast-forward rejection** → branch moved underneath us. Re-fetch; **merge** the new remote commits into the merged state (`git merge <push-remote>/<pr-branch> --no-edit` — never rebase here: HEAD carries Step 7's merge commit, and a rebase silently drops it and replays main's merged commits as PR-branch commits) and retry the push once; if that merge conflicts (`git merge --abort` first) or the retry is rejected, bail with comment.

On either unresolvable-push bail, after capturing the failure-comment SHAs: restore the worktree — `git reset --hard "$PRE_MERGE_HEAD"` (this run's own unpushed commits only) — so a later re-run starts from the remote PR state instead of a stranded local merge.

## Step 12 — `plans/<branch>.md` template (the append + commit run in Step 11, pre-push)

Per the global CLAUDE.md worktree-plans convention. Create-or-append — **executed in Step 11, before the push** (the ordering is load-bearing; see the Step 11 comment). If umbrella missing, create the scaffold first. Append:

```markdown
## /auto-merge-main run, <YYYY-MM-DD>

**Branch SHA (post-merge)**: `<MERGE_RESULT_SHORT>`
**Main SHA (merged)**: `<MAIN_MERGED_SHORT>`
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

(The commit itself happens in Step 11, before the push.)

For the skip case (Step 5 bail): **no plans update** — the skip comment is the record. This path never pushes, so an append would strand state either way (uncommitted dirt → the next run's Step 3 false-bails; a local commit → divergence after any author push — the exact strand Step 11's ordering rationale exists to prevent).

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
BODY_FILE=$(mktemp)
cat > "$BODY_FILE" <<'EOF'
## /auto-merge-main

**Outcome**: <Merged main into branch and pushed | Failed: <reason>>

### Main commits merged
<count> commits from `<merge-base>..origin/main`

### Conflicts
- Textual: <count>
- Semantic: <count>

### Conflict resolutions [omit section if zero]
- `<file>` — <how resolved> — <consult outcome if applicable>

### Meaningful decisions made (<count>) [omit if zero]
- <decision> — <rationale> — consult outcome: <converged | resolved-divergence | single-source> (review-fix-loop Lane 2's vocab; annotate the terminal rule when the extended chain decided)

### Review loop
<stop reason, fixes applied, decisions, escalations>

### Tests
<ran (passed) | ran (failed N times after fix attempts) | skipped>
EOF
printf -- '\n---\n*Generated by `/auto-merge-main <N>` via Claude Code @ branch=%s main=%s.*\n' "$COMMENT_BRANCH_SHORT" "$COMMENT_MAIN_SHORT" >> "$BODY_FILE"
gh pr comment <N> --body-file "$BODY_FILE"
```

The `@ branch=<sha> main=<sha>` is forensic context; idempotency in Step 5 does not depend on parsing it (git state is authoritative). Don't omit it — operators reading the comment expect to see the SHAs.

(The **quoted** `<<'EOF'` body delimiter is load-bearing: conflicted filenames and resolution/decision summaries are PR-derived or quote code — an expanding heredoc would run `$(...)`/backtick substitution on them at comment time. Backticks are typed plainly. The footer is appended by `printf`, the only expanding step, carrying just the two run-controlled SHAs. Step 5's skip comment keeps its unquoted heredoc — its body interpolates only run-controlled variables.)

## Step 15 — Final report (dispatcher)

Assemble per-item blocks — N=1 gets the same flow with one block. Push notification:

```
/auto-merge-main done — <M> merged, <S> skipped (up-to-date), <F> failed.
```

## Hard rules

- Never force-push. Never delete branches. Never use `git reset --hard` to "clean up" a bad merge — use `git merge --abort` if mid-merge, otherwise `git revert <merge-sha>` for anything pushed. One tightly-scoped exception: the post-merge bail restore (`git reset --hard "$PRE_MERGE_HEAD"` — Steps 8/9/11) discards only this run's own unpushed commits, in this run's worktree.
- Never push a merge with broken tests (Step 9 bail).
- Never push a merge with regression detected by `/review-fix-loop` (Step 8 bail).
- Never push to fork PRs without maintainer-edit (Step 11 bail).
- Never bail to the user except per the explicit bail conditions: unresolvable conflict (7c), test exhaustion (9), regression (8), uncommitted-work-in-worktree (3), unresolvable push failure (11), branch-state divergence (4), idempotent skip (5 — which is a no-op, not a failure), or the pre-flight bails (Step 0 no-PR, Step 1 hard blockers, Step 2 no-Agent-tool). Everything else → tough-decision protocol, log, proceed.
- Keep-interactive: anything `AskUserQuestion`-driven or needing the live conversation stays on the main loop — dispatched stage-agents carry no `AskUserQuestion` tool at all. This command has no such step by design (judgment calls go to Step 10); but if a nested invocation ever surfaces a question only the human can answer, return it as **data** in the per-item block and let the main loop surface it (e.g. via `/askme`) — never improvise the answer, never hang.
- Step 2's 4-in-flight cap holds for any caller — an outer command driving this one inherits it; it doesn't re-derive or lift it.
- Always honor `git merge --abort` if a merge gets too tangled to safely commit; bail with comment rather than push a half-baked tree.
- Idempotency is git-state-based (Step 5's `merge-base --is-ancestor` check) — do not change the bail trigger to comment-parsing, which is fragile to force-push and footer drift.

## Failure modes

- **Branch behind remote in non-trivial way** → bail at Step 4 with comment, don't merge.
- **Uncommitted work in worktree** → bail at Step 3 with comment, don't merge.
- **Idempotent skip: branch already contains current main** → Step 5 skip; post brief comment; per-item block reads `skipped-no-changes`. Not a failure.
- **Unresolvable git conflict** → `git merge --abort`, restore `plans/`, bail with comment listing the file and reason.
- **Tough-decision consult both no-confidence on a semantic-conflict resolution** → fall back to "preserve PR's intent, adapt PR's surface to main's new API." If even that's unclear, bail with comment.
- **`/review-fix-loop` regression detected** → don't push; reset to `PRE_MERGE_HEAD`, post comment with the regression details.
- **Tests failing after 5 fix attempts** → don't push; reset to `PRE_MERGE_HEAD`, post comment.
- **Fork without maintainer-edit** → bail with comment asking user to enable it.
- **Push rejected non-fast-forward** → re-fetch, merge the new remote commits into the merged state (never rebase — it drops the merge commit), retry once; conflicts or rejected again → bail.
- **Codex unavailable** → degrade to Claude-only consults. Flag once.
- **One per-PR stage-agent fails** → the others continue. Failed item's block reads `### PR #<N> — failed: <reason>`.
