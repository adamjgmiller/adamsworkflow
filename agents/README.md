# ~/.claude/agents/ — reusable named sub-agent definitions

Conventions for this directory (established 2026-06-11, out of a nesting-refactor audit):

1. **A def documents a contract; it does not grant capability.** Spawn capability is a
   *toolset* property: a def with **no `tools:` frontmatter restriction inherits the full
   toolset including `Agent`** and can spawn children (`~/.claude/docs/field-notes.md` §1). A def that pins
   `tools:` *without* `Agent` cannot spawn — pin tools deliberately to make a role
   leaf-by-construction.
2. **Session-start registry caveat:** defs are loaded when a session starts. A def created
   or edited mid-session is invisible to already-running sessions — create/edit defs
   *before* the sessions that consume them. **The "Agent type not found" fallback
   (dispatch `general-purpose` to read the def as prose) inherits _none_ of the def's
   frontmatter** — both the `model:` pin and any leaf-by-construction `tools:` restriction
   (#1) are lost; the stand-in runs at the *session tier* with the *full* toolset (`Agent`
   included). Restate the pinned model **and** the no-spawn/tools constraint explicitly in
   the fallback brief, or the fallback silently un-pins and re-arms the def
   (field-notes §9).
3. **Named files are the exception, not the rule.** Per the suite's decision rule: a named
   def only for (a) the spawn-capable role (`stage-runner`) and (b) a brief consumed as a
   Codex-review leaf by multiple commands — orchestrate's once-over,
   pr-auto-review's, build-system's, and lens-review's per-lens reviews (`codex-runner` —
   async from unnamed dispatchers, collected via its completion task-notification;
   inline when a named teammate dispatches it — field-notes §4), and (c) a domain-builder role whose def carries a model contract —
   `make-it-easy` (hard Opus role-pin) and `visual-builder` (deliberately UN-pinned; the
   dispatcher passes the model per your global CLAUDE.md → Communication visuals).
   Pure-leaf prompt briefs use **section-citation** (`follow <file>:<lines>`) instead.
4. Named agents are a **DRY/consistency win that nesting amplifies** — only `stage-runner`
   is enabled *by* nesting. Don't add defs here to "use nesting"; add them to kill drift.
