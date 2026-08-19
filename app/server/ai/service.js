// AI service: builds a COMPACT context, calls the provider, parses the
// structured response, and verifies every citation against the sources that
// were actually supplied.
//
// Context budget is deliberately small — we never send whole documents. A
// typical call is ~5k input tokens: system prompt + committee state + top
// retrieved chunks + the relevant country profile + recent transcript.

import { all, get, run, id, now, json, logEvent } from '../db/client.js'
import { searchChunks } from '../search/index.js'
import { safeGenerate, aiStatus } from './provider.js'
import { SYSTEM, renderSources } from './prompts.js'
import { AI } from '../config.js'
import { activeCommittee, ourCountry } from '../committee.js'

const TOP_K = 6              // retrieved chunks per call
const CHUNK_BUDGET = 900     // chars per chunk sent to the model
const TRANSCRIPT_TURNS = 6

function trim(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

const ours = ourCountry

/** Current committee state, in as few tokens as possible. */
function committeeContext(sessionId) {
  const c = activeCommittee()
  const s = sessionId
    ? get('SELECT * FROM sessions WHERE id = ?', [sessionId])
    : get('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
  const lines = [
    `Committee: ${c.committee} · Country: ${c.country}`,
    `Agenda: ${c.agenda}`,
  ]
  if (s) {
    lines.push(`Phase: ${s.phase}${s.caucus_type ? ` (${s.caucus_type})` : ''}`)
    if (s.topic) lines.push(`Current topic: ${s.topic}`)
    if (s.current_speaker) lines.push(`Current speaker: ${s.current_speaker}`)
  }
  return { text: lines.join('\n'), session: s }
}

function recentTranscript(sessionId, limit = TRANSCRIPT_TURNS) {
  if (!sessionId) return ''
  const rows = all(
    `SELECT speaker, country, text FROM transcript_segments
      WHERE session_id = ? ORDER BY ts DESC LIMIT ?`,
    [sessionId, limit]
  ).reverse()
  if (!rows.length) return ''
  return `RECENT TRANSCRIPT (most recent last):\n${rows
    .map((r) => `${r.country || r.speaker}: ${trim(r.text, 300)}`)
    .join('\n')}`
}

function countryProfile(code) {
  if (!code) return ''
  const c = get('SELECT * FROM countries WHERE code = ?', [code])
  if (!c) return ''
  const facts = json.parse(c.facts, []).slice(0, 6)
  const vulns = json.parse(c.vulnerabilities, [])
  const defs = json.parse(c.attacks_defenses, []).slice(0, 4)
  const parts = [
    `COUNTRY PROFILE — ${c.name}`,
    c.identity,
    facts.length ? `Key facts: ${facts.join(' | ')}` : '',
    vulns.length ? `Vulnerabilities: ${vulns.join(', ')}` : '',
    defs.length ? `Attack → defense:\n${defs.map((d) => `  • ${d.attack} → ${d.defense}`).join('\n')}` : '',
    c.caution ? `⚠ CAUTION: ${c.caution}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

function pinnedNotes(limit = 4) {
  const rows = all('SELECT body, badge FROM notes WHERE pinned = 1 ORDER BY created_at DESC LIMIT ?', [limit])
  if (!rows.length) return ''
  return `PINNED NOTES:\n${rows.map((n) => `[${n.badge}] ${trim(n.body, 200)}`).join('\n')}`
}

/**
 * Assemble a compact context for one AI call.
 * @returns {Promise<{prompt:string, sources:object[], committee:object}>}
 */
export async function buildContext({ statement, sessionId, country, extraQuery, topK = TOP_K }) {
  const committee = committeeContext(sessionId)

  // Retrieve against the statement itself plus any explicit topic hint.
  const query = [statement, extraQuery].filter(Boolean).join(' ').slice(0, 400)
  const { results } = await searchChunks(query, { limit: topK })

  // Always fold in our own material even when the statement is about someone
  // else — the delegate has to answer as their own delegation, so its position
  // must be in front of the model whatever the question was about.
  const ourCode = activeCommittee().countryCode
  let sources = results
  if (ourCode && !results.some((r) => r.country === ourCode)) {
    const mine = await searchChunks(query, { limit: 3, country: ourCode })
    sources = [...results.slice(0, topK - mine.results.length), ...mine.results]
  }
  sources = sources.slice(0, topK).map((s) => ({ ...s, text: trim(s.text, CHUNK_BUDGET) }))

  const blocks = [
    committee.text,
    countryProfile(country),
    recentTranscript(sessionId),
    pinnedNotes(),
    renderSources(sources),
  ].filter(Boolean)

  return { prompt: blocks.join('\n\n'), sources, committee }
}

// ───────────────────────────────────────────────────── response parsing

/** Split a headed response into sections. Unknown headings are preserved. */
export function parseSections(text, headings) {
  const out = {}
  // Headings survive being dressed up. Some backends — Claude Code in
  // particular — wrap them in markdown, bold, emoji or an em-dash suffix
  // ("### ⚡ RESPONSE — 15 seconds"). Strip the decoration before matching,
  // otherwise a perfectly good answer parses as one unusable blob.
  const pattern = new RegExp(`^\\s*(${headings.join('|')})\\b`, 'i')
  const undecorate = (line) =>
    line
      .replace(/^\s{0,3}#{1,6}\s*/, '')                       // markdown heading
      .replace(/^\s*[>*\-–—]\s*/, '')                          // quote or bullet
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, '')  // emoji
      .replace(/\*\*|__|`/g, '')                               // bold / code
      .trim()
  // A heading line is a heading, not prose: short, and nothing after the label
  // except a separator or a parenthetical.
  const isHeading = (bare) => {
    const m = bare.match(pattern)
    if (!m) return null
    const rest = bare.slice(m[1].length).trim()
    if (rest && !/^[:—–\-(].{0,60}$/.test(rest)) return null
    return m[1]
  }

  const lines = String(text || '').split('\n')
  let current = '_preamble'
  out[current] = []
  for (const line of lines) {
    const label = isHeading(undecorate(line))
    if (label) {
      current = label.trim().toUpperCase().replace(/\s+/g, '_')
      out[current] = []
    } else {
      out[current].push(line)
    }
  }
  const result = {}
  for (const [k, v] of Object.entries(out)) {
    const body = v.join('\n').trim()
    if (body) result[k] = body
  }
  return result
}

/**
 * Verify every [S#] the model emitted maps to a source we actually supplied.
 * A fabricated citation is the single most dangerous failure for this tool,
 * so it is stripped from the output AND reported.
 */
export function verifyCitations(text, sources) {
  const cited = [...String(text || '').matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]))
  const valid = []
  const fabricated = []
  for (const n of new Set(cited)) {
    if (n >= 1 && n <= sources.length) valid.push(n)
    else fabricated.push(n)
  }
  let clean = text
  for (const n of fabricated) {
    clean = clean.replaceAll(`[S${n}]`, '[unverified citation removed]')
  }
  return {
    text: clean,
    citations: valid.map((n) => ({
      label: `S${n}`,
      chunkId: sources[n - 1].chunkId,
      documentId: sources[n - 1].documentId,
      documentTitle: sources[n - 1].documentTitle,
      heading: sources[n - 1].heading,
      pageLabel: sources[n - 1].pageLabel,
      priority: sources[n - 1].priority,
      snippet: trim(sources[n - 1].text, 260),
    })),
    fabricated,
  }
}

function extractConfidence(sections) {
  const raw = sections.CONFIDENCE || ''
  const m = raw.match(/\b(high|medium|low)\b/i)
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Unknown'
}

// `role` — live / deep / classify — not a model id. The id for that role on the
// selected backend is resolved at call time, so a Gemini or OpenAI key is never
// sent a Claude model name.
async function runAnalysis({ kind, system, userPrompt, statement, sessionId, country, extraQuery, role, headings, segmentId }) {
  const status = aiStatus()
  if (!status.available) {
    return { ok: false, reason: status.message, kind, offline: true }
  }

  const { prompt, sources } = await buildContext({ statement, sessionId, country, extraQuery })

  // The heading list is repeated in final position, where instructions carry
  // most weight. A system prompt alone does not hold it: Claude Code applies
  // its own presentation style, and an answer under invented headings
  // ("CLAIM", "FOLLOW-UP MOVE") is unparseable no matter how good the content.
  const formatRules = [
    '---',
    'OUTPUT FORMAT — required, overrides any default style.',
    'Use exactly these headings, each on its own line, in CAPITALS, nothing else on the line:',
    ...headings.map((h) => h.toUpperCase()),
    'Do not rename, add, merge or omit a heading. Plain prose underneath.',
    'No markdown headings (#), no bold, no tables, no emoji, no horizontal rules.',
    'Cite sources only as [S1], [S2] — never a number that was not supplied.',
  ].join('\n')

  const res = await safeGenerate({
    system,
    role: role || 'live',
    maxTokens: AI.maxTokens,
    messages: [{ role: 'user', content: `${prompt}\n\n---\n\n${userPrompt}\n\n${formatRules}` }],
  })

  if (!res.ok) return { ok: false, reason: res.reason, kind, sources }

  const verified = verifyCitations(res.text, sources)
  const sections = parseSections(verified.text, headings)
  const confidence = extractConfidence(sections)

  const analysisId = id('ai_')
  try {
    run(
      `INSERT INTO ai_analyses(id,kind,input_text,segment_id,session_id,output_json,citations,model,latency_ms,confidence,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [analysisId, kind, statement, segmentId ?? null, sessionId ?? null,
       JSON.stringify({ sections, raw: verified.text }), JSON.stringify(verified.citations),
       res.model, res.latencyMs, confidence, now()]
    )
    logEvent('ai', `${kind}: ${trim(statement, 60)}`, { confidence, latencyMs: res.latencyMs })
  } catch { /* persistence is best-effort; the answer still returns */ }

  return {
    ok: true,
    id: analysisId,
    kind,
    sections,
    raw: verified.text,
    citations: verified.citations,
    fabricatedCitations: verified.fabricated,
    confidence,
    model: res.model,
    provider: res.provider,
    latencyMs: res.latencyMs,
    usage: res.usage,
    sources: sources.map(({ text, ...rest }) => rest),
  }
}

// ─────────────────────────────────────────────────────────── public API

export function respondToThis({ statement, sessionId, country, segmentId }) {
  return runAnalysis({
    kind: 'respond',
    system: SYSTEM.respond,
    userPrompt: `STATEMENT HEARD IN COMMITTEE${country ? ` (from ${country})` : ''}:\n"${statement}"\n\nProduce the response in the required format.`,
    statement, sessionId, country, segmentId,
    headings: ['ASSESSMENT', 'OUR POSITION', 'RESPONSE', 'POI', 'EVIDENCE', 'CONFIDENCE'],
  })
}

export function defenseMode({ country, statement = '', sessionId }) {
  const c = get('SELECT name FROM countries WHERE code = ?', [country])
  const target = c?.name || country
  return runAnalysis({
    kind: 'defense',
    system: SYSTEM.defense,
    userPrompt: `${target} is attacking ${ours()}${statement ? ` and has said:\n"${statement}"` : '.'}\n\nPrepare the defense for ${ours()} in the required format.`,
    statement: statement || `${target} attacks ${ours()}`,
    // Retrieval hint, not a prompt: pull the delegate's own recorded weaknesses
    // so the defense is built from researched material rather than invented.
    extraQuery: `${ours()} vulnerabilities weaknesses criticism oversight remedy`,
    sessionId, country,
    role: 'deep',
    headings: ['THEIR LIKELY CRITICISM', 'OUR STRONGEST ANSWER', 'EVIDENCE', 'COUNTER-POI', 'DO NOT SAY', 'CONFIDENCE'],
  })
}

export function checkClause({ clauseText, resolutionId, sessionId }) {
  let siblings = ''
  if (resolutionId) {
    const rows = all(
      'SELECT kind, ordinal, opener, text FROM clauses WHERE resolution_id = ? ORDER BY kind, ordinal',
      [resolutionId]
    )
    if (rows.length) {
      siblings = `\n\nOTHER CLAUSES IN THIS DRAFT (check for duplication and contradiction):\n${rows
        .map((r) => `${r.kind}${r.ordinal + 1}. ${r.opener ? r.opener + ' ' : ''}${trim(r.text, 220)}`)
        .join('\n')}`
    }
  }
  return runAnalysis({
    kind: 'clause_check',
    system: SYSTEM.clause,
    userPrompt: `CLAUSE UNDER REVIEW:\n"${clauseText}"${siblings}\n\nReview it in the required format.`,
    statement: clauseText,
    extraQuery: 'UNGA authority operative clause recommendatory language resolution drafting',
    sessionId,
    role: 'deep',
    headings: ['VERDICT', 'FLAGS', 'SUGGESTED REWORDING', 'CONFIDENCE'],
  })
}

export function sessionSummary({ sessionId }) {
  const segments = all(
    'SELECT speaker, country, text, classification FROM transcript_segments WHERE session_id = ? ORDER BY ts',
    [sessionId]
  )
  const notes = all('SELECT body, badge FROM notes WHERE session_id = ? ORDER BY created_at', [sessionId])
  const body = [
    segments.length ? `TRANSCRIPT:\n${segments.map((s) => `${s.country || s.speaker}: ${trim(s.text, 240)}`).join('\n')}` : 'No transcript recorded.',
    notes.length ? `NOTES:\n${notes.map((n) => `[${n.badge}] ${n.body}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  return runAnalysis({
    kind: 'summary',
    system: SYSTEM.summary,
    userPrompt: `${trim(body, 14000)}\n\nWrite the session summary in the required format.`,
    statement: 'session summary',
    sessionId,
    role: 'deep',
    headings: ['MAJOR DEVELOPMENTS', 'COUNTRIES ALIGNED WITH US', 'COUNTRIES OPPOSING US', 'IMPORTANT ARGUMENTS', 'UNRESOLVED ISSUES', 'WHAT TO DO DIFFERENTLY', 'NEXT-SESSION PRIORITIES'],
  })
}

export function practiceEvaluate({ opponentCountry, opponentStatement, delegateAnswer, sessionId }) {
  return runAnalysis({
    kind: 'practice',
    system: SYSTEM.practice,
    userPrompt: `You are playing the delegate of ${opponentCountry}.\nYou said: "${opponentStatement}"\n\n${ours()} replied: "${delegateAnswer}"\n\nEvaluate the reply from ${ours()} in the required format.`,
    statement: delegateAnswer,
    extraQuery: opponentStatement,
    sessionId, country: opponentCountry,
    role: 'deep',
    headings: ['YOUR ANSWER', 'WHAT WORKED', 'WHAT DIDN\'T', 'WHAT YOU EXPOSED', 'LIKELY FOLLOW-UP ATTACK', 'STRONGER VERSION'],
  })
}

export async function practiceChallenge({ opponentCountry, topic, difficulty = 'medium', sessionId }) {
  const status = aiStatus()
  if (!status.available) return { ok: false, reason: status.message, offline: true }
  const { prompt } = await buildContext({
    statement: `${opponentCountry} position ${topic || 'surveillance'}`,
    sessionId, country: opponentCountry,
  })
  const res = await safeGenerate({
    system: SYSTEM.practice,
    role: 'live',
    maxTokens: 400,
    messages: [{
      role: 'user',
      content: `${prompt}\n\n---\n\nYou are the delegate of ${opponentCountry}. Difficulty: ${difficulty}.${topic ? ` Topic: ${topic}.` : ''}\n\nChallenge ${ours()} with ONE hard question or attack, 1–3 sentences, as you would say it in committee. Output only the statement — no headings, no commentary.`,
    }],
  })
  if (!res.ok) return { ok: false, reason: res.reason }
  return { ok: true, statement: res.text.trim(), model: res.model, latencyMs: res.latencyMs }
}

// ───────────────────────────────────────────── cheap segment classification

// Local heuristics first — most segments never need to reach the API at all.
// This is what keeps live transcription essentially free.
// Order matters: the first match wins, so the most specific patterns come first.
// Note the deliberate absence of a trailing \b on prefix patterns — `\bhypocri\b`
// would never match "hypocritical", because there is no boundary before the "t".
const LOCAL_RULES = [
  { cls: 'MOTION', re: /\b(?:motion to|motion for|i move|move[sd]? (?:to|for)|second(?:ing|s)? the motion|point of order|point of parliamentary)/i },
  { cls: 'PROCEDURAL', re: /\b(?:roll call|present and voting|speakers'? list|the chair (?:recognis|recogniz|will|has)|time remaining|raise your placard|adjourn|suspend the meeting|voting procedure|yields? (?:the|back))/i },
  { cls: 'QUESTION', re: /\?\s*$|^\s*(?:would|does|do|is|are|can|could|how|what|why|which|will|has|have|should)\b/i },
  { cls: 'ATTACK', re: /\b(?:hypocri\w*|double standard|contradict\w*|fail(?:s|ed|ing)? to|cannot claim|lectur\w+|guilty of|no credibility|has no standing|whilst it|yet it (?:continues|participates)|how can \w+ (?:claim|justify)|(?:its|their) own record)/i },
  { cls: 'PROPOSAL', re: /\b(?:we propose|propos(?:es|ing)|suggest(?:s|ing)?|should include|our (?:clause|draft|amendment)|we recommend|we call upon|this committee should|let us (?:add|draft))/i },
  { cls: 'FACTUAL_CLAIM', re: /\b(?:article \d+|law \d|section \d+|according to|ratified|the court (?:held|found|ruled)|in \d{4}|pursuant to|under (?:the )?(?:iccpr|echr))/i },
]

const VALID = ['QUESTION', 'ATTACK', 'PROPOSAL', 'FACTUAL_CLAIM', 'MOTION', 'PROCEDURAL', 'IRRELEVANT']

/** Relevance drives whether an alert fires at all. */
const RELEVANCE = {
  ATTACK: 0.95, QUESTION: 0.85, PROPOSAL: 0.8, MOTION: 0.7,
  FACTUAL_CLAIM: 0.6, PROCEDURAL: 0.25, IRRELEVANT: 0,
}

export function classifyLocal(text) {
  const t = String(text || '').trim()
  if (t.length < 12) return { classification: 'IRRELEVANT', relevance: 0, via: 'local' }
  for (const rule of LOCAL_RULES) {
    if (rule.re.test(t)) {
      return { classification: rule.cls, relevance: RELEVANCE[rule.cls], via: 'local' }
    }
  }
  return { classification: null, relevance: 0.4, via: 'local' }
}

/**
 * Classify a segment. Local rules resolve most cases for free; only the
 * genuinely ambiguous ones cost an API call, and that call uses Haiku.
 */
export async function classifySegment(text) {
  const local = classifyLocal(text)
  if (local.classification) return local

  const status = aiStatus()
  if (!status.available) return { classification: 'FACTUAL_CLAIM', relevance: 0.4, via: 'fallback' }

  const res = await safeGenerate({
    system: SYSTEM.classify,
    role: 'classify',
    maxTokens: 8,
    messages: [{ role: 'user', content: trim(text, 600) }],
  })
  if (!res.ok) return { classification: 'FACTUAL_CLAIM', relevance: 0.4, via: 'fallback' }

  const word = res.text.trim().toUpperCase().replace(/[^A-Z_]/g, '')
  const cls = VALID.includes(word) ? word : 'FACTUAL_CLAIM'
  return { classification: cls, relevance: RELEVANCE[cls], via: 'model', latencyMs: res.latencyMs }
}

/**
 * One tiny real call against whatever backend is selected. Used by Settings so
 * "AI is configured" is something proven on this machine, not inferred from the
 * presence of a key — and so the delegate sees the actual latency before the
 * competition rather than during it.
 */
export async function testRoundTrip() {
  const status = aiStatus()
  if (status.provider === 'none') {
    return { ok: false, reason: status.message, provider: 'none' }
  }
  const res = await safeGenerate({
    system: 'You are checking a connection. Reply with exactly one word and nothing else.',
    role: 'classify',
    maxTokens: 16,
    messages: [{ role: 'user', content: 'Reply with exactly the word: READY' }],
  })
  if (!res.ok) return { ok: false, reason: res.reason, provider: status.provider }
  return {
    ok: true,
    provider: status.provider,
    viaSubscription: Boolean(status.viaSubscription),
    reply: res.text.trim().slice(0, 40),
    latencyMs: res.latencyMs,
  }
}

export { aiStatus }
