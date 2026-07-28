# Config-change reference — how a config edit lands without going stale

> **Reference only — not installed, not runnable as-is.** This is a faithful
> reproduction of a live skill the owner runs to change their own agent config, kept
> here as a worked example. `install.sh` does not touch it (it lives in `docs/`, not
> `skills/`), and it will not run unmodified — it names the owner's private mechanisms.
> It is here because the guide's central improvement-loop thesis is **port the rule,
> not the snapshot**, and the sharpest way to show that is the real procedure the owner
> follows to keep the config true when a fact underneath it changes. Read it for the
> *discipline*; map each mechanism onto your own setup using the table below.

The whole point of the procedure: a fact about the harness or the policy lives in
exactly one canonical home, and every other file that repeats it is a *carrier* that
can silently drift when the fact moves. The steps exist to move the fact once and then
chase down every carrier before the config quietly starts lying.

## Role mapping — the owner's mechanisms as portable roles

| Role | What it does in the procedure | The owner's instance (worked example) |
|---|---|---|
| **Canonical fact store** | The single home where a given fact is stated with provenance; everything else cites it | Split by kind: probed harness facts → `~/.claude/docs/field-notes.md`; standing policy → the global `~/.claude/CLAUDE.md`; Codex CLI mechanics → `codex-consult/SKILL.md`; a command's or agent-def's own contract → that file itself |
| **Carrier inventory + the grep sweep** | The full set of files that *repeat* a fact, and the sweep that finds every one — grepping the section **cite**, the old fact's **vocabulary**, and (when a named thing changed) the entity's **name** as a post-save verify | The whole config tree (`~/.claude/`: commands, skills, agents, workflows, docs, root CLAUDE.md), plus the standard/tenets doc, the probe-recipes doc, the review/suppression notes, and the routing page |
| **Persistence / sync mechanism** | Gets a saved edit committed and mirrored across machines; different path classes need different handling | A dotfiles manager — chezmoi — with a per-path-class handling matrix (reproduced as a worked example in step 3) |
| **Routing documentation** | The human-facing doc/page that indexes *how work is routed* through the config; goes stale by omission | A "when to use which" routing page — an HTML index of vehicles, review tiers, and policies |
| **Audit log + changelog cursor** | A running record of every config change, plus a "last reviewed: vX" line that is the changelog-review trigger's comparand | A LOG file whose entries carry date / change / grounding, and a `Last reviewed: vX` line kept current in the same place |

The rest of this file is the procedure. Where a step says "the canonical home" or "the
routing page," substitute your own instance from the table.

**Scope.** This procedure is for *user-level* agent config — the suite that governs how
your agent works everywhere. A project repo's own `CLAUDE.md`, `.claude/` directory, or
plan docs are ordinary repo edits and go through that project's normal PR flow; none of
the ceremony below applies to them. (Grounded 2026-07-22: a project-repo `CLAUDE.md` fix
was routed into this procedure because the scope line then said only "CLAUDE.mds" —
routing reads the shortest description available, so an exclusion has to be stated where
routing looks, not only in the body.)

## 0. External feedback? Validate before applying

Config feedback from another session or a field report is a *claim*, not a fact.
Reproduce or probe the claimed mechanism before editing — the complaint is often right
while its mechanism is wrong (grounded 2026-07-15: the awk `$0` feedback — a real
failure with a wrong explanation; the applied fix stated the *verified* mechanism, not
the reported one). A claim that can't be validated cheaply gets labeled a watch item,
not applied.

## 1. Change the fact in its canonical home first

Route the fact to its one home: harness facts → `~/.claude/docs/field-notes.md`;
standing policy → the global CLAUDE.md; Codex mechanics → `codex-consult/SKILL.md`; a
command's or def's own contract → that file. Update the home *with provenance* — what
was probed or observed, and when. Every other carrier then states the fact in one line
plus a cite back to the home, never re-derives it.

## 2. Carrier sweep — cite-grep, vocabulary-grep, entity-grep

Grep the suite twice. First for the section **cite** (e.g. `field-notes §4`). Then,
separately, for the **vocabulary the old fact used** (e.g. `foreground`, `silently
ignored`) — a carrier can state a fact in its own words without ever citing the home,
and a cite-only sweep sails right past it (grounded 2026-07-18: three pre-async-flip
"foreground" carriers — one of them a def's frontmatter description, the outermost
routing contract a reader actually hits first — survived a "grep-verified clean" sweep
for eight days). Sweep every hit. **Frontmatter descriptions count double**, because
routing reads only the description, not the body. New fan-out briefs must state the
operative rule explicitly, not merely cite it.

Grep roots, by role: the whole config tree (commands, skills, agents, workflows, docs,
root CLAUDE.md); the standard/tenets doc; the probe-recipes doc; the review/suppression
notes (suppression rationales quote live facts); and the routing page — the
omission-prone carrier.

