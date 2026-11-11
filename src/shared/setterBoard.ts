// A setter's slide: one setter, six half courts of where their sets went (the attack after each, by
// where it was hit from), in two rows of three. Two layouts:
//  reception  the top row after a #, + and ! reception; the bottom row after a # or + reception, one
//             court per setter call, the most called first
//  rotation   the side-out after a #, + or ! reception in each of the setter's rotations: S1, S6, S5
//             on top, S4, S3, S2 below
// Zone2 and Zone1 are one place here (Zone2/1). Made of objects the slide editor moves and restyles,
// like the rest of the data slides. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { mix } from './overlayDraw'
import { attackOfContact, setTarget, setterCall } from './setChart'
import type { ParsedDVW, Play } from './types'

export type SetLayout = 'reception' | 'rotation'
export const SET_LAYOUTS: SetLayout[] = ['reception', 'rotation']

// Where a set went: Zone4, Zone3, Zone2/1 (the right side, front and back), Pipe, or the setter's own (SD).
export type SetPlace = 'left' | 'middle' | 'right' | 'pipe' | 'dump'
export const SET_PLACES: SetPlace[] = ['left', 'middle', 'right', 'pipe', 'dump']
export const PLACE_NAMES: Record<SetPlace, string> = { left: 'Zone4', middle: 'Zone3', right: 'Zone2/1', pipe: 'Pipe', dump: 'SD' }

// A setter's contact and the attack it led to (for a dump, the same play), with where that was.
export interface SetterSet { set: Play; attack: Play; place: SetPlace }

// Every set of the setter that led to an attack, and their dumps, match by match.
// keep: only these contacts of the setter (the search).
export function setterSets(dvws: ParsedDVW[], setter: string, keep?: (p: Play) => boolean): SetterSet[] {
  const out: SetterSet[] = []
  for (const d of dvws) {
    d.plays.forEach((p, i) => {
      if (p.playerKey !== setter || (p.skill !== 'E' && p.skill !== 'A') || (keep && !keep(p))) return
      const attack = attackOfContact(d.plays, i)
      const target = attack ? setTarget(attack, setter) : null
      if (!attack || !target) return
      out.push({ set: p, attack, place: target === 'back' ? 'right' : target })
    })
  }
  return out
}

export interface SetSplit { total: number; kills: number; errors: number; by: Record<SetPlace, { n: number; kills: number }> }
export function splitSets(list: SetterSet[]): SetSplit {
  const by = Object.fromEntries(SET_PLACES.map(k => [k, { n: 0, kills: 0 }])) as SetSplit['by']
  let kills = 0, errors = 0
  for (const s of list) {
    by[s.place].n++
    if (s.attack.effect === '#') { by[s.place].kills++; kills++ }
    if (s.attack.effect === '=' || s.attack.effect === '/') errors++
  }
  return { total: list.length, kills, errors, by }
}

const rotationOf = (p: Play) => (p.side === '*' ? p.homeRot : p.awayRot)
const afterRec = (s: SetterSet, recs: string) => s.set.phase === 'r' && !!s.set.recEffect && recs.includes(s.set.recEffect)

// The six courts of a layout: each one's title and its sets. Calls: the most called first, after a
// # or + reception; fewer than three calls leave the rest empty.
export interface SetPanel { title: string; sets: SetterSet[] }
export function setPanels(list: SetterSet[], layout: SetLayout, names: Record<string, string> = {}): { rows: [SetPanel[], SetPanel[]]; labels: [string, string] | null } {
  if (layout === 'rotation') {
    const side = list.filter(s => afterRec(s, '#+!'))
    const court = (r: number): SetPanel => ({ title: `S${r}`, sets: side.filter(s => rotationOf(s.set) === r) })
    return { rows: [[1, 6, 5].map(court), [4, 3, 2].map(court)], labels: null }
  }
  const recs = ['#', '+', '!'].map(e => ({ title: `${e} Reception`, sets: list.filter(s => afterRec(s, e)) }))
  const good = list.filter(s => afterRec(s, '#+') && s.set.skill === 'E' && setterCall(s.set))
  const n = new Map<string, number>()
  for (const s of good) { const c = setterCall(s.set); n.set(c, (n.get(c) ?? 0) + 1) }
  const calls = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
  const byCall: SetPanel[] = calls.map(([c]) => ({ title: names[c] ? `${c} ${names[c]}` : c, sets: good.filter(s => setterCall(s.set) === c) }))
  while (byCall.length < 3) byCall.push({ title: '—', sets: [] })
  return { rows: [recs, byCall], labels: ['Reception', 'Setter call (# +)'] }
}

