---
description: Research, plan, and carefully merge all outstanding PRs for the current project
---

Merge ALL outstanding pull requests for the project in the current working directory. High-stakes, multi-step. Be methodical; interrupt the user only when judgment is required.

The user is repo admin and has authorized `gh pr merge --admin` to bypass branch protection (missing approvals, required checks, out-of-date branch, etc.). Branch protection is NOT a blocker. Genuinely failing CI and likely merge conflicts ARE blockers — see Phase 2.

# Operating principles

- **Research before acting.** Never merge a PR without first understanding what it touches and what else is in flight.
- **Predict conflicts ahead of time.** One consolidated question up front beats discovering problems mid-merge after PRs have landed.
- **Bias to safety.** When in doubt, stop and ask. A broken main is worse than a delayed merge.
- **Be quiet on the happy path.** If everything is cleanly mergeable, do it. Interrupt only for risks, conflicts, or judgment calls.
- **Cleanup is best-effort.** The user frequently still has active worktrees and local branches for these PRs. Failures to delete local branches or remove worktrees are EXPECTED — note them and move on. Do NOT use `--force`, `-D`, or any other destructive flag to push past them.

# Phase 1 — Research

1. Verify you are in a git repo with a GitHub remote: `gh repo view --json nameWithOwner,defaultBranchRef`. If not, stop and tell the user.
2. Determine the current GitHub user: `gh api user --jq .login`.
3. Determine the repo's allowed merge methods and pick a default (prefer squash if allowed, else merge, else rebase):
   ```
   gh api repos/{owner}/{repo} --jq '{squash:.allow_squash_merge,merge:.allow_merge_commit,rebase:.allow_rebase_merge}'
   ```
4. List all open PRs with the data you'll need:
   ```
   gh pr list --state open --json number,title,author,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,updatedAt,labels,url
   ```
5. Drop draft PRs from consideration (note them in your final report).
6. For each remaining PR, fetch the file list and current state in parallel:
   ```
   gh pr view <num> --json files,additions,deletions,baseRefName,headRefName,headRepositoryOwner,mergeStateStatus,statusCheckRollup,reviewDecision
   ```
7. **Semantic conflict analysis.** File-path overlap catches only textual conflicts. Also detect *semantic* conflicts — cases where two PRs break each other even though git is happy. To do this:
   1. For each non-trivial PR, fetch the actual diff: `gh pr diff <num>`. (Skip PRs that are pure docs / formatting / lockfile-only.)
   2. Spawn ONE subagent with all the diffs concatenated and the following instruction:

      > You are analyzing N pull request diffs that are about to be merged into the same branch. Your job is to **detect every potential cross-PR interaction**, even weak ones. Do NOT filter for severity — list everything you find. The main agent will decide what's blocking.
      >
      > For each pair of PRs, look for:
      > - Symbols (functions, methods, classes, constants, types) that one PR renames, removes, moves, or changes the signature of, AND that another PR references, calls, imports, or depends on.
      > - Shared types, schemas, interfaces, protobufs, or API contracts where one PR changes the shape and another PR uses the old shape.
      > - Same-name additions: two PRs both adding a route, migration number, env var, config key, feature flag, CLI flag, database table/column, or test name.
      > - Behavioral changes to a shared helper whose tests, callers, or assumptions live in another PR.
      > - Config, infra, or build changes (CI, lockfiles, env, IaC) where one PR changes a setting another PR depends on.
      > - Removed files or directories that another PR still references.
      >
      > Return a list of findings. For each, give: PR numbers involved, one-line description, the specific symbol/file/key involved, and your confidence (low/medium/high) that it's a real interaction. If you find nothing, return "none found".

   3. Do NOT have the subagent decide what's blocking — that's your job in Phase 2.
8. Build a structured picture in your task list:
   - **Stacked PRs**: any PR whose `baseRefName` is another open PR's `headRefName`. These have a hard ordering constraint.
   - **File overlaps**: pairs of PRs that touch the same file path. Each pair is a potential conflict.
   - **CI state**: green / pending / actually failing per PR. Distinguish "failing" from "pending" — they get different treatment.
   - **Authorship**: PRs authored by the current user vs. others.
   - **Sensitive content**: scan each PR's file list for migrations, schema files, lockfiles, dependency manifests, CI config, infra/IaC, feature-flag config, or anything else with non-local impact. You don't need to read the diffs in full — just flag PRs whose file list looks risky.

Use the task list tool to track your progress and make this visible to the user.

# Phase 2 — Plan

Decide a merge order using these rules, in priority order:

1. **Stacked PRs in topological order.** If PR B is based on PR A's head branch, A must merge first. After A merges, retarget B to the default branch (`gh pr edit <B> --base <default>`) before continuing.
2. **Independent PRs next.** PRs with no file overlap with any other open PR. Merging these early shrinks the problem.
3. **PRs with file overlap last.** Each merge in this group will require updating the next PR's branch and re-checking for conflicts, so doing them at the end keeps the unstable work isolated.

Identify **blockers** that require user input BEFORE you start merging. Treat ONLY the following as blockers:

