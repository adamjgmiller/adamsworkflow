---
description: Autonomously review a PR through a fan-out of Opus + Codex sub-agents per lens, fix meaningful issues, promote to ready-for-review when clean — no human input mid-run
argument-hint: "[<pr-num> ...]"
---

Autonomously deep-review one or more PRs through a per-lens fan-out (Opus + Codex per lens), dedup against existing bot/human review comments, fix what's meaningfully fixable, and promote draft PRs to ready-for-review when the review converges clean. No stopping for human input — judgment calls land in the decision log and the PR comment.

Usage: `/pr-auto-review [<pr-num> [<pr-num>...]]`

Examples:
- `/pr-auto-review 45`
- `/pr-auto-review 45 46 47`
- `/pr-auto-review` (no args — use the PR for the current branch)

## Step 0 — Parse `$ARGUMENTS`

- **PR numbers** (optional): zero or more positive integers (dedupe repeats — two per-PR agents on the same PR would share one worktree).
- **No args** → resolve the PR for the current branch:
  ```bash
  gh pr view --json number,headRefName,baseRefName,isDraft,url,headRepositoryOwner,headRepository
  ```
  If this fails (no PR for the branch), bail with the error.
- State the parsed plan back in one line.

## Step 1 — Pre-flight

Hard blockers — bail with one clear error:

```bash
git rev-parse --git-dir >/dev/null
gh repo view --json nameWithOwner >/dev/null
for N in <prs>; do gh pr view "$N" --json number,title,state,isDraft,headRefName,baseRefName,url >/dev/null; done
```

Soft blockers — warn and continue:

- `command -v codex` fails → fan-out runs Opus-only per lens; `/review-fix-loop` degrades to Claude single-source. Note in the final report and the PR comment. Pass the result into each per-PR brief (Step 2) — the per-PR agents don't re-run this check.

## Step 2 — Dispatch

