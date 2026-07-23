export const meta = {
  name: 'adams-field-research',
  description: 'Field-mapping deep research driven by a written request/contract file — Sonnet research+verify+gap fan-outs write and adversarially annotate per-topic notes files, one session-model writer synthesizes the full report against the contract.',
  whenToUse: 'When the user wants a comprehensive FIELD REPORT (survey/map of a domain: people, orgs, literature, tooling, engagement routes) governed by a written request file — vs adams-deep-research, which answers a QUESTION via claim-extraction and voting. Proven shape: a 2026-07-19 field report run. Args (a REAL JSON object, never a string): {requestPath (required — the contract file the report must satisfy), reportPath (required — where the final report is written), date (required — YYYY-MM-DD; scripts cannot read the clock), notesDir (optional — defaults to <reportDir>/notes), readFirst (optional array of paths: pre-verified grounding material, e.g. source digests), assignments (optional array of {label, file, coverage, brief} — RECOMMENDED: the dispatcher authors these inline with payload-complete briefs naming exact papers/orgs/queries; planning is session-tier work. If omitted, a session-model scope agent derives 6-16 assignments from the request file), maxFollowups (optional, default 5)}. Model policy is HARDCODED, no model args by design: all fan-outs (research, verify, gap round) are Sonnet at medium effort; the optional scope stage and the single synthesis writer inherit the session model. Dispatcher should mkdir -p the notes and report dirs before invoking, and review the report after (the run returns verification totals and the writer\'s own gap list).',
  phases: [
    { title: 'Scope', detail: 'Only if assignments not supplied: derive them from the request file (session model)' },
    { title: 'Research', detail: 'One researcher per assignment; notes files with facts/links/dates/quality marks', model: 'sonnet' },
    { title: 'Verify', detail: 'Per-file verifier — refute load-bearing claims, check links, annotate ⚠️/❌ in place', model: 'sonnet' },
    { title: 'Gap check', detail: 'One critic sweeps all notes vs the request; bounded follow-up researchers', model: 'sonnet' },
    { title: 'Synthesize', detail: 'Single session-model writer produces the full report per the request contract' },
  ],
}

// adams-field-research: [Scope] → pipeline(Research → per-file Verify) → Gap check → follow-ups → Synthesize
// Generalized 2026-07-19 from a single bespoke field-research run (40 agents, 0 failures,
// 188 facts checked / 28 corrections / 4 refutations caught pre-report).
// Model policy per the model-selection policy (global CLAUDE.md), hardcoded so there is no override plumbing to fail silently:
//   fan-outs Sonnet (never higher); scope + synthesis inherit the session model (the spine tiers).

const A = args && typeof args === 'object' && !Array.isArray(args) ? args : null
if (!A) return { error: 'args must be a JSON OBJECT: {requestPath, reportPath, date, notesDir?, readFirst?, assignments?, maxFollowups?} — got ' + (typeof args) + '. Do not pass a JSON-encoded string.' }
const REQUEST = typeof A.requestPath === 'string' ? A.requestPath : null
const REPORT = typeof A.reportPath === 'string' ? A.reportPath : null
const DATE = typeof A.date === 'string' ? A.date : null
if (!REQUEST || !REPORT || !DATE) return { error: 'Missing required args. Need requestPath (contract file), reportPath (output file), date (YYYY-MM-DD; scripts cannot read the clock). Got: ' + JSON.stringify({ requestPath: REQUEST, reportPath: REPORT, date: DATE }) }
const NOTES = typeof A.notesDir === 'string' ? A.notesDir : REPORT.slice(0, REPORT.lastIndexOf('/')) + '/notes'
const READ_FIRST = Array.isArray(A.readFirst) ? A.readFirst.filter(p => typeof p === 'string') : []
const MAX_FOLLOWUPS = Number.isInteger(A.maxFollowups) ? Math.max(0, Math.min(8, A.maxFollowups)) : 5

const READ_FIRST_BLOCK = READ_FIRST.length
  ? READ_FIRST.map((p, i) => (i + 2) + '. ' + p + ' — pre-verified grounding material. Mine it for leads; do not re-derive what it already covers — VERIFY key items and EXTEND beyond it.').join('\n')
  : ''

const ASSIGN_SCHEMA = {
  type: 'object', required: ['assignments'],
  properties: {
    assignments: { type: 'array', minItems: 6, maxItems: 16, items: {
      type: 'object', required: ['label', 'file', 'coverage', 'brief'],
      properties: {
        label: { type: 'string' },
        file: { type: 'string' },
        coverage: { type: 'string' },
        brief: { type: 'string' },
      },
    }},
    strategy: { type: 'string' },
  },
}

