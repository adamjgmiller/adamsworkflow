---
description: Produce a click-through guided tour of a diff, subsystem, or codebase — visually compelling HTML by default (`--md` for markdown), with file/line deep-links into the real code, ASCII diagrams where they clarify shape, and a TL;DR.
argument-hint: "[--branch | --session | --range <range> | --path <path> | --codebase | --pr <number>] [--html | --md]"
---

# /guided-tour

Produce a guided tour of a diff, subsystem, or codebase that the user can click
through. The tour walks through the meaningful changes (or the architecture)
with clickable file/line links, ASCII diagrams where they clarify shape, and a
TL;DR table. The goal is **navigation**, not narration — the user clicks into
the actual code, your tour just guides their attention.

**Default output is a visually compelling, self-contained HTML page** (a set of
linked pages for large scopes); pass `--md` for the plain-markdown form. Either
way, clickability into real code is the whole point — see § Link format.

## Who builds it (per your global CLAUDE.md → Communication visuals: tours are the code-visual route)

- **`--session` scope → inline.** The content IS this conversation's context — no
  sub-agent can see it; the main agent curates and builds.
- **Cold scopes (`--branch`, `--range`, `--path`, `--pr`, `--codebase`) → delegate
  wholesale**: dispatch ONE `general-purpose` sub-agent with a pointer brief — *"read
  `~/.claude/commands/guided-tour.md` and execute it for scope `<flag/args>` in repo
  `<abs path>`; write to `<OUTPUT_PATH>`"* — passing `model:` explicitly per the
  Communication-visuals tiering (Opus normally · Sonnet genuinely simple) — never
  escalate above Opus on your own judgment; the user naming a tier overrides that in
  either direction. The content is all
  on disk, so a pointer brief is payload-complete. **The dispatched sub-agent IS the
  builder**: it runs Steps 1–3, writes the page(s) to `<OUTPUT_PATH>`, and returns —
  it does not re-enter this delegation bullet and does not run Step 4's serve/send.
  The dispatcher serves/sends the result itself (§ Step 4) and spot-checks that stop
  links resolve.
- Either way the page reuses the **visual-page design system**
  (`~/.claude/scripts/visual-page/` — palette + components); the tour's stop-nav
  layout extends it. Never route tours through `visual-builder`.

## Usage

Scope (what to tour):

    /guided-tour                          # auto-detect scope from context
    /guided-tour --branch                 # this branch vs its merge-base with main
    /guided-tour --session                # work done in the current Claude session
    /guided-tour --range <range>          # git range, e.g. HEAD~5..HEAD or abc123..def456
    /guided-tour --path <path>            # specific subsystem, e.g. src/auth/
    /guided-tour --codebase               # high-level architecture of current dir
    /guided-tour --pr <number>            # GitHub PR diff (uses `gh pr diff`)

Format (how to render) — optional, default is HTML:

    /guided-tour --html                   # visually compelling HTML page (default)
    /guided-tour --md | --markdown        # plain markdown, VSCode-clickable

