// adams-deep-research — model-tiered deep-research Workflow (a fork of Claude Code's built-in deep-research).
// Installs at ~/.claude/workflows/adams-deep-research.js; runnable via Workflow({name: 'adams-deep-research', args: '<question>'}).
// The paired skill description (meta.whenToUse below) is what surfaces it — the skill invokes this workflow by name.
export const meta = {
  name: 'adams-deep-research',
  description: 'Model-tiered deep research — unbounded search angles, Sonnet fan-outs, session-model scope/synthesis, adversarial 3-lens verification; tiers overridable via args.',
  whenToUse: 'When Adam wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in. Fork of the built-in deep-research: angle count scales with the question (not fixed at 5), mechanical/unbounded stages pinned Sonnet, scope+synthesis inherit the session model, and central claims get one Opus verifier by default. Args: a plain question string, or {question, maxModel, models:{scope,search,fetch,verify,opusVoter,synthesize}} — pass maxModel:"sonnet" when the run must stay Sonnet-only (it clamps the Opus voter escalation and pins the otherwise session-inherited scope/synthesize stages; never pass a tier above the session model).',
  phases: [
    { title: "Scope", detail: "Decompose question (from args) into as many angles as it warrants (3-12)" },
    { title: "Search", detail: "One searcher per angle", model: "sonnet" },
    { title: "Fetch", detail: "URL-dedup, fetch top sources (3/angle budget), extract falsifiable claims", model: "sonnet" },
    { title: "Verify", detail: "3-lens adversarial verification per claim (2/3 refutes kill); central claims get one Opus voter unless args clamps it", model: "sonnet" },
    { title: "Synthesize", detail: "Merge semantic dupes, rank by confidence, cite sources" },
  ],
}

// adams-deep-research: Scope → pipeline(Search → URL-dedup → Fetch+Extract) → 3-lens Verify → Synthesize
// Forked from the built-in deep-research workflow (Claude Code 2.1.198). Changes:
//   1. Angle count is question-driven (3-12), not fixed at 5; fetch/verify budgets scale with it.
//   2. Model tiers per the model-selection policy (global CLAUDE.md): unbounded fan-outs (fetch, verify) hard-pinned Sonnet;
//      bounded-but-mechanical search pinned Sonnet at low effort; scope and synthesis stay
//      UNPINNED so they inherit the session's top tier without ever exceeding the ceiling.
//      Exception per policy: the claim list is known before verify dispatches, so the top
//      central-importance claims each get one Opus voter (voter 0, the overreach lens).
//   3. Verify voters are perspective-diverse (support/overreach · contradiction · quality/recency)
//      instead of three identical prompts.
//   4. Caller model control: args may be {question, maxModel, models:{scope,search,fetch,
//      verify,opusVoter,synthesize}} — maxModel is a hard tier ceiling (haiku|sonnet|opus)
//      clamping every stage INCLUDING the Opus voter escalation, and pinning the otherwise
//      session-inherited scope/synthesize stages; models.* overrides one stage (still
//      clamped by maxModel). Plain-string args keeps all defaults.
// Question is passed via Workflow({name: 'adams-deep-research', args: '<question>'}).

const VOTES_PER_CLAIM = 3
const REFUTATIONS_REQUIRED = 2
const FETCH_PER_ANGLE = 3        // fetch budget scales with angle count…
const MIN_FETCH = 15             // …but never below the original's 15
const VERIFY_PER_ANGLE = 5       // verify cap scales with angle count…
const MIN_VERIFY = 25            // …but never below the original's 25
const OPUS_VOTER_CAP = 15        // at most this many central claims get an escalated voter

