# adamsworkflow

How I run Claude Code for high-volume parallel work — the actual commands
and skills I have installed at `~/.claude/`.

This is a **config-share repo**, not a tutorial. Friends asked what I run;
here it is. Install the script, pick up whichever pieces are useful, ignore
the rest.

## What's in here

```
commands/        →  installed to ~/.claude/commands/
skills/          →  installed to ~/.claude/skills/
install.sh       →  --copy or --symlink, both supported
```

Nothing else. No global `CLAUDE.md` snippets, no philosophy essay, no
onboarding walkthrough. Read the per-command paragraphs below, install
what looks useful, open a few `.md` files when you want detail.

## Install

```bash
git clone https://github.com/adamjgmiller/adamsworkflow.git
cd adamsworkflow
./install.sh --symlink     # or --copy
```

The script mirrors `commands/` and `skills/` into `~/.claude/commands/`
and `~/.claude/skills/`. If a target file already exists, it's backed up
to `<file>.bak-<timestamp>` first — your existing config is never silently
overwritten.

| Mode | What you get |
|------|--------------|
| `--symlink` | Each file in `~/.claude/` is a symlink into this repo. `git pull` here updates your live config. Best if you want to track upstream. Couples your `~/.claude/` to wherever you cloned this. |
| `--copy` | Each file is copied. Edits to `~/.claude/` don't affect this repo and vice versa. Best if you want a baseline you'll fork-and-tweak. |
| `--dry-run` | Pair with either mode. Prints what would happen; touches nothing. |

Re-runs are idempotent in `--symlink` mode (existing symlinks pointing into
this same repo are left alone). In `--copy` mode each re-run replaces the
copy with a fresh one and backs up the previous version.

Manual equivalent if you'd rather see exactly what's happening:

```bash
mkdir -p ~/.claude/commands/ar ~/.claude/skills
cp commands/*.md          ~/.claude/commands/
cp commands/ar/*.md       ~/.claude/commands/ar/
cp -r skills/*            ~/.claude/skills/
```

## Prerequisites

Install only what you'll actually use. Each is optional in the sense that
the rest of the toolkit still works without it — but the commands listed
beside each prereq won't.

