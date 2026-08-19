// Fastify entry point. In production it also serves the built SPA, so the
// whole app is one process on one port — `npm run go` and you are live.

import Fastify from 'fastify'
import path from 'node:path'
import fs from 'node:fs'
import routes from './routes.js'
import { seed } from './db/seed.js'
import { dbStatus } from './db/client.js'
import { PORT, HOST, IS_PROD, APP_ROOT, DATA_DIR, SOURCE_DIR, COMMITTEE } from './config.js'
import { aiStatus } from './ai/service.js'
import { loadStoredKeys, loadStoredProvider, probeCLI } from './ai/keys.js'

const app = Fastify({
  logger: {
    level: IS_PROD ? 'warn' : 'info',
    // Never log an API key, even if one reaches a body by accident.
    redact: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.apiKey', '*.api_key'],
  },
  bodyLimit: 32 * 1024 * 1024,
})

// An empty body on a JSON request means "no arguments", not "malformed". Several
// endpoints take no parameters at all (build the semantic index, test the AI
// connection); Fastify's default parser rejects those outright, which surfaced
// as a baffling "Body cannot be empty" instead of the action happening.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || !String(body).trim()) return done(null, {})
  try {
    done(null, JSON.parse(body))
  } catch {
    const err = new Error('That request body was not valid JSON.')
    err.statusCode = 400
    done(err, undefined)
  }
})

// Readable errors only — the delegate must never see a stack trace mid-committee.
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err }, 'request failed')
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
  reply.code(status).send({
    error: err.userMessage || err.message || 'Something went wrong.',
    hint: status >= 500 ? 'The local knowledge base is unaffected — try again or reload.' : undefined,
  })
})

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ error: `No such endpoint: ${req.method} ${req.url}` })
  }
  // A request for a file (anything with an extension) that got this far is a
  // genuinely missing asset. Answering it with index.html would hand the browser
  // HTML labelled as a script or a manifest, which fails far from the real cause.
  if (/\.[a-z0-9]+$/i.test(new URL(req.url, 'http://localhost').pathname)) {
    return reply.code(404).send({ error: `Not found: ${req.url}` })
  }
  // SPA fallback so deep links work on refresh.
  const indexFile = path.join(APP_ROOT, 'dist', 'index.html')
  if (fs.existsSync(indexFile)) return reply.type('text/html').send(fs.readFileSync(indexFile))
  return reply.code(404).send({ error: 'UI not built. Run `npm run build`, or use `npm run dev`.' })
})

/**
 * This server has no authentication — it is a local tool, and the only thing
 * standing between it and the wider web is that it listens on loopback. That is
 * not quite enough on its own: a page on any website can resolve its own
 * hostname to 127.0.0.1 (DNS rebinding) and then talk to this API as if it were
 * same-origin, reading the delegate's transcript, notes and prep material.
 *
 * A browser cannot forge the Host header, so requiring it to name loopback
 * closes that door. Runs in both dev and production.
 *
 * HOST is a documented .env knob, so whatever it is bound to is allowed too —
 * otherwise setting HOST=0.0.0.0 to reach the app from a phone would 403 every
 * request including the SPA's own.
 *
 * But a non-loopback bind is not a small convenience setting, and HOST alone is
 * too easy to reach for. There is no login here: anyone who can route a packet
 * to this port can read the live transcript, every note and every prepared
 * speech, and can spend the API key through /api/ai/*. On conference or school
 * wifi that is every other device on the network — including the delegations
 * being transcribed. So opening the bind takes two deliberate acts, not one:
 * HOST names the interface, and MUN_ALLOW_LAN=1 confirms the exposure is
 * intended. Setting HOST without it is treated as the mistake it almost always
 * is, and the server refuses to start rather than quietly listening.
 */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1']
const ALLOWED_HOSTS = new Set(
  [...new Set([...LOOPBACK, HOST])]
    .filter(Boolean)
    .flatMap((h) => [h.toLowerCase(), `${h.toLowerCase()}:${PORT}`])
)

const IS_LOOPBACK_BIND = LOOPBACK.includes(HOST)
const ALLOW_LAN = /^(1|true|yes)$/i.test(process.env.MUN_ALLOW_LAN || '')

