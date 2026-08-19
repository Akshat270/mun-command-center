// Which delegation, committee and agenda are actually in force.
//
// There are two sources and they can disagree:
//
//   · the MUN_* environment variables, read once into COMMITTEE in config.js —
//     the defaults, and how a pendrive build or a fresh clone is configured
//   · the `committee` row in the settings table, written from the app — what the
//     delegate chose, and what survives re-seeding
//
// The stored value wins, merged over the defaults so a partially-filled setting
// still has a country and a committee. Everything user-facing must resolve it
// the same way: the AI prompts, the context sent with them, and /api/status,
// which feeds the top bar, the dashboard and the speakers list. When those
// disagree the app argues with itself about who the delegate is representing.
//
// This lives in its own module because config.js cannot read the database —
// db/client.js imports config.js, so the dependency only runs one way.

import { COMMITTEE } from './config.js'
import { getSetting } from './db/client.js'

/**
 * The committee in force. Falls back to the environment defaults whenever the
 * database is unreadable, which is deliberate: an AI call or a status response
 * is not worth failing over a setting, and the defaults are still coherent.
 */
export function activeCommittee() {
  try {
    const stored = getSetting('committee', null)
    if (stored && typeof stored === 'object') return { ...COMMITTEE, ...stored }
  } catch { /* database unavailable — defaults are fine */ }
  return COMMITTEE
}

/** The delegate's own country name, for prose. */
export const ourCountry = () => activeCommittee().country
