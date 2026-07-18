# adamsworkflow

How I run Claude Code. The loops, the config, and the devbox. A guide and my skills, commands, config, etc.

## What this is

A guide, plus the real files it describes: the actual 14 commands, 4 skills,
4 agent defs, 4 script packages, and 1 workflow I run at `~/.claude/`,
generalized so someone else can adopt them. The map of what each piece
requires and how it degrades is in [CLAUDE.md](./CLAUDE.md); my global
config, generalized, is [CLAUDE-global.md](./CLAUDE-global.md).

To be clear about what you are getting: this is a dated snapshot of a living
config (generalized 2026-07-18), not a framework — no version scheme, no
roadmap. It is what I actually run, cleaned up for machines that are not
mine. This file itself was drafted and adversarially reviewed by the loops
it describes; the final read, as always, is human.

The organizing idea, defined once — **loop engineering**, my own shorthand
rather than a term of art: engineering the loops around the model (review
convergence, verification gates, escalation policy) rather than the prompt
text. The commands here are mostly loops with
stopping rules. The config is mostly policy about when to spend more and
when to stop.

## If you only take one thing

The repo adopts in tiers. Each tier stands alone.

**Tier 1 — nothing to install beyond git.** `/quick-review` (a single
review pass over recent work), `/grill-me` (the agent interviews you about
a plan until the decision tree is resolved), `/askme` (pending questions
re-asked one at a time, with options and a recommendation), and the
Config-feedback rule from [CLAUDE-global.md](./CLAUDE-global.md) — one
paragraph that ends every session by asking for a grounded, one-line config
improvement. If you only take one thing, take the config-feedback rule.

**Tier 2 — the review ladder.** Adds the Codex CLI as a second reviewer from
a different vendor: `/dual-review`, `/lens-review`, `/review-fix-loop`, and
the `codex-consult` skill that drives Codex.

**Tier 3 — the full system.** The work-intake vehicles (`/build-system`,
`/orchestrate`, `/ship-issues`, `/teamwork`, `/auto-run`), the agent defs,
the page-serving stack, and the devbox.

Prerequisites, in one table:

| You need | For |
|---|---|
| nothing | `/grill-me`, `/askme`, the config-feedback rule |
| git | assumed everywhere — reviews scope themselves with a diff (`/quick-review` needs nothing else) |
| `gh` | `/ship-issues`, `/pr-auto-review`, `/auto-merge-main`, build-system's PR phases |
| Codex CLI | OpenAI's CLI, on its own account. Optional everywhere except the `codex-consult` skill itself: every review vehicle preflights `command -v codex` and, when it is absent, degrades by design to a labeled single-source review |
| a Google key | `gen-image`, and media on make-it-easy pages. Both degrade: a text-only page, or a clear exit message saying which key to set |
| python3 | the page-serving engines |
| tmux | the activity indicators |
| `frontend-design` plugin | named by `guided-tour` (click-through code tours), `teamwork`, and `visual` as a quality bar; all three run without it |

## The ten-second router

This table is the "Choosing the vehicle" section of
[CLAUDE-global.md](./CLAUDE-global.md), condensed. First match wins.

| Shape of the work | Vehicle |
|---|---|
| Trivial edit, pure Q&A | do it inline — no ceremony |
| Staged execution of a plan — one exists or you'll write one | `/orchestrate` |
| Meaningful repo change from a raw request | `/build-system` |
| GitHub issues to resolve, or an existing PR to ship | `/ship-issues` — review only: `/pr-auto-review`; PR behind main: `/auto-merge-main` |
| Non-code or mixed deliverable (research, proposal, docs) | `/teamwork` |
| Long unattended goal that must not stop for questions | `/auto-run` |
| A batch of decisions for the human | `/make-it-easy` (visual page) or `/askme` (inline) |
| Stress-test a plan with the human | `/grill-me` |

## Review tiers and the fix loop

Three tiers, one shared finding format, one loop that wraps any of them.

```
/quick-review ────► /dual-review ────► /lens-review
one Claude pass     + one detached      per-lens Claude+Codex
                    Codex run           fan-out, read-only

        wrap any tier:  /review-fix-loop <cmd>
        fix → re-review → stop on convergence,
        steady-state, regression, or the round cap
```

- `/quick-review` — a single pass over recent work: bugs, regressions, side
  effects. When it reviews edits made in its own session, it spawns one
  fresh-eyes sub-agent rather than grading its own homework.
- `/dual-review` — adds one detached Codex run on the same scope. The two
  reports are deduped, and every finding is validated against the actual
  diff before it reaches you.
