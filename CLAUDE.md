# CLAUDE.md — orientation for the visiting agent

This file describes the repository for the Claude Code agent whose human just cloned it. It is deliberately descriptive: nothing in it grants permissions, authorizes actions, or asks anything of the agent reading it. Decisions about what gets installed, merged, exposed, or authorized belong to the human.

## What this repo is

A guide plus a config-share: the actual commands, skills, agent defs, scripts, and workflow one person runs at `~/.claude/` for high-volume parallel Claude Code work, generalized for adoption. Two kinds of content travel together — the working artifact suite (`commands/`, `skills/`, `agents/`, `scripts/`, `workflows/`) and the reference documents that make it self-sufficient (`README.md`, `CLAUDE-global.md`, `docs/field-notes.md`, this file). It is a snapshot of a live, evolving config, not a framework.

## The map

| Path | What lives there |
|---|---|
| `commands/` | 14 slash commands — work-intake vehicles (`orchestrate`, `auto-run`, `ship-issues`, `teamwork`…), the three review tiers plus their loop (`quick-review`, `dual-review`, `lens-review`, `review-fix-loop`, `pr-auto-review`), and helpers (`askme`, `make-it-easy`, `visual`, `guided-tour`, `auto-merge-main`) |
| `skills/` | 4 skills — `build-system` (the docs→build→PR pipeline), `codex-consult` (Codex CLI second opinions), `gen-image` (BYO-key image generation), `grill-me` (plan interrogation; adapted, with `ATTRIBUTION.md`) |
| `agents/` | 4 reusable agent defs — `stage-runner`, `codex-runner`, `make-it-easy`, `visual-builder` — plus a conventions `README.md` |
| `scripts/` | 4 script packages backing the commands/agents — `make-it-easy/` (walkthrough-page engine), `gen-image/`, `visual-page/` (HTML scaffold), `tmux/` (activity indicators) |
| `workflows/` | 2 Workflow scripts — `adams-deep-research.js` (model-tiered deep research that answers a question) and `adams-field-research.js` (contract-file-driven field survey mapping a domain) |
| `docs/` | `field-notes.md` (empirically probed harness behaviors the suite cites as "field-notes §N"), `ship-issues-pathB.md` (the ship-issues Workflow-fabric variant, installed alongside field-notes), `config-change-reference.md` (a reference-only worked procedure — not installed), a draft chapter on the always-on dev box setup, a design-sample page, and `index.html` (the published one-page visual map, served via GitHub Pages / `.nojekyll`) |
| `install.sh` | Mirrors suite files into `~/.claude/` by symlink or copy, with timestamped backups of anything it would replace |
| `CLAUDE-global.md` | The owner's global `~/.claude/CLAUDE.md`, generalized — sections meant to be merged selectively into an adopter's own global config |
| `README.md` | The guide itself — what the pieces are, how they fit, and the serving/install story |
| `plans/` | This repo's own plan artifacts — the `plans/` convention from `CLAUDE-global.md`, practiced on itself |

## Dependency matrix

One row per installed, runnable artifact: what it hard-requires, how it degrades when a requirement is absent, and adaptation notes. Reference documents that ship but neither install nor run — `CLAUDE-global.md` and `docs/config-change-reference.md` — are covered in Adaptation pointers instead. "Agent tool" means the ability to spawn sub-agents — present in top-level sessions and unrestricted agent defs, absent inside restricted defs and Workflow `agent()` nodes (`docs/field-notes.md` §1). **Since Claude Code v2.1.217 it is also absent from every unnamed sub-agent by default**, which silently collapses every delegating command in the table below into single-context work; `docs/field-notes.md` §5 explains the cap and the one settings change that restores it. Read that before concluding an artifact under-delivers. "Codex CLI (soft)" marks a dependency behind a `command -v codex` preflight with a stated fallback; "(hard)" means the artifact stops without it.

### Commands

