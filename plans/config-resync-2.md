---
branch: config-resync-2
base: main
started: 2026-07-28
---

# config-resync-2 — re-sync shipped config after the Opus 5 model-routing change

## Goal

Port the live-config deltas that landed after PR #2 (merged 2026-07-20) into the
shipped suite. Sync point: the live config as of 2026-07-20 08:18 UTC; delta is
94 commits / 20 files / +263 −114 upstream.

## Scope — six themes

Derived by diffing the live config over the post-sync range and intersecting with
what this repo actually ships.

1. **Model routing (Opus 5).** Fable is no longer an agent-selectable tier — the
   human names it or it doesn't happen. Opus becomes the ceiling an agent may pick,
   the escalation test ranges only over Haiku↔Sonnet↔Opus, and the ceiling is
   restated as policy rather than a harness limit. Touches `CLAUDE-global.md`, 11
   commands, `agents/visual-builder.md`, `skills/build-system/SKILL.md`,
   `docs/ship-issues-pathB.md`, plus the two public surfaces (`README.md`,
   `docs/index.html`).
2. **Backgrounded work no longer re-wakes a stopped sub-agent** (re-probed
   2026-07-23, v2.1.218) — reverses the 2026-07-10 finding the suite was built on.
   Field-notes §4 plus every carrier that told an agent to background-and-await.
3. **Harness spawn-depth cap** (v2.1.217): unnamed sub-agents hold no Agent tool
   unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set. This one is a live defect
   for adopters — the stage-runner pattern the suite is built on silently degrades
   without it.
4. **Worktrees rule promoted** to a first-class `CLAUDE-global.md` section; carriers
   cite it instead of restating it.
5. **zsh traps** — field-notes §11 grows `=`-prefix expansion, `PIPESTATUS`,
   `/dev/tcp`, and the swept bashisms.
6. **Misc** — commit messages that quote code, review-fix-loop's inline-fix lane and
   consult recovery file, config-change-reference's entity-grep pass, a
   make-it-easy stylesheet fix.

## Not ported

- **Greptile completion detection** (~40% of the upstream diff by volume). The public
  suite has Greptile generalized out to "external PR bot" — nothing to carry.
- **chezmoi mechanics.** The `Config sync` section is a deliberate one-liner here.
- **settings.json env.** The repo ships no settings.json; theme 3 lands as
  documentation instead (see Decisions).

## Decisions

- **D001 — `install.sh` does not write the adopter's `settings.json`.** Theme 3 needs
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=4` to be set for the suite's delegation
  patterns to work at all. Having the installer mutate a user's settings is
  invasive and out of character for a script whose contract is "mirror files, back
  up what you replace." Documented in README + field-notes + the repo CLAUDE.md
  dependency matrix instead, so the adopter makes the change knowingly.
- **D002 — `plans/` history is not rewritten.** The older plan records name Fable as
  an escalation target; they are point-in-time records of runs that happened, not
  live instructions.

## Log

- 2026-07-28 — branch opened; scope derived from the upstream diff; theme 1 ported.
