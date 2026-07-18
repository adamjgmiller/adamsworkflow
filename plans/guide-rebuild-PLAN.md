# Plan v2: adamsworkflow — from config-share repo to workflow guide

2026-07-17 · v1 + Fable adversarial critique folded in (14 findings; critique file:
plan-critique.md). Supersedes plan-draft.md.

> **Sanitized copy of the working plan; personal identifiers genericized for the public record.**

## 1. Goal

Transform github.com/adamjgmiller/adamsworkflow into a guide that teaches how Adam
runs Claude Code today — useful to advanced agentic engineers AND newcomers, and to
people porting concepts to Claude Cowork / Cursor / Codex. Sharable proudly on HN,
with a friend, teammate, or employee. Humble-but-honest tone; "loop engineering" /
"harness engineering" used sparingly and precisely.

## 2. Decisions locked (grill-me, 2026-07-17)

1. **Venue**: same repo, evolved in place; visual served via GitHub Pages; custom
   domain attachable later, zero migration.
2. **Portability**: generalize lightly — real skills, personal hostnames stripped,
   one "serving your pages" convention (localhost default / LAN / Tailscale / VPS).
3. **Policy artifacts ship**: generalized global CLAUDE.md + harness field notes.
4. **Devbox**: full narrative chapter + real scripts (statusline, tmux pair).
5. **Landscape**: named systems, fair framing, no scoring matrix.
6. **Cut**: adams-merge-all-prs OUT, a personal bot-config skill OUT; gen-image IN (BYO key);
   all 15 remaining commands + 4 skills + 4 agents IN.
7. **Shape**: README = guide spine; one flagship visual page; cross-linked.

## 3. The three centerpieces (what the critique sharpened)

**A. The adoption path is engineered, not asserted.** The repo's #1 adoption story is
"clone it, open Claude Code, tell it what you want." That gets real machinery:
- **Repo-root `CLAUDE.md` written FOR the visiting agent** — descriptive, never
  imperative (no pre-auths, no push rules — those stay quarantined in
  `CLAUDE-global.md`, which deliberately does NOT take the auto-loaded name):
  what each artifact is, its dependency row, how to adapt serving/hosts, where the
  field notes live.
- **Per-artifact dependency matrix** (`requires / degrades-to / substitute`):
  e.g. dual-review requires Codex CLI → degrades to labeled single-source (this is
  ALREADY built into dual-review.md:25 + lens-review.md:67 — ship it as a feature,
  verify build-system/orchestrate/ship-issues preflight the same way in Phase 1).
- **A tested adaptation prompt** in the README ("read this repo and set up the
  review ladder for my machine") — Phase 4 runs it live against a clean HOME and
  we fix what breaks. The install experience is tested, not hoped.

**B. The improvement loop is evidenced, not asserted.** Adam's config-feedback rule
(every session surfaces grounded one-line config improvements → human approves →
config compounds) is the guide's core claim and gets:
- Its own high-placement README section: port the RULE, not just the artifacts —
  a snapshot of this config goes stale; the feedback line keeps a fork alive.
- **3–5 sanitized, dated excerpts from skill-audit's LOG.md** (real entries: the
  async-dispatch flip, model-by-omission gap, stale-codex-daemon guard) — the
  cheapest credibility win: demonstration, not claim.
- Per-artifact provenance dates ("generalized from live config, 2026-07-XX") + one
  honest README line: this is a dated snapshot of a living system.
- The §5 generalization table is kept AS A PRIVATE SKILL on Adam's machine
  (re-sync/re-publish from live config later) — not shipped, but the treadmill has
  an owner. [OPEN → Adam: build the re-sync skill as part of this project, or defer?]
- Visual page: the flywheel diagram (session → grounded feedback → approval →
  config → next session).

**C. A real newcomer on-ramp.** Restored + new:
- **Prereq/dependency matrix up front** (what needs Codex CLI / a Google key /
  Tailscale — and what needs NOTHING).
- **Three-tier adoption ladder, early in the README**:
  Tier 1 zero-prereq (quick-review, grill-me, askme + the config-feedback rule) →
  Tier 2 the review ladder (adds Codex CLI: dual/lens/review-fix-loop, codex-consult) →
  Tier 3 the full system (vehicles, serving stack, devbox).
