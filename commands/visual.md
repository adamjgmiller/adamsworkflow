---
description: Build a polished visual page (report, deep-dive, walkthrough, comparison, proposal) for me via the visual-builder agent — payload-complete brief, model per the Communication visuals tiering, served locally for preview. Communication-only — never for project/app deliverable visuals.
---

# /visual — build me a communication page

Thin wrapper over the **Communication visuals** rule in your global CLAUDE.md (see `CLAUDE-global.md` in this repo): turn `$ARGUMENTS` (the topic / material to communicate) into one polished, self-contained HTML page built by the `visual-builder` agent and served for preview. With no arguments, build the page the current conversation obviously calls for; if nothing does, ask what to visualize.

**Scope guard — communication only.** This command and the `visual-builder` agent exist solely for pages that communicate with me — reports, deep-dives, walkthroughs, comparisons, proposals. Never use either for visuals that are part of an actual project/app deliverable (product UI, site pages, in-repo docs assets) — those belong to the project's own code and design pipeline (e.g. frontend-design). Code walkthroughs (a diff, subsystem, or codebase tour) are also out of scope — those go through `/guided-tour`, never here. If the ask is really project output or a code tour, say so and route it there instead.

**Carve-out — permanent/critical reference pages**: long-lived reference to my own system + content synthesized in-session → build it inline as the main agent (or recommend that) instead of dispatching — see your global CLAUDE.md → Communication visuals for the rationale. Routine communication pages stay delegated per the steps below.

## Steps (you, the main agent)

1. **Synthesize first.** Assemble every fact, number, quote, and diff the page will show — from the session, or by doing the reads/analysis now. If the page IS the synthesis, do the synthesis here; delegate only the assembly.

2. **Write a payload-complete brief** (inline, or a handoff file the brief points to): the full content payload, the audience takeaway, the section shape you want, and the output path (scratchpad unless it belongs somewhere specific). "Read X and figure it out" is where delegation fidelity dies — don't.

3. **Dispatch `visual-builder`** (Agent tool, `subagent_type: visual-builder`) with the brief, passing `model:` explicitly per the Communication visuals tiering — Opus normally · Sonnet when genuinely simple · Fable only when the material is complex AND a subtle misstatement is costly — never above the session tier; my explicit override wins in either direction.

4. **Spot-check** the returned page's load-bearing claims against the brief (the known failure mode is plausible misattribution, not bad design). Surface its TBD markers to me rather than papering over them.

5. **Serve it yourself** so it outlives the sub-agent — `python3 -m http.server <port> --bind 127.0.0.1 --directory <dir>` in the background — and lead with the URL (`http://localhost:<port>`). By default, serve on 127.0.0.1 (localhost-only). To open pages from other devices, opt in explicitly: bind 0.0.0.0 on a trusted network, or preferably bind a private tailnet/VPN interface (e.g. Tailscale) — see the README's serving section. Declare the server's lifespan per your global CLAUDE.md's Teardown rule: purpose-bound by default (kill once the page is reviewed or superseded — the file stays on disk), keep-alive only with a stated reason.
