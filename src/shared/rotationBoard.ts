// A rotation's slide: one of a team's six rotations (P1–P6, the setter's position) with its setter's
// side-out. Big "P2" at the top left; a half court with the side-out distribution after a #, + or !
// reception and the six players where the rotation puts them; on the right, the distribution after each
// reception (# / + / !) and after a # or + reception for the two setter calls used most, as small
// tables. Made of objects the slide editor moves and restyles. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { setterCall } from './setChart'
import { splitSets, type SetPlace, type SetSplit, type SetterSet, type SetView } from './setterBoard'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'
import { homography, project, type CourtFit, type Pt } from './courtGeometry'
import { discShapes } from './disc'

export const ROTATIONS = [1, 6, 5, 4, 3, 2] // the order a team rotates

const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const pct = (n: number, of: number): string => `${of ? Math.round((n / of) * 100) : 0}%`
const rotationOf = (p: Play) => (p.side === '*' ? p.homeRot : p.awayRot)
const afterRec = (s: SetterSet, recs: string) => s.set.phase === 'r' && !!s.set.recEffect && recs.includes(s.set.recEffect)

// The sets of a rotation, and those after a #, + or ! reception (the side-out).
export const inRotation = (sets: SetterSet[], r: number) => sets.filter(s => rotationOf(s.set) === r)
export const sideOut = (sets: SetterSet[]) => sets.filter(s => afterRec(s, '#+!'))

// The team's lineup in a rotation: the one it had most often at the start of a rally in it, P1 to P6
// (jerseys; liberos are not in the lineups). With the players, where the DVW names them.
export interface Lineup { jerseys: number[]; players: (Player | null)[] }
export function rotationLineup(dvws: ParsedDVW[], team: string, r: number): Lineup | null {
  const n = new Map<string, { jerseys: number[]; players: (Player | null)[]; count: number }>()
  for (const d of dvws) {
    const i = d.teams.findIndex(t => t.code.toUpperCase() === team.toUpperCase())
    if (i < 0) continue
    const side = i === 0 ? '*' : 'a'
    const seen = new Set<number>()
    for (const p of d.plays) {
      if (p.rallyId === null || seen.has(p.rallyId)) continue
      seen.add(p.rallyId) // the rally's first play: its rotation as the rally starts
      const rot = side === '*' ? p.homeRot : p.awayRot, court = d.rallies[p.rallyId]?.court
      const jerseys = court ? (side === '*' ? court.home : court.away) : []
      if (rot !== r || jerseys.length !== 6) continue
      const k = jerseys.join(','), had = n.get(k) ?? { jerseys, players: jerseys.map(j => d.players[`${side}${j}`] ?? null), count: 0 }
      had.count++
      n.set(k, had)
    }
  }
  const top = [...n.values()].sort((a, b) => b.count - a.count)[0]
  return top ? { jerseys: top.jerseys, players: top.players } : null
}

// The setter calls used most after a # or + reception, with their sets.
export function topCalls(sets: SetterSet[], most = 2): { call: string; sets: SetterSet[] }[] {
  const good = sets.filter(s => afterRec(s, '#+') && s.set.skill === 'E' && setterCall(s.set))
  const by = new Map<string, SetterSet[]>()
  for (const s of good) { const c = setterCall(s.set); by.set(c, [...(by.get(c) ?? []), s]) }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, most).map(([call, list]) => ({ call, sets: list }))
}

// ---- drawing --------------------------------------------------------------------------------
const ROLE_FILL: Record<PlayerRole, string> = { OP: '#DC2626', MB: '#16A34A', OH: '#2563EB', S: '#FACC15', L: '#64748B' }
const PLACE_LABEL: Record<SetPlace, string> = { left: 'Z4', middle: 'Quick', right: 'Z2/1', pipe: 'Pipe', dump: 'SD' }
const PLACE_FILL: Partial<Record<SetPlace, string>> = { right: '#DC2626', middle: '#16A34A', left: '#2563EB', pipe: '#0F172A' }

