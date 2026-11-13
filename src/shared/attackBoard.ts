// An attacker's slide, to set the defence against them: their name large at the top left; on the left a
// half court in perspective, seen from behind our own end line, with the attacker over the net where
// they mostly hit from, the spread of their attacks as a cone, where most of them landed in orange,
// and (if asked) our blockers and diggers as discs to move into place; on the right, a column per
// condition (the pass before the attack, or transition): where the sets to them were given, then
// their direction chart with its numbers (hard / soft / tip, K E B Att, K% ERR%, Pos Neg), where most
// landed ringed in red. Everything but the charts is objects the slide editor moves and restyles, so
// arrows and notes are drawn on by hand. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { chartCourt, chartWidth, type ChartStyle } from './chart'
import { directionChart, type PlacedSetChart } from './court'
import { homography, project, type CourtFit } from './courtGeometry'
import { discOutline } from './disc'
import { mix } from './overlayDraw'
import { NUMBER_FONT, attackCone, attackLine, type TeamPt } from './rotationBoard'
import { attackerSetChart, setChartWidth } from './setChart'
import type { PlacedChart } from './board'
import type { Play, Player } from './types'

// What a column keeps: the attacks after a good pass (# +), after a poor one (! -: the "M.PASS"),
// or in transition (after a dig or a free ball).
export type AttackCondition = 'good' | 'poor' | 'trans'
export const ATTACK_CONDITIONS: AttackCondition[] = ['good', 'poor', 'trans']
export const CONDITION_NAMES: Record<AttackCondition, string> = { good: 'Good pass (# +)', poor: 'M.PASS (! -)', trans: 'Transition' }
const CONDITION_COLORS: Record<AttackCondition, string> = { good: '#2563EB', poor: '#D97706', trans: '#475569' }
export function inCondition(p: Pick<Play, 'phase' | 'recEffect'>, c: AttackCondition): boolean {
  if (c === 'trans') return p.phase === 't'
  return p.phase === 'r' && !!p.recEffect && (c === 'good' ? '#+' : '!-').includes(p.recEffect)
}

// Where the attacking team's setter was: in the front row in rotations 2, 3 and 4 (the setter's zone).
export type SetterRow = 'front' | 'back'
export const SETTER_ROW_NAMES: Record<SetterRow, string> = { front: 'Setter Front', back: 'Setter Back' }
export function setterRowOf(p: Pick<Play, 'side' | 'homeRot' | 'awayRot'>): SetterRow | null {
  const r = p.side === '*' ? p.homeRot : p.awayRot
  return r === null ? null : r >= 2 && r <= 4 ? 'front' : 'back'
}

// Where most of these points lie: the point with the most others within radius metres of it, and the
// middle of those; null with fewer than `least` there. Points in court units (u across 9 m, v along 18 m).
export function hotSpot(points: TeamPt[], radius = 1.5, least = 3): (TeamPt & { n: number }) | null {
  let best: TeamPt[] = []
  for (const p of points) {
    const near = points.filter(q => Math.hypot((q.u - p.u) * 9, (q.v - p.v) * 18) <= radius)
    if (near.length > best.length) best = near
  }
  if (best.length < least) return null
  return { u: best.reduce((a, p) => a + p.u, 0) / best.length, v: best.reduce((a, p) => a + p.v, 0) / best.length, n: best.length }
}

export interface AttackSlideData {
  player: Player
  team: string
  attacks: Play[] // the attacker's, already kept to the code and the setter's row asked for
  setOf: Map<Play, Play | null> // the set before each attack
  label: string // under the name: what the attacks are kept to
}
export interface AttackSlideOptions {
  conditions: AttackCondition[]
  defense: boolean // our blockers and diggers as discs to move
  style: ChartStyle
  ink: string // the heading's colour, to show on the background
}

const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const PW = 1280, PH = 720