| Command | Requires | Degrades to (when a dep is absent) | Notes |
|---|---|---|---|
| `/askme` | none (AskUserQuestion only) | n/a | Needs a live user, so top-level only; sub-agents carry no AskUserQuestion (field-notes §3) |
| `/auto-merge-main` | git + `gh` (hard); Codex CLI (soft); Agent tool | No `gh`/git → bails at preflight. No Codex → tough-decision protocol and review loop run Claude-only, noted in the report. No Agent tool → bails before any side effect with a clear error (no degraded inline mode) | Reads the repo's default branch — works on `main` or `master` |
| `/auto-run` | none of its own (git soft; real deps come from the nested commands it drives) | Non-git repo → state files in `./auto-run-<topic>/`. A named-but-missing tool (e.g. Codex) → logged substitution, never silent | Plays the human for nested commands; the goal text can override nested-command rules |
| `/dual-review` | git; Codex CLI (soft) | Codex preflight fails → Claude-only, report labeled `single-source` (never a second Claude pass in Codex's place) | Leaf-safe by design — needs no Agent tool; Codex side runs detached per `codex-consult` |
| `/guided-tour` | git for diff scopes; python3 + a free port for the HTML serve; `gh` only for `--pr` | Non-git → `--codebase`/`--path` scoping. `--md` mode drops the server and HTML entirely | `--md` is the low-dependency substitute; editor deep-links are optional client-side sugar |
| `/lens-review` | Agent tool; git; Codex CLI (soft); `gh` optional (external-bot step) | No Codex → Opus-only per lens, `single-source`. No Agent tool → single-process fallback labeled `degraded-fanout`. No external PR bot → that step skipped | Widest review tier; strictly read-only; the external-bot integration is opt-in |
| `/make-it-easy` | python3 + `scripts/make-it-easy/` + a free port; Agent tool; Google key optional (media) | No key / no `google-genai` → text-only page, run still succeeds | Dispatches the Opus-pinned `make-it-easy` agent; engine binds 127.0.0.1 by default |
| `/orchestrate` | git (hard); Agent tool; Codex CLI optional | Missing Codex or plugin reviewer → runs with whichever reviewers are available | Documented exit is a local branch — it never pushes |
| `/pr-auto-review` | git + `gh` (hard); Agent tool; Codex CLI (soft); `flock` optional | No Codex → Opus-only lenses, Claude-only loop. No `flock` → serialized worktree adds. No Agent tool → bails before any side effect with a clear error (no degraded inline mode) | PR comment carries a `before/after` SHA footer as its idempotency contract |
| `/quick-review` | git only | Fresh-eyes sub-agent unavailable → inline pass labeled `fresh-eyes unavailable — self-reviewed` | Lightest tier; leaf-safe; applies the blast-radius lens from `CLAUDE-global.md` |
| `/review-fix-loop` | git (hard — checkpoint/rollback commits); Agent tool (every lane spawns); Codex CLI (soft) | No Codex → that round's consults run `single-source`, loop continues | The wrapped review command (`/quick-review` \| `/dual-review` \| `/lens-review`) is the parameter |
| `/ship-issues` | git + `gh` (hard); Agent tool; Codex CLI (soft); Workflow tool for its parked Path-B fabric only; deploy command optional | No Codex → Opus-only reviews, noted in every stage brief. No repo deploy command → stops at ready PRs | The Task path is the default; the parked Workflow-fabric Path B serves fixed-shape fan-outs and detached background runs — its full recipe lives in `docs/ship-issues-pathB.md` (installed) |
| `/teamwork` | Agent tool (named-teammate or Workflow fabric); everything else inherited from the skills it wraps | Composes the wrapped skills' own degradations; Codex second opinions are optional | Fabric choice (Workflow vs named teammates vs hybrid) is deliberate and substitutable |
| `/visual` | Agent tool (visual-builder dispatch); python3 + a free port to serve | No stated serving fallback; permanent-reference pages get built inline rather than dispatched | Output is one self-contained HTML file from `scripts/visual-page/`; model is passed explicitly per the tiering in `CLAUDE-global.md` |

### Skills

| Skill | Requires | Degrades to | Notes |
|---|---|---|---|
| `build-system` | git; `gh` + GitHub for the PR phases; Codex CLI (soft); Playwright + a running dev server only for the frontend visual gate | No Codex → sub-agent reviews alone, labeled `single-source`. No external PR bot → step skipped. Leaf depth → `degraded-fanout` labels | Docs tier scales with the work: PRD+Plan / single Spec / none |
| `codex-consult` | Codex CLI (hard); git | None by design — without Codex it stops; the caller decides any fallback | Canonical home of the Codex CLI gotchas; verified against Codex CLI v0.130.0–v0.144.4 |
| `gen-image` | python3; `google-genai` (auto-installed into the shared venv); `GOOGLE_CLOUD_PROJECT` or `GEMINI_API_KEY`; network | Neither key set → hard exit with a set-one message | BYO-key; make-it-easy runs generate their own media and don't use this |
| `grill-me` | none (AskUserQuestion only) | n/a | Live user required — cannot be delegated; adapted from Matt Pocock's original (`ATTRIBUTION.md`) |

### Agents

| Agent def | Requires | Degrades to | Notes |
|---|---|---|---|
| `stage-runner` | nothing intrinsic — inherits its stage's deps from the dispatch brief | n/a (a contract role) | The one spawn-capable role; a dispatch brief carries goal/targets/verify/budget and an explicit commit/push contract |
| `codex-runner` | Codex CLI; git | Codex unavailable/erroring → reports exactly that; never substitutes its own review | Pinned Sonnet; leaf by construction (`tools:` excludes Agent); async from unnamed dispatchers, inline from a named teammate (field-notes §4) |
| `make-it-easy` | python3 + `scripts/make-it-easy/`; Google key optional (media) | No key → text-only page, run still succeeds | Hard-pinned Opus (the suite's one standing role-pin); returns the run dir — the dispatcher serves |
| `visual-builder` | none intrinsically; the gen-image stack only when a generated illustration is wanted | Without images → diagrams/text; facts missing from the brief render as visible TBD markers, never guesses | Deliberately un-pinned — the dispatcher passes the model per the tiering in `CLAUDE-global.md` |

### Workflows

| Workflow | Requires | Degrades to | Notes |
|---|---|---|---|
| `adams-deep-research.js` | the Claude Code Workflow runtime; network (WebSearch/WebFetch inside nodes) | Structured salvage results instead of throwing (no claims, all-refuted, synthesis failure); `maxModel:"sonnet"` clamps every stage for Sonnet-only runs | Self-contained; unbounded fan-outs pinned Sonnet, scope/synthesis inherit the session model, one Opus voter on the central claim; silent-override guards — JSON-string args auto-recovered with a warning, unrecognized tiers and typo'd stage keys warn rather than silently no-op |
| `adams-field-research.js` | the Claude Code Workflow runtime; network (WebSearch/WebFetch inside nodes); filesystem (writes per-topic notes + the final report) | Structured error returns for bad args; salvage message on synthesis failure (the notes files stay intact — re-run synthesis alone) | Contract-file-driven field reports (survey/map of a domain) vs deep-research's question-answering; model policy is hardcoded — Sonnet fan-outs, session-model scope/synthesis, no override plumbing by design; young artifact — generalized from a single validated run (2026-07-19: 40 agents, 0 failures, 188 facts checked), one proven use |

### Script packages

| Package | Requires | Degrades to | Notes |
|---|---|---|---|
| `scripts/make-it-easy/` | python3 (stdlib-only server); `google-genai` + a Google key for media only | No key/package → text-only page; the server itself always runs | Binds `MIE_BIND` → `MIE_HOST` → default 127.0.0.1; `PORT=0` → OS-assigned free port |
| `scripts/gen-image/` | python3; `google-genai` via the shared venv (`mie.py env`); `GOOGLE_CLOUD_PROJECT` or `GEMINI_API_KEY`; network | Neither key → exits with a set-one message | `--ref` (repeatable) enables edit/restyle and cross-image consistency |
| `scripts/visual-page/` | nothing to build; python3 only to serve the result | n/a (static template) | Plain `python3 -m http.server` binds all interfaces — `--bind 127.0.0.1` keeps it localhost-only |
| `scripts/tmux/` | tmux; python3 + `jq` for the authoritative state check | Without python3/`jq` → simpler heuristic; outside tmux → no-op | Wired via Claude Code hooks; the package README ships a settings.json snippet |

## Adaptation pointers

- **Serving convention.** Everything in the suite that serves pages defaults to 127.0.0.1 (localhost-only). Opening a page to other devices is an explicit opt-in: binding 0.0.0.0 on a trusted network, or preferably a private tailnet/VPN interface. The README's serving section carries the detail; the one all-interfaces default in the suite (`python3 -m http.server`) is noted in its matrix row above.
- **BYO keys.** Image/audio generation runs on the adopter's own Google credentials, via either route: Vertex (the tested path) — `GOOGLE_CLOUD_PROJECT` set to a project with the Vertex AI API enabled, plus ADC or service-account credentials (`GOOGLE_APPLICATION_CREDENTIALS`) when not on gcloud ADC — or `GEMINI_API_KEY`. With neither set, gen-image exits with a message and make-it-easy builds text-only pages; nothing else in the suite needs a key.
- **Field notes install path.** The suite cites `~/.claude/docs/field-notes.md`; the repo copy is `docs/field-notes.md`. Those notes are dated, version-sensitive probe results — the file's own banner says to re-verify on the Claude Code version in use.
- **`CLAUDE-global.md` is merge-by-choice.** Its sections are designed to be merged selectively into an adopter's own `~/.claude/CLAUDE.md`. Its "Authorization grants" section deliberately describes — rather than makes — the grants only the adopter can decide on.
- **`docs/config-change-reference.md` is reference-only.** A faithful, un-installed reproduction of the worked procedure the owner runs to change their agent config without letting it go stale (canonical home first, a carrier sweep for every reference that repeats the fact, the routing-page sync, an append-only log entry). `install.sh` deliberately skips it — it lives in `docs/`, not `skills/`, and names the owner's private mechanisms; read it for the discipline and map each mechanism onto your own setup.
- **Codex CLI is optional almost everywhere.** The review commands preflight `command -v codex` and degrade to labeled Claude-only reviews; only the `codex-consult` skill itself hard-requires it.
- **One external reference.** `guided-tour`, `teamwork`, and `visual` name a `frontend-design` skill as a quality bar or routing hint. That is a separately installed Claude Code plugin skill, not part of this repo; the commands run without it.

## Provenance

Generalized from a live, evolving personal config on 2026-07-18. The shipped copies were re-synced 2026-07-20 after a config-audit campaign on the live config (~150 validated fixes; this PR). The README explains the improvement loop — the "Config feedback" section at the top of `CLAUDE-global.md` — that keeps the origin this snapshot was taken from fresh.