// A table of where the sets went: its title, then N · Pipe · SD and Z2/1 · Quick · Z4, each a label
// over its share; the largest of the three places in bold red. One group.
function table(title: string, head: { fill: string; text: string }, sp: SetSplit, x: number, y: number, w: number): { out: Annotation[]; h: number } {
  const groupId = uid(), cw = w / 3, rh = 0.03, out: Annotation[] = []
  const cell = (c: number, r: number, text: string, o: { fill?: string; color?: string; bold?: boolean; span?: number; size?: number } = {}) => {
    const cwid = cw * (o.span ?? 1)
    out.push(words(x + c * cw + cwid / 2, y + r * rh, text, o.size ?? 13, o.color ?? '#0F172A', {
      align: 'center', bold: o.bold ?? false, groupId,
      box: { fill: o.fill ?? '#FFFFFF', fillOpacity: 1, stroke: '#94A3B8', strokeWidth: 1, padding: 3, width: cwid, height: rh },
    }))
  }
  cell(0, 0, title, { fill: head.fill, color: head.text, bold: true, span: 3, size: 14 })
  cell(0, 1, 'N'); cell(1, 1, 'Pipe', { fill: '#0F172A', color: '#FFFFFF', bold: true }); cell(2, 1, 'SD')
  cell(0, 2, String(sp.total)); cell(1, 2, pct(sp.by.pipe.n, sp.total)); cell(2, 2, pct(sp.by.dump.n, sp.total))
  const three: SetPlace[] = ['right', 'middle', 'left'], top = Math.max(...three.map(k => sp.by[k].n))
  three.forEach((k, c) => {
    cell(c, 3, PLACE_LABEL[k], { fill: PLACE_FILL[k], color: '#FFFFFF', bold: true })
    const big = sp.total > 0 && sp.by[k].n === top
    cell(c, 4, pct(sp.by[k].n, sp.total), { bold: big, color: big ? '#DC2626' : '#0F172A' })
  })
  return { out, h: rh * 5 }
}

// ---- the court in perspective ---------------------------------------------------------------
// The team's half seen from behind its end line: the net at the top, narrower, the end line wide at
// the bottom. u across from the team's left (Zone4's side), s from the net (0) to the end line (1);
// the attack line at a third.
export interface HalfCourt { net: [Pt, Pt]; end: [Pt, Pt] }
export const HALF: HalfCourt = { net: [{ x: 0.12, y: 0.34 }, { x: 0.56, y: 0.34 }], end: [{ x: 0.035, y: 0.965 }, { x: 0.645, y: 0.965 }] }
const halfAt = (c: HalfCourt) => { const H = homography([c.net[0], c.net[1], c.end[0], c.end[1]]); return (u: number, s: number): [number, number] => { const p = project(H, u, s); return [p.x, p.y] } }
// The whole court's corners for the disc's camera: the far end line where the half's perspective puts it.
const fullCorners = (c: HalfCourt): CourtFit['corners'] => {
  const at = halfAt(c), [a, b] = [at(0, -1), at(1, -1)]
  return [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, c.end[0], c.end[1]]
}

const PLACE_COLOR: Partial<Record<SetPlace, string>> = { left: '#2563EB', middle: '#16A34A', right: '#DC2626', pipe: '#7C3AED' }
// Where each place's attack is hit from (u, s), and where its share is written.
const PLACE_AT: Partial<Record<SetPlace, { hit: [number, number]; label: [number, number] }>> = {
  left: { hit: [0.14, 0.04], label: [0.17, 0.3] }, middle: { hit: [0.5, 0.04], label: [0.5, 0.3] },
  right: { hit: [0.86, 0.04], label: [0.83, 0.3] }, pipe: { hit: [0.5, 0.4], label: [0.5, 0.6] },
}
const SETTER_AT: [number, number] = [0.64, 0.05]