Flags combine, e.g. `/guided-tour --pr 1234 --md` or `/guided-tour --codebase`
(HTML by default).

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
> **Options** (only include those that have meaningful content; the harness adds a
> free-form "Other" automatically — don't list one; the user types a range/path/PR there):
>   - "This branch (N commits ahead of `<base>`)" — the branch diff
>   - "Recent session work (~M files changed since `<short SHA>`)" — session scope
>   - "Whole codebase from current dir" — architecture tour

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
  `git diff --name-status <range>` (not `--stat`, which abbreviates long paths
  to `.../…` and renders renames as `{old => new}` — display forms, not real
  paths), and the commit list via `git log --oneline <range>`
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
to a sub-agent (e.g. `Explore`, explicit `model:` per the delegation policy) to
keep context tight — but whoever owns the tour (main agent, or the cold-scope
builder from § Who builds it) writes it. The sub-agent reports back with file
lists, key class/function names, and rough sizes; you decide which to spotlight.

### Step 4 — Write and surface

(For a cold-scope tour the delegated builder only *writes*; everything after the write
— server, URL, file-share — is the dispatcher's, per "Who builds it".)

**HTML (default).** Write the self-contained page(s) to OUTPUT_PATH, then start
a simple static server (e.g. `python3 -m http.server <port>
--bind 127.0.0.1 --directory <dir>`, run in the background) and lead with the
URL — `http://localhost:<port>/<file>`. By default, serve on 127.0.0.1
(localhost-only). To open pages from other devices, opt in explicitly: bind
0.0.0.0 on a trusted network, or preferably bind a private tailnet/VPN
interface (e.g. Tailscale) — see the README's serving section. Also send the file itself via the
file-share tool so the user keeps a copy. Caption it in one line: the
`vscode://` stop links open the real code in VSCode at the right line (desktop
only — on phone the page is read-only). Note the server stays up until they're
done and offer to stop it.

**Markdown (`--md`).** Write to OUTPUT_PATH and send the file via the file-share
tool with a one-line caption telling them how to click through (e.g., "Open in
VSCode — the `/src/...` links jump to the actual code; `#L42` anchors take you
to specific lines"). No server.

## File location

Paths below use `<ext>` = `html` by default, `md` under `--md`. Default
OUTPUT_PATH by scope:

  - `--branch` → `plans/<branch>-TOUR.<ext>` if `plans/` exists, else
    `<branch>-TOUR.<ext>` at repo root.
  - `--session` → `plans/<branch>-TOUR-session.<ext>` if `plans/` exists, else
    `<branch>-TOUR-session.<ext>` at repo root.
  - `--range` → `plans/RANGE-<short>-TOUR.<ext>` where `<short>` is e.g.
    `abc123-def456` or `last-5-commits`.
  - `--pr` → `plans/PR-<number>-TOUR.<ext>`.
  - `--codebase` → `docs/ARCHITECTURE-TOUR.<ext>` if `docs/` exists, else
    `ARCHITECTURE-TOUR.<ext>` at repo root.
  - `--path <dir>` → `<dir>/TOUR.<ext>` if `<dir>` is a directory; otherwise
    `plans/<basename>-TOUR.<ext>`.

**Multi-file HTML sets.** When a scope is large enough that one page would be
unwieldy (big codebase tour, many stops with heavy diagrams), emit a directory
instead of a single file: replace `*-TOUR.html` with a `*-tour/` dir holding
`index.html` (Big Picture + stop nav + TL;DR) and one page per major
section/subsystem, cross-linked. Keep every asset inline or inside that dir so
the set is movable as a unit. Markdown stays single-file.

If the chosen path already exists, append `-2`/`-3`/... (or `-tour-2/` for a
set) so the older tour survives.

**Commit what lands in `plans/`.** In a git checkout, commit a tour written
under `plans/` right after writing it (`git add <path> && git commit -m
"plans: <name> tour" -- <path>` — the pathspec keeps any staged user work in
a reused worktree out of the tour commit) — the plans convention's sidecar rule, and uncommitted
tour files strand reused worktrees against commands whose preflights bail on
dirt (auto-merge-main Step 3). Outputs elsewhere (`docs/`, repo root) stay
uncommitted for the user to place. No push — the branch owns push timing.

If the worktree is not a git repo, fall back to `--codebase` or `--path`
scoping; warn the user that diff-scoped tours need git.

## Link format

Clickability into real code is non-negotiable in both formats. Every link must
resolve — verify by reading or listing before linking. Never invent paths,
line numbers, or SHAs.

**HTML** — a browser can't use VSCode's workspace-relative trick, so use
`vscode://file/` deep-links with **absolute** paths:

    <a href="vscode://file/home/<user>/projects/app/src/auth/login.py:42">
      login.py:42 — token refresh</a>

The shape is `vscode://file/<ABSOLUTE-PATH>:<LINE>[:<COL>]`. The absolute
path's own leading `/` is the only slash after `file` — so
`vscode://file/home/...`, **not** `vscode://file//home/...` (a double slash
breaks the path) — and the line is a trailing `:42`, not an `#L42` anchor.
Clicking opens that file at that line in the user's VSCode on this machine
(desktop only; a harmless no-op on phone). Resolve the absolute prefix once
from the repo/worktree root via `git rev-parse --show-toplevel` (or `pwd` for
non-git scopes) so links work wherever the page is opened from.

**Markdown (`--md`)** — use VSCode-compatible links, preferring the
absolute-from-workspace-root form:

  - **Absolute from workspace root**: `[label](/src/foo/bar.py#L42)`. VSCode
    interprets the leading `/` as the workspace root. Most portable.
  - **Relative from the tour file**: `[label](../src/foo/bar.py#L42)`. Works
    when the tour file's location is known and stable.

## HTML output (default format)

The page should be genuinely nice to look at — not a markdown-to-HTML dump.
Aim for the bar in the `frontend-design` skill: distinctive, polished, not
generic-AI. Start from the visual-page design system
(`~/.claude/scripts/visual-page/` — its palette, cards, callouts) rather than
inventing a parallel style; the tour-specific layout below extends it.
Requirements:

  - **Self-contained.** Inline all CSS (and any small JS) in the file — no CDN
    links, no blocking external fonts; a system font stack is fine. A
    multi-file set keeps its assets inside the set's own dir.
  - **Structure.** Sticky header with the tour title + scope label; a left
    sidebar (top strip on narrow screens) listing the stops as jump links with
    scroll-spy highlighting the current stop; the stops as the main column; the
    TL;DR table pinned at the very bottom.
  - **Stops as cards.** Each stop: a heading, the 1–2 sentence context, the
    `vscode://` code links styled as obvious buttons/chips, and a "what to
    notice" line. ASCII diagrams go in a styled `<pre>` (monospace, preserved
    whitespace, subtle background). Inline 3–5 line snippets in `<pre><code>` —
    never more than ~10 lines.
  - **Responsive + legible.** Readable measure (~70ch body), a coherent
    light/dark-aware palette, generous spacing. Must look right at phone width
    in case the user opens it from a phone or tablet.
  - **No build step, no framework.** Hand-written HTML/CSS emitted directly —
    one tasteful page beats a heavy SPA.

Content rules (stop count, ASCII discipline, no fabrication, TL;DR at the
bottom) are identical to markdown — only the rendering changes.

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