// ─── Schemas ───
const SCOPE_SCHEMA = {
  type: "object", required: ["question", "angles", "summary"],
  properties: {
    question: { type: "string" },
    summary: { type: "string" },
    angles: { type: "array", minItems: 3, maxItems: 12, items: {
      type: "object", required: ["label", "query"],
      properties: {
        label: { type: "string" },
        query: { type: "string" },
        rationale: { type: "string" },
      },
    }},
  },
}
const SEARCH_SCHEMA = {
  type: "object", required: ["results"],
  properties: {
    results: { type: "array", maxItems: 6, items: {
      type: "object", required: ["url", "title", "relevance"],
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        snippet: { type: "string" },
        relevance: { enum: ["high", "medium", "low"] },
      },
    }},
  },
}
const EXTRACT_SCHEMA = {
  type: "object", required: ["claims", "sourceQuality"],
  properties: {
    sourceQuality: { enum: ["primary", "secondary", "blog", "forum", "unreliable"] },
    publishDate: { type: "string" },
    claims: { type: "array", maxItems: 5, items: {
      type: "object", required: ["claim", "quote", "importance"],
      properties: {
        claim: { type: "string" },
        quote: { type: "string" },
        importance: { enum: ["central", "supporting", "tangential"] },
      },
    }},
  },
}
const VERDICT_SCHEMA = {
  type: "object", required: ["refuted", "evidence", "confidence"],
  properties: {
    refuted: { type: "boolean" },
    evidence: { type: "string" },
    confidence: { enum: ["high", "medium", "low"] },
    counterSource: { type: "string" },
  },
}
const REPORT_SCHEMA = {
  type: "object", required: ["summary", "findings", "caveats"],
  properties: {
    summary: { type: "string" },
    findings: { type: "array", items: {
      type: "object", required: ["claim", "confidence", "sources", "evidence"],
      properties: {
        claim: { type: "string" },
        confidence: { enum: ["high", "medium", "low"] },
        sources: { type: "array", items: { type: "string" } },
        evidence: { type: "string" },
        vote: { type: "string" },
      },
    }},
    caveats: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
}

// ─── Phase 0: Scope — decompose question into search angles (inherits session model) ───
phase("Scope")
const OPTS = (args && typeof args === "object" && !Array.isArray(args)) ? args : {}
const QUESTION = ((typeof args === "string" ? args : (typeof OPTS.question === "string" ? OPTS.question : "")) || "").trim()
if (!QUESTION) {
  return { error: "No research question provided. Pass it as args: Workflow({name: 'adams-deep-research', args: '<question>'}) — or args: {question, maxModel, models} for model control." }
}

// ─── Model control (fork change 4) — every stage tier resolves through these ───
// maxModel is a hard ceiling: clamps each pinned default (incl. the Opus voter escalation)
// and pins the otherwise session-inherited scope/synthesize stages. Scripts can't read the
// session tier, so the CALLER must never pass a tier above it — the invoking orchestrator
// is the one holding the delegation policy.
const TIERS = ["haiku", "sonnet", "opus"]
const MAX_MODEL = TIERS.includes(OPTS.maxModel) ? OPTS.maxModel : null
const STAGE_MODELS = (OPTS.models && typeof OPTS.models === "object" && !Array.isArray(OPTS.models)) ? OPTS.models : {}
const clampTier = m => (MAX_MODEL && TIERS.indexOf(m) > TIERS.indexOf(MAX_MODEL)) ? MAX_MODEL : m
const pick = (stage, dflt) => clampTier(TIERS.includes(STAGE_MODELS[stage]) ? STAGE_MODELS[stage] : dflt)
// For the two default-unpinned stages: explicit override wins (clamped), else maxModel
// pins them, else {} → inherit the session model as before.
const inheritOr = stage => {
  const m = TIERS.includes(STAGE_MODELS[stage]) ? clampTier(STAGE_MODELS[stage]) : MAX_MODEL
  return m ? { model: m } : {}
}
if (MAX_MODEL || Object.keys(STAGE_MODELS).length > 0) {
  log("Model control: ceiling=" + (MAX_MODEL || "none") + (Object.keys(STAGE_MODELS).length ? " overrides=" + JSON.stringify(STAGE_MODELS) : ""))
}

const scope = await agent(
  "Decompose this research question into complementary search angles.\n\n" +
  "## Question\n" + QUESTION + "\n\n" +
  "## Task\n" +
  "Generate as many distinct web search queries as the question genuinely warrants — typically 5-8, up to 12 for broad, multi-faceted, or comparative questions; as few as 3 for narrow ones. Do NOT pad with redundant angles. Pick angles that suit the question's domain. Examples:\n" +
  "- broad/primary  · academic/technical  · recent news  · contrarian/skeptical  · practitioner/implementation\n" +
  "- For medical: anatomy · common causes · serious differentials · authoritative refs · red flags\n" +
  "- For tech: state-of-art · benchmarks · limitations · industry adoption · cost/tradeoffs\n\n" +
  "Make queries specific enough to surface high-signal results. Avoid redundancy.\n" +
  "Return: the question (verbatim or lightly normalized), a 1-2 sentence decomposition strategy, and the angles.\n\nStructured output only.",
  { label: "scope", schema: SCOPE_SCHEMA, ...inheritOr("scope") }
)
if (!scope) {
  return { error: "Scope agent returned no result — cannot decompose the research question." }
}
log("Q: " + QUESTION.slice(0, 80) + (QUESTION.length > 80 ? "…" : ""))
log("Decomposed into " + scope.angles.length + " angles: " + scope.angles.map(a => a.label).join(", "))

// ─── Budgets scale with angle count ───
const MAX_FETCH = Math.max(MIN_FETCH, scope.angles.length * FETCH_PER_ANGLE)
const MAX_VERIFY_CLAIMS = Math.max(MIN_VERIFY, scope.angles.length * VERIFY_PER_ANGLE)

// ─── Dedup state — accumulates across searchers as they complete ───
const normURL = u => {
  try {
    const p = new URL(u)
    return (p.hostname.replace(/^www\./, "") + p.pathname.replace(/\/$/, "")).toLowerCase()
  } catch { return u.toLowerCase() }
}
const seen = new Map()
const dupes = []
const budgetDropped = []
const relRank = { high: 0, medium: 1, low: 2 }
let fetchSlots = MAX_FETCH

// ─── Prompts ───
const SEARCH_PROMPT = (angle) =>
  "## Web Searcher: " + angle.label + "\n\n" +
  "Research question: \"" + QUESTION + "\"\n\n" +
  "Your angle: **" + angle.label + "** — " + (angle.rationale || "") + "\n" +
  "Search query: `" + angle.query + "`\n\n" +
  "## Task\nUse WebSearch with the query above (or a refined version). Return the top 4-6 most relevant results.\n" +
  "Rank by relevance to the ORIGINAL question, not just the search query. Skip obvious SEO spam/content farms.\n" +
  "Include a short snippet capturing why each result is relevant.\n\nStructured output only."

const FETCH_PROMPT = (source, angle) =>
  "## Source Extractor\n\n" +
  "Research question: \"" + QUESTION + "\"\n\n" +
  "Fetch and extract key claims from this source:\n" +
  "**URL:** " + source.url + "\n**Title:** " + source.title + "\n**Found via:** " + angle + " search\n\n" +
  "## Task\n1. Use WebFetch to retrieve the page content.\n" +
  "2. Assess source quality: primary research/institution? secondary reporting? blog/opinion? forum? unreliable?\n" +
  "3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n" +
  "   - be a concrete, checkable statement (not vague generalities)\n" +
  "   - include a direct quote from the source as support\n" +
  "   - be rated central/supporting/tangential to the research question\n" +
  "4. Note publish date if available.\n\n" +
  "If the fetch fails or the page is irrelevant/paywalled, return claims: [] and sourceQuality: \"unreliable\".\n\nStructured output only."

// Perspective-diverse verify lenses — each voter attacks the claim a different way.
const LENSES = [
  { tag: "support", name: "Support & Overreach",
    checklist:
      "1. Read the quote strictly: does it actually establish the claim AS STATED, or is the claim an overreach, misread, or generalization beyond what the source says?\n" +
      "2. Does the claim smuggle in precision the quote doesn't have (numbers, causality, universality, 'best/first/only')?\n" +
      "3. Is this marketing copy, a press release, a cherry-picked benchmark, or forum speculation dressed as fact?\n" +
      "4. Would a careful reader of ONLY the quote agree the claim follows? If not, refute." },
  { tag: "contradict", name: "Contradiction Search",
    checklist:
      "1. WebSearch for evidence AGAINST this claim — credible sources that dispute, heavily qualify, or complicate it.\n" +
      "2. Search for the claim's strongest form and its negation; look for disagreement among credible sources.\n" +
      "3. If credible contradiction or heavy qualification exists, refute and cite it in counterSource.\n" +
      "4. Absence of contradiction after a real search is evidence FOR the claim — say what you searched." },
  { tag: "quality", name: "Source Quality & Recency",
    checklist:
      "1. Is the source quality sufficient for the claim's strength? Extraordinary claims need primary sources.\n" +
      "2. Is the claim outdated? Check dates — old claims about fast-moving fields are suspect. WebSearch for newer information if unsure.\n" +
      "3. Is the source independent, or does it have an incentive to make this claim (vendor, advocate, litigant)?\n" +
      "4. Does the publisher have a track record of reliability on this topic?" },
]

if (LENSES.length !== VOTES_PER_CLAIM) {
  return { error: "Config error: LENSES (" + LENSES.length + ") must match VOTES_PER_CLAIM (" + VOTES_PER_CLAIM + ") — each voter needs a lens." }
}

const VERIFY_PROMPT = (claim, lens, v) =>
  "## Adversarial Claim Verifier — lens: " + lens.name + " (voter " + (v + 1) + "/" + VOTES_PER_CLAIM + ")\n\n" +
  "Be SKEPTICAL. Try to REFUTE this claim through your assigned lens. ≥" + REFUTATIONS_REQUIRED + "/" + VOTES_PER_CLAIM + " refutations kill it.\n\n" +
  "## Research question\n" + QUESTION + "\n\n" +
  "## Claim under review\n\"" + claim.claim + "\"\n\n" +
  "**Source:** " + claim.sourceUrl + " (" + claim.sourceQuality + ")\n" +
  "**Supporting quote:** \"" + claim.quote + "\"\n\n" +
  "## Your lens's checklist\n" + lens.checklist + "\n\n" +
  "**refuted=true** if your lens finds a real problem: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\n" +
  "**refuted=false** ONLY if the claim holds up under your lens's scrutiny.\n" +
  "Default to refuted=true if uncertain.\n\nStructured output only. Evidence MUST be specific."

// ─── Pipeline: search → dedup → fetch+extract (no barrier) — Sonnet by default ───
const searchResults = await pipeline(
  scope.angles,

  angle => agent(SEARCH_PROMPT(angle), {
    label: "search:" + angle.label, phase: "Search", schema: SEARCH_SCHEMA,
    model: pick("search", "sonnet"), effort: "low",
  }).then(r => {
    if (!r) return null
    log(angle.label + ": " + r.results.length + " results")
    return { angle: angle.label, results: r.results }
  }),

  searchResult => {
    const sorted = [...searchResult.results].sort((a, b) => relRank[a.relevance] - relRank[b.relevance])
    const novel = sorted.filter(r => {
      const key = normURL(r.url)
      if (seen.has(key)) {
        dupes.push({ ...r, angle: searchResult.angle, dupOf: seen.get(key) })
        return false
      }
      if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {
        budgetDropped.push({ ...r, angle: searchResult.angle })
        return false
      }
      seen.set(key, { angle: searchResult.angle, title: r.title })
      fetchSlots--
      return true
    })
    if (novel.length < searchResult.results.length) {
      log(searchResult.angle + ": " + novel.length + " novel (" + (searchResult.results.length - novel.length) + " filtered)")
    }
    return parallel(
      novel.map(source => () => {
        let host = "unknown"
        try { host = new URL(source.url).hostname.replace(/^www\./, "") } catch {}
        return agent(FETCH_PROMPT(source, searchResult.angle), {
          label: "fetch:" + host,
          phase: "Fetch",
          schema: EXTRACT_SCHEMA,
          model: pick("fetch", "sonnet"),
        }).then(ext => {
          // User-skip → null; drop it (filtered by searchResults.flat().filter(Boolean))
          // rather than throwing into .catch() and mislabeling it "unreliable".
          if (!ext) return null
          return {
            url: source.url, title: source.title, angle: searchResult.angle,
            sourceQuality: ext.sourceQuality, publishDate: ext.publishDate,
            claims: ext.claims.map(c => ({ ...c, sourceUrl: source.url, sourceQuality: ext.sourceQuality })),
          }
        }).catch(e => {
          log("fetch failed: " + source.url + " — " + (e.message || e))
          return { url: source.url, title: source.title, angle: searchResult.angle, sourceQuality: "unreliable", claims: [] }
        })
      })
    )
  }
)

const allSources = searchResults.flat().filter(Boolean)
const allClaims = allSources.flatMap(s => s.claims)
const impRank = { central: 0, supporting: 1, tangential: 2 }
const qualRank = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 }

