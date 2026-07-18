---
branch: guide-rebuild
base: main
started: 2026-07-17
---

# Umbrella: adamsworkflow → public workflow guide

**Goal**: Transform the repo from a stale config-share (adamsreview-era) into a guide
teaching Adam's current Claude Code workflow — README-as-guide, generalized real
config (commands/skills/agents/scripts), generalized CLAUDE-global.md + field notes,
devbox chapter, flagship visual on GitHub Pages, named-but-fair landscape section.

**Planning docs** (session scratchpad, will be committed here as sidecars when build
starts): plan-v2.md (the approved plan + two answer-round amendments), plan-critique.md
(Fable adversarial review, 14 findings), research-findings.md (245-agent verified
landscape research), system-map.md (live-config recon).
Scratchpad: <session-scratchpad>/

## Decided
- Grill round 1 (7 decisions): same repo + Pages; light generalization; ship
  CLAUDE-global + field-notes; devbox chapter; named landscape; cut
  adams-merge-all-prs + a personal bot-config skill, keep gen-image BYO-key; flagship
  visual + README spine.
- Fable critique folded (leakage gate as script incl. the personal email handle
  found hardcoded in the statusline; visiting-agent
  CLAUDE.md; adoption ladder; xref-integrity pass; serving default inverts to
  127.0.0.1; porting = README subsection; Pages .md via blob URLs; cost paragraph).
- Answer round 1: cost = "at least a full Max 20x subscription/week + additional
  usage"; LOG.md excerpts OK; re-sync skill skipped; tagline locked; Phase-4 verify
  on throwaway install ONLY; design step = named re-invocable agent; public page
  design = minimal white/black/grey light/dark modern, SVG > ASCII, sparing gen-image
  (NOT the internal GitHub-flavored scaffold); /adams-deep-research added to suite.
- Answer round 2: devbox hardware = generic + sizing ladder (2-core VPS → 8–16 vCPU
  → full server); statusline script NOT shipped — teach segments + example
  build-your-own prompt instead (tmux pair still ships, confirm at Phase 1); access
  paths = Mac+Kitty daily / Blink on iOS / Claude Code Remote (web+desktop; image
  up/download) / VS Code Remote-SSH; Pages enablement via gh api pre-approved.

## State
- **PAUSED for Phase 1**: Adam is fixing a bug class across his review skills
  (per-round review-scope tracking). Re-snapshot live ~/.claude only after he
  confirms done.
- Started during pause (safe tracks): this worktree/branch; adams-deep-research
  source location; Phase-4 sandbox recon; design-sample agent (named: page-designer);
  devbox chapter draft.

## Executed
- 2026-07-17: worktree + branch + umbrella created.
- 2026-07-17: docs/devbox.md DRAFT landed (delegated draft + main-context once-over;
  fixed 5 truncated prior-art URLs to full verified links). Reconcile at Phase 1:
  tmux indicator scripts must actually ship (chapter references them); verify
  remaining prior-art author names at Phase 5 freshness pass.
- 2026-07-18: design-sample.html landed (page-designer, named/re-invocable):
  serif+mono print-manual language, SVG diagrams, light/dark, verified headless on
  desktop+390px. Adam's verdicts: palette → PURE COOL NEUTRAL (not warm paper);
  keep sparing red accent; keep scroll-inside-frame mobile SVGs but add explicit
  usability test (agent via browser first, Adam on-device before publish — Phase 3
  acceptance item); tagline-as-hero confirmed. Designer re-invoked for palette shift.
  Served at <preview-host>:<port> (purpose-bound: design feedback round).
- 2026-07-18: palette shift applied + headlessly re-verified (cool neutral
  #FBFBFC/#0E0F11, greyscale grain, scroll-affordance chevron/fade on mobile SVGs,
  AA+ contrast both themes). Verified in main context: zero warm remnants, still
  self-contained. Design language LOCKED pending Adam's eyeball.
