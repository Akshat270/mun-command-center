// Auto-classification of imported documents from filename, folder and content.
// Always a suggestion: every field stays editable in the Documents library.
//
// Scoring, not first-match. Nearly every document in this corpus mentions
// "moderated caucus" and "ICCPR Article 17", so a first-match rule files
// everything under Rules or Legal. Filename evidence outweighs body evidence,
// and body signals only count when they are distinctive to one category.

import path from 'node:path'
import { all } from '../db/client.js'

/**
 * Document categories that apply to any committee.
 *
 * Country names are deliberately NOT in this list. A document has both a
 * `category` and a `country`, and they are different questions — "what kind of
 * document is this" and "which delegation is it about". The list used to name
 * four specific countries, which meant the two axes were tangled and the
 * categories only made sense for one committee.
 *
 * `categoriesFor()` below adds the delegate's own researched countries back on
 * for display, so filing a document under a country still works.
 */
export const CATEGORIES = [
  'Conference Guide', 'Other Countries',
  'Rules', 'Speeches', 'POIs', 'Draft Resolution', 'Legal', 'Current Events',
  'Personal Notes', 'Strategy', 'Research', 'Other',
]

/** The countries the delegate has researched, or [] if the database is unavailable. */
function knownCountries() {
  try {
    return all('SELECT code, name FROM countries ORDER BY is_ours DESC, name')
  } catch {
    return []
  }
}

/** The category list offered in the UI: the fixed kinds plus each country. */
export function categoriesFor() {
  const names = knownCountries().map((c) => c.name)
  // Countries first — the delegate reaches for their own delegation most often.
  return [...names, ...CATEGORIES]
}

