// Turn a draft resolution written in Word (or pasted as plain text) into the
// structured clauses this app works with.
//
// Entirely local and deterministic — no AI. A delegate importing their working
// draft ten minutes before submission cannot be waiting on a network call, and
// must be able to see exactly why every line landed where it did.
//
// The parser is deliberately conservative: when it cannot tell what a line is,
// it attaches it to the previous clause and says so in `warnings` rather than
// guessing a new clause into existence.

// Openers as they actually appear in resolutions, including the -ise/-ize split
// and the common two-word forms. Longest first so "Deeply concerned" wins over
// "Concerned", and "Further requests" over "Requests".
const PRE_OPENERS = [
  'Deeply concerned', 'Deeply disturbed', 'Deeply regretting', 'Deeply conscious',
  'Fully alarmed', 'Fully aware', 'Fully believing', 'Further deploring', 'Further recalling',
  'Bearing in mind', 'Taking into account', 'Taking note', 'Having considered',
  'Having examined', 'Having studied', 'Having received', 'Having adopted', 'Having devoted',
  'Keeping in mind', 'Seeking to', 'Desiring to', 'Aware of', 'Alarmed by', 'Guided by',
  'Acknowledging', 'Affirming', 'Approving', 'Believing', 'Concerned', 'Confident',
  'Contemplating', 'Convinced', 'Declaring', 'Emphasising', 'Emphasizing', 'Expecting',
  'Expressing', 'Fulfilling', 'Grieved', 'Noting with regret', 'Noting with concern',
  'Noting with satisfaction', 'Noting with approval', 'Noting further', 'Noting',
  'Observing', 'Reaffirming', 'Realising', 'Realizing', 'Recalling', 'Recognising',
  'Recognizing', 'Referring', 'Regretting', 'Reiterating', 'Stressing', 'Underlining',
  'Underscoring', 'Viewing with appreciation', 'Welcoming', 'Whereas', 'Mindful',
]

const OP_OPENERS = [
  'Further recommends', 'Further requests', 'Further invites', 'Further proclaims',
  'Further resolves', 'Further reminds', 'Further calls upon', 'Further urges',
  'Solemnly affirms', 'Strongly condemns', 'Strongly affirms', 'Strongly urges',
  'Calls upon', 'Calls for', 'Draws the attention', 'Expresses its hope',
  'Expresses its appreciation', 'Expresses its conviction', 'Expresses its regret',
  'Takes note of', 'Trusts', 'Accepts', 'Affirms', 'Approves', 'Authorises', 'Authorizes',
  'Condemns', 'Confirms', 'Congratulates', 'Considers', 'Declares', 'Decides',
  'Deplores', 'Designates', 'Emphasises', 'Emphasizes', 'Encourages', 'Endorses',
  'Expresses', 'Invites', 'Notes', 'Proclaims', 'Reaffirms', 'Recommends', 'Reminds',
  'Regrets', 'Requests', 'Resolves', 'Supports', 'Urges', 'Welcomes', 'Recognises',
  'Recognizes', 'Establishes', 'Requires', 'Calls',
]

const byLengthDesc = (a, b) => b.length - a.length
const PRE_SORTED = [...PRE_OPENERS].sort(byLengthDesc)
const OP_SORTED = [...OP_OPENERS].sort(byLengthDesc)

const HEADERS = [
  { re: /^(?:committee|forum|organ)\s*[:–-]\s*(.+)$/i, field: 'committee' },
  { re: /^(?:agenda|topic|question of|subject)\s*[:–-]\s*(.+)$/i, field: 'agenda' },
  { re: /^(?:sponsors?|submitted by|main submitter)\s*[:–-]\s*(.+)$/i, field: 'sponsors' },
  { re: /^(?:signatories|co-?submitters?)\s*[:–-]\s*(.+)$/i, field: 'signatories' },
]

const BODY_START = /^the\s+general\s+assembly\s*[,.:]?$/i
// "1." "1)" "(1)" "12 ." and the sub-clause forms "(a)" "a)" "i." "(iv)"
const NUMBERED = /^\(?(\d{1,2})\)?\s*[.)–-]\s*/
const SUBCLAUSE = /^\(?([a-z]|[ivx]{1,4})\)\s*|^\(?([a-z])\)\s*/i

const stripTrailing = (s) => s.replace(/[;,]\s*$/, '').replace(/\s*\.\s*$/, '').trim()

function matchOpener(line, list) {
  for (const opener of list) {
    // Word-boundary match at the start, case-insensitive on the first letter only
    // so "URGES" in an all-caps draft is still recognised.
    if (line.length >= opener.length &&
        line.slice(0, opener.length).toLowerCase() === opener.toLowerCase()) {
      const rest = line.slice(opener.length)
      if (!rest || /^[\s,:]/.test(rest)) {
        return { opener, text: rest.replace(/^[\s,:]+/, '') }
      }
    }
  }
  return null
}

const splitList = (s) =>
  s.split(/[,;]|\band\b/i).map((x) => x.trim()).filter(Boolean)

/**
 * @param {string|Array<{text:string,listItem?:boolean}>} input
 *        Plain text, or lines already carrying Word's list structure.
 * @returns {{title,committee,agenda,sponsors,signatories,clauses,warnings,stats}}
 */
