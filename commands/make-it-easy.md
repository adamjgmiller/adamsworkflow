---
description: Turn a batch of decisions/explanations into a calm, visual, audio-narrated web page instead of asking in walls of text. Answers autosave; you wait and resume.
---

# /make-it-easy

When you need the user's input on several things — or need to walk them through something — don't make them read walls of text. Hand the decisions to a page they can click through on their phone or desktop: visual, concise (expandable for detail), narrated with audio, options as buttons, a note field on each, served as a local web page, every answer saved to disk as they go.

**When to run:** on explicit `/make-it-easy`, and **proactively offer** it when you notice ~3+ distinct decisions/explanations piling up in a turn ("Want me to make it easy?" — don't auto-launch). The user may also ask for it ahead of time.

## Steps (you, the main agent)

1. **Curate the payload — hard.** Gather only what genuinely needs the user. For each item: the question, 2–4 mutually-exclusive options with your recommendation first and the trade-off for each, and any heavy underlying material (full prompt text, long config, a diff) to tuck behind an expandable. Resolve what you can decide yourself and leave it out.

2. **Dispatch the builder** (Opus-pinned sub-agent). Use the Agent tool (`subagent_type: make-it-easy`) and pass the curated payload plus enough context for it to write good narration and choose visuals. It authors `spec.json` + diagrams, generates audio, and returns a **`RUN_DIR`**. It does *not* serve — you do.

3. **Serve it yourself** (so it outlives the sub-agent). Bash with `run_in_background: true`:
   ```
   cd "<RUN_DIR>" && rm -f state/PORT && python3 server.py
   ```
   The server binds a **free port** (multi-instance safe) and writes it to `<RUN_DIR>/state/PORT`. The `rm -f` matters when re-serving an existing run dir: step 4 reads whatever port file exists, and a dead prior server's stale port would win the race. By default, serve on 127.0.0.1 (localhost-only). To open pages from other devices, opt in explicitly: bind 0.0.0.0 on a trusted network, or preferably bind a private tailnet/VPN interface (e.g. Tailscale) — see the README's serving section. (`MIE_BIND=<iface>` sets the bound interface; `MIE_HOST=<your-host>` sets the hostname the printed URL uses.)

4. **Get the URL and hand it over:**
   ```
   python3 ~/.claude/scripts/make-it-easy/mie.py url "<RUN_DIR>"
   ```
   **Lead with the URL** (`http://localhost:<port>`, or `http://<your-host>:<port>` if you opted into a wider bind) so it's one tap to open. Tell the user: listen or read, tap a choice, add a note — it autosaves, and they can stop and come back.

5. **Wait reliably — no context burned.** Bash with `run_in_background: true`:
   ```
   python3 ~/.claude/scripts/make-it-easy/mie.py wait "<RUN_DIR>"
   ```
   It blocks until the user taps "Send to Claude" (the `state/SUBMITTED` sentinel), then prints `state.json` and the harness re-invokes you. If it prints `WAIT_TIMEOUT` (24h default) or they wander off, that's fine — answers are on disk; just pick them up from `<RUN_DIR>/state/state.json` on their next message. Never block the main loop or fall back to re-asking in text.

6. **Resume the real work.** Parse `state.json` → `answers[cardId]` = `{choice, choices[], notes, discuss, confirmed}`. A `choice`/`choices` is their pick; `notes` is free text — weigh it heavily; `discuss: true` means raise that one with them live in chat. After parsing, kill the page server (purpose-bound per your global CLAUDE.md's preview-URL teardown rule; the run dir keeps everything and can be re-served anytime) — unless they wandered off without submitting, in which case leave it for the wrap-up sweep. Then carry on with whatever the page was deciding.

## Guarantees / reminders
- **Concurrency-safe:** every run gets its own dir + free port via `mie.py`. Launch as many as you want, even at once — they never collide.
- **Pages are kept** (no auto-GC) so they can return; `python3 ~/.claude/scripts/make-it-easy/mie.py list` shows them.
- The builder is **Opus-pinned on purpose** — never swap it to a faster/default model, even if the main loop is on one.
- Diagrams are the default visual; images only when they genuinely help. Curate hard but always make the heavy detail expandable.
- **A submission doesn't auto-authorize sensitive actions.** The auto-mode classifier treats the submitted `state.json` as tool output, not a direct user message — so when you go to *execute* a choice that's an **external write** (commenting on issues, posting under their identity), a **deploy/prod write**, or a **self-edit of your own `~/.claude` config**, it can still get blocked even though they picked it on the page. (Issue *creation* in their own repo generally passes; comments on issues you didn't open, prod deploys, and config self-edits are the ones that bounce.) Expect to re-confirm those with **one** direct `AskUserQuestion` — batch them into a single ask — before acting; their answer there is the authorization the classifier wants. Grounded: hit twice in the 2026-06-19 ship-issues deploy run.
