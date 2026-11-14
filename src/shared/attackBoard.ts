// An attacker's slide, to set the defence against them: their name large at the top left; on the left a
// half court in perspective, seen from behind our own end line, with the attacker over the net where
// they mostly hit from, the two cones (of five) most of their attacks went into, where most landed in orange,
// and (if asked) our blockers and diggers as discs to move into place; on the right, a column per
// condition (the pass before the attack, or transition): where the sets to them were given, then
// their direction chart with its numbers (hard / soft / tip, K E B Att, K% ERR%, Pos Neg), where most
// landed ringed in red. Everything but the charts is objects the slide editor moves and restyles, so
// arrows and notes are drawn on by hand. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { chartCourt, chartWidth, type ChartStyle } from './chart'
import { attackCones, coneSpan, directionChart, type PlacedSetChart } from './court'
import { homography, project, type CourtFit } from './courtGeometry'
import { discOutline } from './disc'
import { mix } from './overlayDraw'
import { NUMBER_FONT, attackLine, type TeamPt } from './rotationBoard'
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

// A column of the slide: its name and colour, and the attacks it keeps.
export interface AttackColumn { label: string; color: string; keep: (p: Play) => boolean }
export const conditionColumn = (c: AttackCondition): AttackColumn => ({ label: CONDITION_NAMES[c], color: CONDITION_COLORS[c], keep: p => inCondition(p, c) })
// Or the attacks of some attack codes (a middle's quicks, say), named short: "A Quick" by its letter, else the code.
export const attackCode = (p: Pick<Play, 'code'>) => p.code.slice(6, 8).toUpperCase()
export const shortCodeName = (code: string, name = '') => /^\s*(\S+)\s+quick\s*$/i.exec(name)?.[1] ?? code
const CODE_COLORS = ['#2563EB', '#D97706', '#475569']
export const codeColumn = (codes: string[], names: Record<string, string>, i: number): AttackColumn =>
  ({ label: codes.map(c => shortCodeName(c, names[c])).join(','), color: CODE_COLORS[i % CODE_COLORS.length], keep: p => codes.includes(attackCode(p)) })

// A middle's columns to start with: the quicks by the setter (A and C, in front and behind), then the
// rest of their codes; without those, their most used code, then the rest. codes: most used first.
export function defaultCodeGroups(codes: string[], names: Record<string, string>): string[][] {
  const near = codes.filter(c => /^[AC]$/i.test(shortCodeName(c, names[c])))
  const first = near.length ? near : codes.slice(0, 1)
  return [first, codes.filter(c => !first.includes(c))].filter(g => g.length)
}

