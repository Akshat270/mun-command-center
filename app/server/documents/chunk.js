// Chunking tuned for retrieval under time pressure: chunks big enough to
// carry a complete argument, small enough that three of them fit in a
// compact AI context. Heading detection keeps "View source" meaningful.

const TARGET = 1100   // characters — roughly 250-300 tokens
const MAX = 1800
const OVERLAP = 160   // carry the tail of the previous chunk for continuity

const HEADING_RE = [
  /^#{1,6}\s+(.+)$/,                       // markdown
  /^(\d+(?:\.\d+)*)[.)]?\s+([A-Z][^.]{3,80})$/, // "3.2 Cross-border sharing"
  /^([A-Z][A-Z0-9 ,&'’\-—–/()]{6,80})$/,   // ALL CAPS heading
  /^(?:§|Section|Article|Clause)\s+[\w.]+.*$/i,
]

function headingOf(line) {
  const t = line.trim()
  if (!t || t.length > 90) return null
  if (/[.!?]$/.test(t) && !/^#{1,6}\s/.test(t)) return null
  for (const re of HEADING_RE) {
    const m = t.match(re)
    if (m) return (m[2] || m[1] || t).trim()
  }
  return null
}

/** Split into sentence-ish units so chunks never cut mid-sentence. */
function splitUnits(text) {
  const out = []
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim()
    if (!p) continue
    if (p.length <= MAX) { out.push(p); continue }
    // Long paragraph: fall back to sentence boundaries.
    let buf = ''
    for (const s of p.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) {
      if (buf && buf.length + s.length > TARGET) { out.push(buf.trim()); buf = '' }
      buf += (buf ? ' ' : '') + s
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out
}

/**
 * @param {{page:number|null,text:string}[]} pages
 * @returns {{ordinal:number,text:string,page:number|null,heading:string|null,section:string|null}[]}
 */
export function chunkPages(pages) {
  const chunks = []
  let ordinal = 0
  let section = null

  for (const { page, text } of pages) {
    let heading = null
    let buf = ''
    let bufHeading = null

    const flush = () => {
      const body = buf.trim()
      if (!body) return
      chunks.push({
        ordinal: ordinal++,
        text: body,
        page: page ?? null,
        heading: bufHeading,
        section,
      })
      buf = body.length > OVERLAP ? body.slice(-OVERLAP) : ''
      bufHeading = heading
    }

    for (const line of text.split('\n')) {
      const h = headingOf(line)
      if (h) {
        // A heading starts a new chunk so retrieved text always has a label.
        if (buf.trim().length > OVERLAP) flush()
        heading = h
        section = h
        if (!bufHeading) bufHeading = h
        buf += (buf ? '\n' : '') + line.trim()
        continue
      }
      for (const unit of splitUnits(line)) {
        if (buf.length + unit.length > TARGET && buf.trim().length > 200) flush()
        buf += (buf ? '\n' : '') + unit
        if (buf.length >= MAX) flush()
      }
    }
    buf = buf.trim()
    if (buf) {
      chunks.push({ ordinal: ordinal++, text: buf, page: page ?? null, heading: bufHeading, section })
    }
  }

  // Drop fragments that are pure overlap residue.
  return chunks.filter((c) => c.text.replace(/\s+/g, ' ').length > 60)
}
