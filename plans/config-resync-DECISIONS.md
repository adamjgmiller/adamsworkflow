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

## D004 — config-change skill: ship as a NON-INSTALLED reference doc (C)
- **When**: 2026-07-20T06:32Z — during S2 (opened 06:10Z)
- **Question**: Ship the new config-change skill (the config-maintenance discipline), and if so in what form?
- **Options**:
  - A. Ship generalized as a 5th installed skill — operationalizes the guide's improvement-loop thesis, but the generalized rewrite never ran and its procedure dead-ends on infrastructure adopters lack
  - B. Exclude the artifact; README improvement-loop prose only — honest but withholds the concrete procedure
  - C. Ship as a non-installed reference doc (the CLAUDE-global merge-by-choice pattern) — fidelity without a dead-end install
- **Chosen**: C — as `docs/config-change-reference.md`, framed "reference-only worked procedure — not installed, not runnable unmodified", with a preamble mapping owner-specific mechanisms to portable roles (canonical fact store · carrier inventory + cite/vocabulary search · persistence mechanism · routing documentation · audit log + changelog cursor). Placement outside `skills/` is load-bearing: install.sh walks all of `skills/` with no per-artifact allowlist, so a skills/ placement silently becomes option A at install time (Codex catch). Installed-skills count stays 4. Knock-on edits owned by S3e: narrow the repo CLAUDE.md matrix promise ("one row per shipped artifact" → installed/runnable artifacts + a reference-doc mention), tighten the README claim "nothing shipped depends on owner infrastructure" → "no installed artifact depends on it", add the doc to README's deliberately-not-installed list + install.sh's header comment. No config-change pointer line goes into CLAUDE-global.md (a config file referencing a repo doc would dangle post-merge; the README section + reference doc carry the thesis).
- **Reversibility**: trivial pre-merge
- **Dual-review**: yes — CONVERGED. Claude (Opus): C, high confidence — repo's own precedent; installed skill dead-ends; lightest doc ripple. Codex (0.144.4, exit=0): C, high (0.95) — same core reasons plus the three implementation constraints adopted above.
- **Journal ref**: S2 2026-07-20T06:32Z

## D005 — S3b verify #5: intent reading over literal reading (skip-heredocs stay unquoted)
- **When**: 2026-07-20T07:05Z — during S3b acceptance review
- **Question**: My verify criterion said "no unquoted heredoc anywhere in either file", but the live source deliberately keeps two skip-comment heredocs unquoted (bodies interpolate only run-controlled SHAs/dates — no third-party text), and the ported explainer text states that contrast explicitly. Enforce the literal criterion or the intent?
- **Options**:
  - A. Literal — convert the two skip heredocs to quoted+printf too; diverges from live and contradicts the ported explainer
  - B. Intent — the audited vulnerability was third-party (PR-derived) text reaching an expanding heredoc; the PR-comment assembly is the quoted+body-file+printf pattern; run-controlled-only heredocs are safe by the campaign's own analysis
- **Chosen**: B. Faithful-port principle wins; my verify wording was overly broad. The stage-runner read the intent correctly and correctly declined to make the divergence itself.
- **Reversibility**: trivial
- **Dual-review**: no (Tier 1 — the live config's own audit already adjudicated this exact boundary)
- **Journal ref**: S3b acceptance 2026-07-20T07:05Z

## D006 — Leakage incident: scrub + feature-branch history rewrite (force-with-lease)
- **When**: 2026-07-20T10:40Z — during S6 close-out
- **Question**: The /pr-auto-review agent's plans append described a generalization mapping by embedding the literal home path + local username as the example (the exact embed-the-literal failure mode the gate's new header note warns about). My close-out push chained `gate | tail` — the pipeline returned tail's exit code, masking the gate's FAIL — so two commits carrying the literal reached the public branch. Fix-forward (leaves the literal in public history, gate permanently red) or scrub + rewrite the two unpushed-elsewhere commits?
- **Options**:
  - A. Fix-forward commit — history keeps the literal; the gate's history scan fails forever (or needs an allow-list carve-out, weakening it)
  - B. Scrub the line, `reset --soft` to the last clean commit, recommit clean, `push --force-with-lease` to the feature branch
- **Chosen**: B. The goal makes the gate a hard requirement; the branch is this run's own working branch (draft PR, no other consumers, owner asleep) so the Tier-3 "shared branch" concern doesn't apply in substance; force-with-lease bounds the risk. The PR review comment's `after=` SHA dangles post-rewrite — acceptable: the idempotency contract parses only `before=`, which is untouched. A transparency note goes on the PR.
- **Reversibility**: moderate (rewrite is itself the cleanup; nothing of value lost)
- **Dual-review**: no (Tier 1 — leaving a gate-failing literal in public history is not defensible; the only real call was rewrite mechanics)
- **Journal ref**: S6 2026-07-20T10:40Z

## Summary
5 decisions playing the human (D001-D005): 1 used dual-review (D004 — converged, verdict adopted with the Codex critic's implementation constraints), 0 paused for the user (none met Tier 3), 0 permission-gap skips. The /pr-auto-review per-PR agent additionally resolved its leave-vs-scrub privacy tie via the unattended tie-break and returned 3 posture calls + an upstream-defect list as data for Adam's morning gate (PR #2 comment).