- **[Codex CLI](https://github.com/openai/codex)** — needed by
  `/codex-consult`, `/quick-dual-review`, `/review-fix-loop` when paired
  with a dual review, and `/orchestrate`'s once-over fan-out.
  `brew install codex` on macOS, see upstream for Linux.
- **GitHub CLI (`gh`)** — needed by `/adams-merge-all-prs`. Most CC users
  already have it.
- **[`adamsreview` plugin](https://github.com/adamjgmiller/adamsreview)** —
  needed by `/ar:fix-and-verify`. Install via the Claude Code plugin
  marketplace:
  ```
  /plugin marketplace add adamjgmiller/adamsreview
  /plugin install adamsreview@adamsreview
  ```

## How these fit together

The commands aren't isolated. They nest:

```
/auto-run <goal>
   └── plays the human for any nested command, escalates tough calls via ↓

/review-fix-loop /quick-dual-review
   └── loops the review below, fixes findings, re-reviews until clean

/quick-dual-review
   ├── /quick-review                          (Claude reviewer)
   └── codex-consult (review mode)            (Codex reviewer)
        — runs in parallel, results deduped against the actual diff

/orchestrate
   └── post-execution once-over fans out the same two reviewers

/ar:fix-and-verify
   └── /adamsreview:fix   (from the adamsreview plugin)
       then /review-fix-loop /quick-dual-review on the fix delta
```

If you only take one thing: `/quick-dual-review` is the cheapest taste of
the pattern. The rest are scaffolding on top.

## Example: how I work on a meaningful task

The flow I actually run on a non-trivial feature, migration, or refactor:

1. **Goal + `/grill-me`.** State the goal, then let the agent interview me
   until every branch of the decision tree is resolved.
2. **PRD.** Have the agent write a PRD from the grill-me conversation.
3. **Plan + review the plan.** Have the agent write an implementation plan
   from the PRD, then run `/review-fix-loop /quick-dual-review` against
   the *plan itself* — checking consistency with the PRD, consistency
   with the codebase, internal consistency, and general readiness for
   agentic execution.
4. **`/orchestrate` + review the code.** Have the agent orchestrate the
   implementation against the approved plan, then run
   `/review-fix-loop /quick-dual-review` on the resulting diff. For UI
   work I fold Playwright testing into the review loop when it's
   appropriate.
5. **`/adamsreview:review --ensemble`** — multi-lens review with a Codex
   pass and a PR-bot-comment scrape pooled on top.
6. **`/adamsreview:walkthrough`** — interactive pass through the
   borderline findings `:fix` would skip; I promote the ones I want
   auto-fixed.
7. **`/ar:fix-and-verify`** — apply the surviving auto-fixable findings,
   then loop dual-review on the fix delta until it converges (or
   surfaces what it can't clean up).
8. **Preview, decide, loop if needed.** Exercise the actual functionality
   in a real browser / runtime. For a really complex PR (major new
   feature set, migration, refactor), I'll usually run another two or
   three review/fix cycles before I'm satisfied.

**Read the PRD yourself. Skim the Plan when the work matters.** The PRD
and Plan are where intent gets encoded before any code is written, and
the downstream review loops can only verify that *the implementation
matches the plan* — they can't catch a plan that confidently builds the
wrong thing. Manual PRD review is the load-bearing check in this whole
workflow; the `/review-fix-loop` in step 3 catches consistency and
readiness issues, not "this is the wrong approach."

## Commands

Tiered: bigger commands get a paragraph, utilities get a line.

### `/orchestrate`

Drives a multi-stage task end-to-end. Triages whether you handed it a
plan or a request, builds a journal at `plans/<topic>-execution.md`,
runs per-stage build → spot-check → verify → commit loops with sub-agent
delegation (up to 3 cycles per stage), and finishes with a parallel
review fan-out (Claude + Codex when available). The orchestrator agent
keeps coordination state and reads diffs as ground truth; sub-agents do
the per-step build and verify work. This is the spine of my parallel
workflow — most other commands plug into it.

### `/auto-run`

Pursues a goal autonomously while I'm away. Plays the human for any
nested command that would normally pause: takes the recommended option
for routine calls, escalates tough calls to `/quick-dual-review` first,
and pauses only for critical-irreversible actions (external comms,
force-pushes to shared branches, paid resources). Maintains three
durable files — umbrella, journal, decisions log — so I can audit what
got chosen by whom when I come back, even across context compactions.
The honest-execution rule matters: if the goal calls for
`/adamsreview:review`, it runs `/adamsreview:review` — no silent
substitutions for "faster" or "cheaper" alternatives.

### `/review-fix-loop`

Loops a review command, buckets findings into FIX / HUMAN / DEFER, fixes
the FIX bucket with parallel sub-agents, commits per round, re-reviews,
repeats until convergence or a hard stop (steady-state, regression, or
max rounds). Works with `/quick-review`, `/quick-dual-review`, or
anything that emits findings in the standard shape. The non-obvious
piece: "needs human judgment" findings accumulate across rounds and
surface together at the end — the loop doesn't halt on them, so a single
design question doesn't block twelve mechanical fixes from landing.

### `/quick-dual-review`

Runs `/quick-review` (Claude) and `/codex-consult review` (Codex) in
parallel against the same scope, then dedups and validates findings
against the actual diff in main context. The validation step is the
whole point — reviewers hallucinate file:line, and confirming both
reviewers agree (or seeing them disagree) on the same finding is the
signal worth paying for. Handles both top-level fan-out (when `Agent` is
available) and sub-agent contexts where it has to reclaim parallelism by
launching Codex detached before running Claude inline.

### `/adams-merge-all-prs`

Research / plan / merge every open PR in the current repo. Detects
stacked PRs, file-overlap risks, and semantic cross-PR interactions
(one PR renames a symbol another PR calls — git is happy, the build is
broken). Asks one consolidated question up front if any blockers exist,
then merges silently on the happy path. Hard rules against destructive
git ops — won't `-D`, won't `--force`, won't close PRs to "make it
work". Assumes you're repo admin and have authorized `gh pr merge
--admin` to bypass branch protection (missing approvals, out-of-date
branches, etc.) — review the file before running it if that's not you.

### `/guided-tour`

Curates a clickable markdown tour of a diff, subsystem, or codebase —
VSCode turns the `/src/...#L42` links into one-click navigation, so the
tour guides your attention while you read the actual code. Auto-detects
scope (branch diff vs. merge-base, current session's work, whole
codebase) or takes `--branch` / `--session` / `--range` / `--path` /
`--codebase` / `--pr <n>`. Tours run 5–8 stops for diffs, 5–10 for
codebase tours, with optional ASCII shape diagrams and a TL;DR table at
the bottom. The non-obvious bit: `--session` introspects this
conversation's history (what the agent actually did in the window),
not just recent commits — and refuses with a "did you mean `--branch`?"
if the session is empty, rather than silently approximating from `git
log`. I reach for this when I need to hand a teammate (or future me) a
map of a non-trivial branch without writing the walkthrough by hand.

### `/quick-review`

Single-pass review of recent work; auto-scopes from your edits if any,
otherwise from git (uncommitted → branch-ahead → HEAD). Read-only —
won't fix unless you ask in the same request.

### `/askme`

Re-asks your pending questions via `AskUserQuestion`, one at a time, so
you can pick from structured options instead of typing free text.

### `/ar:fix-and-verify`

Runs `/adamsreview:fix`, then loops `/quick-dual-review` on the fix
delta until verified clean (or `steady-state` / `regression` /
`max-rounds`). Requires the `adamsreview` plugin — see prereqs.

## Skills

### `codex-consult`

Runs the Codex CLI as a read-only second-opinion engine. Three modes:
`review` (diff review with prescribed findings format), `critique` (read
a plan or design and surface concerns + alternatives), `ask` (open
question). The skill body encodes four non-obvious Codex CLI gotchas — a
parser bug in `codex review` that forces use of `codex exec`, mandatory
stdin closure to avoid hangs, sentinel-file polling for long-running
jobs, and an auto-background wake quirk that can leave you sitting
dormant while Codex has long since finished. Used by
`/quick-dual-review`, `/orchestrate`'s once-over, `/review-fix-loop`,
and `/auto-run`'s dual-review escalation. If you install nothing else
from this repo, this is the one to consider.

### `grill-me` (adapted from Matt Pocock)

Interview-style design review — asks you one question at a time via
`AskUserQuestion` until each branch of the decision tree is resolved.
Adapted from the [original by Matt
Pocock](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me);
see [`skills/grill-me/ATTRIBUTION.md`](./skills/grill-me/ATTRIBUTION.md)
for credit. I reach for this any time a plan has more than two
non-trivial decisions to lock down before code.

## What's intentionally not here

- **`adamsreview`** — separate plugin, install from
  [adamjgmiller/adamsreview](https://github.com/adamjgmiller/adamsreview).
  `/ar:fix-and-verify` here wraps it.
- **My global `~/.claude/CLAUDE.md`** — too personal / project-specific
  to share usefully. The patterns that matter (blast-radius discipline,
  sub-agent delegation, plan-first workflow) are referenced inside the
  commands themselves where they're load-bearing.

## Acknowledgments

- **`grill-me`** — concept and original implementation by
  [Matt Pocock](https://github.com/mattpocock/skills).
- **`adamsreview`** — separate plugin I maintain at
  [adamjgmiller/adamsreview](https://github.com/adamjgmiller/adamsreview).
- **Codex CLI** integration — the four gotchas in
  `skills/codex-consult/SKILL.md` are the distilled output of debugging
  enough broken runs to want them written down.

## License

[MIT](./LICENSE). The `grill-me` adaptation carries forward upstream
attribution per Matt Pocock's original repo — see
[`skills/grill-me/ATTRIBUTION.md`](./skills/grill-me/ATTRIBUTION.md).
