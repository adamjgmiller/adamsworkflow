# Guide-rebuild Phase 1 (generalize) — execution journal

## Cursor
Current: S2+S3 — dispatched in parallel (S1 complete)

## Stage plan
- S1 snapshot live config → scratchpad (NEVER committed) + fix-round delta report — opus
- S2 generalize artifact suite: commands/skills/agents/workflows + xref + codex-parity — fable (parallel w/ S3)
- S3 scripts & engines: tmux pair, visual-page, make-it-easy (127.0.0.1 default), gen-image BYO-key — opus (parallel w/ S2)
- S4 policy docs: CLAUDE-global.md, docs/field-notes.md, root CLAUDE.md (visiting agent) + dependency matrix — fable
- S5 install.sh + two-layer leakage gate (+ private uncommitted terms file) + full-tree sweep + sanitized plan sidecars — opus

## Standing constraints (all stages)
- Pristine live-config copies stay in scratchpad; only generalized content is committed (public git history).
- No personal strings in ANY committed file, commit message, or this journal.
- Serving convention (identical text every use): shipped default binds 127.0.0.1;
  reaching pages from other devices is an explicit opt-in (bind 0.0.0.0 on a trusted
  network, or preferably a private tailnet/VPN interface) — documented once in the
  README serving section, cross-referenced elsewhere.
- Statusline scripts are NOT shipped (devbox chapter teaches build-your-own).
- Commit convention (from git log): short imperative first line, e.g. "Add /guided-tour command".
- Push: NEVER (orchestrate gate; hand back local branch).

## Stage S1 — snapshot + delta
- 2026-07-18 dispatched stage-runner (opus)
- 2026-07-18 PASS (verified: repo porcelain unchanged; snapshot 40 files/716K in
  scratchpad; delta report 165 lines, all 8 artifacts). No commits by design.
- Notables: fix-round = 13 files <48h (5 review commands at one timestamp; codex-consult
  gained `audit` mode). Shipped-command count corrected: 14 (15 live minus the cut one).
  orchestrate.md NOT in fix round — lacks new scope-provenance vocabulary; flagged as
  config-feedback candidate for Adam (out of scope here). Delta summary = candidate
  improvement-loop excerpt for Phase 2.

## Stage S2 — generalize artifact suite
- 2026-07-18 dispatched stage-runner (fable)
- 2026-07-18 PASS — 4 commits (2da7ba9 commands, 97ffecd skills, b218305 agents,
  4a862d8 workflow), conductor-verified on HEAD; independent leakage sweep CLEAN;
  inventory exact (14/4+ATTR/5/1, old stack git-rm'd); Greptile→neutral-bot done;
  codex parity: only build-system needed the preflight added; 12 field-notes §N
  xrefs preserved (§1-7,9 cited); fresh-eyes leaf read all 24 diff pairs, no flags.
- Cross-stage constraints recorded: S4 CLAUDE-global.md must exist by that exact
  name carrying plan-artifacts, communication-visuals, blast-radius, teardown,
  delegation policy, never-commit-main (+ config-feedback core); S4 field-notes.md
  preserves §1–§9 numbering/meanings; Phase-2 README must rewrite old-stack refs
  (~19) + add the serving section; S5 install.sh must add agents/ workflows/
  scripts/ docs→field-notes for the xref promise to hold.

## Stage S4 — policy docs
- 2026-07-18 dispatched stage-runner (fable)
- 2026-07-18 PASS — 3 commits (3bb6fb6 CLAUDE-global, cb224a0 field-notes, 4c55fc7
  root CLAUDE.md), conductor-verified on HEAD; independent leakage sweep CLEAN.
  Config feedback = first section w/ provenance line; §1–§11 headings byte-identical,
  cite counts match; 27-row matrix 1:1 with shipped trees; fresh-eyes leaf: zero
  imperative/grant language in root CLAUDE.md. Pre-auth sections → advisory
  "Authorization grants (decide your own)" with hard floors kept. Phase-2 note:
  harmonize root CLAUDE.md "config-share repo" wording with guide-first framing;
  add frontend-design plugin to README prereqs.

## Stage S5 — installer + leakage gate + sidecars
- 2026-07-18 dispatched stage-runner (opus)
- 2026-07-18 PASS — 4 commits (38cce81 install.sh, e429cea gate, plus the plan-records
  and devbox-draft commits — those two re-minted during the once-over H1 purge, see
  below), conductor-verified on HEAD; gate
  GREEN on conductor's independent run; tree clean. Fake-home installs (both modes +
  dry-run + idempotency) and migration test (removed exactly the 4 dangling v1 repo
  links, foreign links untouched) evidenced. Canary fired on both layers; public
  handle correctly not flagged. Private terms file created outside repo (12 terms).
  Sidecars: PLAN sanitization-only (verbatim tagline/cost preserved), RESEARCH
  byte-identical, both fresh-eyes-verified. Deviation accepted: a cut personal
  skill's name genericized in two plan files (gate-green requirement; substance kept).
