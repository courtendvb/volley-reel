// Writes players.csv for make-pack.mjs from the SV.LEAGUE site's team rosters: team code, jersey,
// romaji name (as DVW spells it), the Japanese name as the label, and the position. Photos are NOT
// taken: the site's terms forbid copying them without permission, so the photo column stays empty
// for pictures you are allowed to use. Run again (same --out) to refresh the roster: the photo and
// ids already filled in are kept for players still listed.
//   node scripts/svleague-roster.mjs [--list <team list URL>] [--out players.csv] [--codes team=CODE,...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined }
const LIST = opt('list') ?? 'https://www.svleague.jp/team/sv/men/'
const OUT = opt('out') ?? 'players.csv'
const ORIGIN = new URL(LIST).origin

// Site team (in its URLs) → DVW team code, as the scouts write it; teams = other codes for the team
// (HTA: Hiroshima's own scrimmage files; VCN: Matsumoto's code as VC Nagano, in older DVWs). Teams missing here keep their site name in upper case and
// are reported: give their code with --codes.
const CODES = {
  hiroshima: ['HTH', 'HTA'], voreas: ['VOR'], osakab: ['BLU'], stingsaichi: ['JTK'], sakai: ['SAK'],
  tokyogb: ['TGB'], trshizuoka: ['TOR'], matsumototd: ['SMT', 'VCN'], wdnagoya: ['WDN'],
  suntory: ['SUN'], hokkaidoys: ['HYS'], fkagoshima: ['FGK'],
}
for (const pair of (opt('codes') ?? '').split(',').filter(Boolean)) {
  const [team, codes] = pair.split('=')
  if (team && codes) CODES[team.trim()] = codes.split(';').map(c => c.trim().toUpperCase())
}

const sleep = ms => new Promise(ok => setTimeout(ok, ms))
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'volley-reel roster script (team analysis)' } })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.text()
}
const text = s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()

// Japanese players are written surname first (Yanakita Yuri); foreign ones, whose Japanese name is
// in katakana with ・, given name first, the rest being the surname as DVW writes it
// (Daniel Martinez Campos → MARTINEZ CAMPOS, Daniel).
function split(romaji, ja) {
  const w = romaji.split(/\s+/).filter(Boolean)
  if (w.length < 2) return { lastName: (w[0] ?? '').toUpperCase(), firstName: '' }
  return ja.includes('・') ? { lastName: w.slice(1).join(' ').toUpperCase(), firstName: w[0] }
    : { lastName: w[0].toUpperCase(), firstName: w.slice(1).join(' ') }
}

const list = await get(LIST)
const teams = [...new Set([...list.matchAll(/\/team\/([a-z0-9]+)\/player\//g)].map(m => m[1]))]
if (!teams.length) { console.error(`no teams found on ${LIST}`); process.exit(1) }

const rows = [], unknown = []
for (const team of teams) {
  await sleep(1000) // one page a second: a light load on the site
  const html = await get(`${ORIGIN}/team/${team}/player/`)
  const [code, ...others] = CODES[team] ?? [team.toUpperCase()]
  if (!CODES[team]) unknown.push(team)
  let n = 0
  for (const m of html.matchAll(/<b>(\d+)<\/b>\s*<strong>([\s\S]*?)<\/strong>\s*<em>([\s\S]*?)<\/em>(?:\s*<p>([\s\S]*?)<\/p>)?/g)) {
    const ja = text(m[2]), romaji = text(m[3])
    rows.push({ team: code, jersey: m[1], ...split(romaji, ja), label: ja.replace(/\s+/g, ' '), ids: '', teams: others.join(';'), photo: '', position: text(m[4] ?? '') })
    n++
  }
  console.log(`${team} → ${code}: ${n} players`)
}

// Kept from an earlier run: photo and ids, for the same team and name.
const COLS = ['team', 'jersey', 'lastName', 'firstName', 'label', 'ids', 'teams', 'photo', 'position']
const key = r => `${r.team}|${r.lastName}|${r.firstName}`.toUpperCase()
if (existsSync(OUT)) {
  const [head, ...old] = parseCsv(readFileSync(OUT, 'utf8').replace(/^\uFEFF/, ''))
  const at = Object.fromEntries(head.map((h, i) => [h.trim(), i]))
  const kept = new Map(old.map(r => [key({ team: r[at.team], lastName: r[at.lastName], firstName: r[at.firstName] }), r]))
  let n = 0
  for (const r of rows) {
    const o = kept.get(key(r))
    if (!o) continue
    if (at.photo !== undefined && o[at.photo]) { r.photo = o[at.photo]; n++ }
    if (at.ids !== undefined && o[at.ids]) r.ids = o[at.ids]
  }
  console.log(`kept the photo of ${n} players from ${OUT}`)
}

const cell = v => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
// With a BOM, so Excel opens it as UTF-8.
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, '\uFEFF' + [COLS, ...rows.map(r => COLS.map(c => r[c]))].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n')
console.log(`${OUT}: ${rows.length} players`)
if (unknown.length) console.log(`no DVW team code known for: ${unknown.join(', ')} (written as their site name; give codes with --codes ${unknown.map(t => `${t}=XXX`).join(',')})`)

// Same reader as make-pack.mjs.
function parseCsv(s) {
  const out = [[]]
  let f = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c; continue }
    if (c === '"') q = true
    else if (c === ',') { out.at(-1).push(f); f = '' }
    else if (c === '\n') { out.at(-1).push(f.replace(/\r$/, '')); f = ''; out.push([]) }
    else f += c
  }
  out.at(-1).push(f.replace(/\r$/, ''))
  return out.filter(r => r.some(x => x.trim()))
}