**Always spawn one `general-purpose` per-PR review-agent per PR — including when there's only one.** Even a single-PR run delegates: Steps 3–16 generate heavy intermediate volume (per-lens fan-out, fix loop, test runs) for a ~30-line report block, and a `general-purpose` sub-agent holds the `Agent` tool (Task fabric — it can spawn its own children; `~/.claude/docs/field-notes.md` §1), so the per-PR agent runs Step 7's fan-out and Step 9's fix loop itself. The main loop is a thin dispatcher from here: dispatch, wait, assemble (Step 17). Dispatch each per-PR agent with an explicit `model:` — default `opus` (conductor); escalate a given PR's agent to `fable` only when that PR may warrant a Fable lens in Step 7 (the per-lens ceiling is the per-PR agent's own tier, so an implicitly-Opus conductor can never grant one); never leave it to inheritance — an unpinned dispatch inherits the session model (auto-Fable on a Fable session).

Each per-PR agent's brief: *"Follow `~/.claude/commands/pr-auto-review.md` from Step 3 onward for PR #N. Anchor every Bash call to the worktree you set up in Step 3 (`cd` it first in each call, or `git -C`) — your cwd resets between calls (field-notes §2). You are a stage-agent: fan out Step 7's lens reviewers as your own children and run Step 9's fix loop inline. All side effects are yours — the Step 12 push, Step 13's `gh pr ready`, and the Step 14 comment with its `before=`/`after=` footer happen inside you, never in your dispatcher. Codex available: <yes|no> (the dispatcher's Step 1 check) — if no, skip the codex-runner children, run lenses Opus-only, and note the degradation in your Step 14 comment. When done, **`SendMessage` your Step 16 per-item report block to your dispatcher** as your final act — don't just finish and go idle. A backgrounded teammate's plain-text return is NOT auto-routed to the dispatcher, so a silent finish leaves the dispatcher having to ping you for the report it's waiting on."*

Keep the brief's SendMessage-final-act line — a named spawn is mailbox plumbing whose final plain-text turn is not reliably surfaced (field-notes §4). Step 7's unnamed lens children auto-deliver their results via completion task-notifications; a named per-PR teammate does not — the explicit SendMessage is its one reliable return channel.

**Concurrency cap: at most 4 per-PR agents at a time** (waves of 4, or dispatch the next as one returns). The cap is counted in PRs, but account for **within-PR fan-out**: the real concurrent-agent number is PRs × (lens children + codex-runner children) — at 4 PRs × ~4 lens pairs that's ~32 children on top of the 4 per-PR agents. Platform behavior past its comfort point is unverified (field-notes §6) — stay under budget: if 4 at a time proves tight in practice, drop to 3; trim the lens set before blowing past it.

No `Agent` tool in your own toolset (e.g. this file reached via a Workflow agent's Skill tool)? Then you can't spawn — run Steps 3–16 inline yourself, one PR at a time: Step 7's lens passes run sequentially in your own context with the Codex side as detached gotcha‑3 Bash launches (per codex-consult SKILL.md), and for Step 9, replace `/review-fix-loop` with one inline `/dual-review` pass handed the explicit scope `<PR_BASE_SHA>...<FANOUT_HEAD>` — the same frozen range Step 7 computes on this path too; without it dual-review's own ladder anchors at merge-base with `main`, wrong for a PR based elsewhere (its single path needs no `Agent` tool; expect the `concurrent single-process dual-source` label), then apply the meaningful findings (Step 9's criteria) yourself with minimal targeted edits **and commit them per the repo's commit convention** before Step 10 — `/review-fix-loop` itself has no `Agent`-less mode (every lane spawns). Capability is detected, never assumed.

Wait for all per-PR agents, then assemble the final report (Step 17). When you hold `Agent`, never run Steps 3–16 in the main loop.

The rest is the per-PR workflow — everything below runs inside the per-PR agent.

## Step 3 — Worktree setup

```bash
git worktree list --porcelain
```

Parse to find a worktree on the PR's **local ref** — `headRefName` for a same-repo PR, `pr-<N>` for a fork (the `LOCAL_REF` naming below; matching a fork by `headRefName` misses its worktree and the duplicate `worktree add` then fails). If found → `cd` there; **stash any uncommitted changes first** (the WIP paragraph below — a dirty tree would also make the sync's ff spuriously fail), then sync: set `PR_BRANCH` (= `headRefName`) and, for a fork, `FORK_REMOTE` (= `pr-<N>-fork`; the create path below defines both — the reuse path needs them too, for this fetch and Step 12's push), fetch the PR head (from `origin`, or `FORK_REMOTE`), then `git merge --ff-only FETCH_HEAD` — a reused worktree is stale by default, and Step 4 comparing a stale HEAD falsely bails past an author push. If the ff fails (unpushed prior-run commits), note it and use the fetched remote head as Step 4's comparand.

If not found, create a worktree under `.claude/worktrees/`. Never use `gh pr checkout` — it would check out in the main repo checkout, which is forbidden. Fetch via git directly:

```bash
PR_BRANCH=$(gh pr view <N> --json headRefName --jq .headRefName)
HEAD_OWNER=$(gh pr view <N> --json headRepositoryOwner --jq .headRepositoryOwner.login)
HEAD_REPO=$(gh pr view <N> --json headRepository --jq .headRepository.name)
DEFAULT_OWNER=$(gh repo view --json owner --jq .owner.login)
DEFAULT_REPO=$(gh repo view --json name --jq .name)

if [ "$HEAD_OWNER" = "$DEFAULT_OWNER" ] && [ "$HEAD_REPO" = "$DEFAULT_REPO" ]; then
  # Same-repo PR — fetch from origin into a local ref without checking out.
  # The fallback force-points the local ref at the fetched head: a stale local
  # branch would otherwise seed the new worktree. (-f is safe — the worktree
  # lookup above just confirmed no checkout holds this ref.)
  git fetch origin "${PR_BRANCH}:${PR_BRANCH}" 2>/dev/null \
    || { git fetch origin "$PR_BRANCH" && git branch -f "$PR_BRANCH" FETCH_HEAD; }
  LOCAL_REF="$PR_BRANCH"
else
  # Fork PR — add a per-PR remote and fetch.
  FORK_REMOTE="pr-${N}-fork"
  git remote add "$FORK_REMOTE" "https://github.com/${HEAD_OWNER}/${HEAD_REPO}.git" 2>/dev/null || true
  git fetch "$FORK_REMOTE" "$PR_BRANCH"
  LOCAL_REF="pr-${N}"
  git branch -f "$LOCAL_REF" "${FORK_REMOTE}/${PR_BRANCH}"   # -f: a stale pr-<N> from a removed worktree must not seed the new one
fi

# Anchor at the MAIN checkout root, not the current worktree: `git rev-parse
# --show-toplevel` would nest .claude/worktrees/ inside a worktree if this runs from
# one. `--git-common-dir` resolves to the shared <main>/.git from anywhere; its
# parent is the main root. (--path-format=absolute needs git >= 2.31.)
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$GIT_COMMON")
SLUG="${LOCAL_REF//\//-}"                           # slashes → dashes for the dir name
WORKTREE="${REPO_ROOT}/.claude/worktrees/${SLUG}"
SUFFIX=""; i=2
while [ -e "${WORKTREE}${SUFFIX}" ]; do SUFFIX="-${i}"; i=$((i+1)); done
WORKTREE="${WORKTREE}${SUFFIX}"

# .claude/worktrees/ is git-excluded by Claude's native worktree feature; add the
# exclude here too so this Bash-created worktree never shows in `git status`.
# Leading \n guards an exclude file that lacks a trailing newline.
grep -qxF '**/.claude/worktrees/' "${GIT_COMMON}/info/exclude" 2>/dev/null \
  || printf '\n**/.claude/worktrees/\n' >> "${GIT_COMMON}/info/exclude"

# Serialize the add across Step 2's up-to-4 concurrent per-PR agents: simultaneous
# `git worktree add` against one shared .git can race on its internal locks (the same
# reason ship-issues scaffolds worktrees serially). flock makes it mutually exclusive;
# the fallback keeps it working where flock isn't installed (e.g. macOS). This command
# and /auto-merge-main (whose Step 3 reuses this snippet) need it — ship-issues
# creates worktrees serially by design.
if command -v flock >/dev/null 2>&1; then
  flock "${GIT_COMMON}/claude-worktree-add.lock" git worktree add "$WORKTREE" "$LOCAL_REF"
else
  git worktree add "$WORKTREE" "$LOCAL_REF"
fi
cd "$WORKTREE"
# Belt-and-suspenders .env symlink so tests / the app see real secrets. (If your
# setup installs a post-checkout githook that symlinks .env on `git worktree add`,
# this inline copy just covers the window before that hook exists.) Don't clobber
# a real .env — only link if absent or already a symlink.
if [ -e "${REPO_ROOT}/.env" ] && { [ -L "${WORKTREE}/.env" ] || [ ! -e "${WORKTREE}/.env" ]; }; then
  ln -sfn "${REPO_ROOT}/.env" "${WORKTREE}/.env"
fi
```

Remember `LOCAL_REF` and (for fork) `FORK_REMOTE` — push in Step 12 needs them.

Hold `WORKTREE` as an absolute path and anchor **every** subsequent git/test command in Steps 4–14 to it — `cd "$WORKTREE"` at the start of each Bash call, or `git -C "$WORKTREE"`. The snippet above ends in a `cd`, but cwd resets between Bash calls; an unanchored later call silently targets the session-default checkout (field-notes §2).

If the (reused) worktree has uncommitted changes, **respect them** — presumably the user's in-flight work. Record the dirty set in the decision log, then **stash it for the run, before the sync above** (`git -C "$WORKTREE" stash push --include-untracked -m "pr-auto-review #<N>: user WIP"`): reviewers' contextual reads, tests, and commits all want the clean PR state, and the fix loop's checkpoint would otherwise sweep the WIP into commits Step 12 pushes. Restore as the run's **last worktree act — immediately after Step 12 (so the outcome is known before the Step 14 comment), and on every earlier exit, including a Step 4 bail** — popping **this run's entry by its message** from `git stash list`, with `--index` (preserves the staged/unstaged split): the stash stack is shared across linked worktrees, so a blind `git stash pop` under concurrent per-PR agents can grab a sibling's WIP. If the pop conflicts with the run's fixes, leave the stash in place and flag it in the Step 14 comment and Step 16 Notes — never force-resolve user work.

Never check out the PR's branch in the main repo checkout.

## Step 4 — Idempotency check (skip if nothing has changed since the last run *started*)

This command is expensive (per-lens fan-out, multiple Opus + Codex calls, /review-fix-loop). Re-running against a PR where literally nothing has happened since the last run started wastes the budget. Detect that and bail with a brief note.

**The bail rule, in one sentence**: skip iff the PR's HEAD right now is the same SHA as the HEAD right *before* the last /pr-auto-review run started — or differs from it only by `plans/` commits (every completed run pushes a `plans/<branch>.md` append, Steps 11–12, so even a no-code-change run moves HEAD by one metadata commit).

**What this means in practice**:

- ✅ **Proceed** when the author has pushed new commits (obviously).
- ✅ **Proceed** when the PRIOR /pr-auto-review run itself pushed productive fixes (code beyond its plans append). Those fixes deserve a fresh independent re-review — the prior run's internal /review-fix-loop saw them as it made them, but a new /pr-auto-review invocation brings a fresh fan-out, fresh lens choice, and independent eyes on the post-fix state. If you didn't want that, you wouldn't be re-invoking the command.
- ✅ **Proceed** on the first-ever run (no prior /pr-auto-review comment to compare against).
- ❌ **Bail** when nothing reviewable has happened since the prior run started: HEAD is literally identical, or the only delta is that run's own `plans/<branch>.md` append (every completed run pushes one, so bare HEAD-equality would never fire against a run of this version). A re-run would produce identical review output.

```bash
# Capture HEAD at the very start of this run — this is the "before" SHA we'll commit to the footer if we proceed, and the SHA we compare against the prior run's "before".
# Step 3's reuse-path sync makes local HEAD the PR's real head; if that sync couldn't
# fast-forward, use the fetched remote head OID here instead — BEFORE_SHA must reflect
# what the PR actually points at, not a stale checkout.
BEFORE_SHA=$(git rev-parse --short HEAD)

# Find the most recent /pr-auto-review comment on this PR and parse its `before=` SHA from the footer.
# Footer format (this version):
#   *Generated by `/pr-auto-review <N>` via Claude Code @ before=<sha> after=<sha>.*
LAST_BEFORE_SHA=$(gh api "repos/:owner/:repo/issues/<N>/comments" --paginate \
  --jq '[.[] | select(.body | test("Generated by `/pr-auto-review .*` via Claude Code @ before="))]
        | sort_by(.created_at) | last | .body' \
  | grep -oE 'before=[0-9a-f]+' | head -1 | sed 's/before=//')
```

Four cases:

1. **`LAST_BEFORE_SHA` empty** → no prior new-format /pr-auto-review comment found (either no prior run at all, or only old-format comments without the `before=` label — see backwards-compat note below). Proceed to Step 5.
2. **`BEFORE_SHA == LAST_BEFORE_SHA`** → nothing has happened since the prior run started. **Bail.**
3. **`BEFORE_SHA != LAST_BEFORE_SHA`, but the delta is plans-only** → the only movement since the prior run started is that run's own `plans/<branch>.md` append (Steps 11–12) — nothing reviewable changed. **Bail.** The check (run it whenever case 2 didn't fire and `LAST_BEFORE_SHA` is non-empty):

   ```bash
   # Plans-only delta? Guard first: the prior before= SHA may no longer exist locally
   # (force-push rewrote history) — then it is NOT plans-only; fall through to case 4.
   # Diff to $BEFORE_SHA, not HEAD: on the ff-fail reuse path BEFORE_SHA is the fetched
   # remote head — diffing to stale local HEAD would bail right past an author push.
   if git cat-file -e "${LAST_BEFORE_SHA}^{commit}" 2>/dev/null \
      && [ -z "$(git diff --name-only "$LAST_BEFORE_SHA" "$BEFORE_SHA" -- . ':!plans/')" ]; then
     echo "plans-only delta since ${LAST_BEFORE_SHA} — bail (case 3)"
   fi
   ```

4. **`BEFORE_SHA != LAST_BEFORE_SHA`** otherwise → something changed (author push, merge-main push, prior-run fix push, force-push). Proceed to Step 5 with a fresh review.

For either bail case (#2 or #3): restore any Step 3 stash first (its every-exit rule — a pop conflict gets a line in the comment), then post the comment below and return the skip block:

```bash
gh pr comment <N> --body "$(cat <<EOF
## /pr-auto-review

**Skipped**: nothing reviewable has changed in this PR since the last /pr-auto-review run started (HEAD is at \`$BEFORE_SHA\`; any delta from \`$LAST_BEFORE_SHA\` touches only \`plans/\` — the prior run's own record append). A fresh review would produce identical output.

If you want to force a re-run (e.g., the lens set needs to expand or you suspect the last run missed something), push a \`--allow-empty\` commit, then re-invoke.

---
*Generated by \`/pr-auto-review <N>\` via Claude Code @ before=$BEFORE_SHA after=$BEFORE_SHA.*
EOF
)"
```

(In the bail cases, `before` and `after` are the same — no work was done, and a bail commits no plans append. The bail comment's own `before=` becomes the newest reference, so the *next* run bails via the cheap case-2 equality.)

Return the skip per-item block (Step 16 covers the format).

**Backwards compatibility**: prior versions emitted the footer as `@ <short-sha>` without `before=`/`after=` labels. The parser above explicitly looks for `before=` to distinguish, so old-format comments are silently treated as "no prior new-format run" → proceed. That's safe: it never bails based on an unparseable old-format SHA, and the new run produces a new-format comment that subsequent runs can parse.

**Force-push caveat**: if the branch was force-pushed *to the exact same SHA* the prior run started from (mathematically possible via a rebase that produces an identical tree), the idempotency check still bails. That's correct: identical HEAD content → no new review needed.

## Step 5 — Understand the PR

```bash
gh pr view <N> --json number,title,body,author,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,labels,url,comments,reviews,statusCheckRollup
gh pr diff <N>                                              # orientation only — reviewers and ground truth use Step 7's frozen range
```

Read the title, body, and labels — these state the PR's *intent*. The fan-out will measure work against that intent (goal-fit lens).

Determine fork status:

```bash
gh pr view <N> --json headRepositoryOwner,headRepository,maintainerCanModify
```

- Same-owner branch → push works normally.
- Fork PR with `maintainerCanModify: true` → push works against the local ref from Step 3.
- Fork PR with `maintainerCanModify: false` → cannot push fixes; will comment with patches in Step 12.

## Step 6 — Scrape existing review signal

**External PR bot (optional).** An optional external PR review bot can be folded in here if your repos use one: trigger it first (unless the PR already carries the bot's review for the current head SHA), scrape *existing* signal now, and re-check for the bot's fresh output once Step 7's fan-out returns (fold late arrivals into Step 8's dedup). Never block on it — if nothing has landed by dedup time, proceed and note it under Sources scraped in the Step 14 comment. No bot on your repos → just scrape existing signal below.

```bash
gh api "repos/:owner/:repo/pulls/<N>/comments" --paginate   # inline review comments
gh api "repos/:owner/:repo/issues/<N>/comments" --paginate  # PR-level conversation comments
gh pr view <N> --json reviews                                # review submissions (bots, humans, etc.)
```

Collect findings from:

- **Known bots**: Codecov, GitHub Advanced Security (`github-advanced-security`), Sourcery, Snyk, and whatever review bot your repos actually run — pattern-match on author login. (Never expect or wait for a bot your repos don't use.)
- **Human reviewers**: unresolved inline comments and review submissions marked `CHANGES_REQUESTED` or with substantive findings.
- **Skip resolved threads** (`gh api .../pulls/N/comments` returns `in_reply_to_id` / `state`; treat resolved threads as already addressed).
- **Skip prior `/pr-auto-review` comments** — those are the agent's own output, not new findings (Step 4's idempotency check already handled "is there anything new since last run").

Each scraped finding becomes a candidate issue with `source: <reviewer-login>` attribution. These feed Step 8's dedup.

## Step 7 — Fan out per-lens reviewers

The agent picks the lens set per-PR based on what the diff actually touches. Starting menu (agent decides; not a hard list):

- **Always reasonable**: blast-radius (upstream callers, downstream consumers, parallel paths), security, goal-fit (does the change accomplish its stated objective and nothing else), completeness (edge cases, partial implementations, missing error handling), tests (coverage, test quality, asserting the right thing), docs (comment accuracy, README/docstring updates, stale references).
- **Conditional on content**: UI/UX (when `.tsx`/`.jsx`/`.svelte`/`.vue`/`.css` etc. touched), perf (hot paths, benchmarks, large data structures, N+1 patterns), migrations / data integrity (`.sql`, migrations dirs, schema files), breaking changes (public API, exported symbols, config schema), concurrency (locks, async, atomic ops, shared state).
- **PR-specific**: whatever else makes sense — agent's judgment. Sometimes the PR is weird and needs an unusual lens.

For each chosen lens, spawn **paired Opus + Codex review sub-agents in parallel**:

**Opus lens reviewer** (`general-purpose`, one per lens — per-lens model per the model-selection policy: `opus` default, `fable` only for a lens passing the policy's escalation test, decided per-lens, never above your tier):

> You are reviewing PR #<N> ("<title>") through the **<lens-name>** lens specifically. Don't try to be comprehensive across all concerns — stay focused on the lens.
>
> Lens definition: <one-paragraph what to look for>
>
> The diff: `git -C <WORKTREE> diff <PR_BASE_SHA>...<FANOUT_HEAD>` (run it yourself — this exact range; don't run `gh pr diff`, which reads the live remote and can drift mid-run).
> The PR body and intent: <embed body>
>
> Use the prescribed findings format:
>
>     N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
>        Location: <file>:<line>  (or "cross-cutting")
>        Finding: <2-4 sentences explaining the issue and why it matters through THIS lens>
>        Suggestion: <concrete fix, or "needs human judgment">
>
> After the numbered list, a "Notes" section. If nothing's worth flagging through this lens, say so explicitly.
>
> You are a leaf: do not spawn sub-agents of your own and do not contact the user — return only your findings.
>
> **Read-only on the shared worktree** — every lens reviewer (and the Codex children) reads this same checkout concurrently, and the fix loop runs right after you. Never edit, create, or delete files, never run git commands that mutate state (`add`/`commit`/`checkout`/`restore`/`stash`/`clean`/`reset`), and never perform mutation testing here. Running the test suite as-is is fine — if you want to know whether the tests would catch a mutation, reason about it statically and report it as a finding; don't run the experiment.

**Codex lens reviewer** — dispatch the named **`codex-runner`** agent, one per lens. Its definition (`~/.claude/agents/codex-runner.md`) carries the full runner contract — follow codex-consult SKILL.md gotchas 1–4, run `review` mode, never skip, never fall back to its own review, return the `JOB_ID` + sentinel `exit=N` + findings verbatim — so the dispatch prompt supplies only the variables: the `<PR_BASE_SHA>...<FANOUT_HEAD>` scope, the `<WORKTREE>` to run in (`cd` there before launching `codex exec` — Codex's contextual file reads must hit the PR tree, not the session-default checkout), the lens constraint, and — for the **goal-fit** lens — the same PR intent the Opus brief embeds (Codex can't infer the authoritative goal; the def folds supplied context into the Codex prompt verbatim). Each lens still gets its own `JOB_ID`. If the agent type is unknown ("Agent type not found" — stale session registry; defs load at session start), dispatch a `general-purpose` child briefed to read and follow the def file as its full contract, plus the same variables — and pin that child `model: sonnet` (Codex-driver; the def's frontmatter pin does NOT transfer when the def is merely read as prose).

Capture the pre-fan-out baseline first — `FANOUT_HEAD=$(git -C "$WORKTREE" rev-parse HEAD)`; refresh the base (`git -C "$WORKTREE" fetch origin "<baseRefName>"` — a stale `origin/<baseRefName>` folds upstream commits the PR already merged into the range as if they were PR content), then `PR_BASE_SHA=$(git -C "$WORKTREE" merge-base HEAD "origin/<baseRefName>")`; plus the current dirty set (`git -C "$WORKTREE" status --porcelain` — normally empty after Step 3's stash). Every reviewer gets the **one immutable range** `<PR_BASE_SHA>...<FANOUT_HEAD>` — don't brief leaves with live `gh pr diff`, which re-reads the remote per leaf and drifts if the author pushes mid-run. Then launch all lens reviewers in parallel: single message with all the Agent calls (one Opus + one codex-runner per lens). Dispatches are async (async-only at depth — field-notes §4): each Agent call returns a launch handle immediately, and each child's findings arrive as a task-notification carrying its final text — attached to your next tool result, or re-waking you if you've ended your turn. Count the dispatches (2 × |lenses|; |lenses| when Codex is unavailable and only Opus children launched) and reconcile arrivals against that count before Step 8 — join only when every lens pair has reported; the risk is joining on partial results or double-dispatching a slow lens, not stalling. Slot math: routing Codex through codex-runner children turns what used to be slot-free detached Bash launches into real agent slots — 2 × |lenses| concurrent children for this PR — which is exactly the within-PR fan-out Step 2's cap budgets for.

**Worktree-integrity check (defense in depth — the lens reviewers are briefed read-only, but verify rather than trust).** Once the fan-out returns, diff against the baseline captured at launch (`FANOUT_HEAD` + the Step 3 dirty set): porcelain shows nothing beyond the captured Step 3 set, and HEAD still equals `FANOUT_HEAD`. If a reviewer leaked edits, restore **only paths that were clean at baseline** (`git restore <those-paths>` — never a path in the captured user-dirty set); if HEAD moved, `git reset --soft "$FANOUT_HEAD"` and review the now-staged stray diff, discarding only baseline-clean paths. If a stray edit lands in a file the user already had dirty (can't be cleanly separated), **stop and flag it in the decision log rather than force a restore** — losing the user's in-flight work is worse than a dirty review. Record any restoration before the fix loop runs; a dirty tree carried into Step 9 would sweep stray edits into the fix commit.

## Step 8 — Dedup + validate

Combine everything (per-lens findings + scraped review signal):

1. **Read the actual diff** — `git -C "$WORKTREE" diff <PR_BASE_SHA>...<FANOUT_HEAD>` — as ground truth (the same immutable range every reviewer saw; live `gh pr diff` may have moved since).
2. **Dedup by `(file, ~line, topic)`** — same definition as `/review-fix-loop` Step 1. Findings from multiple sources on the same issue merge with attribution: `(flagged by: opus[security], codex[security], @<bot>)`.
3. **Validate each finding** — confirm the citation is real and the issue is **caused by the scoped diff**. A blast-radius finding may legitimately cite an unchanged caller or consumer the diff breaks — validate those against the checkout rather than dropping them for being outside the diff. Drop or downgrade hallucinations. (Bot comments hallucinate too — same rule applies.)
4. **Surface divergence** — if Opus[lens] and Codex[lens] gave contradictory takes on the same line (one "fine", one "broken"), note it. Divergent findings are highest-value flags for review.

Output: a deduped, validated, attributed findings list, sorted by severity then by file.

## Step 9 — Fix meaningful issues

Determine what's **meaningful** to fix:

- All `critical` / `high` — always.
- `medium` / `low` / `nit` — fix if low-effort + low-risk.
- Anything ambiguous (don't know if it's a real issue, fix is risky, scope expansion) → don't fix; document in the PR comment.

If the meaningful set is empty → skip to Step 10 (test pre-check), then Steps 11–14 (plans append, push, promote check, post comment). The push still happens — it carries the plans commit; with no fix commits, `FIX_SHA == FANOUT_HEAD` records the no-code-change state (`== BEFORE_SHA` too on the normal path), and the next run bails via Step 4's plans-only case.

Otherwise, run `/review-fix-loop /dual-review` to apply fixes — **inline, in your own context**: read and execute `~/.claude/commands/review-fix-loop.md` yourself (the proven follow-the-file pattern), don't dispatch it as a sub-agent. Inline invocation collapses a depth level (Agent dispatch = +1, inline command = +0; field-notes §5), so the composed chain stays at `main(0) → per-PR agent(1) → fix-loop's 2a review sub-agent(2)` — 2 levels (dual-review spawns no codex child; its Codex side runs as detached Bash inside the review sub-agent). Dispatching the loop as its own sub-agent would push the chain to 3 — avoid that unless your own context is critically tight. Brief: pass the deduped, validated findings list as the loop's **Seed findings** (its Step 0 input) — round 1 buckets your list directly instead of dispatching a redundant review — plus an explicit scope, **`scope <PR_BASE_SHA>`**: rounds 2+ then review the PR's actual range, where the loop's own clean-tree fallback would anchor at merge-base with `main` (wrong for a PR based elsewhere). Trust the loop's internal convergence (max-rounds=5, hard ceiling 10).

(`/review-fix-loop` itself runs its own review-and-fix rounds. The Step 7 fan-out + Step 8 dedup were our broader-coverage pass; `/review-fix-loop` handles the convergence/regression dynamics from here.)

Capture its final report: rounds, fixes applied, decisions made (with consult outcome), escalations to USER_PENDING.

## Step 10 — Detect + run tests (loop fix up to 5 attempts)

Detect the project's test command:

- `package.json` → `npm test` / `pnpm test` / `yarn test` (whichever matches the lockfile)
- `pyproject.toml` with pytest config → `pytest`
- `Cargo.toml` → `cargo test`
- `go.mod` → `go test ./...`
- `Makefile` with `test:` target → `make test`
- `.tool-versions` or `mise.toml` hints → respect them

If no test command is detectable → skip this step, note that no tests ran.

**Hold the verify's result before moving on.** Run the suite foreground when it fits the ~10-min Bash ceiling; background a longer run and await its completion notification — it re-wakes you with the output (field-notes §4). Never proceed with the run pending. Same for every re-run in the fix loop below.

If tests fail, attempt to fix (sub-agent with the failure output as brief: "All commands run from `<worktree>` — `cd <worktree>` at the start of every Bash call; your cwd does not persist between calls. Fix these failing tests, minimal edits, do not weaken the assertions; never return with a test run still pending — hold each run's result before acting (field-notes §4)"). Re-run. Loop up to **5 attempts**. If a test-fix edit touches production code (not just tests), give those edits one inline `/quick-review` pass before committing and fix anything critical/high it flags — test-fix commits land after the fix loop converged, so nothing else reviews them. If that pass changed anything further — production code *or* tests/test config — rerun the test command once: Step 13 promotes on the final tree's test result, never an earlier pass's. **Commit any test-fix edits before Step 11 — uncommitted edits do not push, and Step 11's `FIX_SHA` must include them** (commit the fix sub-agent's reported edits **plus** any edits made resolving the quick-review pass's critical/high findings — nothing else; user in-flight work, if any, sits in the Step 3 stash until after the push). After 5: push anyway with a note — CI is the final gate.

## Step 11 — Append `plans/<branch>.md` (always; committed BEFORE the push)

Per the global CLAUDE.md worktree-plans convention. Always create-or-append `plans/<branch>.md` (even for human-authored PRs, fork PRs, etc.). If the file doesn't exist, create the umbrella scaffold (frontmatter + Goal + Decisions section).

Capture the post-fix HEAD first — the plans section records it as its After SHA, and Step 12's fork fallback ends its patch range at it. (The section can't record the SHA of the plans commit itself — that commit doesn't exist until after the file is written; the plans append sits deliberately outside the recorded bracket.)

```bash
FIX_SHA=$(git rev-parse --short HEAD)
```

Append a dated section:

```markdown
## /pr-auto-review run, <YYYY-MM-DD>

**Before SHA**: `<BEFORE_SHA>` (the PR head this run started from — local HEAD except on the ff-fail reuse path)
**After SHA**: `<FIX_SHA>` (HEAD after any fix/test-fix commits, before this plans append; same as `FANOUT_HEAD` if no fixes)
**Lenses run**: <list>
**Sources scraped**: <list of reviewer logins>
**Findings**: <count> (after dedup + validation)
**Fixed**: <count>
**Not fixed**: <count> (with rationale per item)
**Tests**: <ran|skipped|failing after 5 attempts>
**Promotion**: <eligible — Step 13 executes after the push | blocked: <reason>> (assessed pre-push; the PR comment records the actual outcome)

### Meaningful decisions
- <bullet per decision flagged meaningful, with rationale and consult outcome>
```

Commit the plans file update. **The ordering is load-bearing**: this commit exists before Step 12's push, so the one push carries fixes + plans together and the run's record reaches the PR (plans docs merge with the branch and appear in PR diffs — the global CLAUDE.md plans convention). Committing plans after the push would strand the record in the local worktree — and the stranded commit would then poison Step 4's next-run HEAD comparison.

For fork PRs without maintainer-edit, Step 12's push will fail and the plans commit stays local-only. Still write it — local audit trail; Step 12's patch fallback deliberately excludes it.

## Step 12 — Push (or comment with patches if fork)

```bash
# Same-repo PR:
git -C "$WORKTREE" push origin "HEAD:${PR_BRANCH}"
# Fork PR (maintainerCanModify) — push to the FORK, naming its branch explicitly:
git -C "$WORKTREE" push "$FORK_REMOTE" "HEAD:${PR_BRANCH}"
```

Always name remote and refspec. A bare `git push` from the fork's local `pr-<N>` branch would (under `push.default=current` / `autoSetupRemote`) create a junk `origin/pr-<N>` branch and "succeed" without ever updating the PR — a silent wrong-destination push that the rest of the run then reports as a success.

Failure handling:

- **Permission denied (fork without maintainer-edit)** → don't retry. Collect the fix commits' diffs (`git format-patch $FANOUT_HEAD..$FIX_SHA --stdout` — `FANOUT_HEAD`, not `BEFORE_SHA`: on the ff-fail reuse path `BEFORE_SHA` is the remote head, and a range from it would re-post a prior run's stranded fixes and plans commit; ending at `FIX_SHA` keeps this run's plans commit out of the patches) and prepare them for inclusion in the PR comment (Step 14). Mark the PR as `couldNotPush: true` in the report block.
- **Push rejected (non-fast-forward)** → the PR branch moved underneath us (author or another tool pushed). Re-fetch from the push remote (`git -C "$WORKTREE" fetch origin "$PR_BRANCH"`, or `"$FORK_REMOTE"` for a fork), examine the divergence. If trivial (rebase onto theirs), do it and retry push — **and leave the PR draft** (Step 13): the rebased combination is code no lens or test run examined. (The plans entry's recorded SHAs predate the rebase — leave them; the footer's `after=` reflects the actually-pushed head.) If non-trivial → bail on the push, note in the comment with rationale.

Capture the final HEAD on **every** path — success, fork patches-in-comment fallback, or non-ff bail (the Step 14 footer needs it):

```bash
AFTER_SHA=$(git rev-parse --short HEAD)
```

`AFTER_SHA` is the `after` half of the footer (Step 14) — the final HEAD this run produced (the pushed HEAD when the push succeeded; on the fork-patches or non-ff-bail paths it's local-only — say so in the comment rather than implying it was pushed), plans commit included, so it always sits at least one commit past `FANOUT_HEAD` (and past `BEFORE_SHA` on the normal path — on the ff-fail reuse path `BEFORE_SHA` is the remote head and serves *only* the idempotency compare and the footer; every local-range use anchors on `FANOUT_HEAD`). "This run changed no code" is signaled by the plans record's `FIX_SHA == FANOUT_HEAD`, not by `after == before`; convergence to the cheap skip comes from Step 4's plans-only case, not from HEAD standing still. The `before` half is `BEFORE_SHA` from Step 4, still in scope — the next run's idempotency check parses it, and capturing `before` as "where we started, not where we ended" remains the load-bearing semantic.

## Step 13 — Promote to ready (if clean)

Conditions for promoting `gh pr ready <N>` (ALL must hold):

- PR was opened as draft.
- `/review-fix-loop` converged (stop reason `convergence`, not `max-rounds` / `steady-state` / `regression`) — or Step 9 skipped the loop for an empty meaningful set, which counts as converged. On the Step 2 **Agent-less path** with meaningful fixes applied, this condition is unsatisfiable by design: **leave draft**, reason *"fixes applied without a convergence loop (Agent-less context)"* — its empty-set case still promotes via the skip-counts-as-converged mapping.
- No `USER_PENDING` escalations from the loop.
- No non-fast-forward rebase in Step 12 — a rebase-retry produced a combined state no lens or test run examined; leave draft with that note.
- No **risk-ambiguous** `Not fixed` items — Step 9's "don't know if it's a real issue / fix is risky / scope-expansion" bucket leaves the PR draft. **Deliberate, documented out-of-scope scope decisions do NOT block promotion**: a tight PR routinely records consult-grade non-fixes in the Step 14 comment, and those are fine to promote over — only the risk-ambiguous bucket gates `ready`.
- Tests: passed, OR no test command detected (skipped). **Failing tests after fix attempts → leave draft.**
- Push succeeded (fork-without-maintainer-edit → leave draft; patches in comment).

If all conditions met:

```bash
gh pr ready <N>
```

Otherwise leave as draft.

## Step 14 — Post PR comment

```bash
gh pr comment <N> --body "$(cat <<EOF
## /pr-auto-review

**Outcome**: <No issues found | Issues found and fixed | Issues found, some fixed and some left | Failed to push fixes (fork without maintainer-edit)>

### Lenses run
<list>

### Sources scraped
<list of reviewer logins (bots, humans) and counts of findings from each>

### Issues fixed (<count>)
- <file:line> — <one-line summary> — originally flagged by <attribution>

### Issues left unfixed (<count>) [omit section if zero]
- <file:line> — <one-line summary> — **why not fixed**: <rationale>

### Meaningful decisions made (<count>) [omit if zero]
- <decision> — <rationale> — consult outcome: <converged | resolved-divergence | single-source> (the `/review-fix-loop` vocab; Step 15 protocol decisions use its own tiebreaker labels)

### Tests
<ran (passed) | ran (failed N times after fix attempts) | skipped (no test command detected)>

### PR status
<promoted to ready-for-review | left as draft because: <reason>>

### Patches [only for fork-without-maintainer-edit cases]

The agent could not push fixes to your fork. Apply with:

\`\`\`
git apply <<'PATCH'
<git format-patch output>
PATCH
\`\`\`

(or paste the diff into a new commit yourself).

---
*Generated by \`/pr-auto-review <N>\` via Claude Code @ before=$BEFORE_SHA after=$AFTER_SHA.*
EOF
)"
```

The `@ before=<sha> after=<sha>` footer is **load-bearing** — Step 4's idempotency check on the next run parses the `before=<sha>` value. Specifically:

- The next run's bail rule = "skip iff next run's pre-review HEAD equals THIS run's `before=` SHA."
- `after != before` always holds — every run pushes at least its plans commit. The next run sees `next-HEAD = this-after ≠ this-before` → falls through to Step 4's plans-only check: fix pushes fail it (code changed → fresh re-review, the intended semantic), a plans-only delta passes it (bail).
- Don't omit either label. Don't put any other `before=<hex>` or `after=<hex>` token in the body that could confuse the parser. Don't reformat the footer without updating Step 4's regex.
- The comment — footer included — is posted here, by the per-PR agent: the agent that pushed and still holds both SHAs in scope. Never bubble the footer up for the dispatcher to post; a dispatcher-assembled footer decouples the SHAs from the worktree that produced them.

(The unquoted `EOF` here is load-bearing on two coupled counts: it lets `$BEFORE_SHA` / `$AFTER_SHA` expand, and it makes the backslash-escaped backticks render as literal Markdown backticks. **Do not convert this heredoc to a quoted `<<'EOF'`** — a quoted delimiter suppresses expansion (the footer would read a literal `before=$BEFORE_SHA`) *and* stops backslash processing (each escaped backtick keeps its leading backslash), corrupting the `before=`/`after=` footer that Step 4's idempotency parser matches on. The escaping is heredoc-quoting-dependent — it works only with the unquoted delimiter.)

## Step 15 — Tough-decision protocol (reference)

Anywhere the agent faces a judgment call it would have stopped to ask about (which fixes are "meaningful," whether a divergence is a real bug, fork push fallback ambiguity, lens-coverage gaps), use this protocol:

1. Frame the decision.
2. Fan out an opinion leaf (`model: opus`/`fable` per the model-selection policy) + a Codex `ask` driver leaf (`model: sonnet`) in parallel.
3. Synthesize with the `review-fix-loop.md` Lane 2 tiebreakers (reversibility → behavior preservation → blast radius → confidence → least action → first option in framing). (The confidence / least-action / first-option extensions are a deliberate divergence from Lane 2's terminal rule, as in auto-merge-main Step 10: Lane 2 escalates true ties to the user via its report; this protocol runs unattended, so ties resolve to the leave-as-is / no-op option when one is present, else the first option in the framing — and get logged.)
4. Log in `plans/<branch>.md` Decisions section; surface meaningful ones in the PR comment.
5. Proceed.

Never bail to the user mid-run.

Keep-interactive rule: anything AskUserQuestion-driven or live-context stays on the main loop — and Steps 3–16 deliberately contain no such step, which is what makes the per-PR delegation safe. A per-PR agent (like any dispatched sub-agent) carries no AskUserQuestion tool at all; if it hits a question only the human can answer — beyond what this protocol resolves — it doesn't improvise: it returns the pending question as **data** (in its report block's Notes), and the main loop surfaces it after the run (e.g. via `/askme`).

## Step 16 — Per-item report block

Return — this block is the per-PR agent's entire return to the dispatcher:

```markdown
### PR #<N> — <title>
**URL**: <url>  **Status**: <ready | draft | skipped-no-changes>  **Author**: <login> (<owned | fork>)
**Before/After SHA**: `<BEFORE_SHA>` → `<AFTER_SHA>`

**Lenses**: <list>
**Findings** (after dedup): <count>
**Fixed**: <count>
**Review loop**: <rounds> rounds, stop reason <convergence | steady-state | regression | max-rounds | skipped — no meaningful findings>
**Unfixed**: <count> (<rationale buckets>)
**Tests**: <status>
**Push**: <succeeded | comment-with-patches | failed: <reason>>
**Promoted**: <yes | no — <reason>>

**Meaningful decisions** (<count>):
- <bullet per decision with one-line rationale>

**Notes**:
- <Codex unavailable | divergence patterns | pending user-questions returned as data (Step 15) | etc., if applicable>
```

For the **skipped-no-changes** case (either Step 4 bail), use this trimmed block:

```markdown
### PR #<N> — <title>
**URL**: <url>  **Status**: skipped-no-changes
**HEAD**: `<BEFORE_SHA>` (no reviewable change since the prior run started — same SHA, or a plans/-only delta)

Nothing reviewable has changed since the prior /pr-auto-review run started. No work performed.

**Notes** (only if applicable): <stash-restore conflict or other worktree anomaly — omit the line when clean>
```

## Step 17 — Final report (dispatcher)

Assemble the per-item blocks (for a single PR, that's the one block). Push notification:

```
/pr-auto-review done — <P> promoted, <D> left draft, <S> skipped (no changes), <F> failed.
```

## Hard rules

- Never close a PR. Never force-push. Never delete branches.
- The Step 2 concurrency cap (4 per-PR agents at a time) is non-negotiable — within-PR fan-out multiplies it. Never dispatch all N at once.
- Side effects stay inside the per-PR agent: the Step 12 push, Step 13 `gh pr ready`, and Step 14 comment (footer included) are executed by the agent that owns the worktree — never bubbled up to the dispatcher.
- Never promote a PR to ready if `/review-fix-loop` didn't converge clean — leave it draft with a clear reason.
- Never bail to the user mid-run. Tough decisions → Step 15 protocol. (Skip-on-idempotency in Step 4 is not a bail — it's a no-op + brief comment.)
- For fork PRs without maintainer-edit, never attempt to push to the user's repo as a workaround — patches go in the comment.
- Respect existing uncommitted work in the worktree (the user may have local changes in flight).
- The footer's `@ before=<sha> after=<sha>` labels are part of the contract with Step 4's idempotency check. Don't reformat without updating Step 4's regex. Specifically: the `before=` SHA reflects HEAD *when the run started*, not where it ended — that's what makes "the prior run's own fixes count as new content worth re-reviewing" work; Step 4's plans-only case is what keeps the always-pushed plans commit (Steps 11–12) from defeating the skip.

## Failure modes

- **PR doesn't exist or no access** → bail at Step 1.
- **Worktree fetch fails (fork URL invalid, network)** → bail at Step 3 with the error.
- **Worktree already exists with branch checked out elsewhere** → reuse, respect uncommitted work.
- **Idempotency: nothing reviewable changed since prior run started** → Step 4 skip (same SHA, or plans-only delta); post brief comment; per-item block reads `skipped-no-changes`. Not a failure. (The prior run's own fix-pushes do *not* trigger this skip — they're treated as new content for the fresh re-review; its plans-only append *does*.)
- **Idempotency: prior comment exists but `before=` SHA can't be parsed** (old-format footer, hand-edited, regex didn't match) → treat as no prior run; proceed with fresh review.
- **`/review-fix-loop` stops at max-rounds with escalations** → push fixes that were applied, leave PR draft, escalations surface in comment.
- **Tests failing after 5 fix attempts** → push anyway, don't promote, note in comment.
- **Push rejected (fork without maintainer-edit)** → patches in comment, don't promote.
- **Push rejected (non-fast-forward)** → try once to rebase onto remote; if non-trivial, bail with note in comment.
- **Stash pop conflicts after the push** (user WIP vs the run's fixes) → leave the stash in place, flag it in the Step 14 comment and Step 16 Notes — never force-resolve user work.
- **Codex unavailable** → skip the codex-runner children; lenses run Opus-only; `/review-fix-loop` degrades to single-source. Flag once.
- **One per-PR agent fails** → the others continue. The failed item's block (assembled by the dispatcher) reads `### PR #<N> — failed: <reason>`.