export function countryName(code) {
  return knownCountries().find((c) => c.code === code)?.name || code
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Country-detection rules built from the countries table.
 *
 * These were hardcoded regexes naming four countries and their specific
 * institutions ("CSIS", "DSN", "Law 25.520"). Those body signals were sharper
 * than a bare name match, but they only ever worked for one committee's
 * research. Matching on the country's own name generalises, and the filename is
 * weighted far above body text anyway (W_NAME 10 vs W_BODY 2), so in practice
 * the strongest signal is unchanged.
 */
function countryRules() {
  return knownCountries().map(({ code, name }) => ({
    code,
    name: new RegExp(`\\b${escapeRe(name)}\\b`, 'i'),
    body: new RegExp(`\\b${escapeRe(name)}\\b`, 'gi'),
  }))
}

const W_NAME = 10   // the filename is the delegate's own label — trust it most
const W_FOLDER = 4
const W_BODY = 2    // capped by BODY_CAP so a long file can't win on repetition
const BODY_CAP = 3

/**
 * `name`  — filename/folder evidence.
 * `body`  — content evidence, distinctive to this category only.
 * `pri`   — source priority: 1 competition, 2 official/primary, 3 research.
 */
const RULES = [
  {
    // The conference's own background guide / chair letter. `rpsis?` is left in
    // as one more filename hint among many — it costs nothing and helps anyone
    // whose files are still named that way.
    cat: 'Conference Guide', pri: 1,
    name: /\b(rpsis?|background[ _-]?guide|\bbg\b|chair(?:'?s)?[ _-]?(?:letter|note))\b/i,
    body: /letter from the (?:chair|executive board|under[- ]secretary)|about (?:the )?committee|introduction to the committee|guiding questions|further reading/i,
  },
  {
    cat: 'Rules', pri: 1,
    name: /\b(rules?|procedur\w*|rop|parliamentary|points?)\b/i,
    body: /point of (?:parliamentary inquiry|personal privilege)|friendly and unfriendly amendment|simple[- ]majority vote|do not confuse them|beginner mistakes/i,
  },
  {
    cat: 'Speeches', pri: 2,
    name: /\b(speech(?:es)?|speaking|opening|gsl|quickbook|remarks|script)\b/i,
    body: /honou?rable chair, distinguished delegates|30[- ]second (?:version|opening)|emergency 20[- ]second|memory:/i,
  },
  {
    cat: 'POIs', pri: 2,
    name: /\b(pois?|points? of information)\b/i,
    body: /to the distinguished delegate of/i,
  },
  {
    cat: 'Draft Resolution', pri: 2,
    name: /\b(resolution|clauses?|draft|operative|preamb\w*|negotiation)\b/i,
    body: /preambulatory clause|operative clause|decides to remain seized|what a unga resolution can actually do|sponsors (?:and|&) signatories/i,
  },
  {
    cat: 'Strategy', pri: 3,
    name: /\b(playbook|strateg\w+|tactics?|dossier|defen[cs]e|study[ _-]?pack|prep(?:aration)?)\b/i,
    body: /likely attacks|game plan|5 vulnerabilities|identity in one sentence|execution document|how to use this/i,
  },
  {
    cat: 'Legal', pri: 2,
    name: /\b(legal|treaty|treaties|jurisprudence|case[ _-]?law|statutes?)\b/i,
    body: /\bv\.\s+[A-Z]\w+,?\s+\(?\d{4}\)?|paragraph \d+ of general comment|ECtHR|grand chamber/i,
  },
  {
    cat: 'Current Events', pri: 3,
    name: /\b(news|current[ _-]?(?:events|developments)|updates?|timeline)\b/i,
    body: /as (?:of|reported) (?:january|february|march|april|may|june|july|august)/i,
  },
  {
    cat: 'Personal Notes', pri: 3,
    name: /\b(notes?|personal|scratch|todo|my[ _-])\b/i,
    body: null,
  },
  {
    cat: 'Research', pri: 3,
    name: /\b(research|database|sources?|facts?|briefing)\b/i,
    body: /research (?:database|cutoff)|this is a factual research database|claims are classified as/i,
  },
]

const normalise = (s) => String(s || '').replace(/[_\-]+/g, ' ')

function countMatches(re, text) {
  if (!re) return 0
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g')
  return (text.match(g) || []).length
}

/**
 * @param {{filename:string, folder?:string, text?:string}} input
 * @returns {{category:string, country:string|null, priority:number,
 *            sourceType:string, title:string, confidence:'high'|'medium'|'low',
 *            scores:object}}
 */
export function classifyDocument({ filename, folder = '', text = '' }) {
  const name = normalise(filename)
  const dir = normalise(path.basename(folder || ''))
  // Classify on the opening — that is where a document says what it is —
  // plus a mid sample so a long file's real subject still registers.
  const head = text.slice(0, 5000) + '\n' + text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 2500)

  const scored = RULES.map((rule) => {
    let score = 0
    const why = []
    if (rule.name.test(name)) { score += W_NAME; why.push('filename') }
    if (dir && rule.name.test(dir)) { score += W_FOLDER; why.push('folder') }
    const hits = Math.min(countMatches(rule.body, head), BODY_CAP)
    if (hits) { score += hits * W_BODY; why.push(`content x${hits}`) }
    return { ...rule, score, why }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  const runnerUp = scored[1]

  let category = 'Research'
  let priority = 3
  let confidence = 'low'

  if (best.score > 0) {
    category = best.cat
    priority = best.pri
    const clear = best.score >= runnerUp.score * 1.5
    confidence = best.why.includes('filename') && clear ? 'high' : clear ? 'medium' : 'low'
  }

  // Country: filename wins outright; otherwise require a clear content lead.
  const rules = countryRules()
  let country = null
  for (const rule of rules) {
    if (rule.name.test(name) || (dir && rule.name.test(dir))) { country = rule.code; break }
  }
  // Needs at least two countries to compare — a runner-up is what makes a lead
  // "clear", and with one country there is nothing to be clearly ahead of.
  if (!country && rules.length > 1) {
    const counts = rules
      .map((r) => ({ code: r.code, n: countMatches(r.name, head) + countMatches(r.body, head) * 2 }))
      .sort((a, b) => b.n - a.n)
    if (counts[0].n >= 6 && counts[0].n > counts[1].n * 1.6) country = counts[0].code
  }

  // A file that is plainly *about* one country, with no other usable label,
  // is filed there. Only on low confidence — a multi-country research database
  // scores as Research with medium confidence and should stay there.
  if (country && (category === 'Research' || category === 'Other') && confidence === 'low') {
    category = countryName(country)
    priority = Math.min(priority, 2)
  }

  const sourceType = priority === 1 ? 'competition' : priority === 2 ? 'primary' : 'research'

  const title = normalise(filename)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s*\(recovered\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    category, country, priority, sourceType, title, confidence,
    scores: Object.fromEntries(scored.filter((s) => s.score > 0).map((s) => [s.cat, s.score])),
  }
}