const rankedClaims = [...allClaims]
  .sort((a, b) => (impRank[a.importance] - impRank[b.importance]) || (qualRank[a.sourceQuality] - qualRank[b.sourceQuality]))
  .slice(0, MAX_VERIFY_CLAIMS)

log("Fetched " + allSources.length + " sources → " + allClaims.length + " claims → verifying top " + rankedClaims.length)
if (allClaims.length > rankedClaims.length) {
  log("Verify cap: dropping " + (allClaims.length - rankedClaims.length) + " lower-ranked claims (cap " + MAX_VERIFY_CLAIMS + ")")
}

if (rankedClaims.length === 0) {
  return {
    question: QUESTION,
    summary: "No claims extracted. " + allSources.length + " sources fetched, all empty/failed. " + dupes.length + " URL dupes, " + budgetDropped.length + " budget-dropped.",
    findings: [], refuted: [], sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: 0, dupes: dupes.length },
  }
}

// ─── Verify: 3-lens adversarial; voter 0 escalates on top central claims (default Opus) ───
// Barrier here is intentional — claim pool must be fully assembled before ranking/verification.
// Per-item escalation sizing is policy-compliant: the claim list is known before dispatch.
// Default-Opus voters are contract-authorized even on a sub-Opus session (the skill
// description advertises them — invoking the workflow IS the explicit request), but the
// CALLER stays in charge: args {maxModel} or {models:{opusVoter}} clamps or disables the
// escalation (scripts can't read the session tier, so the ceiling must be passed in).
phase("Verify")
const VERIFY_MODEL = pick("verify", "sonnet")
const ESCALATION_MODEL = pick("opusVoter", "opus")
const voterModel = (claim, idx, v) =>
  (v === 0 && claim.importance === "central" && idx < OPUS_VOTER_CAP) ? ESCALATION_MODEL : VERIFY_MODEL
