// A serve-target slide: which serves keep a team from siding out. Every reception of the team, by who
// received it and the serve's type (jump / float), by where the serve went (Zone1, Zone6, Zone5,
// short), with how often the pass was good (# +), how often the first attack after it was a kill, and
// how often the team won the rally (side-out). The lowest side-outs are marked: the serves to hit.
// Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { serveZoneMarker } from './presets'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'

export type ServeKind = 'jump' | 'float'
export const SERVE_KINDS: ServeKind[] = ['jump', 'float']
export type TargetZone = 1 | 2 | 3 | 4 // Zone1, Zone6, Zone5, short (presets.ts serveZoneMarker)
export const TARGET_ZONES: TargetZone[] = [1, 2, 3, 4]
export const ZONE_NAMES: Record<TargetZone, string> = { 1: 'Zone1', 2: 'Zone6', 3: 'Zone5', 4: 'Short' }
export type AttackPlace = 'left' | 'middle' | 'right' | 'pipe'

// One reception, with what came of it.
export interface Received {
  rec: Play
  receiver: string // player key
  jersey: number
  kind: ServeKind | null // from the serve's code: Q jump, M / H float
  zone: TargetZone | null // where the serve went
  good: boolean // # or +
  sideOut: boolean | null // the receiving team won the rally (null: not known)
  attack: Play | null // the team's first attack after it, in the same rally
  place: AttackPlace | null // where that attack was hit from
}

const kindOf = (serveCode: string | undefined): ServeKind | null => {
  const c = serveCode?.charAt(4)
  return c === 'Q' ? 'jump' : c === 'M' || c === 'H' ? 'float' : null
}
const placeOf = (a: Play): AttackPlace | null => {
  const z = a.startZone
  return z === 4 || z === 5 || z === 7 ? 'left' : z === 3 ? 'middle' : z === 2 || z === 1 || z === 9 ? 'right' : z === 8 || z === 6 ? 'pipe' : null
}

// Every reception of the team in these matches. keep: only these receptions (the search).
export function teamReceptions(dvws: ParsedDVW[], team: string, keep?: (p: Play) => boolean): Received[] {
  const out: Received[] = []
  for (const d of dvws) {
    const i = d.teams.findIndex(t => t.code.toUpperCase() === team.toUpperCase())
    if (i < 0) continue
    const side = i === 0 ? '*' : 'a'
    d.plays.forEach((p, k) => {
      if (p.skill !== 'R' || p.side !== side || p.rallyId === null || (keep && !keep(p))) return
      let attack: Play | null = null
      for (let j = k + 1; j < d.plays.length; j++) {
        const q = d.plays[j]
        if (q.rallyId !== p.rallyId) break
        if (q.side !== side) break // the ball went over: no attack of this side-out
        if (q.skill === 'A') { attack = q; break }
      }
      const won = d.rallies[p.rallyId]?.wonBy
      out.push({
        rec: p, receiver: p.playerKey, jersey: p.jersey, kind: kindOf(p.shotCode),
        zone: serveZoneMarker({ ...p, effect: '+' }) as TargetZone | null,
        good: p.effect === '#' || p.effect === '+', sideOut: won ? won === side : null,
        attack, place: attack ? placeOf(attack) : null,
      })
    })
  }
  return out
}

// What a set of receptions came to: how many, good passes, kills of the first attack, side-outs.
export interface ReceiveStats { n: number; good: number; attacks: number; kills: number; sideOuts: number; known: number }
export function receiveStats(list: Received[]): ReceiveStats {
  return {
    n: list.length, good: list.filter(r => r.good).length,
    attacks: list.filter(r => r.attack).length, kills: list.filter(r => r.attack?.effect === '#').length,
    sideOuts: list.filter(r => r.sideOut === true).length, known: list.filter(r => r.sideOut !== null).length,
  }
}

// The receivers, those who took the most first; those with only a few left out (at least share of
// the team's, and two).
export function receivers(list: Received[], share = 0.05, most = 7): { key: string; jersey: number; n: number }[] {
  const by = new Map<string, { key: string; jersey: number; n: number }>()
  for (const r of list) { const x = by.get(r.receiver) ?? { key: r.receiver, jersey: r.jersey, n: 0 }; x.n++; by.set(r.receiver, x) }
  return [...by.values()].filter(x => x.n >= 2 && x.n >= list.length * share).sort((a, b) => b.n - a.n).slice(0, most)
}

// ---- drawing --------------------------------------------------------------------------------
const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
const ASPECT = 16 / 9
const INK = '#0F172A', LINE = '#94A3B8', HEAD = '#0F172A', JUMP = '#DC2626', FLOAT = '#1D4ED8'
const GOOD_FOR_US = '#DBEAFE', BAD_FOR_US = '#FEE2E2' // a low side-out (blue: aim there), a high one
const ROLE_FILL: Record<PlayerRole, string> = { OP: '#DC2626', MB: '#16A34A', OH: '#2563EB', S: '#FACC15', L: '#64748B' }
const MIN_N = 3 // fewer receptions than this: no colour, too few to tell

