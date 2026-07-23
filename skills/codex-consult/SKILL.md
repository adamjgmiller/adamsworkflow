---
name: codex-consult
description: Run the Codex CLI as a read-only second-opinion engine. Four modes — `review` (diff review, prescribed findings format), `critique` (plan/design/proposal), `ask` (open question), `audit` (file-set sweep for a defined defect class, findings format). Use for any Codex review, audit, or independent take, directly or as the Codex side of review fan-outs. Read-only — never writes code. Encodes the non-obvious Codex CLI gotchas so the recipe isn't reinvented.
---

# Codex consult

Run Codex as a read-only second-opinion consultant in one of four modes:

| Mode | Slash form | Codex command | Use case |
|---|---|---|---|
| `review` | `/codex-consult review [scope] [focus]` | `codex exec --sandbox read-only` (prompt instructs the diff) | Diff review with prescribed findings format — fits orchestrate dedup |
| `critique` | `/codex-consult critique <path-or-prose> [focus]` | `codex exec --sandbox read-only` | Read a plan, design doc, or proposal and surface concerns + alternatives |
| `ask` | `/codex-consult ask <question>` | `codex exec --sandbox read-only` | Open second opinion — "what do you think of approach X?" |
| `audit` | `/codex-consult audit <targets> [defect-class]` | `codex exec --sandbox read-only` | Sweep named files for a defined defect class — findings format, not diff-scoped |

Read-only. For code-writing, drive Codex write-mode deliberately (`codex exec --sandbox workspace-write`) outside this skill.

> This skill never spawns; leaf-safe only when the parent supplies an explicit mode + scope — the no-args path stops to ask the user.

## Preflight

1. **Verify Codex is installed.**

   ```bash
   command -v codex
   ```

   If this fails, stop. Tell the user Codex isn't on PATH and suggest
   `brew install codex` (or equivalent). Do not fall back to a different
   reviewer — that's the caller's decision.

2. **Determine mode.** Pick the first match:

   - **Explicit token**: `$ARGUMENTS` first token is `review`, `critique`,
     `ask`, or `audit` → that mode, with the rest of `$ARGUMENTS` as
     mode-specific args.
   - **Legacy diff-scope token**: if the first token is `uncommitted`, a
     SHA, or `<base>...<head>`, assume `review` mode with that scope.
     Preserves muscle memory from the old `/codex-review <scope>` form.
   - **No args**: if `git status --porcelain` is non-empty OR the current
     branch is ahead of its base → `review` mode. Otherwise stop and ask
     the user which mode they want — do **not** guess between `critique`,
     `ask`, and `audit`.

## The four gotchas (load-bearing)

All four apply across modes — skip any one and the run breaks.

### Gotcha 1: `codex review` rejects `[PROMPT]` whenever a scope flag is set (review mode only)

In current Codex CLI (verified at v0.130.0), the `codex review` parser
treats `--uncommitted`, `--commit <SHA>`, and `--base <BRANCH>` as
mutually exclusive with the `[PROMPT]` positional. Every form below
exits with code 2 before Codex even starts:

| Form | Runtime error |
|------|---------------|
| `codex review --uncommitted "<prompt>"`            | `the argument '--uncommitted' cannot be used with '[PROMPT]'` |
| `codex review --commit <SHA> "<prompt>"`           | `the argument '--commit <SHA>' cannot be used with '[PROMPT]'` |
| `codex review --commit <SHA> --base <BRANCH> "..."`| same family |
| `codex review --uncommitted -` (stdin marker)      | same — `-` counts as `[PROMPT]` |
| `codex exec review --uncommitted "<prompt>"`       | same — `exec review` is the same code path |

**Practical consequence:** there is no way to inject a custom prompt
into `codex review` while also passing a scope flag. Since the whole
point of this skill is to inject the prescribed findings format, the
skill always uses `codex exec --sandbox read-only "<prompt>"` and has the
prompt itself instruct Codex to start by running the appropriate `git`
command for the scope:

