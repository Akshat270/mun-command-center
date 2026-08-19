// Text extraction. Originals are opened read-only and never written back.
// Every parser returns { pages: [{page, text}], meta } or throws a message
// the UI can show verbatim — never a stack trace.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const PDF_MIN_CHARS = 40 // below this a "text" PDF is really a scan

/** Normalise whitespace without destroying paragraph structure. */
export function cleanText(raw) {
  if (!raw) return ''
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}

async function parseDocx(file) {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ path: file })
  const text = cleanText(value)
  if (!text) throw new Error('Document contains no extractable text.')
  return { pages: [{ page: null, text }], meta: { kind: 'docx' } }
}

async function parsePdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(file))
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise

  const pages = []
  let total = 0
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Rebuild lines: pdf.js emits positioned runs, and hasEOL marks line ends.
    let text = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      text += item.str
      if (item.hasEOL) text += '\n'
      else if (item.str && !item.str.endsWith(' ')) text += ' '
    }
    const clean = cleanText(text)
    total += clean.length
    if (clean) pages.push({ page: i, text: clean })
    page.cleanup()
  }
  await doc.destroy()

  if (total < PDF_MIN_CHARS) {
    throw new Error(
      'Could not extract text — this PDF looks like a scan. Open it manually or try another parser.'
    )
  }
  return { pages, meta: { kind: 'pdf', pageCount: doc.numPages } }
}

async function parsePlain(file) {
  const text = cleanText(await fs.readFile(file, 'utf8'))
  if (!text) throw new Error('File is empty.')
  return { pages: [{ page: null, text }], meta: { kind: 'text' } }
}

const PARSERS = {
  '.pdf': parsePdf,
  '.docx': parseDocx,
  '.txt': parsePlain,
  '.md': parsePlain,
  '.markdown': parsePlain,
  '.rtf': parsePlain,
  '.csv': parsePlain,
  '.json': parsePlain,
}

export const SUPPORTED_EXTENSIONS = Object.keys(PARSERS)

export function isSupported(file) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase())
}

/**
 * Parse any supported document.
 * @returns {Promise<{pages:{page:number|null,text:string}[], text:string, hash:string, meta:object}>}
 */
export async function parseDocument(file) {
  const ext = path.extname(file).toLowerCase()
  const parser = PARSERS[ext]
  if (!parser) throw new Error(`Unsupported file type "${ext}".`)

  const stat = await fs.stat(file).catch(() => null)
  if (!stat) throw new Error('File not found.')
  if (stat.size === 0) throw new Error('File is empty.')

  const { pages, meta } = await parser(file)
  const text = pages.map((p) => p.text).join('\n\n')
  if (!text.trim()) throw new Error('Could not extract text from this document.')

  return { pages, text, hash: hashText(text), meta: { ...meta, bytes: stat.size } }
}