// A middle hits by the setter, and is defended with three blockers: a middle blocker, or a player
// most of whose attacks come from zone 3.
export type AttackLayout = 'side' | 'middle'
export function attackLayoutOf(player: Pick<Player, 'role'>, attacks: Pick<Play, 'startZone'>[]): AttackLayout {
  if (player.role) return player.role === 'MB' ? 'middle' : 'side'
  return attacks.filter(a => a.startZone === 3).length * 2 > attacks.length ? 'middle' : 'side'
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
  columns: AttackColumn[]
  sets: boolean // where the sets were given, over each column's chart
  layout: AttackLayout // how our defence stands
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
const TOP_CONES = 2, DISC_R = 0.45 // the cones shown; a player's disc, its radius in metres
const COURT_SCALE = 0.93 // the court's size against its corners above
// The diggers (u across the picture, v along) against an attack on the picture's left (zone 2 or 1),
// and against a middle.
const SIDE_DIGGERS: [number, number][] = [[0.1, 0.915], [0.82, 0.89], [0.485, 0.945]]
const MIDDLE_DIGGERS: [number, number][] = [[0.17, 0.78], [0.85, 0.8], [0.5, 0.93]]

// The court, the net, the attacker and what their attacks did, as objects on the slide.
function courtSide(v: AttackSlideData, defense: boolean, layout: AttackLayout, corners: CourtFit['corners']): Annotation[] {
  const H = homography(corners), out: Annotation[] = [], g = uid()
  const at = (u: number, w: number): [number, number] => { const q = project(H, u, w); return [q.x, q.y] }
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
  // The court tab's cones (court.ts attackCones): five equal angles from where they hit, sideline to
  // sideline; the two most hit, each over our half with its share, the stronger the more.
  const cones = attackCones({ corners } as CourtFit, lines.map(l => ({ start: { x: 1 - l.from.u, y: l.from.v }, end: { x: 1 - l.to.u, y: l.to.v } })))
  if (cones) {
    const top = cones.shares.map((share, i) => ({ share, i })).filter(c => c.share > 0).sort((a, b) => b.share - a.share).slice(0, TOP_CONES)
    for (const { share, i } of top) {
      const from = cones.rays[i], to = cones.rays[i + 1], steps = 16
      const spans = Array.from({ length: steps + 1 }, (_, k) => coneSpan(cones, from + ((to - from) * k) / steps)).filter(x => !!x)
      if (spans.length < 2) continue
      const cg = uid(), show = (p: { x: number; y: number }) => at(p.x, p.y)
      out.push({ id: uid(), kind: 'polygon', color: CONE, width: 2.5, points: [...spans.map(x => show(x[0])), ...spans.map(x => show(x[1])).reverse()], fill: CONE, fillOpacity: 0.08 + 0.2 * (share / top[0].share), groupId: cg })
      const mid = coneSpan(cones, (from + to) / 2)
      if (mid) {
        const [x, y] = show({ x: mid[0].x + (mid[1].x - mid[0].x) * 0.62, y: mid[0].y + (mid[1].y - mid[0].y) * 0.62 })
        out.push(words(x, y - 0.02, `${Math.round(share * 100)}%`, 24, '#FFFFFF', { align: 'center', groupId: cg, font: NUMBER_FONT, box: { fill: CONE, fillOpacity: 0.95, stroke: null, strokeWidth: 0, padding: 3, radius: 4 } }))
      }
    }
  }

  // A player as a ball on the floor, lit from the top left, its shadow under it.
  const disc = (u: number, w: number, fill: string, label: string) => {
    const gg = uid(), ring = discOutline(corners, { u, v: w, r: DISC_R, z: 0 }).top, [cx, fy] = at(u, w)
    const xs = ring.map(q => q[0]), d = (Math.max(...xs) - Math.min(...xs)) * PW, cy = fy * PH - d * 0.42
    out.push({ id: uid(), kind: 'polygon', color: '#000000', width: 0, points: discOutline(corners, { u, v: w + 0.005, r: 0.47, z: 0 }).top, fill: '#2A1708', fillOpacity: 0.32, groupId: gg })
    out.push({ id: uid(), kind: 'circle', color: mix(fill, '#000000', 0.45), width: 1.5, x: cx - d / 2 / PW, y: (cy - d / 2) / PH, w: d / PW, h: d / PH, fill, fillOpacity: 1, shade: 'ball', groupId: gg })
    if (label) out.push(words(cx, (cy - d * 0.27) / PH, label, Math.round(d * 0.45), light(fill) ? '#0F172A' : '#FFFFFF', { align: 'center', groupId: gg, font: NUMBER_FONT }))
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
  const apexU = cones ? cones.apex.x : 0.8
  if (cones) disc(apexU, Math.min(0.48, cones.apex.y), ATTACKER, String(v.player.jersey))
  // Ours in front of the net, nearer ones over farther ones. Against a side attacker a two-player
  // block shoulder to shoulder (the discs touching) in front of them, the diggers as set out for an
  // attack from zone 2 or 1 (on the picture's left), turned round for one from zone 4. Against a
  // middle three blockers spread along the net, the middle one in front of them, and three diggers.
  if (defense) {
    const blockV = 0.5 + (DISC_R + 0.15) / 18
    if (layout === 'middle') {
      for (const u of [0.2, Math.min(0.67, Math.max(0.33, apexU)), 0.8]) disc(u, blockV, BLOCKER, '')
      for (const [u, w] of MIDDLE_DIGGERS) disc(u, w, DIGGER, '')
    } else {
      const half = DISC_R / 9, mid = Math.min(1 - half, Math.max(half, apexU)), left = apexU < 0.5
      for (const du of [-half, half]) disc(mid + du, blockV, BLOCKER, '')
      for (const [u, w] of [...SIDE_DIGGERS].sort((a, b) => a[1] - b[1])) disc(left ? u : 1 - u, w, DIGGER, '')
    }
  }
  return out
}
const light = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 }

// The right side: from the court to the edge, a column per condition.
const END = 0.988, GAP = 0.012, COL_MAX = 0.165, TAG_Y = 0.012, SET_Y = 0.058, SET_MAX = 0.29

export function attackSlide(v: AttackSlideData, o: AttackSlideOptions): { annotations: Annotation[]; charts: PlacedChart[]; setCharts: PlacedSetChart[] } {
  const out: Annotation[] = [], charts: PlacedChart[] = [], setCharts: PlacedSetChart[] = []
  const columns = o.columns.length ? o.columns : ATTACK_CONDITIONS.slice(0, 2).map(conditionColumn), n = columns.length
  const scale = COURT_SCALE * (n >= 3 ? 0.8 : 1), corners = courtAt(scale), right = Math.max(...corners.map(c => c.x)) + 0.02
  out.push(...courtSide(v, o.defense, o.layout, corners))
  // The heading: the number and name large, underlined; what the attacks are kept to under it.
  const hg = uid(), name = `#${v.player.jersey} ${v.player.lastName.toUpperCase()}`, size = Math.min(60, Math.floor((0.55 * PW) / (name.length * 0.68)))
  out.push(words(0.02, 0.012, name, size, o.ink, { groupId: hg }))
  out.push({ id: uid(), kind: 'polyline', color: o.ink, width: 4, points: [[0.022, 0.012 + (size * 1.22) / PH], [0.022 + (name.length * size * 0.66) / PW, 0.012 + (size * 1.22) / PH]], groupId: hg })
  out.push(words(0.022, 0.03 + (size * 1.3) / PH, v.label, Math.min(30, Math.floor(((right - 0.05) * PW) / (v.label.length * 0.62))), o.ink, { groupId: hg }))

  // Under set charts a column is at most COL_MAX wide; without them, as wide as a chart the slide's height.
  const most = o.sets ? COL_MAX : chartWidth((0.985 - SET_Y) * PH, true) / PW
  const colW = Math.min(most, (END - right - GAP * (n - 1)) / n)
  const x0 = END - n * colW - GAP * (n - 1)
  const chartName = `#${v.player.jersey} ${[v.player.firstName, v.player.lastName.toUpperCase()].filter(Boolean).join(' ')}`
  const style = { ...o.style, scope: 'player' as const, name: true, stats: true }
  columns.forEach((c, i) => {
    const x = x0 + i * (colW + GAP), plays = v.attacks.filter(c.keep)
    out.push(words(x + colW / 2, TAG_Y, `${c.label}  n ${plays.length}`, 16, '#FFFFFF', { align: 'center', box: { fill: c.color, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 4, radius: 4, width: colW } }))
    // Where their sets were given (set chart, as the rotation slide draws it: discs and a key).
    const setH = o.sets ? Math.min(SET_MAX, (colW * PW) / setChartWidth(PH)) : 0, setW = (setChartWidth(setH * PH)) / PW
    const sc = o.sets ? attackerSetChart(plays.map(attack => ({ attack, set: v.setOf.get(attack) ?? null }))) : null
    if (sc) setCharts.push({ chart: sc, x: x + (colW - setW) / 2, y: SET_Y, h: setH, rich: true })
    else if (o.sets) out.push(words(x + colW / 2, SET_Y + setH / 2 - 0.015, 'No sets', 14, '#94A3B8', { align: 'center', bold: false }))
    // The direction chart with its name and numbers, as large as the column takes.
    const y = SET_Y + setH + (o.sets ? 0.012 : 0), h = Math.min(0.985 - y, (colW * PW) / (chartWidth(PH, true)))
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