// A cell of a table, as a text in a fixed box.
function cell(out: Annotation[], g: string, x: number, y: number, w: number, h: number, text: string, o: { fill?: string; color?: string; bold?: boolean; size?: number } = {}) {
  out.push(words(x + w / 2, y, text, o.size ?? 13, o.color ?? INK, { align: 'center', bold: o.bold ?? false, groupId: g,
    box: { fill: o.fill ?? '#FFFFFF', fillOpacity: 1, stroke: LINE, strokeWidth: 1, padding: 3, width: w, height: h } }))
}

// A side-out share coloured against the team's: well under (blue, the serve to hit) or over (red).
function soFill(s: ReceiveStats, team: ReceiveStats): string | undefined {
  if (s.known < MIN_N || !team.known) return undefined
  const v = s.sideOuts / s.known, t = team.sideOuts / team.known
  return v <= t - 0.1 ? GOOD_FOR_US : v >= t + 0.1 ? BAD_FOR_US : undefined
}

// The rows of a block: per serve kind, receptions, good passes, kills of the first attack and side-outs;
// then side-out of both kinds together.
function statColumn(out: Annotation[], g: string, x: number, y: number, w: number, rh: number, list: Received[], team: ReceiveStats) {
  const half = w / 2
  SERVE_KINDS.forEach((k, i) => {
    const s = receiveStats(list.filter(r => r.kind === k)), cx = x + i * half
    cell(out, g, cx, y, half, rh, k === 'jump' ? 'Jump' : 'Float', { fill: k === 'jump' ? '#FEE2E2' : '#DBEAFE', color: k === 'jump' ? JUMP : FLOAT, bold: true, size: 12 })
    cell(out, g, cx, y + rh, half, rh, String(s.n))
    cell(out, g, cx, y + 2 * rh, half, rh, pct(s.good, s.n))
    cell(out, g, cx, y + 3 * rh, half, rh, pct(s.kills, s.attacks))
    const fill = soFill(s, team)
    cell(out, g, cx, y + 4 * rh, half, rh, pct(s.sideOuts, s.known), { bold: !!fill, ...(fill ? { fill } : {}) })
  })
  const all = receiveStats(list), fill = soFill(all, team)
  cell(out, g, x, y + 5 * rh, w, rh, pct(all.sideOuts, all.known), { bold: true, ...(fill ? { fill } : {}) })
}
function rowLabels(out: Annotation[], g: string, x: number, y: number, w: number, rh: number) {
  const labels = ['Serve', 'Receptions', 'Good pass (AB%)', '1st attack K%', 'Side-out %', 'Side-out (all)']
  labels.forEach((l, i) => cell(out, g, x, y + i * rh, w, rh, l, { fill: '#F1F5F9', bold: true, size: 11 }))
}

// A zone's panel: how many serves went there and what the team did after: the share of its first
// attacks from Z4, Quick and Z2/1 (count and kill rate), and Pipe's.
function zonePanel(out: Annotation[], x: number, y: number, w: number, h: number, title: string, list: Received[], head: string) {
  const g = uid(), s = receiveStats(list), att = list.filter(r => r.place)
  out.push({ id: uid(), kind: 'rect', color: '#C2410C', x, y, w, h, width: 1.5, fill: '#FDBA74', fillOpacity: 0.55, groupId: g })
  out.push(words(x + 0.006, y + 0.004, title, 13, '#FFFFFF', { groupId: g, box: { fill: head, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 3 } }))
  out.push(words(x + 0.008, y + 0.033, `n ${s.n} · SO ${pct(s.sideOuts, s.known)}`, 12, INK, { groupId: g }))
  const pipe = att.filter(r => r.place === 'pipe')
  out.push(words(x + 0.008, y + 0.054, `Pipe ${pct(pipe.length, att.length)} · ${pipe.length} · K ${pct(pipe.filter(r => r.attack?.effect === '#').length, pipe.length)}`, 10, '#166534', { groupId: g, bold: false }))
  const cw = (w - 0.012) / 3
  ;(['left', 'middle', 'right'] as AttackPlace[]).forEach((p, i) => {
    const here = att.filter(r => r.place === p), cx = x + 0.006 + i * cw + cw / 2
    out.push(words(cx, y + 0.074, p === 'left' ? 'Z4' : p === 'middle' ? 'Quick' : 'Z2/1', 10, '#7C2D12', { align: 'center', groupId: g }))
    out.push(words(cx, y + 0.089, pct(here.length, att.length), 13, INK, { align: 'center', groupId: g }))
    out.push(words(cx, y + 0.11, `${here.length} · K ${pct(here.filter(r => r.attack?.effect === '#').length, here.length)}`, 10, '#4338CA', { align: 'center', groupId: g, bold: false }))
  })
}

