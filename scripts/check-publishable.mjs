#!/usr/bin/env node
// Refuse to publish anything that must stay private.
//
// Git history is permanent and public. A source document, a database holding
// API keys, or the delegate's own strategy file cannot be un-published once
// pushed — so this runs as a hard gate rather than relying on remembering.
//
//   node scripts/check-publishable.mjs          check tracked + staged files
//   node scripts/check-publishable.mjs --all    also audit the working tree
//
// Exits non-zero on any finding.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Anything matching these must never be tracked by git. */
const FORBIDDEN = [
  {
    test: /\.(docx?|pdf|odt|pptx?)$/i,
    why: 'Conference or prep document. Conference material is not ours to redistribute; ' +
         'prep material is the delegate\'s strategy.',
  },
  {
    test: /\.(db|sqlite3?|db-wal|db-shm)$/i,
    why: 'Database. Contains API keys, notes and the full transcript of live sessions.',
  },
  {
    test: /(^|[\\/])\.env($|\.)(?!example)/i,
    why: 'Environment file. Contains API keys.',
  },
  {
    // The seed split is done: `seed-data.js` is now a loader containing no
    // content, `seed-data.example.js` is deliberately public, and this file is
    // the only one of the three holding the delegate's real speeches, POIs,
    // defences and country dossiers. It is gitignored; this rule is the second
    // lock, for the case where someone adds it with `git add -f`.
    test: /seed-data\.local\.js$/i,
    why: 'Your own prepared content — speeches, POI bank, defences and country ' +
         'dossiers. It is meant to stay on your machine. The public sample lives ' +
         'in seed-data.example.js.',
  },
  {
    test: /(^|[\\/])MUN-Data([\\/]|$)/i,
    why: 'Live data directory — database, embedding cache, recordings.',
  },
  {
    test: /(^|[\\/])node([\\/])(node\.exe|npm)/i,
    why: 'Portable Node.js runtime (~90 MB, machine-specific). Not source.',
  },
]

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

const inRepo = git(['rev-parse', '--is-inside-work-tree']) !== null

const findings = []
const check = (files, source) => {
  for (const file of files) {
    const hit = FORBIDDEN.find((r) => r.test.test(file))
    if (hit) findings.push({ file, source, why: hit.why })
  }
}

if (inRepo) {
  check(git(['ls-files']) ?? [], 'tracked')
  check(git(['diff', '--cached', '--name-only']) ?? [], 'staged')
} else {
  console.log('  No git repository yet — auditing the working tree instead.\n')
}

// Working-tree audit: confirm .gitignore actually covers what is on disk.
// Without this, a rule that looks right but does not match is invisible until
// the first commit, which is exactly when it stops being fixable.
if (!inRepo || process.argv.includes('--all')) {
  const walk = (dir, depth = 0) => {
    if (depth > 3) return []
    let out = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist'].includes(e.name)) continue
      const full = path.join(dir, e.name)
      const rel = path.relative(ROOT, full).replace(/\\/g, '/')
      if (e.isDirectory()) out = out.concat(walk(full, depth + 1))
      else out.push(rel)
    }
    return out
  }

  const onDisk = walk(ROOT).filter((f) => FORBIDDEN.some((r) => r.test.test(f)))

  // Ask git itself whether each file is ignored — a hand-rolled .gitignore
  // parser would eventually disagree with git, and only git's answer matters.
  // With no repository yet, borrow a throwaway git dir outside the project so
  // the answer is still authoritative without creating .git here.
  let gitDir = null
  if (!inRepo) {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mun-ignorecheck-'))
    try {
      execFileSync('git', ['init', '--quiet', '--bare', gitDir], { stdio: 'ignore' })
    } catch { gitDir = null }
  }

  const isIgnored = (file) => {
    const args = gitDir
      ? ['--git-dir=' + gitDir, '--work-tree=' + ROOT, 'check-ignore', '-q', file]
      : ['check-ignore', '-q', file]
    try {
      execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' })
      return true
    } catch { return false }
  }

  if (!inRepo && !gitDir) {
    console.log(`  git unavailable — could not verify .gitignore. ${onDisk.length} sensitive`)
    console.log('  file(s) are on disk; verify by hand before publishing.\n')
  } else {
    for (const f of onDisk) {
      if (!isIgnored(f)) {
        findings.push({
          file: f,
          source: 'NOT ignored',
          why: FORBIDDEN.find((r) => r.test.test(f)).why,
        })
      }
    }
    const covered = onDisk.length - findings.filter((f) => f.source === 'NOT ignored').length
    if (covered) console.log(`  ${covered} sensitive file(s) on disk, correctly ignored by .gitignore.`)
  }

  if (gitDir) fs.rmSync(gitDir, { recursive: true, force: true })
}

if (findings.length) {
  console.error('\n  ✕ NOT SAFE TO PUBLISH\n')
  const seen = new Set()
  for (const f of findings) {
    const key = `${f.file}|${f.source}`
    if (seen.has(key)) continue
    seen.add(key)
    console.error(`    ${f.file}`)
    console.error(`      [${f.source}] ${f.why}\n`)
  }
  console.error('  Fix: add a matching rule to .gitignore, then')
  console.error('       git rm --cached <file>   (removes from git, keeps it on disk)\n')
  process.exit(1)
}

console.log('  ✓ Nothing forbidden is tracked or staged.')
if (inRepo) console.log('    Still inspect `git show --stat` before the first push.')
process.exit(0)
