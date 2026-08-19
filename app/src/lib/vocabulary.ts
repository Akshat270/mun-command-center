// Domain vocabulary repair for speech recognition output.
//
// Browser speech recognition is trained on general English. It has never heard
// "unmoderated caucus" and it renders member states phonetically — "Czechia"
// becomes "check ya", "Côte d'Ivoire" becomes "quote deval". In a transcript
// that is searched and fed to an AI, a mangled country name is worse than a
// missing one: it silently attributes a position to nobody.
//
// SpeechGrammarList is deliberately NOT used to fix this. It is in the spec,
// but Chrome accepts it and ignores it entirely — wiring it up would look like
// a fix and do nothing. Correcting the text afterwards actually works.
//
// The matching is intentionally conservative. Rewriting the delegate's
// transcript into something that was never said is a worse failure than
// leaving a wonky word alone, so a term is only replaced when the recognised
// text is a near-miss of it, never merely similar.

/** Procedure and agenda terms this committee actually uses. */
export const MUN_TERMS = [
  // procedure
  'point of order',
  'point of information',
  'point of personal privilege',
  'point of parliamentary inquiry',
  'moderated caucus',
  'unmoderated caucus',
  'right of reply',
  'yields the floor',
  'yield to the chair',
  'general speakers list',
  'motion to table',
  'division of the question',
  'roll call vote',
  'present and voting',
  'working paper',
  'draft resolution',
  'operative clause',
  'preambulatory clause',
  'friendly amendment',
  'unfriendly amendment',
  'quorum',
  'placard',
  // bodies and instruments
  'General Assembly',
  'Security Council',
  'Human Rights Council',
  'Secretary-General',
  'Special Rapporteur',
  'UNGA',
  'ICCPR',
  'OHCHR',
  'Universal Declaration of Human Rights',
  // this committee's agenda
  'state surveillance',
  'mass surveillance',
  'national security',
  'lawful interception',
  'due process',
  'proportionality',
  'extraterritorial',
  'metadata',
  'encryption',
  'Pegasus',
  'spyware',
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Damerau-Levenshtein distance, capped — we only ever care about very small
 * values. Transposition counts as one edit because that is what mis-hearings
 * and typos actually look like: "ordre" for "order" is one slip, not two.
 */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prevPrev: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1)
      }
      row.push(v)
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    prevPrev = prev
    prev = row
  }
  return prev[b.length]
}

/**
 * How much misspelling to tolerate, by term length.
 *
 * These thresholds are deliberately strict, because the failure mode is
 * horrible: member-state names cluster within one edit of each other, so a
 * looser rule turns Zambia into Gambia and Ireland into Iceland, and the
 * transcript then attributes a position to a country that never said it.
 * Silently rewriting a delegation's name is far worse than leaving a wonky
 * word alone, so nothing under 8 characters is fuzzy-matched at all.
 */
function tolerance(term: string): number {
  // A single word is never fuzzy-matched. Nearly all member states are one
  // word, they sit within an edit or two of each other and of ordinary English,
  // and there is no context to disambiguate them — so the only safe rule for a
  // lone word is exact. "Argentia" therefore stays as heard rather than being
  // guessed into "Argentina"; a wonky word the delegate can read past beats a
  // confident rewrite into the wrong country.
  if (!/\s/.test(term.trim())) return 0

  // Multi-word phrases are safe: "unmoderated caucus" resembles nothing else
  // anyone says in a committee room.
  const n = term.replace(/\s/g, '').length
  if (n <= 7) return 0
  if (n <= 12) return 1
  return 2
}

/**
 * Repair known terms in recognised text.
 *
 * @param text  one utterance from the recognizer
 * @param terms extra terms — member-state names from the database
 */
export function applyVocabulary(text: string, terms: string[] = []): string {
  const input = String(text ?? '')
  if (!input.trim()) return input

  // Longest first, so "point of personal privilege" wins over "point of".
  const vocab = [...new Set([...terms, ...MUN_TERMS])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  // Anything that is already a term is correct by definition and must never be
  // "improved" into a different one. Without this, a correctly recognised
  // "Zambia" is one edit from "Gambia" and gets overwritten by whichever name
  // the loop happens to reach first.
  const known = new Set(vocab.map(norm))

  const tokens = input.split(/(\s+)/)                   // keeps whitespace
  const out = [...tokens]
  const wordIdx = tokens.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0)

  // Once a span has been matched it is settled, and no later term may touch it.
  // Without this, "unmoderated caucus" is repaired correctly and then the
  // shorter "moderated caucus" — two edits away — overwrites it and drops the
  // "un", inverting what the delegate actually said.
  const settled = new Set<number>()

  for (const term of vocab) {
    const target = norm(term)
    const span = target.split(' ').filter(Boolean).length
    if (!span || wordIdx.length < span) continue
    const tol = tolerance(term)

    for (let w = 0; w + span <= wordIdx.length; w++) {
      let overlaps = false
      for (let k = w; k < w + span; k++) if (settled.has(k)) { overlaps = true; break }
      if (overlaps) continue

      const from = wordIdx[w]
      const to = wordIdx[w + span - 1]
      const candidate = tokens.slice(from, to + 1).join('')
      const normalised = norm(candidate)
      if (!normalised) continue

      // Already correct: settle it so nothing later can "improve" it.
      if (normalised === target) {
        for (let k = w; k < w + span; k++) settled.add(k)
        break
      }

      if (tol === 0) continue                          // short terms: exact only
      if (known.has(normalised)) continue               // already some other term
      if (distance(normalised, target, tol) > tol) continue

      // Preserve any trailing punctuation the recognizer added.
      const trailing = candidate.match(/[^\w\s]+$/)?.[0] ?? ''
      out[from] = term + trailing
      for (let i = from + 1; i <= to; i++) out[i] = ''
      for (let k = w; k < w + span; k++) settled.add(k)
      break                                            // one repair per term
    }
  }

  return out.join('')
}

/** Member-state names from `api.countries()`, shaped for `applyVocabulary`. */
export function countryTerms(countries: Array<{ name?: string }> = []): string[] {
  return countries.map((c) => c?.name).filter((n): n is string => Boolean(n && n.length > 3))
}