export function parseResolution(input) {
  const lines = (typeof input === 'string'
    ? input.replace(/\r\n?/g, '\n').split('\n').map((text) => ({ text, listItem: false }))
    : input
  )
    .map((l) => ({ ...l, text: (l.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text)

  const out = {
    title: null, committee: null, agenda: null,
    sponsors: [], signatories: [], clauses: [], warnings: [],
  }

  let inBody = false
  let kind = 'PRE'
  let sawOperative = false
  let unmatched = 0

  for (const line of lines) {
    const raw = line.text

    if (!inBody) {
      if (BODY_START.test(raw)) { inBody = true; continue }

      const header = HEADERS.find((h) => h.re.test(raw))
      if (header) {
        const value = raw.match(header.re)[1].trim()
        if (header.field === 'sponsors' || header.field === 'signatories') out[header.field] = splitList(value)
        else out[header.field] = value
        continue
      }

      // A clause before "The General Assembly" means the header was never
      // written — start the body here rather than swallowing real content.
      if (matchOpener(raw, PRE_SORTED) || matchOpener(raw, OP_SORTED) || NUMBERED.test(raw)) {
        inBody = true
      } else {
        if (!out.title && raw.length < 200) out.title = raw
        continue
      }
    }

    // Sub-clauses belong to the clause above them, not to a new one.
    const isSub = line.listItem && SUBCLAUSE.test(raw) && !NUMBERED.test(raw)
    const numbered = NUMBERED.test(raw)
    const body = numbered ? raw.replace(NUMBERED, '') : raw

    const op = matchOpener(body, OP_SORTED)
    const pre = matchOpener(body, PRE_SORTED)

    // Numbering or an operative opener marks the switch. Once operative,
    // never switch back — a preambulatory-looking word inside the operative
    // section ("Recognises that…") is an operative clause.
    if (!sawOperative && (numbered || (op && !pre))) { kind = 'OP'; sawOperative = true }

    const chosen = kind === 'OP' ? (op || pre) : (pre || op)
    const last = out.clauses[out.clauses.length - 1]

    if (isSub && last) {
      last.text = `${last.text}\n${raw}`
      continue
    }

    if (chosen) {
      out.clauses.push({ kind, opener: chosen.opener, text: stripTrailing(chosen.text) })
      continue
    }

    // No recognisable opener. Continuation of the previous clause if there is
    // one; otherwise keep it as an opener-less clause rather than dropping it.
    if (last && !numbered) {
      last.text = `${last.text} ${raw}`.trim()
      unmatched++
    } else {
      out.clauses.push({ kind, opener: null, text: stripTrailing(body) })
      unmatched++
    }
  }

  if (!out.clauses.length) {
    out.warnings.push(
      'No clauses were recognised. Check that the text contains clause openers such as ' +
      '"Recalling", "Calls upon" or "Urges", or numbered operative clauses.'
    )
  }
  if (unmatched) {
    out.warnings.push(
      `${unmatched} line${unmatched > 1 ? 's' : ''} had no recognisable opener and ` +
      'were joined to the clause above. Check those clauses before submitting.'
    )
  }
  if (!out.clauses.some((c) => c.kind === 'OP')) {
    out.warnings.push('No operative clauses were found — everything was read as preambulatory.')
  }

  out.stats = {
    preambulatory: out.clauses.filter((c) => c.kind === 'PRE').length,
    operative: out.clauses.filter((c) => c.kind === 'OP').length,
  }
  return out
}

/**
 * Word documents carry their numbering in list structure, not in the text, so
 * `extractRawText` loses it. Convert to HTML instead and keep the list flag.
 */
export async function linesFromDocx(buffer) {
  const mammoth = (await import('mammoth')).default
  const { value: html } = await mammoth.convertToHtml({ buffer })
  const lines = []
  const blockRe = /<(p|li|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = blockRe.exec(html))) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' '))
    if (text.trim()) lines.push({ text, listItem: m[1].toLowerCase() === 'li' })
  }
  if (!lines.length) {
    const { value: raw } = await mammoth.extractRawText({ buffer })
    return raw.split('\n').map((text) => ({ text, listItem: false }))
  }
  return lines
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Plain text of a resolution, in the shape a Chair expects to receive. */
export function renderResolution(res, clauses) {
  const pre = clauses.filter((c) => c.kind === 'PRE')
  const op = clauses.filter((c) => c.kind === 'OP')
  const clauseLine = (c) => `${c.opener ? `${c.opener} ` : ''}${c.text}`
  return [
    `COMMITTEE: ${res.committee || ''}`,
    `AGENDA: ${res.agenda || ''}`,
    `SPONSORS: ${(res.sponsors || []).join(', ') || '—'}`,
    `SIGNATORIES: ${(res.signatories || []).join(', ') || '—'}`,
    '',
    'The General Assembly,',
    '',
    ...pre.map((c) => `${clauseLine(c)},`),
    '',
    ...op.map((c, i) => `${i + 1}. ${clauseLine(c)}${i === op.length - 1 ? '.' : ';'}`),
  ].join('\n')
}
