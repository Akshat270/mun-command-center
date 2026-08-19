// Seed-content loader. Contains no content of its own — only the choice of
// which content file to use.
//
// Two files can supply the app's starting content:
//
//   seed-data.local.js     your own prep. Gitignored, so it never leaves this
//                          machine and cannot be committed by accident.
//   seed-data.example.js   committee-neutral sample content. Committed, and
//                          what a fresh clone seeds from.
//
// `.local` wins whenever it exists. That ordering is the point of this file: a
// contributor cloning the repository gets a working app with example content,
// and a delegate with their own prep gets their own, without either of them
// editing a shared file that the other would have to merge.
//
// This indirection also keeps `seed.js` unaware of the split — it imports the
// same twelve names from the same path either way. The top-level `await` below
// resolves at module load, before `seed()` can be called, so `seed()` stays
// synchronous and neither of its call sites had to change.
//
// To make your own copy:
//
//   cd app/server/db
//   cp seed-data.example.js seed-data.local.js
//   # edit seed-data.local.js, then restart the app

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 'local' when the delegate has their own content file, otherwise 'example'. */
export const SEED_SOURCE = fs.existsSync(path.join(here, 'seed-data.local.js'))
  ? 'local'
  : 'example'

// A static specifier per branch rather than one built by string concatenation:
// bundlers and static analysers can follow these, and a typo fails at load
// rather than resolving to something unexpected.
const content = SEED_SOURCE === 'local'
  ? await import('./seed-data.local.js')
  : await import('./seed-data.example.js')

export const {
  SOURCES,
  SPEECHES,
  POIS,
  QA,
  COUNTRIES,
  CAUCUS_PLAYS,
  CLAUSE_LIBRARY,
  PROCEDURE,
  PRIORITIES,
  UNGA_POWERS,
  OPENING_MOMENTS,
  NEGOTIATION_LINES,
} = content
