# /guided-tour

Produce a guided markdown tour of a diff, subsystem, or codebase that the user
can click through in VSCode. The tour walks through the meaningful changes (or
the architecture) with clickable file/line links, ASCII diagrams where they
clarify shape, and a TL;DR table. The goal is **navigation**, not narration —
the user clicks into the actual code, your tour just guides their attention.

## Usage

    /guided-tour                          # auto-detect scope from context
    /guided-tour --branch                 # this branch vs its merge-base with main
    /guided-tour --session                # work done in the current Claude session
    /guided-tour --range <range>          # git range, e.g. HEAD~5..HEAD or abc123..def456
    /guided-tour --path <path>            # specific subsystem, e.g. src/auth/
    /guided-tour --codebase               # high-level architecture of current dir
    /guided-tour --pr <number>            # GitHub PR diff (uses `gh pr diff`)

## Scope detection (when no flag is given)

Identify which scope is most likely. If one is obviously right, just go. If
two or more are plausible, dispatch `AskUserQuestion` and let the user pick.

Signals to weigh:

- **Branch diff** — strong when `git rev-parse --abbrev-ref HEAD` is not
  `main`/`master`, the branch is N commits ahead of its merge-base, AND there
  is a `plans/<branch>*.md` file (the user's worktree convention). Default
  base is `main` unless `git merge-base --fork-point` resolves elsewhere.
- **Session work** — strong when this conversation has done meaningful work
  (files edited or created, commits made, fixes applied, plans/journals
  updated) that you can see in your own context. The signal is what's in
  your context window right now, not a time fence. Use `git status
  --porcelain` and a short `git log --oneline` as cross-references for
  what landed on disk vs. what was just discussed.
- **Codebase** — fallback when neither diff nor session signal is strong, OR
  when the user is clearly on a fresh checkout asking "what is this".

If exactly one signal is strong, proceed without asking. If two or more are
plausible, ask:

> **Question header**: "Scope"
> **Question**: "Tour what?"
> **Options** (only include those that have meaningful content):
>   - "This branch (N commits ahead of `<base>`)" — the branch diff
>   - "Recent session work (~M files changed since `<short SHA>`)" — session scope
>   - "Whole codebase from current dir" — architecture tour
>   - "Other (specify)" — user types a range/path/PR

If there is nothing to tour (empty diff, empty session, no project files),
say so and ask the user what they had in mind. Don't fabricate a tour.

**Empty `--session` scope is a refusal, not a fallback.** When the user
explicitly passes `--session` AND your conversation context shows no
meaningful work done in the current window (no files edited/written, no
commits made, no plans/journals updated, no fixes discussed), STOP and say:
*"Nothing in this session's context to tour. Did you mean `--branch` or
`--codebase`?"* Do NOT silently approximate with recent commits — the user
asked for session work, and session work means "what this conversation did,"
not "what looks recent on the branch."

## Workflow

### Step 1 — Resolve scope to concrete inputs

Once scope is picked, derive:

- **SCOPE_LABEL** — short human-readable name (e.g. `branch`, `session`, `pr-1234`)
- For diff-scoped tours: **SCOPE_RANGE** (`<base>..HEAD`), the file list via
  `git diff --stat <range>`, and the commit list via `git log --oneline <range>`
- For **session-scoped tours**: introspect your own conversation history to
  answer "what work did I do in this conversation that is worth touring?"
  Build:
    - **SESSION_FILES** — the set of files you edited / wrote / verified
      in this conversation, plus files in `git status --porcelain` that
      are clearly part of this conversation's work
    - **SESSION_COMMITS** — the commits you (the assistant) made during
      this conversation. If you can identify the SHA the conversation
      opened on, set **SESSION_RANGE = `<session-start-SHA>..HEAD`**;
      otherwise list commits individually
    - **SESSION_THEMES** — the topics, decisions, and fixes that came up
      (e.g. "finalizer flip + reviewer fixes R1-R5"). Use these to title
      the tour and group stops; they don't have to map 1:1 to commits

  If the conversation has been compacted, work from the surviving summary
  plus whatever's in the live window — the summary typically lists what
  was done. If neither yields a coherent picture, refuse per the empty
  `--session` rule above rather than guessing from `git log`.
- For path-scoped tours: directory tree + file count via `find`/`ls`
- For codebase tours: top-level README/CLAUDE.md/package manifest signals
- **OUTPUT_PATH** (see § File location)

### Step 2 — Pick the tour shape

**Diff-scoped tour** (branch / session / range / PR):

  1. **The Big Picture** — what changed at a macro level. Before/after ASCII
     diagram if it clarifies the shape change (e.g., 15 dispatches → 1
     dispatch, monolith → modules).
  2. **5–8 tour stops** — each opens with 1-2 sentences of context, has
     clickable file/line links, names what to notice. Optional ASCII
     diagram if the shape needs one. Pick the stops that tell the *story*
     of the change, not every file touched.
  3. **What's deferred** — explicit notes from the diff: TODO/FIXME/XXX
     comments, follow-up commits in linked plans/journals, "see issue #N"
     pointers. Skip the section if nothing relevant.
  4. **Where to dig deeper** — clickable links to related plan / journal /
     decisions / docs files if they exist.
  5. **TL;DR table** — 4–8 headline metrics (LOC delta, files touched,
     tests added, gates passed, etc.).

**Codebase tour** (`--codebase` or path-scoped):

  1. **The Big Picture** — what the project does in one paragraph.
  2. **5–10 tour stops** — each names a subsystem/module. Entry points
     first (CLI, server bootstrap, main). Key abstractions next. Data flow
     and persistence last.
  3. **Where to dig deeper** — README, CLAUDE.md, docs/, plans/, etc.
  4. **TL;DR** — "What to read first when onboarding" (3-5 bullet points).

A path-scoped tour is a smaller-form codebase tour, focused on the given path.

### Step 3 — Generate

You are *curating* — read enough of the diff or codebase to pick stops well.
Read the diff in full once at the start of a diff-scoped tour.

For large scopes (whole codebase, big diffs), it's fine to delegate exploration
to a sub-agent (e.g. `Explore`) to keep main context tight — but you write the
tour yourself. The sub-agent reports back with file lists, key class/function
names, and rough sizes; you decide which to spotlight.

### Step 4 — Write and surface

Write to OUTPUT_PATH. Send the file to the user via the file-share tool with
a one-line caption telling them how to click through (e.g., "Open in VSCode —
the `/src/...` links jump to the actual code; `#L42` anchors take you to
specific lines").

## File location

Default OUTPUT_PATH by scope:

  - `--branch` → `plans/<branch>-TOUR.md` if `plans/` exists, else
    `<branch>-TOUR.md` at repo root.
  - `--session` → `plans/<branch>-TOUR-session.md` if `plans/` exists, else
    `<branch>-TOUR-session.md` at repo root.
  - `--range` → `plans/RANGE-<short>-TOUR.md` where `<short>` is e.g.
    `abc123-def456` or `last-5-commits`.
  - `--pr` → `plans/PR-<number>-TOUR.md`.
  - `--codebase` → `docs/ARCHITECTURE-TOUR.md` if `docs/` exists, else
    `ARCHITECTURE-TOUR.md` at repo root.
  - `--path <dir>` → `<dir>/TOUR.md` if `<dir>` is a directory; otherwise
    `plans/<basename>-TOUR.md`.

If the chosen path already exists, append `-2`/`-3`/... so the older tour
survives.

If the worktree is not a git repo, fall back to `--codebase` or `--path`
scoping; warn the user that diff-scoped tours need git.

## Link format

Use **VSCode-compatible** clickable links. Two acceptable forms:

  - **Absolute from workspace root**: `[label](/src/foo/bar.py#L42)`. VSCode
    interprets the leading `/` as the workspace root. Most portable.
  - **Relative from the tour file**: `[label](../src/foo/bar.py#L42)`. Works
    when the tour file's location is known and stable.

Prefer the absolute-from-root form. Every link must resolve — verify by
reading or listing before linking. Never invent paths.

## Constraints

  - **Click-throughable beats narrative.** Don't quote large code blocks
    inline; link instead and tell the user what to look for. Inline snippets
    of 3–5 lines are fine when illustrating a pattern; never reproduce more
    than ~10 lines of source.
  - **5–8 stops for diff tours, 5–10 for codebase tours.** Fewer and it's
    not a tour. More and it's a list — the user loses the thread.
  - **ASCII diagrams must clarify a shape.** Don't decorate the page with
    them. If prose carries the idea, skip the diagram.
  - **No emojis** unless the user explicitly asked for them.
  - **No fabrication.** If a file/line/concept doesn't exist in scope, leave
    it out. Don't invent commit SHAs, line numbers, or filenames.
  - **TL;DR table goes at the bottom**, not the top. It's the "what should
    I remember" section, not the lead.
