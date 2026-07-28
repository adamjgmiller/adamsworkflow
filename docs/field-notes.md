# Field notes — probed harness behaviors behind the command suite

> **What this is.** Empirically probed Claude Code harness behaviors that the commands
> and agent defs in this repo rely on. Each finding carries the date it was probed where
> the probe was dated. **Harness behavior changes across Claude Code versions — verify on
> your version before relying on any of these**, especially the collection semantics in
> §4, which have already changed more than once. `install.sh` installs this file to
> `~/.claude/docs/field-notes.md`, which is the path the commands cite.

Single home for the empirically-probed harness facts the commands and agent defs rely
on. Files state each operative rule inline in one line and cite a section here; this
file holds the full statement, rationale, and provenance. When a probe result changes,
update it HERE, then grep the suite for the section cite to find affected files.

## §1 Fabric spawn capabilities
- **Task fabric (Agent tool): dispatched sub-agents CAN spawn children** when their def
  doesn't restrict `tools:` (a `general-purpose` agent holds the Agent tool; `Explore`/
  `Plan` types do not) **AND the §5 spawn-depth cap allows their depth** — since
  v2.1.217 the default cap strips Agent from ALL unnamed sub-agents unless
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set (§5 has the full mechanism). This
  enables the stage-agent pattern: one delegated agent runs a
  whole stage and fans out its own leaves.
- **Workflow fabric (`agent()` nodes): agents CANNOT spawn** — no Agent tool at all.
  Every fan-out on that fabric lives in the script (`parallel()`/`pipeline()`), never in
  a delegated fan-out command.
- Provenance: both halves probed 2026-06-10; re-verified since.