// The half court, the net as a see-through band above it, a cone from the setter to where each place's
// attack is hit (as wide as its share, in its colour), each share large on a white plate, the dumps by
// the setter, and the lineup as discs with their numbers (P4 P3 P2 by the net, P5 P6 P1 at the back).
function courtView(so: SetSplit, lineup: Lineup | null, c: HalfCourt): Annotation[] {
  const at = halfAt(c), out: Annotation[] = [], courtGroup = uid()
  const poly = (pts: [number, number][], fill: string, o: Partial<Extract<Annotation, { kind: 'polygon' }>> = {}): Annotation =>
    ({ id: uid(), kind: 'polygon', color: '#FFFFFF', width: 0, points: pts, fill, fillOpacity: 1, groupId: courtGroup, ...o })
  const line = (a: [number, number], b: [number, number], width: number, color = '#FFFFFF'): Annotation =>
    ({ id: uid(), kind: 'polyline', color, width, points: [a, b], groupId: courtGroup })
  // The floor: the free zone a shade darker round the court, then the court.
  out.push(poly([at(-0.05, -0.02), at(1.05, -0.02), at(1.05, 1.04), at(-0.05, 1.04)], '#E9A8A8'))
  out.push(poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], '#F6C9C9', { color: '#FFFFFF', width: 3 }))
  out.push(line(at(0, 1 / 3), at(1, 1 / 3), 3))
  out.push(line(at(-0.05, 1 / 3), at(0, 1 / 3), 2), line(at(1, 1 / 3), at(1.05, 1 / 3), 2)) // the attack line runs on, dashed in life
  // Cones: from where each place's attack is hit back to the end line, as wide there as the share
  // (the attackers' lanes), see-through so they cross.
  const total = so.total || 1, [sx, sy] = at(...SETTER_AT)
  for (const k of ['left', 'right', 'middle', 'pipe'] as SetPlace[]) {
    const n = so.by[k].n, p = PLACE_AT[k]
    if (!n || !p) continue
    const half = 0.03 + 0.2 * (n / total) // the end's half width in court units
    out.push(poly([at(p.hit[0] - 0.015, p.hit[1]), at(p.hit[0] + 0.015, p.hit[1]), at(p.hit[0] + half, 1), at(p.hit[0] - half, 1)], PLACE_COLOR[k]!, { fillOpacity: 0.45 }))
  }
  // The net: a band above the net line, between two posts.
  const [nl, nr] = [at(-0.06, 0), at(1.06, 0)], up = 0.11
  out.push(poly([[nl[0], nl[1] - up], [nr[0], nr[1] - up], nr, nl], '#F8FAFC', { fillOpacity: 0.55, color: '#E2E8F0', width: 2 }))
  out.push(line([nl[0], nl[1] - up], [nr[0], nr[1] - up], 4, '#F8FAFC'), line(nl, nr, 3, '#F8FAFC'))
  for (const p of [nl, nr]) out.push({ id: uid(), kind: 'rect', color: '#7F1D1D', x: p[0] - 0.006, y: p[1] - up - 0.02, w: 0.012, h: up + 0.06, width: 1, fill: '#DC2626', fillOpacity: 1, groupId: courtGroup })
  // The players.
  if (lineup) {
    const corners = fullCorners(c)
    const spots: [number, number, number][] = [[1, 5 / 6, 0.8], [2, 5 / 6, 0.09], [3, 1 / 2, 0.09], [4, 1 / 6, 0.09], [5, 1 / 6, 0.8], [6, 1 / 2, 0.8]] // P, u, s
    for (const [pos, u, s] of spots) {
      const role = lineup.players[pos - 1]?.role, fill = (role && ROLE_FILL[role]) || '#F8FAFC', dark = role === 'S' || !role
      const g = uid(), [side, top] = discShapes(corners, { u, v: (s + 1) / 2, r: 0.5, z: 0.3 }, { color: '#334155', fill, fillOpacity: 1, width: 1.5 }, { side: uid(), top: uid(), group: g })
      out.push(side, top)
      const pts = top.kind === 'polygon' ? top.points : [], cx = pts.reduce((a, p) => a + p[0], 0) / (pts.length || 1), cy = pts.reduce((a, p) => a + p[1], 0) / (pts.length || 1)
      out.push(words(cx, cy - 11 / 720, String(lineup.jerseys[pos - 1]), 18, dark ? '#0F172A' : '#FFFFFF', { align: 'center', groupId: g }))
    }
  }
  // The shares, large on white plates; the dumps small by the setter.
  for (const k of ['left', 'middle', 'right', 'pipe'] as SetPlace[]) {
    const p = PLACE_AT[k]
    if (!p) continue
    const [lx, ly] = at(...p.label), g = uid()
    out.push(words(lx, ly - 0.035, pct(so.by[k].n, total), 40, '#0F172A', { align: 'center', groupId: g,
      box: { fill: '#FFFFFF', fillOpacity: 0.75, stroke: null, strokeWidth: 0, padding: 4, radius: 4, width: 0.105, height: 0.07 } }))
    out.push(words(lx, ly + 0.038, PLACE_LABEL[k], 13, PLACE_COLOR[k]!, { align: 'center', groupId: g }))
  }
  out.push(words(sx + 0.03, sy - 0.1, `SD ${pct(so.by.dump.n, total)}`, 14, '#0F172A', { groupId: courtGroup, box: { fill: '#FACC15', fillOpacity: 0.9, stroke: null, strokeWidth: 0, padding: 3, radius: 3 } }))
  return out
}