// Our half seen from behind our end line, the net toward the top, the other team's front zone beyond
// it. Picture points of the whole court's corners (its far end line lies just off the picture):
// far left / right, near left / right. u across as the picture goes, v from the attacker's end line.
export const ATTACK_COURT: CourtFit['corners'] = [{ x: 0.1312, y: -0.04 }, { x: 0.5084, y: -0.04 }, { x: 0.03, y: 0.975 }, { x: 0.6096, y: 0.975 }]
// The court made smaller toward its near left corner (scale 1: as above), to give three columns room.
const courtAt = (scale: number): CourtFit['corners'] =>
  ATTACK_COURT.map(c => ({ x: 0.03 + (c.x - 0.03) * scale, y: 0.975 + (c.y - 0.975) * scale })) as CourtFit['corners']
const FLOOR = '#2B4A6F', COURT_FILL = '#E7C89C', FRONT_FILL = '#DDB784', LINE = '#FFFFFF'
const ATTACKER = '#1E3A8A', BLOCKER = '#FACC15', DIGGER = '#34D399', CONE = '#DC2626', HOT = '#F97316', RING = '#EF4444'
const BEYOND = 0.4 // how far the drawing goes past the net, as v

// The court, the net, the attacker and what their attacks did, as objects on the slide.
function courtSide(v: AttackSlideData, defense: boolean, corners: CourtFit['corners']): Annotation[] {
  const H = homography(corners), out: Annotation[] = [], g = uid()
  const at = (u: number, w: number): [number, number] => { const q = project(H, u, w); return [q.x, q.y] }
  // The team's frame (u from the attacker's left) on the picture: turned round across.
  const team = (p: TeamPt) => at(1 - p.u, p.v)
  const poly = (pts: [number, number][], fill: string | null, o: Partial<Extract<Annotation, { kind: 'polygon' }>> = {}): Annotation =>
    ({ id: uid(), kind: 'polygon', color: LINE, width: 0, points: pts, fill, fillOpacity: 1, groupId: g, locked: true, ...o })
  const line = (a: [number, number], b: [number, number], width: number, color = LINE, o: { opacity?: number; dash?: 'dash' } = {}): Annotation =>
    ({ id: uid(), kind: 'polyline', color, width, points: [a, b], groupId: g, locked: true, ...o })
  out.push(poly([at(-0.08, BEYOND - 0.05), at(1.08, BEYOND - 0.05), at(1.08, 1.03), at(-0.08, 1.03)], FLOOR))
  out.push(poly([at(0, BEYOND), at(1, BEYOND), at(1, 1), at(0, 1)], COURT_FILL))
  out.push(poly([at(0, 0.5), at(1, 0.5), at(1, 2 / 3), at(0, 2 / 3)], FRONT_FILL))
  out.push(line(at(0, BEYOND), at(0, 1), 3), line(at(1, BEYOND), at(1, 1), 3), line(at(0, 1), at(1, 1), 3))
  out.push(line(at(0, 2 / 3), at(1, 2 / 3), 2.5), line(at(-0.08, 2 / 3), at(0, 2 / 3), 1.5, LINE, { dash: 'dash' }), line(at(1, 2 / 3), at(1.08, 2 / 3), 1.5, LINE, { dash: 'dash' }))
  out.push(line(at(0, 0.5), at(1, 0.5), 3))

  const lines = v.attacks.flatMap(a => { const l = attackLine(a); return l ? [l] : [] })
  // Where most attacks landed: an ellipse on the floor.
  const hot = hotSpot(lines.map(l => l.to), 2)
  if (hot) out.push({ id: uid(), kind: 'polygon', color: HOT, width: 0, points: discOutline(corners, { u: 1 - hot.u, v: hot.v, r: 1.6, z: 0 }).top, fill: HOT, fillOpacity: 0.55 })
  // The spread of the attacks (the middle 80% of their directions), from where they were hit.
  const cone = attackCone(lines)
  if (cone) {
    const rim: [number, number][] = []
    for (let i = 0; i <= 14; i++) {
      const a = cone.from + ((cone.to - cone.from) * i) / 14
      rim.push(team({ u: cone.apex.u + (Math.sin(a) * cone.reach) / 9, v: cone.apex.v + (Math.cos(a) * cone.reach) / 18 }))
    }
    out.push({ id: uid(), kind: 'polygon', color: CONE, width: 3, points: [team(cone.apex), ...rim], fill: CONE, fillOpacity: 0.12 })
  }

  // A player as a ball on the floor, lit from the top left, its shadow under it.
  const disc = (u: number, w: number, fill: string, label: string) => {
    const gg = uid(), ring = discOutline(corners, { u, v: w, r: 0.45, z: 0 }).top, [cx, fy] = at(u, w)
    const xs = ring.map(q => q[0]), d = (Math.max(...xs) - Math.min(...xs)) * PW, cy = fy * PH - d * 0.42
    out.push({ id: uid(), kind: 'polygon', color: '#000000', width: 0, points: discOutline(corners, { u, v: w + 0.005, r: 0.47, z: 0 }).top, fill: '#2A1708', fillOpacity: 0.32, groupId: gg })
    out.push({ id: uid(), kind: 'circle', color: mix(fill, '#000000', 0.45), width: 1.5, x: cx - d / 2 / PW, y: (cy - d / 2) / PH, w: d / PW, h: d / PH, fill, fillOpacity: 1, shade: 'ball', groupId: gg })
    if (label) out.push(words(cx, (cy - d * 0.27) / PH, label, Math.round(d * 0.45), light(fill) ? '#0F172A' : '#FFFFFF', { align: 'center', groupId: gg, font: NUMBER_FONT }))
  }
  // Ours, behind the net from the picture's view: the diggers, then the blockers at the net.
  const apexU = cone ? 1 - cone.apex.u : 0.8
  if (defense) {
    for (const [u, w] of [[0.5, 0.93], [0.12, 0.78], [0.88, 0.78]]) disc(u, w, DIGGER, '')
    for (const du of [-0.07, 0.07]) disc(Math.min(0.95, Math.max(0.05, apexU + du)), 0.55, BLOCKER, '')
  }
  // The net: a see-through mesh with the white tape along its top, the antennas over the sidelines.
  const [nl, nr] = [at(-0.05, 0.5), at(1.05, 0.5)], up = 0.11, low = 0.025, netTop = nl[1] - up
  out.push(poly([[nl[0], netTop], [nr[0], netTop], [nr[0], nr[1] - low], [nl[0], nl[1] - low]], '#0F172A', { fillOpacity: 0.16 }))
  for (let i = 1; i < 30; i++) { const x = nl[0] + ((nr[0] - nl[0]) * i) / 30; out.push(line([x, netTop], [x, nl[1] - low], 1, '#0F172A', { opacity: 0.22 })) }
  out.push(line([nl[0], netTop], [nr[0], netTop], 5), line([nl[0], nl[1] - low], [nr[0], nr[1] - low], 1.5, '#F8FAFC'))
  for (const u of [0, 1]) {
    const [x, y] = at(u, 0.5)
    for (let i = 0; i < 5; i++) out.push(line([x, y - up - i * 0.014], [x, y - up - (i + 1) * 0.014], 3, i % 2 ? '#FFFFFF' : '#DC2626'))
  }
  // The attacker over the net, where they mostly hit from, on top of it.
  if (cone) disc(apexU, Math.min(0.48, cone.apex.v), ATTACKER, String(v.player.jersey))
  return out
}
const light = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 }