const escalatedVotes = ESCALATION_MODEL === VERIFY_MODEL ? 0
  : rankedClaims.filter((c, i) => voterModel(c, i, 0) === ESCALATION_MODEL).length
log("Verifying with " + LENSES.map(l => l.tag).join("/") + " lenses; " +
  (escalatedVotes > 0
    ? escalatedVotes + " central claims get a " + ESCALATION_MODEL + " support-lens voter"
    : "no voter escalation — all voters " + VERIFY_MODEL))

const voted = (await parallel(
  rankedClaims.map((claim, idx) => () =>
    parallel(
      Array.from({ length: VOTES_PER_CLAIM }, (_, v) => () =>
        agent(VERIFY_PROMPT(claim, LENSES[v], v), {
          label: LENSES[v].tag + ":" + claim.claim.slice(0, 40),
          phase: "Verify",
          schema: VERDICT_SCHEMA,
          model: voterModel(claim, idx, v),
        })
      )
    ).then(verdicts => {
      // A vote can be null (user-skip or agent error) — treat as abstain.
      const valid = verdicts.filter(Boolean)
      const refuted = valid.filter(v => v.refuted).length
      // Survive only if the claim was actually adjudicated: a quorum of
      // valid votes AND fewer than REFUTATIONS_REQUIRED refuting. Too many
      // abstentions = unverified, which must NOT pass into the report
      // (otherwise all-abstain → refuted=0 → false survive).
      const abstained = VOTES_PER_CLAIM - valid.length
      const survives = valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED
      log("\"" + claim.claim.slice(0, 50) + "…\": " + (valid.length - refuted) + "-" + refuted + (abstained > 0 ? " (" + abstained + " abstain)" : "") + " " + (survives ? "✓" : "✗"))
      return { ...claim, verdicts: valid, refutedVotes: refuted, survives }
    })
  )
)).filter(Boolean)

