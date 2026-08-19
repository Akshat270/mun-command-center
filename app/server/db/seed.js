// Idempotent seeding. Safe to re-run: content rows are replaced, but anything
// the delegate has changed in the live tables (asked POIs, used speeches,
// bloc notes, resolutions, notes) is preserved.

import { pathToFileURL } from 'node:url'
import { run, get, all, tx, id, now, json, setSetting, getSetting } from './client.js'
import {
  SPEECHES, POIS, QA, COUNTRIES, CAUCUS_PLAYS, CLAUSE_LIBRARY,
  PROCEDURE, PRIORITIES, SOURCES, UNGA_POWERS, OPENING_MOMENTS, NEGOTIATION_LINES,
} from './seed-data.js'
import { COMMITTEE } from '../config.js'

const SEED_VERSION = 3

function seedSpeeches() {
  // Preserve use counts across re-seeds — they are the delegate's own data.
  const used = new Map(all('SELECT title, used_at, use_count, pinned FROM speeches').map((r) => [r.title, r]))
  run("DELETE FROM speeches WHERE source_doc IS NOT NULL")
  for (const s of SPEECHES) {
    const prev = used.get(s.title)
    run(
      `INSERT INTO speeches(id,title,category,duration_s,body,memory_hook,tags,pinned,used_at,use_count,source_doc,ordinal,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id('sp_'), s.title, s.category, s.duration_s ?? null, s.body, s.memory_hook ?? null,
       json.stringify(s.tags ?? []), prev?.pinned ?? s.pinned ?? 0, prev?.used_at ?? null,
       prev?.use_count ?? 0, SOURCES.quickbook, s.ordinal ?? 0, now()]
    )
  }
}

function seedPois() {
  const prior = new Map(all('SELECT question, asked_at, outcome, pinned FROM pois').map((r) => [r.question, r]))
  run("DELETE FROM pois WHERE source_doc IS NOT NULL")
  POIS.forEach((p, i) => {
    const prev = prior.get(p.question)
    run(
      `INSERT INTO pois(id,target_country,topic,question,purpose,expected_response,follow_up,strength,asked_at,outcome,pinned,source_doc,ordinal,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id('poi_'), p.target_country, p.topic ?? null, p.question, p.purpose ?? null,
       p.expected_response ?? null, p.follow_up ?? null, p.strength ?? 'medium',
       prev?.asked_at ?? null, prev?.outcome ?? null, prev?.pinned ?? p.pinned ?? 0,
       SOURCES.cheatsheet, i, now()]
    )
  })
}

// `kind` was renamed when the app stopped assuming one committee. Seeding runs
// after the database migration, so a content file still using the old name would
// quietly put the old value back — and a row whose kind matches no tab does not
// appear in the UI at all. Normalising here means an older seed-data.local.js
// keeps working untouched.
const QA_KIND_ALIASES = { likely_to_canada: 'likely_to_us' }
const qaKind = (k) => QA_KIND_ALIASES[k] || k || 'likely_to_us'