export interface RotationSlideData {
  rotation: number
  team: string
  setter: Player
  sets: SetterSet[] // the setter's, every rotation
  lineup: Lineup | null
  callNames?: Record<string, string>
}

// Where the set chart goes on the slide (top right), as a share of the picture's height.
export const ROTATION_CHART = { x: 0.795, y: 0.02, h: 0.46 }

export function rotationSlide(v: RotationSlideData, _view: SetView, ink: string): Annotation[] {
  const out: Annotation[] = [], rot = inRotation(v.sets, v.rotation), so = sideOut(rot)
  // The heading: the rotation large, underlined; the team, setter and side-out numbers after it.
  const headGroup = uid(), all = splitSets(so)
  out.push(words(0.03, 0.012, `P${v.rotation}`, 80, ink, { groupId: headGroup }))
  out.push({ id: uid(), kind: 'polyline', color: ink, width: 5, points: [[0.03, 0.15], [0.145, 0.15]], groupId: headGroup })
  out.push(words(0.165, 0.035, `${v.team}  #${v.setter.jersey} ${v.setter.lastName.toUpperCase()}`, 24, ink, { groupId: headGroup }))
  out.push(words(0.165, 0.085, `Side-out (# + ! reception)   n ${all.total} · K ${pct(all.kills, all.total)} · ERR ${pct(all.errors, all.total)}`, 15, ink, { bold: false, groupId: headGroup }))
  out.push(...courtView(all, v.lineup, HALF))
  // Bottom right: by reception, and by setter call (the chart is above them).
  const colW = 0.145, gap = 0.01, x1 = 0.69, x2 = x1 + colW + 0.012
  let y = 0.5
  const recs: [string, string, { fill: string; text: string }][] = [['#', '# pass', { fill: '#DBEAFE', text: '#0F172A' }], ['+', '+ pass', { fill: '#DCFCE7', text: '#0F172A' }], ['!', '! pass', { fill: '#FDE8D0', text: '#0F172A' }]]
  for (const [e, title, head] of recs) {
    const tb = table(title, head, splitSets(rot.filter(s => afterRec(s, e))), x1, y, colW)
    out.push(...tb.out); y += tb.h + gap
  }
  y = 0.5
  const heads = [{ fill: '#3B5BDB', text: '#FFFFFF' }, { fill: '#E03131', text: '#FFFFFF' }]
  topCalls(rot).forEach(({ call, sets }, i) => {
    const name = v.callNames?.[call]
    const tb = table(`CALL ${call}${name ? ` ${name}` : ''}`, heads[i], splitSets(sets), x2, y, colW)
    out.push(...tb.out); y += tb.h + gap
  })
  return out
}