- "**If you only take one thing**" device kept (v1's best line): Tier 1 + the rule.
- Composition map moved later; internal vocab glossed on first use.

## 4. Repo tree (v2)

```
adamsworkflow/
├── README.md                  ← guide spine (§6 outline)
├── CLAUDE.md                  ← FOR THE VISITING AGENT (descriptive; §3A)
├── CLAUDE-global.md           ← generalized global config (merge-by-choice, never auto-loaded)
├── install.sh                 ← extended walk: commands/ skills/ agents/ scripts/ docs/→~/.claude/docs/
│                                + v1-migration: dangling-symlink cleanup + rename note
├── scripts/check-leakage.sh   ← the leakage gate, committed (runs in CI + pre-publish)
├── commands/                  ← 15 commands, generalized (list per §2.6)
├── skills/                    ← build-system, codex-consult, gen-image (BYO key), grill-me (+ATTRIBUTION)
├── agents/                    ← stage-runner, codex-runner, make-it-easy, visual-builder (+conventions README)
├── scripts/                   ← statusline-command.sh, subagent-statusline.sh, tmux pair,
│                                visual-page/ scaffold, make-it-easy/ engine, gen-image/
└── docs/                      ← Pages root, .nojekyll
    ├── index.html             ← FLAGSHIP visual (self-contained; §7)
    ├── devbox.md              ← devbox chapter (linked via github.com blob URLs, NOT Pages-relative —
    ├── field-notes.md           .md under .nojekyll serves as raw text)
    └── (porting = README subsection, NOT a standalone doc — see §6.9)
```

Cross-reference integrity (Phase 1 gate): shipped commands cite
`~/.claude/docs/harness-notes.md §N` inline today → installer places
`docs/field-notes.md` at `~/.claude/docs/field-notes.md` and shipped artifacts are
rewritten to that path; a grep pass over every shipped artifact for `~/.claude/`
paths verifies no dead pointers remain.

## 5. Generalization & leakage

**Leakage gate (`scripts/check-leakage.sh`, committed):** matches a private term list
(personal hostnames, addresses, project names) kept outside the repo — including the
personal email handle the critique caught hardcoded in the statusline — plus committed
generic patterns (routable IPs, emails, home paths, credential shapes). Scope: EVERYTHING
that merges — including `plans/` docs (they commit to this public repo per Adam's
own policy). Statusline email→account-tag map becomes an env var (also fixes
degradation).

**Serving defaults INVERT for adopters** (critique: mie.py:28 defaults HOST to the
author's personal host; 0.0.0.0 on an adopter's laptop = exposed on café wifi): shipped default `127.0.0.1`,
LAN/Tailscale opt-in via env/config, documented in the serving-conventions section.

**Per-artifact edits** (each also gets a provenance date):
| artifact | edits |
|---|---|
| make-it-easy (cmd+agent+engine) | host default 127.0.0.1; GOOGLE_CLOUD_PROJECT absent → page works, no audio/images (verify) |
| visual (cmd+agent+scaffold) | host default; model-note kept with Claude names |
| guided-tour | strip hardcoded ~/Projects + personal host URL → serve convention |
| teamwork / auto-run / ship-issues | serve convention; strip personal project/VPS/deploy references |
| pr-auto-review, lens-review | strip Greptile trigger sections → optional "external bot" note |
| dual/lens/build-system/orchestrate | verify codex preflight+degrade parity (feature, documented) |
| statusline | usage-tracker / chezmoi-drift / account-tag segments degrade when deps absent; email→env |
| CLAUDE-global.md | keep: routing, review tiers, delegation policy + escalation test, blast-radius, plans/ layout, ASCII-diagrams, **Config feedback (core)**. strip: chezmoi, Greptile, Tailscale specifics, pre-auths, memory paths |
| field-notes.md | probed facts w/ probe dates + "verify on your version" banner |
| gen-image | BYO key (Vertex or Gemini API) |

## 6. README outline (v2)

1. **What this is** — how I actually run Claude Code; guide + real config; the one
   deliberate "loop engineering" definition (engineering the loops around the model —
   review convergence, verification gates, escalation — not prompt text); honest
   dated-snapshot line.
2. **If you only take one thing** + three-tier adoption ladder + prereq matrix (§3C).
3. **The 10-second router** — work-shape → vehicle table.
4. **Review tiers & the fix loop** — quick→dual→lens; convergence goal, caps as cost
   guards; dual-source rationale (uncorrelated reviewers); degrades-cleanly-without-
   Codex as a stated feature.
5. **The improvement loop** (§3B — LOG.md excerpts here).
6. **How I work a meaningful task** — updated real example (grill-me → build-system →
   review-fix-loop → pr-auto-review).
7. **Delegation & model tiering** — escalation test; cite official docs for
   inheritance ("omission is not neutral" — validated by Anthropic's own docs, F10).
   Keep Claude model names (they're citable platform primitives).
8. **Human-decision batching** — make-it-easy / askme / grill-me.
9. **Porting the concepts** — README subsection (NOT standalone doc): concept-level
   mapping (what's Claude-Code-specific vs portable: routing/review/feedback rules
   port anywhere; hooks/subagent primitives vary) — no per-platform API claims we
   haven't verified (critique: zero research on Cowork/Cursor/Codex primitives).
10. **What this costs** — honest paragraph: the tiering policy IS the cost story
    (Sonnet fan-outs, escalation test, caps as cost guards). Preempts HN comment #1.
    [OPEN → Adam: comfortable stating rough plan/usage reality?]
11. **The devbox** — teaser + link to docs/devbox.md.
12. **Where this sits** — landscape, folded into README (no standalone doc; one
    surface to keep fresh): Spec Kit ~122k★, GSD (archived→successor, verify at
    publish), awesome-claude-code 50.2k★, Claude Flow (architecture, no stars),
    hamelsmu/claude-review-loop 705★ + OpenAI codex-plugin-cc **named in
    acknowledgments as prior art** for cross-model review, sankalp blog. Framing
    rule (F11): "each element exists somewhere; the integrated system doesn't appear
    to" — absence-inference, stated as such. Star counts sparse + dated.
13. **Install** — install.sh modes + v1-migration note + the tested adaptation prompt.
14. **What's intentionally not here** + acknowledgments (Matt Pocock; hamelsmu;
    OpenAI codex-plugin-cc; devbox prior-art guides credited in devbox.md).

## 7. Flagship visual (docs/index.html)

Public when-to-use-which adaptation, same design tokens (built in-repo — project
output, not visual-builder). Sections: router · intake ladder · review-tier ladder +
caps · composition map · delegation/model tables (Claude names) · devbox stack
diagram + statusline anatomy · improvement flywheel · porting strip (concept-level).
Self-contained HTML, no .md links into Pages (blob URLs instead). **Explicit mobile
requirement**: the mirrored layout is desktop-first two-col sticky-TOC; HN is
mobile-heavy — single-col collapse + readable diagrams (horizontal-scroll pre blocks)
are acceptance criteria. Provenance header with generation date.

## 8. docs/devbox.md (the most-wanted chapter)

Narrative: why a persistent devbox (sessions survive; any device is a thin client) →
the stack (Tailscale → ssh/mosh → tmux → Claude Code; Blink on iOS) → statusline
anatomy (what each segment answers and why it exists — model/effort/context/quota/
worktree awareness) → tmux niceties (window indicator, pending-question hook) →
credit prior art (elliotbonneville, rogs.me, duanestorey, alxpck gist et al.) and
state our addition honestly: the integrated stack + statusline (F13: none of 8
surveyed guides integrate one).

## 9. Implementation phases

- **Phase 0** ✓ this plan → Fable critique ✓ → /visual to Adam → feedback gate.
- **Phase 1 — generalize (riskiest: failures are quiet + public).** Re-snapshot live
  ~/.claude (Adam improved it since recon); per-artifact edits (§5); xref-integrity
  pass; codex-degradation parity check; leakage gate green. Worktree branch;
  /orchestrate as vehicle.
- **Phase 2 — write** README + devbox.md + field-notes.md (+ CLAUDE.md for agents).
- **Phase 3 — visual + Pages.** Build index.html; enable Pages (main:/docs); mobile
  check via Playwright.
- **Phase 4 — verify the adoption story.** Clean-HOME install test (both modes) AND
  the live "read this repo and set it up" adaptation-prompt test; fix what breaks.
- **Phase 5 — review + ship.** lens-review breadth (repo policy) + leakage gate +
  link check; publish-time freshness pass (star counts, GSD successor, F7/F8 credit
  set); draft PR → pr-auto-review → Adam reads README + visual himself (tone can't
  be machine-verified) → merge → share.

## 10. ANSWERED by Adam (2026-07-17) — plan amendments

1. **Cost paragraph: YES**, using his safer phrasing: "at least a full Max 20x
   subscription every week + additional usage." (Fuller detail deliberately kept out
   of the public record; the published phrasing is the approved one.)
2. **LOG.md excerpts: YES.** Candidate excerpt: the 2026-07-17 fix round across all
   review tools/loops (loop-scope tracking bug class) — happening live during this project.
3. **Re-sync skill: SKIP** unless it turns out genuinely useful during this build.
   He'll update occasionally; revisit cadence/tooling if the repo gets traction.
4. **Tagline (verbatim):** "How I run Claude Code. The loops, the config, and the
   devbox. A guide and my skills, commands, config, etc."
5. **Scope approved, with four amendments:**
   a. **Phase 4 isolation is a hard requirement**: the clean-HOME/adaptation test must
      run on a throwaway user account or isolated install (separate OS user, container,
      or CLAUDE_HOME/CLAUDE_CONFIG_DIR sandbox — decide at Phase 4) — ZERO risk of
      touching his live config.
   b. **Delegate where possible**; specifically the web-design step goes to a NAMED
      agent (SendMessage-re-invocable for post-hoc changes; named leaf dispatches run
      synchronous — plan the fan-out accordingly).
   c. **DESIGN DIRECTION CHANGE for docs/index.html (§7)**: do NOT reuse the internal
      GitHub-flavored scaffold look, and don't look like default mid-2026 AI-agent
      output. Minimal, white/black/grey, light/dark option, modern. Prefer SVG (or
      similar) diagrams over ASCII on the public page. A little gen-image where
      genuinely useful, sparingly.
   d. **Autonomy**: not required to run end-to-end unattended — /askme whenever input
      now is cheaper than cascading rework later.

**SCOPE ADD (Adam, same message): ship `/adams-deep-research` in the suite** — his
fork of built-in deep-research (less bounded, much more cost-effective). He has just
fixed the model-override gap himself. Phase 1: locate its actual source (may live as
a plugin rather than ~/.claude/skills), generalize, add to inventory/matrix/README.

**PAUSE (2026-07-17):** Adam is mid-flight updating several skills (shared bug class:
how the review tools/loops track what they're reviewing per round). DO NOT re-snapshot
or start Phase 1 until he says done — then re-snapshot picks up the fixes.

## 11. Second answer round (2026-07-17) — amendments

1. **Devbox chapter = generic hardware + a sizing ladder** (his advice, verbatim
   spirit): full dedicated server = best experience — lowest latency, practically
   unlimited concurrent sessions, plus room for your own apps/servers; a simple
   2-core VPS is fine for a little dev work; 8–16 vCPU if running 5–10+ sessions
   at once without full-server money. No provider/specs/cost of his own.
2. **Statusline script NOT shipped** (replaces part of grill decision #4): the chapter
   instead teaches what segments are worth having (dir/branch · model · effort ·
   context % · quota · worktree-awareness) and ships a tested example prompt for the
   reader's own Claude Code to build THEIR statusline. On-thesis ("tell Claude what
   you want"). Statusline files come OUT of the repo tree + install.sh; leakage-gate
   email term stays anyway. tmux pair (window indicator, pending-question) still
   ships as real scripts — not contested by this answer; confirm at Phase 1.
3. **Access-path corrections for the chapter**: daily driver = Mac + Kitty (any
   terminal is fine); Blink is the iPhone/iPad path (Blink is iOS-only); ALSO cover
   Claude Code Remote (web/desktop app controlling the devbox session — nice UI,
   image upload/download that tmux-over-ssh can't do); AND VS Code on Mac
   (Remote-SSH) for managing files on the devbox — he uses it regularly.
4. **Pages enablement via gh api: pre-approved** (main:/docs) at Phase 3.

**Started during the pause (safe tracks — no review-skill dependency):** worktree +
branch + plans umbrella; locate adams-deep-research source; Phase-4 sandbox recon;
named design agent (new minimal aesthetic sample); devbox chapter draft.