function seedQA() {
  run("DELETE FROM qa WHERE source_doc IS NOT NULL")
  QA.forEach((q, i) => {
    run(
      `INSERT INTO qa(id,question,answer,kind,short,tags,pinned,source_doc,ordinal,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [id('qa_'), q.question, q.answer, qaKind(q.kind), q.short ?? null, json.stringify(q.tags ?? []),
       q.pinned ?? 0, SOURCES.cheatsheet, i, now()]
    )
  })
}

function seedCountries() {
  for (const c of COUNTRIES) {
    // Keep the delegate's live bloc status if they have already changed it.
    const prev = get('SELECT bloc_status FROM countries WHERE code = ?', [c.code])
    run(
      `INSERT INTO countries(code,name,flag,is_ours,bloc_status,identity,lead_topic,main_vulnerability,
         position,facts,legal_refs,strengths,vulnerabilities,attacks_defenses,questions_to_ask,
         likely_allies,likely_opponents,cooperation,resolution_fit,should_lead_on,caution,source_doc,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET
         name=excluded.name, flag=excluded.flag, is_ours=excluded.is_ours,
         identity=excluded.identity, lead_topic=excluded.lead_topic,
         main_vulnerability=excluded.main_vulnerability, position=excluded.position,
         facts=excluded.facts, legal_refs=excluded.legal_refs, strengths=excluded.strengths,
         vulnerabilities=excluded.vulnerabilities, attacks_defenses=excluded.attacks_defenses,
         questions_to_ask=excluded.questions_to_ask, likely_allies=excluded.likely_allies,
         likely_opponents=excluded.likely_opponents, cooperation=excluded.cooperation,
         resolution_fit=excluded.resolution_fit, should_lead_on=excluded.should_lead_on,
         caution=excluded.caution, source_doc=excluded.source_doc, updated_at=excluded.updated_at`,
      [c.code, c.name, c.flag, c.is_ours ?? 0, prev?.bloc_status ?? c.bloc_status,
       c.identity, c.lead_topic, c.main_vulnerability, c.position,
       json.stringify(c.facts), json.stringify(c.legal_refs), json.stringify(c.strengths),
       json.stringify(c.vulnerabilities), json.stringify(c.attacks_defenses),
       json.stringify(c.questions_to_ask ?? []), c.likely_allies, c.likely_opponents,
       c.cooperation, c.resolution_fit, json.stringify(c.should_lead_on ?? []),
       c.caution ?? null, SOURCES.dossier, now()]
    )
    // Mirror into the bloc board so the board is populated on first open.
    run(
      `INSERT INTO bloc_members(country_code,status,updated_at) VALUES(?,?,?)
       ON CONFLICT(country_code) DO NOTHING`,
      [c.code, c.bloc_status, now()]
    )
  }
}

function seedProcedure() {
  // Preserve any card the delegate promoted to RPS_CONFIRMED after the Chair spoke.
  const confirmed = new Map(
    all("SELECT title, source, body, wording FROM procedure_rules WHERE source = 'RPS_CONFIRMED'")
      .map((r) => [r.title, r])
  )
  run("DELETE FROM procedure_rules WHERE source != 'RPS_CONFIRMED'")
  for (const p of PROCEDURE) {
    if (confirmed.has(p.title)) continue
    run(
      `INSERT INTO procedure_rules(id,topic,title,body,wording,source,ordinal,updated_at)
       VALUES(?,?,?,?,?,'GENERAL_PRACTICE',?,?)`,
      [id('pr_'), p.topic, p.title, p.body, p.wording ?? null, p.ordinal ?? 0, now()]
    )
  }
}

function seedCaucusPlays() {
  run('DELETE FROM caucus_plays')
  CAUCUS_PLAYS.forEach((c, i) => {
    run('INSERT INTO caucus_plays(id,room_state,motion,objective,lead,ordinal) VALUES(?,?,?,?,?,?)',
      [id('cp_'), c.room_state, c.motion, c.objective, c.lead ?? null, i])
  })
}

function seedClauseLibrary() {
  run('DELETE FROM clause_library')
  CLAUSE_LIBRARY.forEach((c, i) => {
    run('INSERT INTO clause_library(id,kind,opener,text,topic,priority,ordinal,source_doc) VALUES(?,?,?,?,?,?,?,?)',
      [id('cli_'), c.kind ?? 'OP', c.opener ?? null, c.text, c.topic ?? null, c.priority ?? 2, i, SOURCES.quickbook])
  })
}

function seedPriorities() {
  if (get('SELECT COUNT(*) AS n FROM priorities')?.n > 0) return // never clobber the live list
  PRIORITIES.forEach((text, i) => {
    run('INSERT INTO priorities(id,text,done,ordinal) VALUES(?,?,0,?)', [id('pri_'), text, i])
  })
}

function seedResolution() {
  if (get('SELECT COUNT(*) AS n FROM resolutions')?.n > 0) return
  const rid = id('res_')
  run(
    `INSERT INTO resolutions(id,title,committee,agenda,sponsors,signatories,open_issues,is_active,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,1,?,?)`,
    [rid, 'Working Draft', COMMITTEE.committee,
     COMMITTEE.agenda, json.stringify([COMMITTEE.country]), json.stringify([]), json.stringify([]), now(), now()]
  )
}

function seedSettings() {
  if (getSetting('alertSensitivity') == null) setSetting('alertSensitivity', 'medium')
  if (getSetting('fontScale') == null) setSetting('fontScale', 1)
  if (getSetting('theme') == null) setSetting('theme', 'dark')
  if (getSetting('transcriptionProvider') == null) setSetting('transcriptionProvider', 'webspeech')
  if (getSetting('recordingConsentAck') == null) setSetting('recordingConsentAck', false)
  // Only on first run. Re-seeding must never overwrite the committee: it is the
  // one setting the delegate is most likely to have edited by hand in Settings,
  // and silently reverting it to the environment default — days after they set
  // it, on an unrelated content update — would be the worst kind of surprise.
  if (getSetting('committee') == null) setSetting('committee', COMMITTEE)
  setSetting('ungaPowers', UNGA_POWERS)
  setSetting('openingMoments', OPENING_MOMENTS)
  setSetting('negotiationLines', NEGOTIATION_LINES)
}

export function seed({ force = false } = {}) {
  const current = getSetting('seedVersion', 0)
  if (!force && current === SEED_VERSION) {
    return { status: 'up-to-date', version: current }
  }
  tx(() => {
    seedSpeeches()
    seedPois()
    seedQA()
    seedCountries()
    seedProcedure()
    seedCaucusPlays()
    seedClauseLibrary()
    seedPriorities()
    seedResolution()
    seedSettings()
    setSetting('seedVersion', SEED_VERSION)
  })
  return {
    status: 'seeded',
    version: SEED_VERSION,
    counts: {
      speeches: get('SELECT COUNT(*) AS n FROM speeches').n,
      pois: get('SELECT COUNT(*) AS n FROM pois').n,
      qa: get('SELECT COUNT(*) AS n FROM qa').n,
      countries: get('SELECT COUNT(*) AS n FROM countries').n,
      procedure: get('SELECT COUNT(*) AS n FROM procedure_rules').n,
      caucusPlays: get('SELECT COUNT(*) AS n FROM caucus_plays').n,
      clauseLibrary: get('SELECT COUNT(*) AS n FROM clause_library').n,
    },
  }
}

// Allow `npm run seed`.
//
// pathToFileURL rather than a hand-built `file://` string: on Windows an
// absolute path starts with a drive letter, so concatenation produces
// `file://C:/...` while import.meta.url is `file:///C:/...`. The comparison then
// never matched and `npm run seed` exited silently having done nothing, which
// looked exactly like a seed that had run and found nothing to do.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(seed({ force: true }), null, 2))
}