- `/lens-review` — the widest tier: a per-lens fan-out, one Claude and one
  Codex reviewer per lens, strictly read-only. It never fixes.

`/review-fix-loop <cmd>` wraps any of the three: fix the meaningful
findings, re-review, and stop on convergence, steady-state, or regression,
with a cap of 5 rounds (3 when wrapping `/lens-review`).
Convergence is the goal. The cap is the cost guard.

Why two vendors: reviewers from different model families make
less-correlated mistakes than two passes of the same model. Dedup what
they agree on; investigate what they disagree on.

## How I work a meaningful task

The real current flow, end to end:

1. State the goal, then `/grill-me`. The agent interviews me until the
   decision tree is actually resolved — scope, tradeoffs, what done means.
2. `/build-system`. It sizes the docs to the work: PRD plus Plan for large
   or ambiguous work, a single Spec for medium, neither for small. Steps
   3–5 happen inside its pipeline — I list them because they are where the
   time goes.
3. Build.
4. `/review-fix-loop` on the diff.
5. Draft PR, then `/pr-auto-review`.
6. I read the PRD and the diff myself.

Reading the PRD yourself is the one check no review loop replaces: the
loops verify that the implementation matches the plan. They cannot catch a
plan that confidently builds the wrong thing. `/grill-me` encodes intent
going in; the step-6 read is the backstop for what slipped through. That
check stays human.

## The improvement loop

This is the part I would keep if I lost everything else. My global config
ends every session with the config-feedback rule: surface any grounded,
one-line improvement to the config that governs agents — a broken
instruction actually hit this session, a missing convention, a sharper
interface. I approve or reject each one. Approved changes land in the
config, and an append-only log records why each change happened. The config
compounds; nothing changes silently.

The bar matters: grounded in something that actually happened this session,
concrete enough to act on, worth the change. Not speculation.

Five entries from the log, sanitized but otherwise as they happened:

**2026-07-06 — a real failure became a rule.** A `/ship-issues` batch on my
main work repo stalled four sub-agents at their fan-out points — children
dispatched into the background, parents waiting on completions that had
been orphaned to the top-level session. The fix landed as config: a
dispatch-collection rule written into every command that fans out, plus a
field note explaining why.