// The right side: from the court to the edge, a column per condition.
const END = 0.988, GAP = 0.012, COL_MAX = 0.165, TAG_Y = 0.012, SET_Y = 0.058, SET_MAX = 0.29

export function attackSlide(v: AttackSlideData, o: AttackSlideOptions): { annotations: Annotation[]; charts: PlacedChart[]; setCharts: PlacedSetChart[] } {
  const out: Annotation[] = [], charts: PlacedChart[] = [], setCharts: PlacedSetChart[] = []
  const conditions = o.conditions.length ? o.conditions : ATTACK_CONDITIONS.slice(0, 2), n = conditions.length
  const scale = n >= 3 ? 0.8 : 1, corners = courtAt(scale), right = Math.max(...corners.map(c => c.x)) + 0.02
  out.push(...courtSide(v, o.defense, corners))
  // The heading: the number and name large, underlined; what the attacks are kept to under it.
  const hg = uid(), name = `#${v.player.jersey} ${v.player.lastName.toUpperCase()}`, size = Math.min(60, Math.floor((0.55 * PW) / (name.length * 0.68)))
  out.push(words(0.02, 0.012, name, size, o.ink, { groupId: hg }))
  out.push({ id: uid(), kind: 'polyline', color: o.ink, width: 4, points: [[0.022, 0.012 + (size * 1.22) / PH], [0.022 + (name.length * size * 0.66) / PW, 0.012 + (size * 1.22) / PH]], groupId: hg })
  out.push(words(0.022, 0.03 + (size * 1.3) / PH, v.label, Math.min(30, Math.floor(((right - 0.05) * PW) / (v.label.length * 0.62))), o.ink, { groupId: hg }))

  const colW = Math.min(COL_MAX, (END - right - GAP * (n - 1)) / n)
  const x0 = END - n * colW - GAP * (n - 1)
  const chartName = `#${v.player.jersey} ${[v.player.firstName, v.player.lastName.toUpperCase()].filter(Boolean).join(' ')}`
  const style = { ...o.style, scope: 'player' as const, name: true, stats: true }
  conditions.forEach((c, i) => {
    const x = x0 + i * (colW + GAP), plays = v.attacks.filter(a => inCondition(a, c))
    out.push(words(x + colW / 2, TAG_Y, `${CONDITION_NAMES[c]}  n ${plays.length}`, 16, '#FFFFFF', { align: 'center', box: { fill: CONDITION_COLORS[c], fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 4, radius: 4, width: colW } }))
    // Where their sets were given (set chart, as the rotation slide draws it: discs and a key).
    const setH = Math.min(SET_MAX, (colW * PW) / setChartWidth(PH)), setW = (setChartWidth(setH * PH)) / PW
    const sc = attackerSetChart(plays.map(attack => ({ attack, set: v.setOf.get(attack) ?? null })))
    if (sc) setCharts.push({ chart: sc, x: x + (colW - setW) / 2, y: SET_Y, h: setH, rich: true })
    else out.push(words(x + colW / 2, SET_Y + setH / 2 - 0.015, 'No sets', 14, '#94A3B8', { align: 'center', bold: false }))
    // The direction chart with its name and numbers, as large as the column takes.
    const y = SET_Y + setH + 0.012, h = Math.min(0.985 - y, (colW * PW) / (chartWidth(PH, true)))
    const w = (chartWidth(h * PH, true)) / PW, cx = x + (colW - w) / 2
    if (!plays.length) { out.push(words(x + colW / 2, y + h / 2, 'No attacks', 14, '#94A3B8', { align: 'center', bold: false })); return }
    const chart = directionChart(plays[0], style, () => plays, { name: chartName })
    charts.push({ chart, x: cx, y, h })
    // Where most of these landed, ringed in red over the chart.
    const spot = hotSpot(chart.dots.flatMap(d => (d.end && d.end.y > 0.5 ? [{ u: d.end.x, v: d.end.y }] : [])))
    if (spot) {
      const court = chartCourt({ x: cx * PW, y: y * PH, h: h * PH }, true), r = (1.6 / 9) * court.w
      const px = court.left + spot.u * court.w, py = court.top + spot.v * 2 * court.w
      out.push({ id: uid(), kind: 'circle', color: RING, width: 0, x: (px - r) / PW, y: (py - r) / PH, w: (2 * r) / PW, h: (2 * r) / PH, fill: RING, fillOpacity: 0.3 })
    }
  })
  return { annotations: out, charts, setCharts }
}