// ---- drawing --------------------------------------------------------------------------------
const ASPECT = 16 / 9
const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`
export type SetView = 'zones' | 'arrows' | 'both'

// Each place on the half court, net at the top, as the team faces it (Zone4 on the left): u across,
// v from the net (0) to the end line (1); the attack line at a third. Zone2/1 takes the right side
// from the net to behind the attack line; Pipe is behind Zone3. SD has no place: it is written below.
const CELLS: Partial<Record<SetPlace, { u: [number, number]; v: [number, number] }>> = {
  left: { u: [0, 1 / 3], v: [0, 1 / 3] }, middle: { u: [1 / 3, 2 / 3], v: [0, 1 / 3] },
  right: { u: [2 / 3, 1], v: [0, 2 / 3] }, pipe: { u: [1 / 3, 2 / 3], v: [1 / 3, 2 / 3] },
}
const SETTER_AT = { u: 0.62, v: 0.06 }
const TITLE_ROOM = 0.082, SD_ROOM = 0.04 // above a court: its title and numbers; below: the dumps

// One court: its title and numbers above, the places painted the stronger the more sets went there
// and / or arrows from the setter as thick as the share, each place's share, count and kill rate, and
// the dumps under it. One group, to move as one. h: the court's height (0..1 of the picture).
// head: false leaves the title and numbers out (the caller writes its own); groupId: the group to join.
export function setCourt(panel: SetPanel, x: number, y: number, h: number, view: SetView, ink: string, head = true, groupId = uid()): Annotation[] {
  const sp = splitSets(panel.sets), w = h / ASPECT
  const at = (u: number, v: number): [number, number] => [x + u * w, y + v * h]
  const size = (k: number) => Math.max(10, Math.round(h * 720 * k))
  const top = Math.max(0, ...SET_PLACES.map(k => sp.by[k].n))
  const out: Annotation[] = [
    ...(head ? [
      words(x + w / 2, y - TITLE_ROOM, panel.title, 20, ink, { align: 'center', groupId }),
      words(x + w / 2, y - TITLE_ROOM + 0.04, `n ${sp.total} · K ${pct(sp.kills, sp.total)} · ERR ${pct(sp.errors, sp.total)}`, 14, ink, { align: 'center', groupId, bold: false }),
    ] : []),
    { id: uid(), kind: 'rect', color: '#FFFFFF', x, y, w, h, width: 2, fill: '#F3D9B1', fillOpacity: 1, groupId },
  ]
  for (const k of SET_PLACES) {
    const c = CELLS[k], n = sp.by[k].n
    if (!c || !n || view === 'arrows') continue
    const [x0, y0] = at(c.u[0], c.v[0])
    out.push({ id: uid(), kind: 'rect', color: '#FFFFFF', x: x0, y: y0, w: (c.u[1] - c.u[0]) * w, h: (c.v[1] - c.v[0]) * h, width: 0,
      fill: mix('#FEE2E2', '#B91C1C', top ? n / top : 0), fillOpacity: 0.95, groupId })
  }
  // The lines: across at the attack line (thicker) and two thirds; down between the places (not
  // through Zone2/1's two rows).
  const line = (a: [number, number], b: [number, number], width: number): Annotation => ({ id: uid(), kind: 'polyline', color: '#FFFFFF', width, points: [a, b], groupId })
  out.push(line(at(0, 1 / 3), at(2 / 3, 1 / 3), 2.5), line(at(2 / 3, 1 / 3), at(1, 1 / 3), 1), line(at(0, 2 / 3), at(1, 2 / 3), 1.5))
  out.push(line(at(1 / 3, 0), at(1 / 3, 1), 1.5), line(at(2 / 3, 0), at(2 / 3, 1), 1.5))
  out.push({ id: uid(), kind: 'polyline', color: '#0F172A', width: 5, points: [at(-0.03, 0), at(1.03, 0)], groupId }) // the net
  const mid = (k: SetPlace) => { const c = CELLS[k]!; return at((c.u[0] + c.u[1]) / 2, (c.v[0] + c.v[1]) / 2) }
  if (view !== 'zones') {
    for (const k of SET_PLACES) {
      const n = sp.by[k].n
      if (!CELLS[k] || !n) continue
      const [x1, y1] = at(SETTER_AT.u, SETTER_AT.v), [x2, y2] = mid(k)
      out.push({ id: uid(), kind: 'arrow', color: '#1D4ED8', width: Math.round(2 + 16 * (n / sp.total)), x1, y1, x2, y2: y2 + h * 0.06, opacity: 0.85, groupId })
    }
    out.push({ id: uid(), kind: 'circle', color: '#FFFFFF', x: x + SETTER_AT.u * w - 0.007, y: y + SETTER_AT.v * h - 0.0125, w: 0.014, h: 0.025, width: 2, fill: '#FACC15', fillOpacity: 1, groupId })
  }
  for (const k of SET_PLACES) {
    if (!CELLS[k]) continue
    const b = sp.by[k], [cx, cy] = mid(k)
    const strong = view !== 'arrows' && top > 0 && b.n / top > 0.55, color = strong ? '#FFFFFF' : '#0F172A'
    const boxed = view === 'arrows' ? { box: { fill: '#FFFFFF', fillOpacity: 0.85, stroke: null, strokeWidth: 0, padding: 2, radius: 3 } } : {}
    // Three lines in a third of the court's height, centred on the place: its name, share, count and kills.
    const b0 = cy - h / 6, bh = h / 3
    out.push(words(cx, b0 + bh * 0.04, PLACE_NAMES[k], size(0.04), color, { align: 'center', groupId, bold: false }))
    out.push(words(cx, b0 + bh * 0.26, pct(b.n, sp.total), size(0.09), color, { align: 'center', groupId, ...boxed }))
    out.push(words(cx, b0 + bh * 0.68, `${b.n} · K ${pct(b.kills, b.n)}`, size(0.042), color, { align: 'center', groupId, bold: false }))
  }
  const sd = sp.by.dump
  out.push(words(x + w / 2, y + h + 0.008, `SD ${pct(sd.n, sp.total)} · ${sd.n}`, 14, ink, { align: 'center', groupId }))
  return out
}

// The six courts and the row labels, under a heading the board makes. area.left: where the courts
// start; the room left of it is for the photo (at the top, when photo) and the rows' labels.
export function setterCourts(list: SetterSet[], layout: SetLayout, names: Record<string, string>, view: SetView, ink: string,
  area: { left: number; top: number; bottom: number; photo?: boolean }): Annotation[] {
  const { rows, labels } = setPanels(list, layout, names)
  const out: Annotation[] = []
  const colW = (0.99 - area.left) / 3, rowH = (area.bottom - area.top) / 2
  const h = Math.min(rowH - TITLE_ROOM - SD_ROOM, colW * ASPECT * 0.92), w = h / ASPECT
  rows.forEach((row, r) => {
    const y = area.top + r * rowH + TITLE_ROOM
    if (labels) out.push(words(0.012, area.top + rowH * (r + (r === 0 && area.photo ? 0.82 : 0.5)), labels[r], 16, '#FFFFFF',
      { box: { fill: '#1D4ED8', fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 5, radius: 4 } }))
    row.forEach((panel, c) => out.push(...setCourt(panel, area.left + c * colW + (colW - w) / 2, y, h, view, ink)))
  })
  return out
}