- Branch note for Phase 5: commit trailers inconsistent (Fable stages carry a session
  trailer; S3/S5/main-style use single Co-Authored-By) — normalize before/at PR if
  Adam wants; nothing pushed yet.

## Phase-1 once-over
- 2026-07-18 dispatched general-purpose reviewer (opus) + codex-runner (sonnet), siblings, scope merge-base(main)..HEAD
- 2026-07-18 Claude reviewer: H1 (high) — PLAN sidecar's cost parenthetical re-published
  the withheld detail the approved phrasing existed to exclude; regex-invisible
  contextual leak. FIXED with history purge: parenthetical reduced to the decision
  alone, and the two commits containing the leaky blob (plan records; devbox draft +
  design sample) rebuilt via soft reset so the detail exists nowhere in branch
  history (branch never pushed). Remaining findings (M2 third-person "Adam" voice in
  make-it-easy/visual-builder; nits: installed .gitignore, research stats telemetry,
  stale harness-notes pointer in PLAN, migrate_v1 breadth) held for synthesis with
  Codex's report.
- 2026-07-18 Codex reviewer: 13 findings (JOB verified, exit=0). Synthesis: 12 fixed
  + Claude's M2/nits in one delegated batch (installer eval→argv; gate gains
  session-URL patterns + unterminated-line fix; voice de-personalization; keyless
  paths run before dependency bootstrap; media path-escape guard; no-jq attention
  fallback; devbox.md accuracy; PLAN/RESEARCH annotations + telemetry trim;
  CLAUDE_HOME-aware script paths; state/HOST persistence). Session-URL trailer purge
  (Codex #1, high) = conductor history rewrite after the fix commit — SHAs cited in
  earlier entries become pre-normalization labels at that point. DEFERRED to Adam:
  Codex #10 — codex-runner "foreground-only" description vs async-collect contract
  contradiction, present in the live config too; not our call to resolve in the
  shipped copy. migrate_v1 breadth accepted as-is (v1 installed only commands+skills).

## Stage S3 — scripts & engines
- 2026-07-18 dispatched stage-runner (opus)
- 2026-07-18 PASS — 4 commits (58f89de tmux, 1c82e1d visual-page, ae7c7e6 make-it-easy,
  e8cc952 gen-image), conductor-verified on HEAD; independent leakage sweep CLEAN
  (tree + messages). Serving default inverted (127.0.0.1, MIE_HOST/MIE_BIND env);
  media degrades gracefully with no credentials (smoke-tested keyless: page builds
  text-only, loopback-only listen confirmed); GEMINI_API_KEY alt-auth landed in
  media_gen + gen_image (Vertex = tested path, api-key path wired but untested —
  documented). tmux helper now self-locating; hooks snippet derived from script
  source. Commit trailers match existing repo convention (single Co-Authored-By,
  no session URL) — accepted for public-history consistency.
