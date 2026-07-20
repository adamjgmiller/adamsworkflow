---
branch: config-resync
base: origin/main (1e80fbe — PR #1 merge)
started: 2026-07-20T05:20Z
---

# config-resync — umbrella

## Goal (from /auto-run; home paths ~-normalized per D003)

Overnight config re-sync of the adamsworkflow public guide repo. HOLD FIRST: wait ~3 hours from 05:17 UTC 2026-07-20 (until ~08:15 UTC) because another agent is actively finishing final review iterations in ~/Projects/skill-audit — do not disturb or race it; at wake, verify quiescence (no uncommitted churn/new commits in the last ~15 min; if still active, extend the wait in 30-min steps). THEN: (1) investigate everything that changed since the guide PR snapshot was taken — the skill-audit repo (audit rounds, fixes, LOG.md, reviews/) AND the live ~/.claude/ config (commands, skills, agents, workflows, scripts, CLAUDE.md) versus the shipped generalized copies in the adamsworkflow repo (now merged to main, github.com/adamjgmiller/adamsworkflow); (2) decide whether to include the new adams-field-research workflow (~/.claude/workflows/adams-field-research.js) — Adam delegated this decision to me; (3) create a fresh branch from updated origin/main (in the existing guide-rebuild worktree at ~/Projects/adamsworkflow/.claude/worktrees/guide-rebuild or a new worktree, my choice) and thoroughly update the repo's generalized copies, README, CLAUDE.md map, dependency matrix, and docs/index.html visual where affected; (4) the two-layer leakage gate (scripts/check-leakage.sh with private terms at ~/.config/adamsworkflow/leakage-terms.txt) MUST pass — this repo is public; run a privacy sweep on the full diff before pushing; (5) push the branch and open a DRAFT PR, run the full review loop on it until convergence, but DO NOT merge — merge is Adam's morning gate; (6) prepare a morning report: what changed, what I synced vs deliberately skipped, the field-research include/exclude decision with rationale, and any final decisions or risks Adam must weigh before merging. Pushing the feature branch and opening the draft PR are pre-approved. Never commit to main, never merge, never touch the running skill-audit agent's files (read-only there).

## Standing directive (Adam, mid-turn 05:19 UTC)

Orchestrate rather than doing the work in the main loop: use **Opus and Sonnet sub-agents / workflows as much as possible, not Fable** children. The Fable main loop reviews work between steps and before finalizing.

## Methodology

- Orchestrate-style staged execution: one Opus stage-runner per non-interactive stage; Sonnet for mechanical/unbounded leaves; main loop = coordination + review.
- `/pr-auto-review` as the PR-bound review loop (draft PR → review → fix → converge; promote-to-ready allowed, merge NEVER).
- `/dual-review` for Tier-2 tough calls.
- Two-layer leakage gate (`scripts/check-leakage.sh` + `~/.config/adamsworkflow/leakage-terms.txt`) + independent privacy sweep before any push.
- Greptile: availability check before any trigger comment, per global CLAUDE.md.

## Permission grants (pre-authorized)

- Push feature branch `config-resync` to origin; open DRAFT PR.
- Promote own draft PR to ready + post the review summary comment (global CLAUDE.md standing grant, reversible).
- bypassPermissions/auto mode for the run.

## Overrides

- Goal explicitly authorizes push + draft PR → overrides orchestrate's never-push gate for this run.
- Hard limits kept: no merge, no commits to main, skill-audit repo strictly read-only, leakage gate is a hard gate before push.

## Stages

- S0 HOLD — DONE early (Adam released the hold at 05:40 UTC; skill-audit quiescent, final commit 0fa59d2 @ 05:35).
- S1 INVESTIGATE — DONE: two Opus explorers returned (campaign digest; per-file sync work-list — 27 shipped files, 2 cross-cutting themes, §12 addition required, 3 include/exclude decisions). Handoffs in scratchpad.
- S2 DECIDE — DONE. D001 field-research INCLUDE; D002 ship-issues-pathB INCLUDE; D003 plans-hygiene (no absolute home paths/usernames in committed files; history rewritten pre-push); D004 config-change → dual-review CONVERGED on C: ship as docs/config-change-reference.md, NON-installed (outside skills/ — placement is load-bearing), role-mapping preamble, skills count stays 4.
- S3 BUILD — serial Opus stage-runners, main-loop (Fable) diff review between stages; per-stage verify includes scripts/check-leakage.sh:
  - S3a Foundations: docs/field-notes.md (§4 rewrite, §6/7/10/11 updates, NEW §12, drop personal probe-pointer) + CLAUDE-global.md (fresh-eyes gate, guided-tour route, attribution trailers, §10 cite, plan-artifacts fixes, deep-research + field-research routing lines, config-change line per D004) + commands/review-fix-loop.md (canonical Lane-2 unattended variant, scope arg, branch naming).
  - S3b Autonomous pair (THEME-A): commands/pr-auto-review.md + commands/auto-merge-main.md (Agent-less bail + all robustness deltas) + skills/build-system/SKILL.md (all deltas incl. THEME-A row).
  - S3c Review ladder (THEME-B): agents/codex-runner.md, agents/stage-runner.md, agents/README.md (conv 3), commands/lens-review.md, commands/dual-review.md, skills/codex-consult/SKILL.md (marker extraction, §12 cite, audit mode, version range), commands/teamwork.md.
  - S3d Remaining + new artifacts: commands/ship-issues.md rewrite + NEW docs/ship-issues-pathB.md (generalized), NEW workflows/adams-field-research.js (generalized), NEW docs/config-change-reference.md (D004: role-mapping preamble, reference-only framing), orchestrate, auto-run (STATE_STEM pair), guided-tour, make-it-easy, visual, gen-image, grill-me, scripts/tmux/tmux_window_indicator.sh, workflows/adams-deep-research.js.
  - S3e Repo-level docs: CLAUDE.md (map, counts, matrix rows incl. THEME-A cells + codex-consult version range + new-artifact rows; narrow "one row per shipped artifact" promise to installed/runnable + reference-doc mention), README.md (counts, affected prose, tighten "nothing shipped depends on owner infrastructure" → "no installed artifact", deliberately-not-installed list), install.sh (docs/ship-issues-pathB.md install line + header comment incl. config-change-reference in the skipped list), scripts/check-leakage.sh header note (routed feedback item), docs/index.html spot-check/edit.
- S4 GATE — leakage gate on full branch + independent fresh-eyes privacy sweep on the whole diff (Opus, read-only).
- S5 SHIP — push, draft PR, /pr-auto-review to convergence (no merge; greptile: skipped — not enabled, availability check 0 @ 05:52 UTC).
- S6 REPORT — morning report + close-out.

## Cursor

COMPLETE — all stages done; draft PR #2 awaiting Adam's morning merge gate.

## Links

- Journal: plans/config-resync-JOURNAL.md
- Decisions: plans/config-resync-DECISIONS.md
- Predecessor: guide-rebuild family (plans/guide-rebuild*.md) — SHIPPED via PR #1.

## /pr-auto-review run, 2026-07-20

**Before SHA**: `254c5de` (PR head this run started from — local HEAD, clean ff-sync no-op)
**After SHA**: `254c5de` (== FANOUT_HEAD — no code fixes applied; this section's commit is the only delta)
**Lenses run**: leakage · tool-semantics (mandated) · executable-correctness · consistency/carrier-sweep · goal-fit/accuracy — each Opus + Codex (codex-runner)
**Sources scraped**: no prior PR comments/reviews/threads; greptile: skipped (not enabled)
**Findings**: ~27 after dedup + validation (2 Codex findings dropped as invalid/false-positive)
**Fixed**: 0
**Not fixed**: all — documented, not fixed (rationale below)
**Tests**: skipped (no test command in repo — expected for a docs/config repo)
**Promotion**: blocked — left draft for Adam's morning merge gate (privacy judgment calls + upstream config defects surfaced)

### Meaningful decisions
- **Re-sync verified faithful.** Diffed every shipped command/skill/agent/workflow against the live `~/.claude` source: byte-identical except cosmetic generalization edits (`harness-notes`→`field-notes`, `bb-`→`claude-` de-branding, Greptile→external-bot abstraction, home-path/username literals→placeholder form, Tailscale specifics→generalized). **No port-introduced regression.** So every tool-semantics + `.js` robustness finding is a defect that exists identically UPSTREAM in the live config → documented for upstream fix + re-sync, **not** fixed in the mirror (fixing the mirror alone creates the live-vs-shipped drift the repo's own thesis warns against).
- **Leakage (public repo) → LEAVE + surface.** 3 items Codex rated HIGH but the S4 fresh-eyes sweep + the Opus leakage lens rated LOW/deliberate: (1) plans/ campaign narrative naming the private `skill-audit` repo + opaque SHAs — already public on `main` via PR #1; (2) `docs/config-change-reference.md` chezmoi/infra worked-example — the deliberate, dual-reviewed D004 decision; (3) Greptile vendor name + availability in plans/ — low-sensitivity public SaaS the shipped suite abstracts to "external PR bot". Resolved to LEAVE per the unattended tie-break (reversible; least-action; already-public / deliberate / low-sensitivity; leakage gate passes with no hard-class hit) and surfaced for Adam's conscious morning-gate call — not auto-scrubbed (the human owns the public-footprint decision).
- **Dropped as invalid:** Codex tool-semantics `cat-file -e`-vs-ancestry (the tree-diff is the correct cost-guard check; the command documents this behavior as intended) and Codex consistency dispatch-sense "foreground" (flagged instances are the correct "no foreground mode" phrasing, a historical narrative ref, and the deliberate vocabulary-grep example).

## Outcome

ACHIEVED. Draft PR #2 delivers the full re-sync (34 files: ~30 shipped copies ported to the post-audit live config + 3 new artifacts + repo self-docs), verified faithful by a 10-reviewer /pr-auto-review fan-out that found zero port-introduced regressions and zero mirror-fixable meaningful issues. Leakage gate clean at every commit and on the full branch; adversarial privacy sweep clean of all hard classes. Left draft on purpose — merge is Adam's gate, with three privacy posture calls and an upstream-defect list (live-config fixes, then re-sync) documented in the PR's review comment. All five decisions (D001-D005) logged; D004 resolved by a converged Claude+Codex dual-review.