if (!IS_LOOPBACK_BIND && !ALLOW_LAN) {
  console.error(`
  ✕ Refusing to start.

    HOST is set to "${HOST}", which listens beyond this machine, but
    MUN_ALLOW_LAN is not set.

    This app has no login. Anyone who can reach this port can read your live
    transcript, notes and prepared speeches, and can spend your API key.

    If you genuinely want that — a phone on your own trusted network, say —
    set both:

        HOST=${HOST}
        MUN_ALLOW_LAN=1

    Otherwise remove HOST from app/.env and use the default 127.0.0.1.
`)
  process.exit(1)
}

// Bound beyond loopback with consent given: the rebinding guard cannot know
// which Host header is legitimate any more, so it stands down. The warning at
// startup is what stands in its place.
const OPEN_BIND = HOST === '0.0.0.0' || HOST === '::'

app.addHook('onRequest', async (req, reply) => {
  if (OPEN_BIND) return
  const host = (req.headers.host || '').toLowerCase()
  if (!ALLOWED_HOSTS.has(host)) {
    return reply.code(403).send({
      error: 'This app only accepts requests addressed to localhost.',
    })
  }
})

await app.register(routes)

// Serve the build whenever one exists, not only under NODE_ENV=production.
// Otherwise opening this port directly without the prod flag returns the SPA
// fallback for /assets/*.js and /site.webmanifest too, and the browser rejects
// a script served as text/html — a build that looks live but cannot boot.
const dist = path.join(APP_ROOT, 'dist')
if (fs.existsSync(dist)) {
  const { default: fastifyStatic } = await import('@fastify/static')
  await app.register(fastifyStatic, { root: dist, prefix: '/' })
} else if (IS_PROD) {
  app.log.warn('dist/ not found — run `npm run build` first.')
}

if (!IS_PROD) {
  // In dev the browser talks to Vite, which proxies /api here. CORS is only a
  // safety net for hitting the API directly from a browser tab — so it names
  // the dev server explicitly. `origin: true` reflects whatever Origin is sent,
  // which would let any site the delegate happens to have open read every
  // response from this API.
  const { default: cors } = await import('@fastify/cors')
  await app.register(cors, {
    origin: ['http://127.0.0.1:5180', 'http://localhost:5180'],
  })
}

// Pick up any API key saved from Settings. Done before the first request so a
// key added yesterday is live today without touching .env.
try {
  const loaded = loadStoredKeys()
  loadStoredProvider()
  if (loaded) app.log.info('loaded %d saved API key(s)', loaded)
} catch (err) {
  app.log.warn({ err }, 'could not load saved API keys')
}

// Is the Claude Code CLI usable? Probed once, in the background, so a delegate
// with no API key still gets AI through the subscription they already pay for.
probeCLI()
  .then((r) => app.log.info({ claudeCli: r.available }, 'claude code cli probe'))
  .catch(() => {})

// Seed on boot so a fresh clone is immediately useful.
try {
  const result = seed()
  if (result.status === 'seeded') app.log.info({ counts: result.counts }, 'seeded curated MUN content')
} catch (err) {
  app.log.warn({ err }, 'seeding skipped')
}

const db = dbStatus()
const ai = aiStatus()

await app.listen({ port: PORT, host: HOST })

const line = (label, value) => console.log(`  ${label.padEnd(11)} ${value}`)
console.log(`\n  ${COMMITTEE.flag}  MUN LIVE COMMAND CENTER — ${COMMITTEE.country} · ${COMMITTEE.committee}`)
console.log(`  ${'─'.repeat(64)}`)
line('API', `http://${HOST}:${PORT}`)
line('UI', IS_PROD ? `http://${HOST}:${PORT}` : 'http://127.0.0.1:5180  (vite dev server)')
line('Database', db.ok ? db.path : `UNAVAILABLE — ${db.error}`)
line('Data dir', DATA_DIR)
line('Documents', SOURCE_DIR)
line('AI', ai.available ? `${ai.provider} · ${ai.models.live} live / ${ai.models.deep} deep` : 'not configured — local knowledge base fully available')
console.log(`  ${'─'.repeat(64)}\n`)

// Loud, every boot, for as long as the app is exposed. A warning that is easy to
// stop noticing is not doing its job — and the state it describes (no login, on
// a shared network) is the one worth being reminded of before a session starts.
if (!IS_LOOPBACK_BIND) {
  console.log('  ⚠  REACHABLE FROM YOUR NETWORK — there is no login on this app.')
  console.log(`     Bound to ${HOST}:${PORT}. Anyone who can reach that address can read your`)
  console.log('     transcript, notes and speeches, and can spend your API key.')
  console.log('     Use HOST=127.0.0.1 (the default) unless you need this right now.\n')
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await app.close(); process.exit(0) })
}