- A PR has **actually failing** CI checks (not pending — failing). The user should decide whether to bypass.
- A PR has **pending** CI checks AND the file list looks sensitive (migrations, lockfiles, infra). For pending checks on low-risk PRs, just proceed — `--admin` will merge through them.
- A PR is authored by **someone other than the current GitHub user**. Surface it and ask whether to include it.
- Two or more PRs touch overlapping files and at least one has `mergeStateStatus` of `DIRTY`, OR the overlap looks substantial enough that a clean auto-rebase is unlikely.
- A PR contains a **database migration, schema change, lockfile/dependency bump, feature-flag flip, CI/infra config change**, or other change with non-local impact. The user should know these are landing before they do.
- A PR has unresolved review comments (`reviewDecision` is `CHANGES_REQUESTED`) — the reviewer wanted something fixed.
- **A semantic-conflict finding from Phase 1 step 7 that you judge as plausibly breaking.** The subagent returned every interaction it could find without filtering. It is YOUR job to read through those findings and decide which ones matter. For each finding, ask yourself:
  - Is the relationship real? (e.g. does PR A actually rename a symbol that PR B actually calls, or did the subagent confuse two unrelated identifiers?)
  - If it's real, would the result actually break? (e.g. a renamed internal helper that both PRs update consistently is fine; a renamed exported function that another PR's new caller still uses the old name for is broken.)
  - If you're confident it's safe, drop it silently and continue.
  - If you're confident it'd break, surface it as a blocker.
  - If you genuinely can't tell from the diffs alone, surface it as a blocker — that's exactly the case where the user's judgment is needed.
  When surfacing, give the user the specific symbol/file involved and your read of the risk, not just the raw subagent output.

**NOT blockers** (proceed without asking):

- `mergeStateStatus` of `BLOCKED` due to missing approvals or required reviews — `--admin` handles it.
- `mergeStateStatus` of `BEHIND` — `--admin` will bypass the "must be up to date" branch-protection rule, so policy is fine. `BEHIND` is a *policy* state, not a *content* state — if the branch actually conflicts with base, the `gh pr update-branch` probe in Phase 3 will catch it; stop and ask then.
- Pending CI on a PR with a low-risk file list — `--admin` handles it.
- No reviewers assigned.

If there are ANY blockers, **stop and report them in a single consolidated message** containing:

- A one-line summary of each blocker, grouped by PR.
- Your proposed merge order (so the user can sanity-check it).
- Specific, answerable questions the user needs to respond to (yes/no or short-answer, not open-ended).

Then wait for the user's response before continuing.

If there are NO blockers, proceed silently to Phase 3 without checking in.

# Phase 3 — Execute

For each PR in your planned order:

1. Re-check the PR's current state: `gh pr view <num> --json mergeable,mergeStateStatus,statusCheckRollup`. State may have changed since Phase 1 (someone pushed, CI re-ran, another PR landed). If a NEW blocker has appeared (newly failing CI, new conflict), STOP and report. If the state change is benign or already-handled by `--admin`, continue.
2. If the PR's branch is behind the default branch, run `gh pr update-branch <num>` first. This is primarily a **conflict probe** — if it succeeds, great; if it fails with a merge conflict, STOP and report which files conflict. Do not attempt to resolve conflicts yourself.
3. Merge using the repo's default method (determined in Phase 1) with admin override:
   ```
   gh pr merge <num> --<method> --admin --delete-branch
   ```
   `--delete-branch` will try to delete the remote head branch. Local branch deletion may fail if a worktree is still attached — that's fine and expected.
4. **After each merge**, for any remaining planned PR that touches files just modified, run `gh pr update-branch <num>` to bring it up to date and probe for conflicts. If a conflict appears, STOP and report which PR blocked, what files conflict, and what the user's options are.
5. Best-effort local cleanup (do NOT use force flags, ignore errors silently):
   - `git fetch --prune` once at the start of cleanup, to drop stale remote-tracking refs.
   - For each merged PR's `headRefName`, try `git branch -d <branch>`. **Never** `-D`.
   - For each worktree whose branch matches a merged PR, try `git worktree remove <path>`. **Never** `--force`.
   - Capture which cleanups failed for the final report. Failures here aren't errors — the user likely still has the worktree active.
6. Move to the next PR.

# Phase 4 — Report

Once you've processed every PR (whether merged, skipped, or blocked), give the user ONE concise final report containing:

1. **Merged** — PR number, title, and merge SHA for each one that landed.
2. **Skipped or blocked** — PR number, title, and the specific reason (one line each).
3. **Cleanup notes** — which local branches and worktrees couldn't be removed. Frame these as "for your awareness", not as failures. The user almost certainly has these worktrees active intentionally.
4. **Latent risks to watch for** — be specific to what actually merged, not generic. Examples:
   - Migrations or schema changes that landed → user may need to run them locally / coordinate a deploy.
   - Lockfile or dependency bumps → user may need `npm install` / `bundle install` / `cargo build` etc.
   - Feature flags that were added or flipped.
   - CI config changes that may affect main's signal on the next push.
   - Files where merged PRs overlap with the user's uncommitted local work (if you can detect this).
   - Anything with non-local impact (env vars, infra, shared config).
   - PRs that were merged with `--admin` despite pending CI (call these out so the user knows to watch for post-merge CI failures on main).
5. **Suggested follow-ups**, only if there's something specific worth doing right now.

Keep the report tight. Surface what the user couldn't see at a glance from the diffs.

# Hard rules

- Never use `git push --force`, `--force-with-lease`, `git reset --hard`, `git checkout -- .`, `git restore .`, or `git clean -f`.
- Never use `git branch -D` — use `-d` only, and accept the failure.
- Never use `git worktree remove --force` — accept the failure.
- Never close a PR. If you can't merge it, leave it for the user to handle.
- Never amend, rebase, or rewrite history on any branch.
- `gh pr merge --admin` is allowed and expected — the user is repo admin and has authorized bypassing branch protection. Do NOT, however, use `--admin` to push through actually-failing CI without first asking the user.
- If a step fails, diagnose before retrying. Do not retry the same destructive command with stronger flags to "make it work".
- If you find yourself uncertain about whether something is safe, stop and ask. The user would much rather answer one question than untangle a bad merge.