## §2 Sub-agent cwd resets on every Bash call
A dispatched agent starts in the dispatcher's cwd (which may be a worktree) but resets
to it on EVERY Bash call — a `cd` does not persist to the next call. Use absolute paths
/ `git -C <abs>` everywhere, or fold `cd <dir> && <cmd>` into a single call. Root cause:
the Bash tool's "working directory persists between calls" wording is a main-thread
property that does not apply to agent threads; the agent-thread footer ("cwd reset
between bash calls") is authoritative. Hazard: git SHAs/status resolve plausibly against
the shared object DB from any checkout, so a wrong-tree operation looks fine while
editing or validating the wrong tree.
- Provenance: probed 2026-06; re-probed 2026-06-26; re-probed 2026-07-10 on v2.1.206
  (unchanged — cwd resets every call at depth even though the sub-agent's own Bash tool
  description says it persists; survived the v2.1.198 async redesign).

## §3 Sub-agents cannot reach the user
Dispatched sub-agents and Workflow agents carry no AskUserQuestion tool. Never brief one
to "ask the user." The pattern: a delegated agent that hits a human-only decision STOPS
and returns it **packaged as data** (question, options, recommendation, work state); the
main loop surfaces it (AskUserQuestion directly, or /askme for a batch).
- Provenance: probed 2026-06.

## §4 Collection semantics (dispatch modes / notifications)

Dispatch mode depends on the dispatching CONTEXT — main loop, unnamed sub-agent, or
named teammate — and, at main level, whether the child is named
(probed 2026-07-15 on v2.1.210; supersedes the 2026-07-10 "async-only at every depth,
`run_in_background` gone" findings — history: the probe-session log, 2026-07-10/15
entries).

- **Main level, unnamed child: async by default; `run_in_background: false` is back
  and REAL** — a sync dispatch blocks the turn and returns the child's full final text
  + usage block inline (probed: ~26s block for a 15s child). Supersedes 2026-07-10's
  "flag silently ignored". Fan-outs stay async; sync fits a single child whose result
  you need before continuing. The flag applies to unnamed children only — naming a
  child forces the background-teammate path (bullet below), sync flag or not.
- **Unnamed sub-agents (any depth): async only.** No `run_in_background`/`name`/`mode`
  params at depth. Every dispatch returns a launch ack; batched dispatches in one
  message run CONCURRENTLY (probed: two 45s children started 3s apart, windows fully
  overlapping). The depth Agent schema's own text — "Only synchronous subagents are
  supported" — is WRONG for unnamed dispatches; trust this note over it.
- **Dispatches made BY a named teammate are SYNCHRONOUS** — each Agent call the
  teammate makes blocks until the child completes and returns the final text + usage
  inline (probed: ~78s block through a 60s child, secret token delivered in-result).
  A named teammate therefore cannot end its turn with a child mid-run — the old
  orphan/stall trap (2026-07-05/06) is structurally closed, and file handoff is no
  longer REQUIRED to collect a named teammate's leaves. Batched named dispatches'
  concurrency is UNTESTED — assume serialized: keep a named teammate's own fan-outs
  small; run wide fan-outs unnamed or at the orchestrator. **The other direction —
  dispatching a NAMED child from the main loop — stays async/background**: the
  dispatcher gets a launch ack and keeps working (same 2026-07-15 probe: the teammate
  ran while the dispatcher's turn continued), and its completion surfaces only as a
  result-less idle ping (bullet below) — which is why the SendMessage-final-act rule
  exists for named spawns. Don't conflate the two directions.
- **Collection (main + unnamed depth) is push-only via task-notifications** carrying
  the child's full final text in a `<result>` field. Mid-turn, a completion attaches
  to the dispatcher's NEXT tool-result boundary — never a turn of its own
  (re-confirmed 2026-07-15); a dispatcher that has ENDED its turn is re-woken (probed
  2026-07-10). **Operative fan-out rule: count your dispatches and reconcile
  arrivals** — don't run the join until every child's notification has arrived; the
  failure modes are joining on partial results and double-dispatching a child whose
  notification hasn't landed, not stalling.
- **A dispatcher's own completion notification defers while it has live agent
  children** ("fires each time this agent stops with no live background children of its
  own") — a parent stopping with children pending doesn't falsely signal completion
  upward. Backgrounded BASH tasks do NOT defer it (probed 2026-07-10; re-confirmed
  2026-07-23).
- **Backgrounded Bash at depth does NOT re-wake a stopped sub-agent** (probed
  2026-07-23 on v2.1.218: child stopped with a sleep-40 background task pending; the
  task exited; no re-invocation within ~2.5 min. Supersedes the 2026-07-10 re-wake
  probe, which itself superseded a 2026-07-07 no-re-wake probe — VERSION-VOLATILE:
  re-probe on upgrades). Same-day field grounding: 4 stalls in one `/ship-issues`
  run — backgrounded test suites, Monitors, and timers all stranded stopped
  sub-agents, while agent-child completion notifications delivered fine. The main
  loop is unaffected — its backgrounded Bash still re-invokes it on exit. At depth:
  foreground fits anything under the ~10-min Bash ceiling (bare and chained `sleep`
  are BLOCKED — use an `until <check>; do sleep 2; done` loop); a longer run may be
  backgrounded but must be POLLED — bounded foreground checks of its output file —
  and a sub-agent must never stop or return with a run pending. A stalled child
  resumes with full context via SendMessage to its agentId (works even after
  TaskOutput reports "No task found"); the stall's tell is a completion notification
  carrying "waiting for X" instead of its deliverable.
- **Still no pull channel at depth**: sub-agents have no TaskOutput (ToolSearch finds
  none — re-confirmed 2026-07-10); the main loop does. Results reach sub-agents only
  via notifications (or inline, for a named teammate's sync dispatches). File handoff
  (child writes a known path before returning) remains the belt-and-braces recovery
  channel for a lost notification — review-fix-loop's `RUN_DIR/round-<r>-report.md` is
  the worked example. **Handoff-file naming — harness guard**: a subagent Write to a
  basename matching `^(REPORT|SUMMARY|FINDINGS|ANALYSIS).*\.md$` (case-insensitive) is
  refused with a tool_use_error ("Subagents should return findings as text…") —
  applies to named teammates too; Bash writes bypass it (Write-tool layer only);
  filename triggers it, not content; the permission system is never consulted, so
  `permissions.allow` can't override. Name handoff files outside that family — the
  regex is prefix-anchored, so `round-<r>-report.md` and `handoff.md` pass. Probed
  2026-07-16 (7-probe matrix + binary regex extraction; probe-session log).
- **A named teammate's stops surface only as result-less `idle_notification`
  teammate-messages, never result-carrying task-notifications** — probed 2026-07-15:
  each of the probe teammate's two stops generated
  `{"type":"idle_notification","idleReason":"available"}` stamped ~10s after the stop,
  but both were delivered to the main session minutes later, batched, only after the
  dispatcher's long turn ended — delivery waits for a turn boundary. No final text
  rides along: not a completion report, never a join signal. The teammate's final
  plain-text turn is still not reliably surfaced (observed 3-of-5 loss in one
  pre-redesign pipeline). Keep the SendMessage-final-act rule for named spawns;
  anything that must land goes in a file or a SendMessage.
- **SendMessage RESUMES a stopped/completed agent from its transcript** — probed
  2026-07-15: a poke resumed a deliberately-stopped named teammate in ~17s and it
  executed its follow-up protocol cleanly. The old caveat ("SendMessage-resumption is
  not known to restore notification delivery") is resolved as MOOT: sync dispatch
  means a named teammate can never have pending agent-child notifications. Completed
  unnamed agents stay addressable the same way via their agentId.
- Provenance: 2026-07-15 four-probe set on v2.1.210 (named-teammate sync dispatch +
  resume poke with token-carrying leaf; unnamed batched-pair concurrency; unnamed
  single dispatch; main-level sync flag), file-timestamped in the probe session's
  scratchpad; 2026-07-10 set for the deferral / TaskOutput facts; 2026-07-23 probe
  (v2.1.218) + same-day `/ship-issues` field stalls for the no-re-wake-at-depth fact.
  Grep the suite for `field-notes §4` to enumerate carriers; any NEW fan-out brief must state
  the collect-before-join rule explicitly.

## §5 Depth convention & the harness spawn-depth cap
Keep nesting within ~3–4 levels — a self-imposed legibility/debuggability convention.
Counting: each Agent dispatch = +1; invoking a skill/command inline = +0 (it runs in
the current agent's context); a detached CLI launch via Bash = +0. Sum across composed
delegations; collapse a level when stacks run deep.

Harness cap (v2.1.217; probed live + binary-read 2026-07-22): an agent at depth d
holds the Agent tool only while d < MAX; at or past MAX the tool is **stripped from
its toolset** (absent from the tool list, ToolSearch can't load it — not a call-time
refusal; a "Subagent nesting limit reached" error exists only as backstop). MAX
resolves: env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` if set → else a remote feature
flag (integer floor 1, so remote config can deepen but never block main-loop spawns)
→ else 1. **Default observed = 1: unnamed subagents cannot spawn at all** (probed:
unnamed depth-1 agents toolless — sync, async, interactive, headless;
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=4` restores the tool, validated headless).
Named teammates are the exception: the roster is flat, a teammate sits at depth 0,
holds Agent, and spawns unnamed children (probed; those children are toolless);
teammates cannot spawn teammates (hard error).

**Adoption consequence — read this before running the suite.** Without the env var,
every unnamed conductor in this suite silently degrades to inline work: the
stage-runner pattern, `/orchestrate`'s per-stage dispatch, `/pr-auto-review`'s per-PR
agents and their lens fan-out, `/ship-issues`' resolve agents. Nothing errors; the
work just collapses into one context. Set
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=4` in your `~/.claude/settings.json` `env`
block (4 covers the ~3–4 convention above). Settings `env` reaches NEW sessions only
— restart after changing it. `install.sh` deliberately does not write this for you;
it is your settings file to change.

Supersedes the pre-2.1.217 "5-level documented cap" (v2.1.172/174) — and note the
probe-hygiene trap that produced a false reading first time: `claude --version` reads
the binary on disk, not the runtime of the session you are sitting in, so an
in-session probe after an upgrade tests the OLD version. Probe through a fresh
`claude -p` headless call.

## §6 Concurrency
The ~16-concurrent figure is a Workflow-TOOL limit (min(16, cores−2) per workflow); it
is NOT a Task-fabric fact. Task-fabric queue-vs-error behavior past the platform's
comfort point is unverified — commands cap themselves (typically ≤4 stage-agents in
flight, counting each agent's own fan-out toward the real concurrent total) and stay
under budget rather than probing the edge.

Watch items (changelog v2.1.212, UNTESTED): session-TOTAL subagent-spawn cap, default
200 (`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`; `/clear` resets) — a cumulative budget,
distinct from §5's depth cap and the concurrency figure above; error-vs-queue at the
cap unprobed; long autonomous flows (auto-run, big ship-issues batches, wide
deep-research fan-outs) are the plausible approachers. Also a session-wide WebSearch
cap, default 200 (`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`) — relevant to wide
deep-research fan-outs.

Concurrently-RUNNING subagent cap (v2.1.217): default 20
(`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), confirmed by binary-read 2026-07-22; at the
cap the spawn ERRORS ("Concurrent subagent limit reached… Do not retry") rather than
queuing — binary-read, live-unprobed. A third distinct limit (concurrent, vs §5 depth
and the session-total above). Wide unnamed fan-outs (20+ validators in one message)
are the plausible approachers.

## §7 Playwright browser is a session-global singleton
One shared tab across the main loop and every sub-agent (same MCP server). Two agents
driving it concurrently silently corrupt each other's page with NO error. Serialize all
browser/visual work to exactly one agent at a time; never put it in a concurrent
fan-out. Sub-agents reach Playwright via ToolSearch deferred-load; defs with a
restricted `tools:` list can't. Provenance: observed in field use (date unrecorded);
not re-probed.

## §8 Codex CLI mechanics
Canonical source: `~/.claude/skills/codex-consult/SKILL.md` — the four load-bearing
gotchas (no [PROMPT] with review scope flags; always close stdin; detached launch +
sentinel-file poll; stay engaged after an auto-backgrounded wait). Never re-derive from
memory; never glob `/tmp/codex-*` (shared namespace across sessions).

## §9 Agent-def registry
Defs in `~/.claude/agents/` load at session start; a def created or edited mid-session
is invisible to already-running sessions. The "Agent type not found" fallback (dispatch
`general-purpose` briefed to read the def as prose) inherits NONE of the def's
frontmatter — both the `model:` pin and any `tools:` restriction are lost; restate both
in the fallback brief (probed 2026-07-02).
Scope: this session-start caveat covers agent defs ONLY. Skills and commands live-reload
mid-session as of Claude Code v2.1.216 (changelog line; observed 2026-07-20 — skills
copied into `~/.claude/skills/` mid-session were invocable without a restart).

## §10 Misc probed gotchas
- `EnterWorktree` cannot create a worktree while the session is already in one (probed
  2026-07-02) — chain `git worktree add` + `EnterWorktree {path}`.
- SendMessage is push-delivered with no inbox, no backpressure, ~10KB/message
  (observed in field use, unprobed; the ~10KB figure is an estimate) — signals
  travel in messages, truth lives in files/boards; senders stamp state, receivers
  re-check live artifacts, producers batch feedback then grep-verify before "done".

## §11 The Bash tool's shell is the user's shell — bash-only idioms fail silently
Everything below was probed under **zsh 5.9**, the shell on the machine this suite runs
on. If your login shell is bash these specific traps don't apply — but the general
lesson does: inline Bash-tool commands are eval'd under *your* shell, not a guaranteed
bash, and the failures below are all **silent** — no error, no fallback.

**`path`↔`PATH` — never name a shell variable `path`.** zsh links
the lowercase array `path` to `$PATH` (likewise `cdpath`, `fpath`, `manpath`,
`mailpath`; `status` is read-only). Any assignment — `read -r path`, `for path in …`,
`path=…` — silently rewrites the command search path; the symptom is
`(eval):N: command not found: <cmd>` for external binaries from that point on while
builtins keep working. A failed EOF `read` leaves `path`/`PATH` **empty**, and an
empty PATH does NOT fall back to zsh defaults — external commands stay broken for
the rest of that eval (probe-verified 2026-07-19); the "mysterious recovery" is the
next Bash tool call getting a fresh shell. `path` is the
natural variable name when looping over file lists — rename it (`wpath`, `p`). On any
`command not found` for a binary that exists, `echo $PATH` before suspecting the
sandbox or harness. Sandbox, permission classifier, and redirects were all ruled out as
causes of the original failure; switching to `bash script.sh` "fixed" it only because
bash doesn't tie `path`↔`PATH`.
- Provenance: root-caused 2026-07-05 by a worktree-audit agent in a private repo
  (deterministic 2/2 repro, 12-variant bisect, minimal pair = the one-word rename);
  independently re-verified same day in another session (`path=/tmp/nowhere;
  git --version` → exit 127; `wpath` control passes).

**Unquoted `=`-prefixed words** are a separate trap in the same shell: zsh's `=cmd`
filename expansion (EQUALS option, on by default) rewrites any unquoted argument
beginning with `=` to the full path of the command named by the rest, and kills the
whole line when none exists — `echo ===FOO===` → `zsh:1: ==FOO=== not found`, exit 1,
`echo` never runs (probed 2026-07-23). Bites `===`-style sentinel/delimiter args;
quote them (`echo "===FOO==="`).

**Bash-only parameters and devices** read as empty or missing, so the check built on
them silently becomes a no-op (all probed 2026-07-25):
- `${PIPESTATUS[0]}` → **empty string**; zsh's equivalent is the lowercase, 1-indexed
  `${pipestatus[1]}`. The natural spelling of the gate is the dangerous one: zsh's `[`
  evaluates an empty operand as 0, so `… | tail -3; [ "${PIPESTATUS[0]}" -eq 0 ]` is
  `0 -eq 0` → **true on a failing command** — it inverts the gate it exists to provide,
  with no output. (Unquoted `[ ${PIPESTATUS[0]} -eq 0 ]` instead dies
  `[:1: unknown condition: -eq` and fails closed; `= "0"` also fails closed. Only the
  quoted numeric form silently passes — probed all three.) Portable fix:
  `set -o pipefail; <cmd> 2>&1 | tail -N; echo EXIT=$?` — `pipefail` works in zsh
  (`false | tail -1` → `$?` is 1 with it, 0 without).
- `/dev/tcp/<host>/<port>` does **not exist** — bash synthesizes that device, zsh reads
  it as a plain path. Every redirect fails `no such file or directory`, exit 1,
  *whether or not anything is listening*, so a free-port probe written
  `(echo > /dev/tcp/127.0.0.1/$p) || use_port $p` reports **every** port free and hands
  back a port another process is already serving. Probe with
  `ss -ltn "( sport = :$p )"` and test the **output** — `ss` exits 0 either way. Where
  you control the listener, prefer binding port 0 and reading back the OS-assigned port
  (what `scripts/make-it-easy/` does).
- Same class, swept out of this suite on 2026-07-25 — assume broken if reintroduced:
  `mapfile`/`readarray`, `declare -A`, `local -n`, `${var,,}`/`${var^^}`. Run a
  genuinely wanted bashism under `bash -c '…'`.

## §12 Skill-tool arg substitution rewrites literal `$0` in the loaded text
When the Skill tool loads a skill WITH invocation args, every literal `$0` in the
SKILL.md text is substituted with the args string in the copy the agent reads — the file
on disk is untouched, but an agent trusting the loaded text gets a garbled recipe, and
silently: the substituted text looks like a plausible recipe, not an error. Distinct from
the v2.1.210 slash-arg behavior that preserves unmatched `$1`/`$2` placeholders verbatim
— `$0` with args present is *replaced*, not preserved. **Operative rule:** any recipe
containing awk's whole-line variable (`$0`) or any other literal dollar-zero token must be
READ FROM DISK (Read tool on the SKILL.md path), never trusted from Skill-loaded text —
and a guard sentence warning about this must itself avoid the literal token (spell it
"dollar-zero") or it garbles identically.
- Provenance: observed live 2026-07-19 (tool-semantics audit session) — codex-consult's
  canonical awk extraction snippet (`cap{blk=blk $0 ORS}`) arrived garbled in the
  Skill-loaded text with the args spliced into its `$0` tokens; the agent recovered by
  reading the SKILL.md from disk. codex-consult carries the one-line guard beside that
  snippet; grep the suite for `field-notes §12` to enumerate carriers, and for any other
  Skill-loadable file with a literal `$0` in an operative recipe.

## §13 Agent `model:` overrides are honored in BOTH directions — no harness tier cap
The Agent tool's `model:` override resolves to exactly the tier named, including tiers
ABOVE the dispatching session's model. There is no mechanical ceiling; the tier cap in
`CLAUDE-global.md` § Sub-agent delegation is a deliberate policy, not an enforced limit.
Unpinned calls inherit the session model exactly (including variant suffixes such as
`[1m]`). Worth knowing before you port that policy: it is the *only* thing preventing
silent escalation, so dropping it means dropping the guarantee, not inheriting one.
- **Corollary — never verify a pin by asking the agent.** A subagent's self-reported
  model identity is unreliable: it will sometimes name a different model and invent a
  plausible-but-fake ID for it. The objective discriminator is the `subagent_tokens`
  figure in the Agent tool result — system-prompt size clusters tightly by resolved
  tier, and a misreporting child still sits in its true tier's band.
- Provenance: probed 2026-07-25 from an Opus 5 session, 8 dispatches. A top-tier pin
  resolved there both times (~35.29k tokens); unpinned → the session model (35.25k);
  `model:'haiku'` → Haiku 4.5 (28.43k); `model:'sonnet'` → Sonnet 5 in 3 of 5, while
  2 of 5 self-reported a *higher* tier under two DIFFERENT ids (one of them not a
  published model id) — yet all five sat in the same 40.84k band, i.e. all five really
  were Sonnet.
