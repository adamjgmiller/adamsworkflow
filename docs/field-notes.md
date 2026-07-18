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
  `Plan` types do not). This enables the stage-agent pattern: one delegated agent runs a
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

Dispatch mode depends on WHERE the Agent call runs and whether the child is NAMED
(probed 2026-07-15 on v2.1.210; supersedes the 2026-07-10 "async-only at every depth,
`run_in_background` gone" findings — history: the probe-session log, 2026-07-10/15
entries).

- **Main level: async by default; `run_in_background: false` is back and REAL** — a
  sync dispatch blocks the turn and returns the child's full final text + usage block
  inline (probed: ~26s block for a 15s child). Supersedes 2026-07-10's "flag silently
  ignored". Fan-outs stay async; sync fits a single child whose result you need before
  continuing.
- **Unnamed sub-agents (any depth): async only.** No `run_in_background`/`name`/`mode`
  params at depth. Every dispatch returns a launch ack; batched dispatches in one
  message run CONCURRENTLY (probed: two 45s children started 3s apart, windows fully
  overlapping). The depth Agent schema's own text — "Only synchronous subagents are
  supported" — is WRONG for unnamed dispatches; trust this note over it.
- **Named teammates: every Agent dispatch is SYNCHRONOUS** — it blocks until the child
  completes and returns the final text + usage inline (probed: ~78s block through a
  60s child, secret token delivered in-result). A named teammate cannot end its turn
  with a child mid-run, so the old orphan/stall trap (2026-07-05/06) is structurally
  closed and file handoff is no longer REQUIRED to collect a named teammate's leaves.
  Batched named dispatches' concurrency is UNTESTED — assume serialized: keep a named
  teammate's own fan-outs small; run wide fan-outs unnamed or at the orchestrator.
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
  upward. Backgrounded BASH tasks do NOT defer it (probed 2026-07-10).
- **Backgrounded Bash at depth re-wakes too**: a stopped sub-agent is re-invoked when
  its background Bash task exits, output in the notification (probed 2026-07-10;
  supersedes the 2026-07-07 no-re-wake probe — long verifies at depth may be
  backgrounded-and-awaited again). Foreground remains right for anything under the
  ~10-min Bash ceiling; note the harness BLOCKS bare foreground `sleep` and chained
  sleeps (use an `until <check>; do sleep 2; done` loop or a background task). Either
  way, never return a bundle with a verify still pending — hold the pass/fail result
  first.
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
  scratchpad; 2026-07-10 set for the re-wake / deferral / TaskOutput facts. Grep the
  suite for `field-notes §4` to enumerate carriers; any NEW fan-out brief must state
  the collect-before-join rule explicitly.

## §5 Depth convention
Keep nesting within ~3–4 levels. This is a self-imposed legibility/debuggability
convention tighter than the harness's own limit — the harness documents a 5-level
subagent depth cap (changelog v2.1.172/174; earlier probes found no wall because they
never reached it). Counting: each Agent dispatch
= +1; invoking a skill/command inline = +0 (it runs in the current agent's context); a
detached CLI launch via Bash = +0. Sum across composed delegations; collapse a level
when stacks run deep.

## §6 Concurrency
The ~16-concurrent figure is a Workflow-TOOL limit (min(16, cores−2) per workflow); it
is NOT a Task-fabric fact. Task-fabric queue-vs-error behavior past the platform's
comfort point is unverified — commands cap themselves (typically ≤4 stage-agents in
flight, counting each agent's own fan-out toward the real concurrent total) and stay
under budget rather than probing the edge.

## §7 Playwright browser is a session-global singleton
One shared tab across the main loop and every sub-agent (same MCP server). Two agents
driving it concurrently silently corrupt each other's page with NO error. Serialize all
browser/visual work to exactly one agent at a time; never put it in a concurrent
fan-out. Sub-agents reach Playwright via ToolSearch deferred-load; defs with a
restricted `tools:` list can't.

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

## §10 Misc probed gotchas
- `EnterWorktree` cannot create a worktree while the session is already in one (probed
  2026-07-02) — chain `git worktree add` + `EnterWorktree {path}`.
- SendMessage is push-delivered with no inbox, no backpressure, ~10KB/message — signals
  travel in messages, truth lives in files/boards; senders stamp state, receivers
  re-check live artifacts, producers batch feedback then grep-verify before "done".

## §11 zsh ties `path`↔`PATH` — never name a shell variable `path`
Inline Bash-tool commands are eval'd under the user's shell (zsh here), and zsh links
the lowercase array `path` to `$PATH` (likewise `cdpath`, `fpath`, `manpath`,
`mailpath`; `status` is read-only). Any assignment — `read -r path`, `for path in …`,
`path=…` — silently rewrites the command search path; the symptom is
`(eval):N: command not found: <cmd>` for external binaries from that point on while
builtins keep working (and after a failed EOF `read` clears the vars, an *empty* PATH
falls back to zsh defaults, so post-loop commands mysteriously recover). `path` is the
natural variable name when looping over file lists — rename it (`wpath`, `p`). On any
`command not found` for a binary that exists, `echo $PATH` before suspecting the
sandbox or harness. Sandbox, permission classifier, and redirects were all ruled out as
causes of the original failure; switching to `bash script.sh` "fixed" it only because
bash doesn't tie `path`↔`PATH`.
- Provenance: root-caused 2026-07-05 by a worktree-audit agent in a private repo
  (deterministic 2/2 repro, 12-variant bisect, minimal pair = the one-word rename);
  independently re-verified same day in another session (`path=/tmp/nowhere;
  git --version` → exit 127; `wpath` control passes).