const confirmed = voted.filter(c => c.survives)
const killed = voted.filter(c => !c.survives)
log("Verify done: " + voted.length + " claims → " + confirmed.length + " confirmed, " + killed.length + " killed")

if (confirmed.length === 0) {
  return {
    question: QUESTION,
    summary: "All " + voted.length + " claims refuted by adversarial verification. Research inconclusive — sources may be low-quality or claims overstated.",
    findings: [],
    refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
    sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 0, killed: killed.length },
  }
}

// ─── Synthesize (inherits session model unless args pins it) ───
phase("Synthesize")
const confRank = { high: 0, medium: 1, low: 2 }
const block = confirmed.map((c, i) => {
  const best = c.verdicts.filter(v => !v.refuted).sort((a, b) => confRank[a.confidence] - confRank[b.confidence])[0]
  return "### [" + i + "] " + c.claim + "\n" +
    "Vote: " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes + " · Source: " + c.sourceUrl + " (" + c.sourceQuality + ")\n" +
    "Quote: \"" + c.quote + "\"\nVerifier evidence (" + best.confidence + "): " + best.evidence + "\n"
}).join("\n")

const killedBlock = killed.length > 0
  ? "\n## Refuted claims (for transparency)\n" +
    killed.map(c => "- \"" + c.claim + "\" (" + c.sourceUrl + ", vote " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes + ")").join("\n")
  : ""