export interface ServeTargetData {
  team: string; teamName: string
  receptions: Received[]
  players: Record<string, Player> // by key: the receivers' names and positions
  photos: Record<string, { assetId: string; width: number; height: number }> // by key; the team's logo under logoKey(team)
}
export const logoKey = (team: string) => `logo:${team.toUpperCase()}`

export function serveTargetSlide(v: ServeTargetData, ink = INK): Annotation[] {
  const out: Annotation[] = [], all = v.receptions, team = receiveStats(all)
  const rs = receivers(all)
  // The heading.
  const hg = uid()
  out.push(words(0.015, 0.012, `${v.team} reception vs serve`, 26, ink, { groupId: hg }))
  out.push(words(0.015, 0.058, `${team.n} receptions · good pass ${pct(team.good, team.n)} · side-out ${pct(team.sideOuts, team.known)}   blue: side-out 10 points or more under the team's (the serve to hit), red: over`, 13, ink, { groupId: hg, bold: false }))
  // The receivers: photo, number and name, then the stats; the team's at the end.
  const top = 0.1, photoH = 0.13, nameH = 0.032, rh = 0.034, labelW = 0.11
  const cols = rs.length + 1, colW = Math.min(0.13, (0.985 - 0.015 - labelW) / cols)
  const statY = top + photoH + nameH + 0.006
  const lg = uid()
  rowLabels(out, lg, 0.015, statY, labelW, rh)
  rs.forEach((r, i) => {
    const x = 0.015 + labelW + i * colW, g = uid(), p = v.players[r.key], ph = v.photos[r.key]
    if (ph) {
      const h = photoH, w = Math.min(colW * 0.9, (h * ph.width) / ph.height / ASPECT)
      out.push({ id: uid(), kind: 'rect', color: '#FFFFFF', x: x + (colW - w) / 2, y: top, w, h, width: 0, fill: '#FFFFFF', fillOpacity: 1, groupId: g })
      out.push({ id: uid(), kind: 'image', color: '#FFFFFF', x: x + (colW - w) / 2, y: top, w, h, assetId: ph.assetId, groupId: g })
    }
    const fill = (p?.role && ROLE_FILL[p.role]) || '#E2E8F0', dark = !p?.role || p.role === 'S'
    cell(out, g, x, top + photoH, colW, nameH, `#${r.jersey} ${(p?.lastName ?? '').toUpperCase()}`, { fill, color: dark ? INK : '#FFFFFF', bold: true, size: 13 })
    statColumn(out, g, x, statY, colW, rh, all.filter(x => x.receiver === r.key), team)
  })
  const tx = 0.015 + labelW + rs.length * colW, tg = uid()
  // The team's logo above its column, where the players have their photos.
  const logo = v.photos[logoKey(v.team)]
  if (logo) {
    const h = Math.min(photoH, (colW * 0.9 * ASPECT * logo.height) / logo.width), w = (h * logo.width) / logo.height / ASPECT
    out.push({ id: uid(), kind: 'image', color: '#FFFFFF', x: tx + (colW - w) / 2, y: top + photoH - h, w, h, assetId: logo.assetId, groupId: tg })
  }
  cell(out, tg, tx, top + photoH, colW, nameH, v.team, { fill: HEAD, color: '#FFFFFF', bold: true, size: 13 })
  statColumn(out, tg, tx, statY, colW, rh, all, team)
  // Bottom left: by where the serve went.
  const zy = statY + 6 * rh + 0.04, zg = uid(), zw = 0.085
  rowLabels(out, zg, 0.015, zy + nameH, labelW, rh)
  TARGET_ZONES.forEach((z, i) => {
    const x = 0.015 + labelW + i * zw
    cell(out, zg, x, zy, zw, nameH, ZONE_NAMES[z], { fill: HEAD, color: '#FFFFFF', bold: true, size: 13 })
    statColumn(out, zg, x, zy + nameH, zw, rh, all.filter(r => r.zone === z), team)
  })
  // Bottom right: each zone's panel, for every serve, then jump and float.
  const px = 0.015 + labelW + TARGET_ZONES.length * zw + 0.02, pw = (0.985 - px) / TARGET_ZONES.length, ph = 0.128
  const rowsOf: [string, Received[], string][] = [['All', all, HEAD], ['Jump', all.filter(r => r.kind === 'jump'), JUMP], ['Float', all.filter(r => r.kind === 'float'), FLOAT]]
  rowsOf.forEach(([label, list, head], ri) => {
    TARGET_ZONES.forEach((z, zi) => zonePanel(out, px + zi * pw + 0.003, zy + ri * (ph + 0.006), pw - 0.006, ph, `${label} · ${ZONE_NAMES[z]}`, list.filter(r => r.zone === z), head))
  })
  return out
}
