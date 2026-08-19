// Every UN member state, for naming a speaker and for repairing what the
// speech recogniser heard.
//
// The `countries` table holds only the delegations this delegate prepared
// research briefs for — four of them. That is the right scope for a brief and
// the wrong scope for a speaker list: any of the other 189 can take the floor,
// and before this the Live Room offered a fixed dropdown of four.
//
// Names follow the UN's own protocol list, which is what a chair reads out.
// Codes are ISO 3166-1 alpha-2, matching the `countries.code` column so a
// delegation that does have a brief links straight to it.

const RAW = `
AF Afghanistan|AL Albania|DZ Algeria|AD Andorra|AO Angola|AG Antigua and Barbuda
AR Argentina|AM Armenia|AU Australia|AT Austria|AZ Azerbaijan|BS Bahamas
BH Bahrain|BD Bangladesh|BB Barbados|BY Belarus|BE Belgium|BZ Belize
BJ Benin|BT Bhutan|BO Bolivia|BA Bosnia and Herzegovina|BW Botswana|BR Brazil
BN Brunei Darussalam|BG Bulgaria|BF Burkina Faso|BI Burundi|CV Cabo Verde|KH Cambodia
CM Cameroon|CA Canada|CF Central African Republic|TD Chad|CL Chile|CN China
CO Colombia|KM Comoros|CG Congo|CR Costa Rica|CI Côte d'Ivoire|HR Croatia
CU Cuba|CY Cyprus|CZ Czechia|KP Democratic People's Republic of Korea
CD Democratic Republic of the Congo|DK Denmark|DJ Djibouti|DM Dominica
DO Dominican Republic|EC Ecuador|EG Egypt|SV El Salvador|GQ Equatorial Guinea
ER Eritrea|EE Estonia|SZ Eswatini|ET Ethiopia|FJ Fiji|FI Finland
FR France|GA Gabon|GM Gambia|GE Georgia|DE Germany|GH Ghana
GR Greece|GD Grenada|GT Guatemala|GN Guinea|GW Guinea-Bissau|GY Guyana
HT Haiti|HN Honduras|HU Hungary|IS Iceland|IN India|ID Indonesia
IR Iran|IQ Iraq|IE Ireland|IL Israel|IT Italy|JM Jamaica
JP Japan|JO Jordan|KZ Kazakhstan|KE Kenya|KI Kiribati|KW Kuwait
KG Kyrgyzstan|LA Lao People's Democratic Republic|LV Latvia|LB Lebanon|LS Lesotho
LR Liberia|LY Libya|LI Liechtenstein|LT Lithuania|LU Luxembourg|MG Madagascar
MW Malawi|MY Malaysia|MV Maldives|ML Mali|MT Malta|MH Marshall Islands
MR Mauritania|MU Mauritius|MX Mexico|FM Micronesia|MC Monaco|MN Mongolia
ME Montenegro|MA Morocco|MZ Mozambique|MM Myanmar|NA Namibia|NR Nauru
NP Nepal|NL Netherlands|NZ New Zealand|NI Nicaragua|NE Niger|NG Nigeria
MK North Macedonia|NO Norway|OM Oman|PK Pakistan|PW Palau|PA Panama
PG Papua New Guinea|PY Paraguay|PE Peru|PH Philippines|PL Poland|PT Portugal
QA Qatar|KR Republic of Korea|MD Republic of Moldova|RO Romania|RU Russian Federation
RW Rwanda|KN Saint Kitts and Nevis|LC Saint Lucia|VC Saint Vincent and the Grenadines
WS Samoa|SM San Marino|ST Sao Tome and Principe|SA Saudi Arabia|SN Senegal
RS Serbia|SC Seychelles|SL Sierra Leone|SG Singapore|SK Slovakia|SI Slovenia
SB Solomon Islands|SO Somalia|ZA South Africa|SS South Sudan|ES Spain|LK Sri Lanka
SD Sudan|SR Suriname|SE Sweden|CH Switzerland|SY Syrian Arab Republic|TJ Tajikistan
TH Thailand|TL Timor-Leste|TG Togo|TO Tonga|TT Trinidad and Tobago|TN Tunisia
TR Türkiye|TM Turkmenistan|TV Tuvalu|UG Uganda|UA Ukraine|AE United Arab Emirates
GB United Kingdom|TZ United Republic of Tanzania|US United States of America
UY Uruguay|UZ Uzbekistan|VU Vanuatu|VE Venezuela|VN Viet Nam|YE Yemen
ZM Zambia|ZW Zimbabwe|VA Holy See|PS State of Palestine
`

export type MemberState = { code: string; name: string }

export const MEMBER_STATES: MemberState[] = RAW
  .split(/[|\n]/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const i = s.indexOf(' ')
    return { code: s.slice(0, i), name: s.slice(i + 1) }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * What delegates actually say and type. The UN's formal name is what a chair
 * reads out, but nobody types "United Kingdom of Great Britain and Northern
 * Ireland" mid-debate — and the speech recogniser will never produce it either.
 */
const ALIASES: Record<string, string> = {
  uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB',
  usa: 'US', us: 'US', america: 'US', 'united states': 'US',
  russia: 'RU', 'south korea': 'KR', 'north korea': 'KP',
  'south africa': 'ZA', 'ivory coast': 'CI', 'cape verde': 'CV',
  turkey: 'TR', swaziland: 'SZ', macedonia: 'MK', moldova: 'MD',
  tanzania: 'TZ', laos: 'LA', vietnam: 'VN', syria: 'SY',
  brunei: 'BN', 'czech republic': 'CZ', burma: 'MM', palestine: 'PS',
  'east timor': 'TL', 'drc': 'CD', 'congo-kinshasa': 'CD',
}

const key = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

const BY_KEY = new Map<string, MemberState>()
for (const m of MEMBER_STATES) {
  BY_KEY.set(key(m.name), m)
  BY_KEY.set(m.code.toLowerCase(), m)
}

/** Resolve a typed or spoken name to a member state. Null if it is not one. */
export function findMemberState(input: string): MemberState | null {
  const k = key(input)
  if (!k) return null
  const direct = BY_KEY.get(k)
  if (direct) return direct
  const aliased = ALIASES[k]
  if (aliased) return MEMBER_STATES.find((m) => m.code === aliased) ?? null
  return null
}

export const MEMBER_STATE_NAMES = MEMBER_STATES.map((m) => m.name)
