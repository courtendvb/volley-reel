// Builds an add-on pack (.vrpack, see src/shared/pack.ts) from a folder:
//   <folder>/players.csv  team,jersey,lastName,firstName,label,ids,teams,photo  (UTF-8; Excel: "CSV UTF-8")
//   <folder>/photos/      the photos the csv names (PNG or JPEG)
// ids and teams take several values separated by ';'. Only team, lastName and photo are needed.
//   node scripts/make-pack.mjs <folder> --id vleague-2026 --name "V.League 2026" [--out file.vrpack]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const args = process.argv.slice(2)
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined }
const dir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const id = opt('id'), name = opt('name') ?? id
if (!dir || !id) {
  console.error('usage: node scripts/make-pack.mjs <folder> --id <id> [--name <name>] [--out <file.vrpack>]')
  process.exit(1)
}
if (!/^[a-z0-9_-]{1,40}$/.test(id)) { console.error('--id: lower-case letters, digits, - and _ only'); process.exit(1) }

// A small CSV reader: quoted fields, "" inside quotes, CRLF, a BOM.
function parseCsv(text) {
  const rows = [[]]
  let f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c; continue }
    if (c === '"') q = true
    else if (c === ',') { rows.at(-1).push(f); f = '' }
    else if (c === '\n') { rows.at(-1).push(f.replace(/\r$/, '')); f = ''; rows.push([]) }
    else f += c
  }
  rows.at(-1).push(f.replace(/\r$/, ''))
  return rows.filter(r => r.some(x => x.trim()))
}

const csv = join(dir, 'players.csv')
if (!existsSync(csv)) { console.error(`not found: ${csv}`); process.exit(1) }
const [head, ...rows] = parseCsv(readFileSync(csv, 'utf8').replace(/^﻿/, ''))
const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]))
for (const need of ['team', 'lastName', 'photo']) if (col[need] === undefined) { console.error(`players.csv needs a "${need}" column`); process.exit(1) }

const files = { }
const players = []
const list = s => (s ?? '').split(';').map(x => x.trim()).filter(Boolean)
rows.forEach((r, n) => {
  const get = k => (col[k] === undefined ? '' : (r[col[k]] ?? '').trim())
  const photo = get('photo'), where = `players.csv line ${n + 2}`
  if (!get('team') || !get('lastName') || !photo) return console.warn(`${where}: skipped (team, lastName and photo are needed)`)
  if (!/^[A-Za-z0-9_.-]{1,80}\.(png|jpg|jpeg)$/i.test(photo)) return console.warn(`${where}: skipped (photo "${photo}": PNG/JPEG, letters, digits, . - _ only)`)
  const file = join(dir, 'photos', photo)
  if (!existsSync(file)) return console.warn(`${where}: skipped (no photos/${photo})`)
  files[`photos/${photo}`] = [readFileSync(file), { level: 0 }] // already compressed
  const jersey = get('jersey')
  players.push({
    team: get('team').toUpperCase(),
    ...(list(get('teams')).length ? { teams: list(get('teams')).map(s => s.toUpperCase()) } : {}),
    ...(/^\d+$/.test(jersey) ? { jersey: +jersey } : {}),
    lastName: get('lastName'),
    ...(get('firstName') ? { firstName: get('firstName') } : {}),
    ...(get('label') ? { label: get('label') } : {}),
    ...(list(get('ids')).length ? { ids: list(get('ids')) } : {}),
    photo,
  })
})
if (!players.length) { console.error('no players to pack'); process.exit(1) }

files['manifest.json'] = strToU8(JSON.stringify({ format: 'volley-reel-pack', version: 1, id, name, players }, null, 2))
const out = resolve(opt('out') ?? `${id}.vrpack`)
writeFileSync(out, zipSync(files))
console.log(`${basename(out)}: ${players.length} players`)