const report = await agent(
  "## Synthesis: research report\n\n" +
  "**Question:** " + QUESTION + "\n\n" +
  confirmed.length + " claims survived " + VOTES_PER_CLAIM + "-lens adversarial verification. Merge semantic duplicates and synthesize.\n\n" +
  "## Confirmed claims\n" + block + "\n" + killedBlock + "\n\n" +
  "## Instructions\n" +
  "1. Identify claims that say the same thing — merge them, combine their sources.\n" +
  "2. Group related claims into coherent findings. Each finding should directly address the research question.\n" +
  "3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n" +
  "4. Write a 3-5 sentence executive summary answering the research question.\n" +
  "5. List caveats (one string per caveat): what's uncertain, what sources were weak, what time-sensitivity applies.\n" +
  "6. List 2-4 open questions that emerged but weren't answered.\n\nStructured output only.",
  { label: "synthesize", schema: REPORT_SCHEMA, ...inheritOr("synthesize") }
)

if (!report) {
  // Synthesis skipped/errored — salvage the verified claims raw rather
  // than throwing on report.findings and discarding the whole run.
  return {
    question: QUESTION,
    summary: "Synthesis step was skipped or failed — returning " + confirmed.length + " verified claims unmerged.",
    findings: [],
    confirmed: confirmed.map(c => ({ claim: c.claim, source: c.sourceUrl, quote: c.quote, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes })),
    refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
    sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: confirmed.length, killed: killed.length, afterSynthesis: 0 },
  }
}

// Tally actual dispatched tiers (a stage with no model key inherited the session model).
const modelMix = {}
const bumpMix = (m, n) => { if (n > 0) { const k = m || "session-inherit"; modelMix[k] = (modelMix[k] || 0) + n } }
bumpMix(inheritOr("scope").model, 1)
bumpMix(pick("search", "sonnet"), scope.angles.length)
bumpMix(pick("fetch", "sonnet"), allSources.length)
bumpMix(VERIFY_MODEL, voted.length * VOTES_PER_CLAIM - escalatedVotes)
bumpMix(ESCALATION_MODEL, escalatedVotes)
bumpMix(inheritOr("synthesize").model, 1)

return {
  question: QUESTION,
  ...report,
  refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
  sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, angle: s.angle, claimCount: s.claims.length })),
  stats: {
    angles: scope.angles.length,
    fetchBudget: MAX_FETCH,
    sourcesFetched: allSources.length,
    claimsExtracted: allClaims.length,
    claimsVerified: voted.length,
    confirmed: confirmed.length,
    killed: killed.length,
    afterSynthesis: report.findings.length,
    urlDupes: dupes.length,
    budgetDropped: budgetDropped.length,
    agentCalls: 1 + scope.angles.length + allSources.length + (voted.length * VOTES_PER_CLAIM) + 1,
    modelMix: modelMix,
  },
}