// ── Scope (only when the dispatcher did not author assignments) — session model: planning ──
let ASSIGNMENTS = Array.isArray(A.assignments) && A.assignments.length > 0
  ? A.assignments.filter(a => a && a.label && a.file && a.brief).map(a => ({ label: a.label, file: a.file, coverage: a.coverage || a.label, brief: a.brief }))
  : null
if (!ASSIGNMENTS) {
  phase('Scope')
  const scoped = await agent(
    '## Research planner\n\nToday is ' + DATE + '. Read the research request/contract file at ' + REQUEST + ' fully' + (READ_FIRST.length ? ', plus the grounding material: ' + READ_FIRST.join(', ') : '') + '.\n\n' +
    'Decompose the request into 6-16 research assignments that together cover EVERY required content area (split dense areas across multiple assignments; merge thin ones). For each: a kebab-case label; a notes filename "<label>.md"; a one-line coverage statement naming which request section(s) it covers; and a self-contained, payload-complete brief (5-12 lines) naming exact search targets — papers, people, orgs, URLs, dates — that a researcher with NO other context can execute. Return structured output.',
    { label: 'scope-assignments', phase: 'Scope', schema: ASSIGN_SCHEMA, agentType: 'general-purpose' }
    // no model key: inherits the session model — planning is spine-tier work
  )
  if (!scoped) return { error: 'Scope agent returned no assignments and none were supplied via args.' }
  ASSIGNMENTS = scoped.assignments
}
log(ASSIGNMENTS.length + ' assignments: ' + ASSIGNMENTS.map(a => a.label).join(', '))

const RESEARCH_PROMPT = (a) =>
  '## Field researcher: ' + a.label + '\n\n' +
  'You are one of several researchers building the evidence base for a comprehensive field report. Today is ' + DATE + '.\n\n' +
  '## Read these first (on disk)\n' +
  '1. ' + REQUEST + ' — the master research request. It is the contract; your assignment covers: ' + a.coverage + '. Honor its scope boundaries, exclusions, and conventions (inline URLs, dated claims, source-quality and independence marking).\n' +
  READ_FIRST_BLOCK + (READ_FIRST_BLOCK ? '\n' : '') + '\n' +
  '## Your assignment\n' + a.brief + '\n\n' +
  '## Method\n' +
  '- Load WebSearch and WebFetch via ToolSearch if needed. Run at least 5 distinct WebSearch queries (vary phrasing; add recency qualifiers where freshness matters). WebFetch at least 5 of the most promising sources in full (prefer primary: paper abstract pages, org sites, official docs).\n' +
  '- Capture EXACT names, titles, dates, URLs. Never invent a URL — only record URLs you saw in search results or fetched pages.\n\n' +
  '## Output contract\n' +
  'Write your complete notes to ' + NOTES + '/' + a.file + ' as markdown with EXACTLY these sections:\n' +
  '1. "## Key facts" — bulleted facts, each with inline URL, date, and quality mark [primary/secondary/blog], plus [self-report] where an organization reports on itself\n' +
  '2. "## Narrative notes" — substantive short prose per subtopic (the report writer draws on this; make it rich, not telegraphic)\n' +
  '3. "## Resource index entries" — markdown table: Name | Type | URL | Why it matters — EVERY person, org, paper, book, tool, dataset, community you found\n' +
  '4. "## Load-bearing claims" — the 3-6 facts most central to the report that would be most damaging if wrong, numbered\n' +
  '5. "## Gaps" — what you could not find or confirm\n' +
  'Do not write or modify any other file. Then return structured output.'

const RESEARCH_SCHEMA = {
  type: 'object', required: ['file', 'keyFindings', 'resourceCount', 'loadBearingCount'],
  properties: {
    file: { type: 'string' },
    keyFindings: { type: 'array', maxItems: 8, items: { type: 'string' } },
    resourceCount: { type: 'number' },
    loadBearingCount: { type: 'number' },
    gaps: { type: 'array', maxItems: 4, items: { type: 'string' } },
  },
}