| Scope                          | Diff instruction to embed in the prompt                                       |
|--------------------------------|-------------------------------------------------------------------------------|
| Uncommitted changes            | `Start by running 'git status --short --untracked-files=all && git diff && git diff --cached'.` |
| Single commit (vs. its parent) | `Start by running 'git show --first-parent --stat --patch <SHA>'.`            |
| Single commit vs. a base       | `Start by running 'git diff <BRANCH>...<SHA>'.`                               |
| Multi-commit branch range      | `Start by running 'git diff <base>...HEAD'.`                                  |

(Abbreviated — the mode-specific prompt bodies below are authoritative:
they additionally have Codex read untracked files for uncommitted scope,
and embed a literal `A...B` when the caller's range names an endpoint.)

`codex exec --sandbox read-only` reads the working tree
directly, so it sees uncommitted changes the same way `--uncommitted`
would have. The `exec` parser also handles `-c key=value` cleanly if
a config override is needed (e.g. `-c model_reasoning_effort="max"` —
on GPT-5.6 models `max` sits above the `xhigh` config default for a
targeted deepest-pass override; overriding to `xhigh` is a no-op).

Use `read-only`, not `workspace-write` or the deprecated alias
`--full-auto` (which is `workspace-write` under the hood and emits a
deprecation warning in Codex CLI 0.130.0+). This skill is a read-only
consultancy — its prompts only need git reads (`git diff`, `git show`,
`git status`), and `read-only` mechanically forecloses Codex deciding
to be "helpful" mid-review by running formatters, package installs,
or stash/checkout operations.

### Gotcha 2: always close stdin (all modes)

Per `codex exec --help`: *"If stdin is piped and a prompt is also
provided, stdin is appended as a `<stdin>` block."* Codex always tries to
read stdin to EOF. From any non-TTY context — every sub-agent invocation,
anything piped to `tee`, scripts — the pipe stays open and Codex hangs
forever on *"Reading additional input from stdin..."*.

**Always pass `</dev/null`** to feed an immediately-closed stdin:

```bash
codex exec --sandbox read-only "$(cat /tmp/codex-prompt.txt)" </dev/null > /tmp/codex-out.log 2>&1
```

For multi-paragraph prompts, write the prompt to a temp file
(`/tmp/codex-prompt-$JOB_ID.txt`) and pass `"$(cat <file>)"` rather than
a heredoc inside `$(...)` — easier to re-read for debugging, and
heredoc-in-substitution is more fragile than it looks.

### Gotcha 3: never invoke Codex inline — wait via a sentinel file (all modes)

Codex runs typically take 1–10+ minutes. The Bash tool's default 120s
timeout will kill Codex mid-stream — and worse, the killed process
leaves `/tmp/codex-out-$JOB_ID.log` with partial output that *looks*
like a finished result.

Even at the Bash tool's maximum 600000ms (10 min) timeout, some runs
exceed it.

**Run Codex detached, then poll a sentinel in a separate Bash call.**
The sentinel file is written only after Codex exits, so reading the log
behind that gate is always safe. Splitting launch from poll also makes
the wait resumable: if a polling call times out at 10 min, just reissue
the same `until` loop — the sentinel is the source of truth, not any
in-memory shell state.

The `JOB_ID` itself lives in your conversation context (the launch
step's stdout ends with `JOB_ID=<value>`) and is substituted as a
literal into the wait and cleanup steps. **Never write it to a shared
file like `/tmp/codex-current-job`** — that path is global, so two
concurrent /codex-consult callers would clobber each other's tracker
and the second to read would tail the wrong job's log. Per-job state
must stay namespaced by `$JOB_ID` end-to-end.

**Never glob `/tmp/codex-*`** — to find a job, to wait on one, or to
clean up. Concurrent Claude sessions on the same box share this
namespace; a glob can read a stranger's log as your result or delete
a job mid-run (this happened in the field). The `JOB_ID` held in
conversation context is the only valid handle, including for cleanup.

**Step 1 — launch Codex detached** (one Bash tool call, returns in
milliseconds):

```bash
JOB_ID=$(date +%s)-$$-$RANDOM   # per-job; never store in any shared/singleton path

PROMPT_FILE=/tmp/codex-prompt-$JOB_ID.txt
LOG_FILE=/tmp/codex-out-$JOB_ID.log
DONE_FILE=/tmp/codex-done-$JOB_ID.flag

# (write the assembled prompt to $PROMPT_FILE here, before launching)

# ( ... ) & disown survives the Bash tool's shell exit on macOS bash,
# so Codex keeps running after this tool call returns.
( <CODEX_COMMAND> </dev/null > "$LOG_FILE" 2>&1; \
  echo "exit=$?" > "$DONE_FILE" ) &
disown
echo "Codex launched: JOB_ID=$JOB_ID PID=$!"
```

`<CODEX_COMMAND>` is the same for every mode at v0.130.0 (see gotcha 1
for why `codex review` is off the table):

- `codex exec --sandbox read-only "$(cat $PROMPT_FILE)"`

The differentiation between modes lives in the prompt body itself —
review mode embeds the per-scope `git` instruction from gotcha 1's
diff-instruction table; critique/ask embed their artifact or question;
audit embeds its file list + defect-class definition.

**Step 2 — wait for the sentinel** (separate Bash tool call, with
`timeout: 600000`):

```bash
JOB_ID=<paste-job-id-from-step-1-stdout>   # literal value, not read from disk
DONE_FILE=/tmp/codex-done-$JOB_ID.flag
LOG_FILE=/tmp/codex-out-$JOB_ID.log

until [ -f "$DONE_FILE" ]; do sleep 10; done

echo "=== Sentinel ==="; cat "$DONE_FILE"   # exit=N — non-zero => Codex errored
echo "=== Log ==="; cat "$LOG_FILE"
```

If the polling Bash call itself times out (rare — Codex >10 min),
reissue the exact same `until` loop in another Bash call. The sentinel
is file-based, so polling is fully resumable.

**Total-wait ceiling (hung Codex).** A wedged `codex` process that never
exits never writes the sentinel — reissued polls would wait forever and
the caller's failure handling (which keys on `exit=N`) would never fire.
After ~3 reissued polls (~30 min total) with no sentinel: treat the run
as hung — kill the process tree, not just the wrapper (the recorded PID
from the launch stdout is the backgrounded subshell, and `pkill -P`
reaches only *direct* children — enumerate before killing, since orphans
reparent and become unfindable: `pgrep -P <PID>` for the codex child,
`pgrep -P <codex-pid>` for anything it spawned, then kill deepest-first,
ending with `kill <PID>`), record a labeled
failure (`exit=hung`) in place of the sentinel line, clean up this job's
temp files, and return the failure so the caller's documented
degradation (`single-source`, Opus-only lens, etc.) takes over. Never
keep polling past the ceiling.

**Do not** invoke Codex synchronously in the same Bash call that reads
the log, even with `timeout: 600000`. You lose the ability to detect
timeout-induced truncation: the partial log will read as if it were
complete, and the sub-agent will surface it as a finished result.

### Gotcha 4: don't yield the turn after the wait auto-backgrounds (all modes)

The wait Bash call uses `timeout: 600000` (a 10-min ceiling). For runs
that finish inside that window, the Bash tool returns the result inline
and you proceed normally. But the Bash tool can also **auto-background**
the wait call instead of holding it foreground, returning immediately
with `Command running in background with ID: <id>. Output is being
written to: <path>`. The auto-background path's completion notification
appears to **queue rather than proactively wake the agent** — it
surfaces as an embedded `<system-reminder>` on your *next* tool call,
not as a standalone wake event. (This is distinct from gotcha 3, which
is about Codex itself getting killed mid-stream. Here Codex finishes
fine; the failure is in the agent's wait/wake loop on top of it.)

If you respond with "I'll let it complete and read the result when
notified" prose and end the turn after the wait Bash call returns
auto-backgrounded, you can sit dormant indefinitely while the job has
long since finished. This has happened in production: the user had to
ping ("still running?") to flush the queued notification. The queued
event then appears inline in your *response to the ping*, alongside
output from a manual sentinel check — that interleaving is the
diagnostic fingerprint.

**Fix — stay engaged. Don't yield the turn while waiting.**

After the wait Bash call returns auto-backgrounded, immediately follow
up with a fast sentinel check **in the same response** — do not send
a text-only "I'll wait for the notification" message and end the turn:

```bash
JOB_ID=<paste-from-step-1>
if [ -f "/tmp/codex-done-$JOB_ID.flag" ]; then
  echo "=== Sentinel ==="; cat "/tmp/codex-done-$JOB_ID.flag"
  echo "=== Log ==="; cat "/tmp/codex-out-$JOB_ID.log"
else
  echo "still running — sentinel not yet present"
fi
```

If the sentinel exists, you have the result and can surface it
immediately. If not, reissue the `until` poll in another Bash call
(it's resumable per gotcha 3) and keep the turn active until the
sentinel lands. Either way, the turn does not end until you've read
the actual completion.

**Do not** end the turn with "I'll read the result when notified."
The auto-background notification is not a reliable wake — it's a
queued event that needs your next tool call to surface, so by
construction you cannot wait for it passively.

## Mode-specific behavior

### `review` mode

1. **Determine diff scope** (after mode dispatch). Pick the first match:
   - **Explicit second token**: `uncommitted`, a SHA, or `<base>...<head>`.
   - **Auto-detect**:
     - `git status --porcelain` non-empty → uncommitted.
     - On a branch ahead of `main` (fall back to `master`) → `<base>...HEAD`.
     - Otherwise → tell the user there's nothing to review and stop.
2. **Focus brief**: anything after the scope token in `$ARGUMENTS`. Default:
   bugs, unintended side effects, regressions, edge cases, callers/writers
   not touched, stale comments or docs.
3. **Prompt body**:

   ```
   You are performing a focused second-opinion code review.

   <DIFF_INSTRUCTION>

   Review focus: <FOCUS>

   Return your findings as a numbered list. For each finding, use this
   exact shape:

     N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
        Location: <file>:<line> (or "cross-cutting" if no single location)
        Finding: <2-4 sentences explaining the issue and why it matters>
        Suggestion: <concrete fix, or "needs human judgment" if unclear>

   After the numbered list, add a short "Notes" section for broad
   observations or things you couldn't review confidently.

   Be specific. Cite file paths and line numbers. Do not pad with generic
   advice. If you have nothing to flag, say so explicitly.
   ```

   `<DIFF_INSTRUCTION>` per scope (Codex always runs the diff itself
   now — see gotcha 1):
   - **Uncommitted**: *"Start by running `git status --short
     --untracked-files=all && git diff && git diff --cached` to see all
     staged, unstaged, and untracked changes, then read each untracked
     file the status listed — the diffs omit new-file contents. Review
     the full set."* (`--untracked-files=all`: the default listing
     collapses a wholly-untracked directory to one `dir/` entry, hiding
     its files.)
   - **Single commit (vs. parent)**: *"Start by running `git show
     --first-parent --stat --patch <SHA>` to see the commit. Review the
     resulting diff."* (`--first-parent`: on a merge commit the default
     combined diff shows nothing for cleanly-merged content —
     probe-verified; first-parent shows what the commit brought in.)
   - **Single commit vs. a base**: *"Start by running `git diff
     <BRANCH>...<SHA>` to see the commit's effect relative to the
     base. Review the resulting diff."*
   - **Branch range**: *"Start by running `git diff <base>...HEAD` to
     see the cumulative diff for this branch. Review the resulting
     diff."* (When the caller's scope names an explicit endpoint —
     `A...B` — embed that literal range, not a rewritten `A...HEAD`:
     every reviewer must see the same diff.)

4. **Launch and wait** via the gotcha-3 sentinel pattern with
   `<CODEX_COMMAND>` = `codex exec --sandbox read-only "$(cat $PROMPT_FILE)"`.

### `critique` mode

The argument after `critique` is either a **path** or **inline prose**:

- Starts with `/`, `~`, `./`, or names an existing file → read the file
  and embed its contents in the prompt.
- Otherwise → treat as inline prose to critique.

Optional focus brief follows the path/prose. Default focus: unstated
assumptions, risks, missing alternatives, edge cases, plan steps that
gloss over real complexity.

**Prompt body**:

```
You are giving a focused second opinion on a plan / design / proposal.
Read-only — do not propose to write code, just critique.

The artifact under review:

<<<
<EMBEDDED_CONTENT>
>>>

Critique focus: <FOCUS>

Return your take in three sections:

1. **Concerns** — numbered list. Each item: one-line summary, then 1-3
   sentences explaining the risk or unstated assumption and why it
   matters. Cite specific lines or sections of the artifact.
2. **Suggested revisions** — concrete, minimal changes to address the
   concerns. Bias toward small targeted fixes over rewrites.
3. **Alternatives worth considering** — paths the artifact didn't take
   (or didn't justify rejecting). One sentence each on what they'd buy
   and what they'd cost.

If the artifact is fundamentally sound, say so plainly. Do not pad with
generic advice.
```

Launch and wait via the gotcha-3 sentinel pattern, with
`<CODEX_COMMAND>` set to `codex exec --sandbox read-only "$(cat $PROMPT_FILE)"`.

### `ask` mode

The argument after `ask` is the question (rest of `$ARGUMENTS`).

**Prompt body**:

```
You are giving a focused second opinion. Read-only — do not propose to
write code, just answer.

Question: <QUESTION>

Return your take in three sections:

1. **Direct answer** — your actual recommendation or take, in 2-5
   sentences. No throat-clearing.
2. **Alternatives considered** — other reasonable options and why you
   didn't pick them.
3. **What I'd want to verify** — assumptions you made or things you
   couldn't check from this prompt alone.

Be specific. If the question is underspecified, name what's missing
rather than guessing.
```

If the question references files in the current repo, append to the
prompt: *"You may read files in the current working directory if needed
to answer."* `codex exec --sandbox read-only` already has filesystem access.

Launch and wait via the gotcha-3 sentinel pattern, with
`<CODEX_COMMAND>` set to `codex exec --sandbox read-only "$(cat $PROMPT_FILE)"`.

### `audit` mode

Sweep a named set of files for a defined defect class. Differs from
`review` (not diff-scoped — the targets are files as they stand, no git
range) and from `critique`/`ask` (returns per-finding locations and
severities, not fixed prose sections). This is the recipe audit-style
consults kept re-deriving — review-fix-loop Lane 2 documents the
sibling per-decision adaptation — encoded here so it isn't reinvented.

Args after `audit`: one or more file/dir paths (absolute preferred),
then the defect-class brief — what to hunt for, stated concretely.
Missing either → stop and ask.

**Prompt body**:

```
You are auditing the following files for one specific class of defect.
Read-only — do not propose to write code. Read each file in full.

Files:

  <absolute paths, one per line>

Defect class — hunt specifically for:

<the caller's defect-class brief, as concrete bullets>

Calibration: report only defects with a concretely reachable trigger —
name the precondition. Do not report style, taste, or hypotheticals
requiring the text/code to be misread. An empty report is a valid and
welcome result — do not pad to seem thorough.
[If iterating: list what was fixed since the prior round, and carry
forward a "previously rejected — do not re-raise" list.]

Findings as a numbered list, exact shape:

  N. [SEVERITY: critical | high | medium | low | nit] <one-line summary>
     Location: <file>:<line or section>
     Finding: <2-4 sentences: the reachable precondition and what goes wrong>
     Suggestion: <concrete minimal fix, or "needs human judgment">

If a file is clean for this class, say so explicitly. After the list, a
short "Notes" section for anything you could not verify confidently.
```

Launch and wait via the gotcha-3 sentinel pattern, with `<CODEX_COMMAND>`
set to `codex exec --sandbox read-only "$(cat $PROMPT_FILE)"`.

**Fix-and-re-audit loops** (the common use): each round is a fresh
detached launch with an updated prompt — name the fixes applied since
the prior round so Codex checks them for knock-ons instead of
re-finding them, keep the do-not-re-raise list growing, and stop on an
empty (or meaningless-only) round. The caller validates every finding
against the actual files before fixing — Codex proposes, the caller
disposes. In late rounds, bucket each survivor into documented-behavior
divergence — the audited class, fix it — versus robustness or style
suggestions, which the calibration bar rejects; a survivor count that stays
flat late in a loop usually means the class definition is stretching to
keep finding work, not that real defects remain. Adopt a soft cap of ~6
rounds: stop there and log any leftovers as findings with an honest "not
certified empty" note rather than looping further for a clean sweep that
may not exist.

## Run and capture

1. Compute `JOB_ID=$(date +%s)-$$-$RANDOM`. The launch step echoes this
   value in its final stdout line as `JOB_ID=<value>`; remember it in
   conversation context and substitute it as a literal into the wait
   and cleanup steps. Do not write it to any shared singleton path —
   that would clobber a concurrent /codex-consult caller's tracker.
2. Write the assembled prompt to `/tmp/codex-prompt-$JOB_ID.txt`.
3. **Launch detached** per the gotcha-3 step 1 snippet. The Bash tool
   call returns in milliseconds with `JOB_ID` and the launched PID.
4. **Wait** in a separate Bash tool call (with `timeout: 600000`) using
   the gotcha-3 step 2 polling snippet. If that call itself times out,
   reissue it — the sentinel file makes polling resumable.
5. Once the sentinel exists, check the exit code in
   `/tmp/codex-done-$JOB_ID.flag` and read
   `/tmp/codex-out-$JOB_ID.log`. **In every mode**, Codex's actual
   answer is the block from the *last* `^codex$` marker line to the
   `^tokens used$` line — everything before is banner, reasoning, and
   tool output (the diff Codex ran, web searches); everything after the
   token count is a verbatim echo of the same answer. This holds for all
   modes because the marker is a property of `codex exec` output,
   not the prompt. Extract it with:

   ```bash
   ANSWER=$(awk '/^codex$/{cap=1; blk=""; next} /^tokens used$/{cap=0} \
        cap{blk=blk $0 ORS} END{printf "%s", blk}' "$LOG_FILE")

   if [ -n "$(printf '%s' "$ANSWER" | tr -d '[:space:]')" ]; then
     printf '%s\n' "$ANSWER"                      # the mode's output body (all four modes)
   else
     # Empty extraction → fall back to the raw log, but log WHY first. A blank
     # result is a *symptom* (non-zero exit, a Codex error page, or a future CLI
     # changing the marker format), not proof the awk is wrong — it has been
     # misdiagnosed as a `$0`-drop bug when the awk was fine. Record the exit,
     # marker presence, and byte count so the real cause is legible:
     grep -qxE 'codex[[:space:]]*'       "$LOG_FILE" && M1=y || M1=n
     grep -qxE 'tokens used[[:space:]]*' "$LOG_FILE" && M2=y || M2=n
     echo "codex-consult fallback: $(cat "$DONE_FILE" 2>/dev/null) codex_marker=$M1 tokens_marker=$M2 log_bytes=$(wc -c < "$LOG_FILE") — reading raw log $LOG_FILE"
     cat "$LOG_FILE"
   fi
   ```

   The awk captures the block from the *last* `^codex$` marker to
   `^tokens used$`, yielding review/audit findings, critique sections, or
   ask sections cleanly and avoiding the trailing duplicate echo. The awk
   program must stay a **single-quoted** shell string — double-quoted, the
   shell expands `$0` to the shell name before awk runs, and the
   extraction comes back empty (silently under bash, an awk fatal under
   zsh), reproducing the false `$0`-drop diagnosis above. Separately, a
   Skill-load hazard: if this skill was invoked with args, the Skill tool
   substitutes them into every dollar-zero token in the loaded text —
   including this snippet's awk whole-line variable — so the recipe an
   agent reads from the loaded skill can arrive garbled while the file on
   disk stays correct; read the snippet from this file on disk (Read tool
   on this SKILL.md path) before running it, never from Skill-loaded text
   (field-notes §12). **Don't fall
   back silently** — the empty branch prints its reason so a downstream
   reader pins the real cause instead of guessing: `codex_marker=n` /
   `tokens_marker=n` means the CLI changed the marker format (verified
   intact at v0.144.4; originally v0.136.0), and a non-`exit=0` sentinel
   means Codex itself errored. Surface findings/take to the conversation:
   for `review`/`audit`, preserve the numbered findings format; for
   `critique`/`ask`, preserve Codex's section structure.
6. Clean up temp files (substitute the same `JOB_ID` literal you used
   for the wait step — only delete this job's files, never anything
   shared):
   ```bash
   JOB_ID=<paste-job-id-from-step-1-stdout>
   rm -f /tmp/codex-prompt-$JOB_ID.txt /tmp/codex-out-$JOB_ID.log \
         /tmp/codex-done-$JOB_ID.flag
   ```

Never read the log before the sentinel exists (see gotcha 3).

If Codex's exit code is non-zero, or the log is empty / clearly
truncated, say so plainly — do not invent findings or paper over the
failure.

## When invoked as a Codex runner (from `/orchestrate`, `/pr-auto-review`, `/lens-review`, `/build-system`)

`/orchestrate`'s post-execution once-over and the per-lens reviewers of
`/pr-auto-review`, `/lens-review`, and `/build-system` dispatch a runner sub-agent — the named
`codex-runner` def (`~/.claude/agents/codex-runner.md`), or a
`general-purpose` sub-agent briefed to follow this skill — against
parent-supplied inputs (diff scope, or audit file list + defect class). (`/dual-review` does not dispatch a runner;
it drives this skill inline.) The sub-agent's role in this context is
**Codex runner**, not reviewer: the decision to consult Codex was
already made by the parent. **Skipping is a failure mode, not an
optimization.** Do not skip based on diff triviality, perceived
redundancy with another reviewer, or your own assessment of need — the
parent specifically wants Codex's independent take, and a silent skip
defeats the dedup/divergence logic the parent is built around.

That sub-agent should:

1. Read this SKILL.md (it's the source of truth, not the orchestrate or
   pr-auto-review doc).
2. Run the **mode the parent supplied** — `review` when unstated — with
   the parent's inputs: review takes a diff scope (typically
   `<merge-base>...HEAD`, or `uncommitted`); `audit` takes the parent's
   file list + defect-class brief (the audit-mode template above). Do
   not redetect scope or mode — use what the parent passed.
3. Return both:
   - **Proof of execution**: the `JOB_ID` and the sentinel `exit=N` line
     from `/tmp/codex-done-$JOB_ID.flag`. The parent uses these to
     distinguish a real run from a silent skip.
   - **Findings** in the prescribed shape so the parent's synthesis step
     can dedup against the other reviewers.

If Codex is unavailable (`command -v codex` fails) or errors mid-run,
say so plainly with the relevant evidence (the `command -v` output, or
the `JOB_ID` + sentinel exit code + log content). Do not fall back to
your own review — that's the parent's call to make, not yours.
