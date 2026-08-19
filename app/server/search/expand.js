// MUN-domain query expansion.
//
// This is the cheap, offline substitute for semantic search. A delegate types
// "metadata" but the prepared answer says "communications data"; they type
// "Five Eyes" but the operative idea is filed under "transfer parity".
// Keyword search alone misses both. The alias map recovers most of that recall
// for zero dependencies and zero latency, and works with the network unplugged.

const GROUPS = [
  ['metadata', 'communications data', 'non-content', 'subscriber information', 'traffic data'],
  ['five eyes', 'intelligence sharing', 'transfer parity', 'partner collection', 'onward sharing', 'cross-border'],
  ['oversight', 'nsira', 'nsicop', 'intelligence commissioner', 'independent review', 'review body'],
  ['authorisation', 'authorization', 'warrant', 'prior judicial', 'judicial approval', 'pre-authorisation'],
  ['lifecycle', 'retention', 'querying', 'deletion', 'onward use', 'collection'],
  ['proportionality', 'necessity', 'legitimate aim', 'least intrusive'],
  ['remedy', 'notification', 'redress', 'effective remedy', 'complaint'],
  ['spyware', 'pegasus', 'commercial spyware', 'device access', 'state hacking', 'federal trojan'],
  ['encryption', 'end-to-end', 'backdoor', 'exceptional access', 'lawful access'],
  ['mass surveillance', 'bulk collection', 'untargeted', 'indiscriminate', 'bulk powers'],
  ['journalists', 'lawyers', 'human rights defenders', 'professional privilege', 'sources'],
  ['capacity', 'capacity-building', 'technical assistance', 'differentiated', 'global south', 'implementation'],
  ['iccpr', 'article 17', 'covenant', 'arbitrary interference', 'privacy right'],
  ['echr', 'article 8', 'european convention', 'strasbourg'],
  ['charter', 'section 8', 'section 1', 'unreasonable search', 'reasonable limits'],
  ['csis', 'cse', 'security intelligence', 'signals intelligence', 'dataset'],
  ['sovereignty', 'extraterritorial', 'foreigners abroad', 'non-nationals'],
  ['dissent', 'protest', 'advocacy', 'lawful advocacy', 'political surveillance', 'activists'],
  ['gsl', 'general speakers list', 'speakers list'],
  ['moderated caucus', 'mod caucus', 'moderated'],
  ['unmoderated caucus', 'unmod', 'unmoderated'],
  ['poi', 'point of information', 'question to the speaker'],
  ['draft resolution', 'working paper', 'operative clause', 'preambulatory'],
  ['amendment', 'friendly amendment', 'unfriendly amendment'],
  ['roll call', 'present and voting', 'present'],
]

// term -> Set(aliases)
const INDEX = new Map()
for (const group of GROUPS) {
  for (const term of group) {
    const key = term.toLowerCase()
    if (!INDEX.has(key)) INDEX.set(key, new Set())
    for (const other of group) if (other !== term) INDEX.get(key).add(other)
  }
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'on', 'in', 'to', 'for', 'and', 'or', 'is', 'are',
  'what', 'whats', 'how', 'why', 'does', 'do', 'did', 'can', 'about', 'with',
  'position', 'stance', 'view', 'say', 'says',
])

/** Aliases whose whole phrase appears in the query. */
export function aliasesFor(query) {
  const q = ` ${query.toLowerCase()} `
  const found = new Set()
  for (const [term, aliases] of INDEX) {
    if (q.includes(` ${term} `) || q.includes(` ${term}s `) || q.includes(`${term},`)) {
      for (const a of aliases) found.add(a)
    }
  }
  return [...found]
}

/** Quote a phrase for FTS5 and strip characters FTS5 treats as operators. */
function ftsPhrase(text) {
  const cleaned = text.replace(/["^*():]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? `"${cleaned}"` : ''
}

/**
 * Build an FTS5 MATCH expression.
 *  - the exact phrase is boosted so "Article 17" outranks loose word hits
 *  - individual terms keep results coming when the phrase is absent
 *  - aliases are OR'd in at lower weight via a separate query pass
 * @returns {{match:string, aliasMatch:string|null, terms:string[], aliases:string[]}}
 */
export function buildQuery(raw) {
  const query = String(raw || '').trim()
  if (!query) return { match: '', aliasMatch: null, terms: [], aliases: [] }

  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))

  const parts = []
  const phrase = ftsPhrase(query)
  if (phrase && terms.length > 1) parts.push(phrase)
  for (const t of terms) {
    // Prefix-match the last token so search feels live as the delegate types.
    parts.push(t === terms.at(-1) && query.length > 2 ? `${ftsPhrase(t).slice(0, -1)}"*` : ftsPhrase(t))
  }

  const aliases = aliasesFor(query)
  const aliasMatch = aliases.length
    ? aliases.map(ftsPhrase).filter(Boolean).join(' OR ')
    : null

  // The same query with no prefix wildcard on the last token.
  //
  // The wildcard exists so results appear while the delegate is still typing,
  // but combined with porter stemming it also matches words nobody asked for —
  // "recipe*" stems to "recip" and matches "recipient". On a multi-word query
  // that is enough for one stray token to pull in passages when nothing else
  // matched at all. Callers use this to check whether a real term matched
  // before trusting a prefix-only hit.
  const strictParts = []
  if (phrase && terms.length > 1) strictParts.push(phrase)
  for (const t of terms) strictParts.push(ftsPhrase(t))

  return {
    match: parts.filter(Boolean).join(' OR '),
    strictMatch: strictParts.filter(Boolean).join(' OR '),
    aliasMatch,
    terms,
    aliases,
  }
}

/** True when the query looks like an exact reference the delegate must find verbatim. */
export function isExactLookup(query) {
  return /\b(article|section|clause|law|ley|s\.|art\.)\s*\d|\b\d{2,}\b|"[^"]+"/i.test(query)
}
