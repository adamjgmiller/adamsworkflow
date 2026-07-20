# config-resync — decision audit

## D001 — Ship adams-field-research.js (INCLUDE)
- **When**: 2026-07-20T06:05Z — during S2, decision explicitly delegated by Adam
- **Question**: Ship the new adams-field-research workflow in the public guide, or leave it live-only?
- **Options**:
  - A. Include — self-contained, demonstrates the hardcoded model-tiering doctrine, complements the shipped deep-research workflow (question-answering vs field-mapping)
  - B. Exclude — young artifact (one validated run), wait for more usage signal
- **Chosen**: A. It is production-quality (arg validation, salvage paths, hardcoded Sonnet fan-out policy with deliberate absence of override plumbing), generalized from a real proven run (40 agents, 0 failures, 188 facts checked), and the live global CLAUDE.md already routes to it — shipping the routing line without the workflow would dangle. The matrix row will state the single-run provenance honestly, matching the guide's dated-claims practice.
- **Reversibility**: trivial (file + matrix row removal)
- **Dual-review**: no (Tier 1 — investigator digest and work-list both support; ambiguity low)
- **Journal ref**: S2 2026-07-20T06:05Z

## D002 — Ship docs/ship-issues-pathB.md (INCLUDE, near-forced)
- **When**: 2026-07-20T06:05Z — during S2
- **Question**: Mirror the live extraction of ship-issues' Workflow-fabric Path B into a separate doc, or keep Path B inline in the shipped command?
- **Options**:
  - A. Include the extracted doc + mirror the pointer-table structure — matches live reality
  - B. Keep Path B inline in shipped ship-issues.md — one less file, but shipped structure permanently forks from live
- **Chosen**: A. The live command cites the doc at four points; the extraction was a deliberate architecture decision (extraction-not-retirement, per the campaign's do-not-re-raise list), and the guide's premise is a faithful snapshot. Consequence accepted: install.sh must start installing it from docs/ (currently only field-notes.md), plus header-comment and repo-CLAUDE.md "only field-notes installed from docs/" claims update in S3e.
- **Reversibility**: moderate (touches install.sh + repo docs, all in one PR)
- **Dual-review**: no (Tier 1 — forced by the citation structure)
- **Journal ref**: S2 2026-07-20T06:05Z

## D003 — Public-repo hygiene overrides verbatim-paths in plans files
- **When**: 2026-07-20T06:08Z — during S2, while reviewing the committed umbrella against the leakage gate
- **Question**: The auto-run contract stores the goal verbatim in the umbrella, but the verbatim goal contains absolute /home/<user> paths that the public repo's leakage gate (Layer-1 regex + history pickaxe) rejects. Which wins?
- **Options**:
  - A. Keep verbatim, exempt plans/ from the gate — weakens the gate on a public repo
  - B. Store the goal with home paths rewritten to ~ form; rewrite the one unpushed local commit so branch history is clean
- **Chosen**: B. The gate is a hard requirement of the goal itself; ~-form preserves every semantic of the goal text. Branch history rewritten via soft reset + single clean recommit (nothing was pushed). Standing rule added to all S3 stage briefs: committed files never contain absolute home paths or the local username.
- **Reversibility**: trivial
- **Dual-review**: no (Tier 1 — the goal text itself makes the gate non-negotiable)
- **Journal ref**: S2 2026-07-20T06:08Z

## D004 — config-change skill: include/exclude (PENDING dual-review)
- **When**: opened 2026-07-20T06:10Z — verdict pending
- **Question**: Ship the new config-change skill (the config-maintenance discipline), and if so in what form?
- **Options**:
  - A. Ship generalized as a 5th installed skill (investigator's recommendation — "the natural home of the improvement-loop thesis")
  - B. Exclude the artifact; cover it in README improvement-loop prose (orchestrator's lean — its load-bearing content is coupled to private infrastructure: the audit-workspace paths, routing page, dotfiles-manager matrix; a generalized rewrite is an artifact that never ran)
  - C. Ship as a non-installed reference doc alongside CLAUDE-global.md (merge-by-choice precedent; install.sh doesn't walk it)
- **Chosen**: _pending_
- **Dual-review**: yes — in flight (Opus critic + Codex CLI critic, critique mode, parallel)