**2026-07-10 — the harness changed underneath the config; probes caught
it.** Feedback from a `/lens-review` run claimed the "run this child in the
foreground" flag no longer existed. A five-probe session confirmed the
Agent tool had gone async-only, rewrote the relevant field note wholesale
("count your dispatches; collect every child's notification before the
join"), and swept every command that carried the old assumption.

**2026-07-13 — the model-by-omission gap.** A session running the most
expensive model launched three sub-agents at that same tier for work the
tier guide prices lower. Root cause: an unpinned dispatch inherits the
session model, so omitting `model:` silently escalates the child — nobody
decided that. New rule: explicit `model:` on every dispatch; omission is
not neutral.

**2026-07-15 — a guard born from a real failure.** The Codex model picker
kept reverting after a CLI upgrade: a daemon started ten days earlier was
holding the old version in memory and rewriting the shared model cache
every ten minutes. The durable fix was a nightly freshness guard with three
stacked checks — including an idle gate so it can never kill active work.

**2026-07-18 — retiring a bug class, not a bug.** Three same-shaped fixes
in one day pointed at a latent class across the whole review family:
losing track of exactly what is under review as work moves between agents
and across loop rounds — a child re-detecting scope from its own tree and
reviewing a different slice than its siblings, a validator re-deriving a
narrower diff and discarding real findings as "hallucinated". One audited
round made review scope an explicit, immutable value — established once,
handed down with "do not redetect", frozen against mid-run drift, every
finding validated against that exact diff — plus a fresh-eyes rule so no
agent reviews its own edits. The audit used the machinery it was fixing:
eight Codex rounds converged 17 → 9 → 8 → 4 → 4 → 4 → 3 → 0 findings, with
a fresh adversarial review as the final gate.

The takeaway: port the rule, not just the files. A snapshot of this config
goes stale the week you clone it. The loop is what keeps a fork alive.

## Delegation and model tiering

Every dispatched sub-agent gets a model tier, and the tier is picked by the
shape of the work, not its importance — important-but-mechanical work stays
on a cheap model, because verification catches loud errors cheaply. The
escalation test in one sentence: take the higher tier only when the work
sits at the lower tier's reasoning frontier AND a subtly-wrong output would
be expensive to catch downstream. Unbounded fan-outs — any stage whose
agent count is unknown when the model is chosen — get pinned to a cheap
model, always.

And the rule the 2026-07-13 log entry produced: explicit `model:` on every
dispatch, because omission is not neutral. Anthropic's own documentation
confirms that unpinned subagents inherit the session model
([docs](https://code.claude.com/docs/en/sub-agents)) — leave the field off
on an expensive session and the child silently runs at the top tier,
without anyone deciding that. The full policy — tier guide, ceiling,
fan-out rules, the standing exceptions — is in
[CLAUDE-global.md](./CLAUDE-global.md); I won't reproduce it here.

## Batching human decisions

The principle: an agent that needs twenty answers should ask for them in
one batch at a natural boundary, not scatter twenty interrupts through a
run.

- `/make-it-easy` — a calm visual walkthrough page for a batch of
  decisions, each with context, options, and a recommendation. Answers
  autosave while you click through; the agent waits and resumes.
- `/askme` — the same batching inline: pending questions re-asked one at a
  time as structured questions with options and a recommendation.
- `/grill-me` — the inverse: the agent interviews you until the plan's
  decision tree is resolved.

## Serving your pages

Everything in the suite that serves pages binds 127.0.0.1 by default — and
installing starts no servers, so nothing listens until you run something. Opening a page to other devices is an
explicit opt-in: bind 0.0.0.0 if you trust the network, or — better — bind
a private tailnet/VPN interface (e.g. Tailscale) so pages reach your phone
without reaching anyone else.

For make-it-easy specifically: `MIE_BIND` sets the interface the server
binds, and `MIE_HOST` sets the hostname printed in the URL — useful when
you bind a private interface and want the printed link to use its name.

Everything in the suite serves localhost-first, including the documented
`http.server` examples (`--bind 127.0.0.1` — Python's default is
all-interfaces, so keep the flag unless you mean to expose the page).

And the teardown habit: servers here are purpose-bound. When the purpose
completes — answers parsed, review decided, page superseded — kill the
server. The files stay on disk, and re-serving is one command.

## The devbox

I moved Claude Code off my laptop and onto an always-on Linux box. Every
device I own is now a thin client to the same running sessions — they
survive laptop lids, network drops, and travel. The full chapter, layer by
layer: [docs/devbox.md](./docs/devbox.md).

## Porting the concepts

If your tool is Claude Cowork, Cursor, or the Codex CLI, I can only answer
at the concept level: I haven't verified those platforms' primitives and
won't pretend otherwise.

What ports anywhere: the routing tree (a fixed intake decision instead of
per-task improvisation), the review ladder and its convergence discipline,
the config-feedback rule, docs-gated builds, and decision batching. None of
those depend on Claude Code.

What is Claude-Code-shaped: hooks, the subagent primitives, and the skills
format. If your tool has equivalents, the mapping is yours to make — I
would rather leave it to you than guess at APIs I haven't used.

## What this costs

I run through at least a full Max 20x subscription every week, plus
additional usage. This is not a cheap way to work.

The tiering policy is the cost control: cheap models pinned on unbounded
fan-outs, the escalation test as the gate every expensive tier has to
pass, review caps as cost guards. The claim is only that the spend is
deliberate — every expensive model run happens because a rule or an
explicit judgment call put it there, and the caps say when to stop. Note
also that the review ladder's second vendor is a second bill: the Codex
lane runs on an OpenAI account, priced separately from everything above.

## Where this sits

I checked the landscape before writing this, so you don't have to take "I
haven't seen this elsewhere" on faith. Star counts as of 2026-07-17:

- **GitHub's Spec Kit** (~122k stars) — spec-driven development with a
  built-in verification layer (converge/analyze/checklist commands). It is
  not the linear spec-to-code pipeline it sometimes gets caricatured as.
- **GSD** (Get Shit Done, a lean multi-agent orchestrator) — 61k+ stars in
  under five months, archived 2026-06, continued by the successor
  open-gsd/gsd-core. That is the velocity of this space: projects rise and
  get abandoned inside a season.
- **awesome-claude-code** (50.2k stars) — the directory genre: everything,
  catalogued.
- **Claude Flow** — the hive-mind swarm archetype: queen/worker roles,
  swarm topologies. A different bet than mine — it scales agent count and
  coordination structure, where this repo scales review loops and stopping
  rules.
- Cross-model review has clear prior art. **hamelsmu/claude-review-loop**
  (705 stars) runs OpenAI's Codex CLI as an independent reviewer from a
  Stop hook, and OpenAI's own **codex-plugin-cc** ships
  `/codex:adversarial-review` inside Claude Code. The concept is public —
  I didn't invent it. [sankalp's write-up](https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/)
  argues the same Claude-executes/GPT-reviews preference from a year of
  use.

So what is left to claim? Something narrow:
"each element exists somewhere; the integrated system does not appear to".
That is an absence-inference over roughly 30 verified sources — not a
uniqueness boast, and one good link from you falsifies it. The survey
itself ships in this repo:
[plans/guide-rebuild-RESEARCH.md](./plans/guide-rebuild-RESEARCH.md) —
method, sources, and the claims that failed verification.

The devbox chapter gets the same treatment: at least eight independent
guides cover the Tailscale/mosh/tmux fragments (the chapter credits them);
none of the surveyed ones integrate a statusline — the one layer this repo
deliberately ships as a build-your-own prompt rather than a script (see
"What's intentionally not here").

## Install and adopt

```bash
git clone https://github.com/adamjgmiller/adamsworkflow.git
cd adamsworkflow
./install.sh --symlink    # or --copy; add --dry-run to preview either
```

| Mode | Behavior |
|---|---|
| `--symlink` | each file symlinked into `~/.claude/` — `git pull` updates your live config |
| `--copy` | each file copied — an independent baseline you fork and tweak |
| `--dry-run` | pairs with either mode; prints every action, touches nothing |

Existing files are backed up to `<file>.bak-<timestamp>` before being
replaced. Re-runs in symlink mode are idempotent — links already pointing
into this clone are left alone. `CLAUDE_HOME` overrides the `~/.claude`
target.

One thing to be clear-eyed about with `--symlink`: it means my future
commits edit your live config on your next `git pull`. If you want my
updates, that is the feature. If you would rather not extend that trust,
use `--copy`, or pin the clone to a commit you have read.

**What it installs:** `commands/`, `skills/`, `agents/`, `workflows/`, and
`scripts/`, plus [docs/field-notes.md](./docs/field-notes.md) — the
commands cite it at `~/.claude/docs/field-notes.md`.

**Deliberately not installed:** `README.md`, [CLAUDE.md](./CLAUDE.md),
[CLAUDE-global.md](./CLAUDE-global.md), [docs/devbox.md](./docs/devbox.md),
and the design-sample page (a style reference for generated pages) —
reference documents you merge by choice — and
[scripts/check-leakage.sh](./scripts/check-leakage.sh), which is a
repo-maintenance gate, not config.

**Migrating from v1:** if you installed the earlier version of this repo,
`/quick-dual-review` became `/dual-review`, and `/adams-merge-all-prs` and
the `ar:fix-and-verify` wrapper were removed. The installer removes
dangling symlinks under `commands/` and `skills/` — the two directories v1
shipped — that point into this clone at files that no longer exist, and
says so when it does.

Or let your Claude do the adapting. Paste this into Claude Code inside the
cloned repo:

```text
I just cloned this repo (adamsworkflow). Help me adapt and install it.

1. Read CLAUDE.md (the dependency matrix) and README.md so you know what
   each piece requires and how it degrades.
2. Ask me which tier I want: Tier 1 (the zero-prerequisite commands and
   the config-feedback rule), Tier 2 (the review ladder plus the Codex
   CLI), Tier 3 (the full system), or specific pieces I name.
3. Check which prerequisites are actually present on this machine (git,
   gh, the Codex CLI, python3, tmux, a Google key) and tell me exactly
   what degrades without each missing one.
4. Adapt the serving convention and keys to this machine: pages bind
   127.0.0.1 unless I explicitly opt in to a wider interface, and image
   generation uses my own key or stays text-only.
5. Then install — ./install.sh --symlink or --copy, or a selective copy
   of just the pieces I chose — backing up anything you would replace.
```

A clean-machine test of this prompt is part of this repo's pre-release
checklist. Until that lands, treat it as the intended flow rather than a
verified one.

## What's intentionally not here

- **My statusline script.** The devbox chapter teaches which segments earn
  their place and ships a prompt for building your own instead — the same
  move as the adaptation prompt above: tell your own Claude what you want.
- **My personal infrastructure.** Bot configs, sync tooling, private
  services. Nothing shipped here depends on them.
- **A live update feed.** This repo gets occasional re-syncs from the live
  config. The improvement loop itself lives upstream — which is exactly
  why the improvement-loop section above says to port the rule, not just
  the files.

## Acknowledgments and license

- **Matt Pocock** — the grill-me concept and original implementation
  ([mattpocock/skills](https://github.com/mattpocock/skills)); upstream
  attribution preserved in
  [skills/grill-me/ATTRIBUTION.md](./skills/grill-me/ATTRIBUTION.md).
- **hamelsmu/claude-review-loop** and **OpenAI's codex-plugin-cc** —
  cross-model review prior art.
- The devbox write-ups credited in the prior-art section of
  [docs/devbox.md](./docs/devbox.md).

MIT — see [LICENSE](./LICENSE).