**Third pass — entity-grep minus known-good, when the change redefines or removes a
NAMED thing** (a model tier, tool, agent type, command, flag, endpoint). One rule gets
phrased many ways with no shared n-gram, so the old phrasings cannot be enumerated up
front — but every carrier contains the entity's literal name. Bare-name grep is too
noisy alone (most hits are correct, including what you just wrote), so subtract:
`grep -rnioE ".{50}\bNAME\b.{70}" <roots> | grep -viE "<phrases you just authored>"`
— the residue is the unconverted carriers. **This is a VERIFY pass: run it AFTER step 3
saves**, since the subtraction list is the new wording; it doubles as the "am I done?"
check the two discovery passes cannot give. An over-broad `-v` hides carriers — filter
only on phrases you literally wrote this session, and sanity-check how much it removed.
(Grounded 2026-07-25: removing an agent-selectable model tier — cite-grep and
vocabulary-grep between them missed 3 carriers, and this pass then caught 2 more.)

## 3. Save under the persistence-mechanism rules (finalize wording BEFORE saving)

Save each edited file according to how the persistence mechanism treats its path class.
The owner's mechanism is chezmoi; its matrix below is a **worked example** of this role
— your mechanism will have its own equivalent rows.

| Path class | Handling (chezmoi worked example) |
|---|---|
| `~/.claude/{commands,agents,skills,workflows,hooks,output-styles,subagents,scripts}/` | A PostToolUse hook auto-commits + pushes Write/Edit saves within seconds — no staging window; review *before* saving, not after |
| `~/.claude/docs/`, root `~/.claude/CLAUDE.md` | NOT hook-covered → manual `chezmoi re-add <path>` (new file → `chezmoi add <path>`) |
| `~/.claude/settings.json` | A `modify_` overlay → edit its `BASE` block, then `chezmoi apply ~/.claude/settings.json`; never `re-add` it (this row is pattern reference only — settings.json changes themselves belong to the built-in config skill) |
| Any shell-written file (`cp` / `mv` / `sed -i` / python) | Hook bypassed → manual `chezmoi re-add <path>` (new file → `chezmoi add <path>`) |
| New scripts | Hook captures mode at Write time (0644) — after `chmod +x`, `chezmoi re-add <path>` so the executable bit reaches source |

**Always pass the explicit `<path>`.** A bare `chezmoi re-add` re-imports *every*
modified managed file (absorbing unrelated live drift, e.g. a stray shell-rc edit), and
a bare `chezmoi apply` re-renders every target (clobbering unrelated live state from
source). The argument-less forms are suite-wide, not current-path.

## 4. Routing-doc sync — additions count

If the change touches routing content (work-intake vehicles, review tiers,
delegation/model policy, standing authorizations, external-review policy), update the
routing page: the affected section, its Sources footer, and the header's "last synced"
stamp. **A pure addition is a change** — the page goes stale by omission while every
line it already carries stays perfectly correct (grounded 2026-07-17: a new policy
section landed in the config and the routing page silently lacked it, though nothing on
the page was wrong).

## 5. LOG it, commit the repo

Every config-suite change earns an entry in the audit LOG — date, what changed, why,
and the grounding (name the observed failure, the probe, or the validated finding).
The workspace repo commits as part of finishing the session. **Agent-def timing
caveat:** defs load at session start, so an edited def is invisible to any session
already running — it takes effect only in a fresh session (field-notes §9).

## Changelog review (on a Claude Code upgrade)

Run this when the installed version has moved past the last-reviewed one. The
comparand is a `Last reviewed: vX` cursor line kept in the audit log — as a worked
example, the owner's currently reads `Last reviewed: v2.1.220` (recorded in the LOG on
2026-07-25; prior runs 2026-07-10 through 2026-07-23, roughly one per upgrade). Update
that line as part of every run.

1. Diff the changelog over the un-reviewed range; pull every suite-adjacent line
   (subagents, dispatch, tools, worktrees, hooks, skills/commands parsing).
2. Check each line against the canonical fact store and its carriers: does it
   invalidate a documented fact? Probe what is cheap and load-bearing; label the rest
   as watch items tagged with the version number — an unverified changelog line never
   rewrites a probed fact.
   **Probe hygiene — probe the NEW runtime, not your own session:** the session whose
   trigger fired is usually still RUNNING the old binary (`claude --version` reads the
   disk, not the process), so in-session Agent-tool probes exercise the old version.
   Run live probes through a fresh `claude -p` headless call, or confirm the probing
   session's runtime via its transcript's `version` fields first (grounded 2026-07-22:
   a nesting probe for a just-installed version ran on the previous runtime and
   recorded a false negative; corrected the same day).
3. Apply any real fact change via steps 1–5 above; record the review (range covered,
   changes made, watch items opened) in the LOG so the next run knows where to start.