const VERIFY_PROMPT = (file, label) =>
  '## Notes verifier: ' + label + '\n\n' +
  'Today is ' + DATE + '. Read the notes file ' + NOTES + '/' + file + ' fully.\n\n' +
  '## Task\n' +
  '1. For EACH numbered item under "## Load-bearing claims": independently verify it with fresh WebSearch/WebFetch — do NOT trust the file citation; actively try to REFUTE it (wrong date, wrong attribution, overstated, superseded by newer events).\n' +
  '2. Spot-check up to 10 of the most important URLs in the file: fetch each; confirm it resolves and actually supports the fact attached to it.\n' +
  '3. EDIT the file in place: fix wrong dates/titles/attributions directly; prefix items you could NOT confirm with "⚠️ unverified: "; prefix refuted items with "❌ refuted: " plus a one-line reason and keep them visible (do not delete). Append a "## Verification report" section: what you checked, what you changed, residual doubts.\n' +
  'Do not touch any other file. Then return structured output.'

const VERIFY_SCHEMA = {
  type: 'object', required: ['file', 'factsChecked', 'corrections', 'refuted'],
  properties: {
    file: { type: 'string' },
    factsChecked: { type: 'number' },
    corrections: { type: 'number' },
    unverified: { type: 'number' },
    refuted: { type: 'number' },
    brokenLinks: { type: 'number' },
  },
}

const researchThenVerify = (phaseName) => [
  a => agent(RESEARCH_PROMPT(a), {
    label: 'research:' + a.label, phase: phaseName === 'wave1' ? 'Research' : 'Gap check', schema: RESEARCH_SCHEMA,
    model: 'sonnet', effort: 'medium', agentType: 'general-purpose',
  }).then(r => { if (r) log(a.label + ': ' + r.resourceCount + ' resources, ' + r.loadBearingCount + ' load-bearing claims'); return r }),
  (res, a) => {
    if (!res) { log(a.label + ': research failed — skipping verify'); return null }
    return agent(VERIFY_PROMPT(a.file, a.label), {
      label: 'verify:' + a.label, phase: phaseName === 'wave1' ? 'Verify' : 'Gap check', schema: VERIFY_SCHEMA,
      model: 'sonnet', effort: 'medium', agentType: 'general-purpose',
    }).then(v => ({ assignment: a.label, file: a.file, research: res, verify: v }))
  },
]

// ── Wave 1: research → per-file verify, no barrier between stages ──
const wave1 = await pipeline(ASSIGNMENTS, ...researchThenVerify('wave1'))
const completed = wave1.filter(Boolean)
const failed = ASSIGNMENTS.filter(a => !completed.some(c => c.assignment === a.label)).map(a => a.label)
log('Wave 1: ' + completed.length + '/' + ASSIGNMENTS.length + ' completed' + (failed.length ? ' — failed: ' + failed.join(', ') : ''))
if (completed.length === 0) return { error: 'Every research assignment failed — nothing to synthesize.', failedAssignments: failed }

// ── Gap check (barrier is genuine: the critic needs ALL notes to judge coverage) ──
phase('Gap check')
const CRITIC_SCHEMA = {
  type: 'object', required: ['followups'],
  properties: {
    followups: { type: 'array', maxItems: 8, items: {
      type: 'object', required: ['label', 'file', 'brief'],
      properties: { label: { type: 'string' }, file: { type: 'string' }, brief: { type: 'string' } },
    }},
    assessment: { type: 'string' },
  },
}
const critic = MAX_FOLLOWUPS === 0 ? null : await agent(
  '## Completeness critic\n\nToday is ' + DATE + '. The master research request is ' + REQUEST + ' (read it fully — especially its required content areas and any depth priorities). The evidence base is the notes files in ' + NOTES + '/ (list and skim ALL of them; read section headers, "## Gaps", and "## Verification report" sections closely).\n\nCompleted assignment files: ' + completed.map(c => c.file).join(', ') + (failed.length ? '\nFAILED assignments (no notes exist — their coverage is missing entirely): ' + failed.join(', ') : '') + '\n\n## Task\nIdentify the most damaging coverage gaps versus the request: a required content area with thin or missing notes, a modality never searched (news vs academic vs community vs official docs), load-bearing topics the notes flag as unfound, or anything the request names that no file covers. Return up to ' + MAX_FOLLOWUPS + ' follow-up research assignments, most damaging first — each with a kebab-case label, a NEW filename of the form "extra-<label>.md", and a specific, self-contained brief (name exact search targets). Return followups: [] if coverage is genuinely adequate. Do not write any files.',
  { label: 'gap-critic', phase: 'Gap check', schema: CRITIC_SCHEMA, model: 'sonnet', effort: 'medium', agentType: 'general-purpose' }
)
const followups = (critic && critic.followups ? critic.followups : []).slice(0, MAX_FOLLOWUPS)
log('Gap check: ' + (followups.length ? followups.length + ' follow-ups: ' + followups.map(f => f.label).join(', ') : 'coverage adequate, no follow-ups'))
const wave2 = followups.length === 0 ? [] : await pipeline(
  followups.map(f => ({ label: f.label, file: f.file, coverage: 'gap follow-up: ' + f.label, brief: f.brief })),
  ...researchThenVerify('wave2')
)
const allDone = completed.concat(wave2.filter(Boolean))

// ── Synthesize: ONE writer, deliberately unpinned → inherits the session model (spine tier) ──
phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object', required: ['reportPath', 'sections', 'approxWords'],
  properties: {
    reportPath: { type: 'string' },
    sections: { type: 'array', items: { type: 'string' } },
    approxWords: { type: 'number' },
    biggestGaps: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
}
const synth = await agent(
  '## Report writer — field report\n\n' +
  'Today is ' + DATE + '. You are writing the final deliverable of a deep-research run: a comprehensive field report.\n\n' +
  '## Inputs (all on disk)\n' +
  '1. ' + REQUEST + ' — THE CONTRACT. Read it fully. Its required content areas, conventions, depth priorities, and out-of-scope list all bind you.\n' +
  READ_FIRST_BLOCK + (READ_FIRST_BLOCK ? '\n' : '') +
  (READ_FIRST.length + 2) + '. ALL notes files in ' + NOTES + '/ (' + allDone.length + ' files: ' + allDone.map(c => c.file).join(', ') + ') — the verified evidence base. Facts marked "⚠️ unverified" must be hedged or attributed if used; facts marked "❌ refuted" must NOT be stated as true (mention only, if at all, as corrected misconceptions).\n\n' +
  '## Task\n' +
  'Write the report to ' + REPORT + '. Requirements:\n' +
  '- Begin with a metadata block: title, date, generated-by (Claude Code adams-field-research workflow: ' + ASSIGNMENTS.length + ' research agents + per-file adversarial verification + a gap-check round), and an honest limitations note (single-session web sweep; flagged items are leads to re-verify, not settled facts).\n' +
  '- Then a genuine executive summary.\n' +
  '- Then cover EVERY required content area of the request. Follow the request\'s structural instructions if it gives them; otherwise choose the structure that serves the material. Nothing required may be dropped; honor any depth priorities the request states.\n' +
  '- Where notes files conflict, present the conflict. Where the evidence base is thin, say so rather than padding.\n' +
  '- If the request requires structured appendices (e.g. a consolidated resource index), build them by deduplicating across ALL notes files.\n' +
  '- End the report with a short "Remaining gaps and items to re-verify" section consolidating the notes files\' flagged doubts.\n' +
  '- Target 8,000-15,000 words unless the request says otherwise. Write the file INCREMENTALLY — an initial Write for the skeleton and early sections, then successive Edit calls appending sections — to avoid output truncation. Sparing targeted WebFetch/WebSearch is allowed to close a critical hole, but the notes are your evidence base; do not re-research broadly.\n' +
  'When finished, return structured output listing your section headings, approximate word count, and the biggest remaining gaps.',
  { label: 'synthesize-report', phase: 'Synthesize', schema: SYNTH_SCHEMA, agentType: 'general-purpose' }
  // no model key on purpose: inherits the session model — synthesis is spine-tier work
)

const vTotals = allDone.reduce((t, c) => {
  const v = c.verify || {}
  return { checked: t.checked + (v.factsChecked || 0), corrections: t.corrections + (v.corrections || 0), unverified: t.unverified + (v.unverified || 0), refuted: t.refuted + (v.refuted || 0), brokenLinks: t.brokenLinks + (v.brokenLinks || 0) }
}, { checked: 0, corrections: 0, unverified: 0, refuted: 0, brokenLinks: 0 })

return {
  reportPath: synth ? synth.reportPath : null,
  synthesis: synth || ('SYNTHESIS FAILED — notes files in ' + NOTES + ' are intact; re-run synthesis alone (resume this run or dispatch one session-model writer with the same prompt)'),
  notesFiles: allDone.map(c => c.file),
  failedAssignments: failed,
  followupsRun: wave2.filter(Boolean).map(c => c.assignment),
  verification: vTotals,
  modelPolicy: 'fan-outs sonnet (hardcoded); scope+synthesis session-inherit; assignments best authored by the dispatcher inline',
}
