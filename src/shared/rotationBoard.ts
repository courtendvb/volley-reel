// A rotation's slide: one of a team's six rotations (P1–P6, the setter's position) with its setter's
// side-out. Big "P2" at the top left; the court in perspective with the side-out distribution after a #,
// + or ! reception, each spiker's usual course, and the six players in the serve-receive formation of
// the rotation, in the team's colour; on the right, the distribution after each
// reception (# / + / !) and after a # or + reception for the two setter calls used most, as small
// tables. Made of objects the slide editor moves and restyles. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { setterCall } from './setChart'
import { splitSets, type SetPlace, type SetSplit, type SetterSet, type SetView } from './setterBoard'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'
import { homography, project, type CourtFit } from './courtGeometry'
import { discOutline, discShapes } from './disc'
import { mix } from './overlayDraw'

export const ROTATIONS = [1, 6, 5, 4, 3, 2] // the order a team rotates

const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
type TextBox = NonNullable<Text['box']>
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

// ---- where the players stand ----------------------------------------------------------------
// Points in the team's own frame, as the DVW clicks are: u across from the team's left, v from its
// own end line (0) to the net (0.5) and on to the other end line (1).
export interface TeamPt { u: number; v: number }

// A zone's middle in that frame: the team's own zones on its half, the other team's beyond the net.
const OWN = [[5, 6, 1], [7, 8, 9], [4, 3, 2]] // rows from the own end line toward the net, left to right
const OPP = [[2, 3, 4], [9, 8, 7], [1, 6, 5]] // rows from the net toward the far end line
// sub: the coded sub-zone (own half: A back right, B front right, C front left, D back left) puts it
// in that quarter of the zone.
function zoneMiddle(z: number | null, own: boolean, sub?: string | null): TeamPt | null {
  if (z === null) return null
  const rows = own ? OWN : OPP
  for (const [r, row] of rows.entries()) {
    const c = row.indexOf(z)
    if (c < 0) continue
    const q = own ? sub?.toUpperCase() : undefined
    const du = q === 'A' || q === 'B' ? 1 / 12 : q === 'C' || q === 'D' ? -1 / 12 : 0, dv = q === 'B' || q === 'C' ? 1 / 24 : q === 'A' || q === 'D' ? -1 / 24 : 0
    return { u: (c + 0.5) / 3 + du, v: (own ? r : r + 3) / 6 + 1 / 12 + dv }
  }
  return null
}
const mean = (ps: TeamPt[]): TeamPt => ({ u: ps.reduce((a, p) => a + p.u, 0) / ps.length, v: ps.reduce((a, p) => a + p.v, 0) / ps.length })

// One of the side-out team's players as it lines up to receive in a rotation. libero: not in the
// lineup (a libero); setter: the setter, who doesn't pass.
export interface FormationSpot { jersey: number; role?: PlayerRole; libero?: boolean; setter?: boolean; at: TeamPt; receives: boolean }

// The serve receive almost every team plays in a 5-1: three passers (the two outside hitters and the
// libero) across the court about 6–7 m from the net, the setter by the net or behind a front
// player ready to run in, the opposite and the front middle by the net out of the way, all within the
// overlap rule. By the setter's zone (the rotation), then by the player's place in the rotation order
// after the setter: setter, outside 1, middle 1, opposite, outside 2, middle 2 (the back row's middle
// is the libero). In the team's frame (u from its left, v from its end line to the net at 0.5).
const RECEIVE: Record<number, [number, number][]> = {
  1: [[0.9, 0.07], [0.8, 0.2], [0.45, 0.45], [0.1, 0.45], [0.2, 0.17], [0.5, 0.15]],
  6: [[0.64, 0.27], [0.82, 0.15], [0.9, 0.45], [0.6, 0.45], [0.18, 0.2], [0.45, 0.14]],
  5: [[0.3, 0.3], [0.5, 0.14], [0.82, 0.15], [0.9, 0.45], [0.18, 0.21], [0.08, 0.45]],
  4: [[0.38, 0.45], [0.18, 0.17], [0.5, 0.14], [0.92, 0.07], [0.82, 0.2], [0.58, 0.45]],
  3: [[0.6, 0.45], [0.18, 0.2], [0.45, 0.14], [0.66, 0.05], [0.84, 0.14], [0.9, 0.45]],
  2: [[0.9, 0.45], [0.25, 0.2], [0.08, 0.45], [0.08, 0.06], [0.5, 0.14], [0.82, 0.15]],
}

// The team's libero in a rotation: of the players not in the lineup, the one with the most receptions
// there (else in any rotation); one the DVW calls a libero first.
function liberoOf(dvws: ParsedDVW[], team: string, r: number, lineup: Lineup): number | null {
  const n = new Map<number, { here: number; all: number; libero: boolean }>()
  for (const d of dvws) {
    const i = d.teams.findIndex(t => t.code.toUpperCase() === team.toUpperCase())
    if (i < 0) continue
    const side = i === 0 ? '*' : 'a'
    for (const p of d.plays) {
      if (p.side !== side || p.skill !== 'R' || lineup.jerseys.includes(p.jersey)) continue
      const had = n.get(p.jersey) ?? { here: 0, all: 0, libero: d.players[`${side}${p.jersey}`]?.role === 'L' }
      had.all++
      if ((side === '*' ? p.homeRot : p.awayRot) === r) had.here++
      n.set(p.jersey, had)
    }
  }
  const top = [...n.entries()].sort((a, b) => +b[1].libero - +a[1].libero || b[1].here - a[1].here || b[1].all - a[1].all)[0]
  return top ? top[0] : null
}

// Where the lineup stands to receive in rotation r (the setter's zone; where the lineup has the
// setter elsewhere, that zone), in the standard formation above.
export function rotationFormation(dvws: ParsedDVW[], team: string, r: number, lineup: Lineup | null, setter: string): FormationSpot[] {
  if (!lineup || lineup.jerseys.length !== 6) return []
  const at = lineup.players.findIndex(p => p?.key === setter), sz = at >= 0 ? at + 1 : r
  const libero = liberoOf(dvws, team, r, lineup)
  return RECEIVE[sz].map(([u, v], d) => {
    const zone = ((sz - 1 + d) % 6) + 1, k = zone - 1, jersey = lineup.jerseys[k], role = lineup.players[k]?.role
    const spot = { u, v }
    if ((d === 2 || d === 5) && (zone === 1 || zone >= 5)) // the back row's middle: the libero comes on
      return libero !== null ? { jersey: libero, libero: true, at: spot, receives: true } : { jersey, ...(role ? { role } : {}), at: spot, receives: false }
    return { jersey, ...(role ? { role } : {}), ...(d === 0 ? { setter: true } : {}), at: spot, receives: d === 1 || d === 4 }
  })
}

// An attack's line in the team's frame: from where it was hit to where it went, by the clicks, else
// by the zones' middles.
export function attackLine(a: Play): { from: TeamPt; to: TeamPt } | null {
  const from = a.startClick ?? zoneMiddle(a.startZone, true), to = a.endClick ?? zoneMiddle(a.endZone, false)
  return from && to && to.v > 0.5 ? { from, to } : null
}

// ---- the court in perspective ---------------------------------------------------------------
// The whole court seen from behind the near end line, as a camera would: the side-out team on the far
// half (its left on the picture's right), attacking toward us. Picture points (0..1) of the court's
// corners: far end line left / right, near end line left / right.
export const COURT: CourtFit['corners'] = [{ x: 0.135, y: 0.19 }, { x: 0.545, y: 0.19 }, { x: 0.025, y: 0.975 }, { x: 0.655, y: 0.975 }]
// The team's frame on the picture: across turned round, along as is (its own end line is the far one).
const onPicture = (H: ReturnType<typeof homography>) => (p: TeamPt): [number, number] => { const q = project(H, 1 - p.u, p.v); return [q.x, q.y] }

const PLACE_COLOR: Partial<Record<SetPlace, string>> = { left: '#2563EB', middle: '#16A34A', right: '#DC2626', pipe: '#7C3AED' }
const COURT_W = 9, COURT_L = 18

// A cone for one place's attacks: from where they were hit (their mean) over the directions they went
// (the middle 80% of them) to as far as most of them went. Null without lines to draw it from.
export function attackCone(lines: { from: TeamPt; to: TeamPt }[]): { apex: TeamPt; from: number; to: number; reach: number } | null {
  if (!lines.length) return null
  const apex = mean(lines.map(l => l.from))
  const ang = lines.map(l => Math.atan2((l.to.u - l.from.u) * COURT_W, (l.to.v - l.from.v) * COURT_L)).sort((a, b) => a - b)
  const dist = lines.map(l => Math.hypot((l.to.u - apex.u) * COURT_W, (l.to.v - apex.v) * COURT_L)).sort((a, b) => a - b)
  const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(f * (xs.length - 1))))]
  let lo = q(ang, 0.1), hi = q(ang, 0.9)
  const min = 0.09 // at least ~10 degrees wide
  if (hi - lo < min) { const m = (lo + hi) / 2; lo = m - min / 2; hi = m + min / 2 }
  return { apex, from: lo, to: hi, reach: q(dist, 0.85) }
}

// A spiker's usual course: of their attacks, the most that went within ~20 degrees of each other, as
// a cone over those. Null without lines.
const COURSE = 0.35 // radians
export function mainCourse(lines: { from: TeamPt; to: TeamPt }[]): ReturnType<typeof attackCone> {
  const angle = (l: { from: TeamPt; to: TeamPt }) => Math.atan2((l.to.u - l.from.u) * COURT_W, (l.to.v - l.from.v) * COURT_L)
  const sorted = [...lines].sort((a, b) => angle(a) - angle(b))
  let best: typeof lines = []
  for (let i = 0; i < sorted.length; i++) {
    const run = sorted.slice(i).filter(l => angle(l) - angle(sorted[i]) <= COURSE)
    if (run.length > best.length) best = run
  }
  return attackCone(best)
}

// Light or dark: which text reads on a fill.
const light = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 }
const FLOOR = '#2B4A6F', COURT_FILL = '#E7C89C', FRONT_FILL = '#DDB784', PLANK = '#8A5A2B', LINE = '#FFFFFF'
const BLOCKER = '#CBD5E1'
export const TEAM_COLOR = '#1D4ED8' // a team without a colour of its own

// The main colour of a picture (a team's logo), from its RGBA pixels: the most common strong colour,
// leaving out see-through, white, black and grey pixels. Null when it has none.
export function mainColor(px: ArrayLike<number>): string | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b)
    if (px[i + 3] < 128 || hi < 40 || (hi - lo) / hi < 0.35) continue
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5), had = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    had.n++; had.r += r; had.g += g; had.b += b
    bins.set(k, had)
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]
  if (!top) return null
  const hex = (v: number) => Math.round(v / top.n).toString(16).padStart(2, '0')
  return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`
}

// The court, the net, the side-out team's players in their serve-receive formation (in the team's
// colour, the libero in white), the other team's three blockers at the net, a cone for each spiker's
// usual course in this rotation, each place's share beyond the net over where it is hit from, and
// the dumps by the setter.
function courtView(so: SetterSet[], formation: FormationSpot[], teamColor: string): Annotation[] {
  const H = homography(COURT), at = (u: number, v: number): [number, number] => { const q = project(H, u, v); return [q.x, q.y] }
  const team = onPicture(H), out: Annotation[] = [], g = uid()
  const poly = (pts: [number, number][], fill: string | null, o: Partial<Extract<Annotation, { kind: 'polygon' }>> = {}): Annotation =>
    ({ id: uid(), kind: 'polygon', color: '#FFFFFF', width: 0, points: pts, fill, fillOpacity: 1, groupId: g, ...o })
  const line = (a: [number, number], b: [number, number], width: number, color = LINE, o: { opacity?: number; dash?: 'dash' } = {}): Annotation =>
    ({ id: uid(), kind: 'polyline', color, width, points: [a, b], groupId: g, ...o })
  // Floor and court: the free zone, the court in wood with its planks, the front zones a shade
  // darker, and the lines (the centre line, the attack lines and their dashes out of court).
  out.push(poly([at(-0.07, -0.035), at(1.07, -0.035), at(1.07, 1.03), at(-0.07, 1.03)], FLOOR))
  out.push(poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], COURT_FILL))
  out.push(poly([at(0, 1 / 3), at(1, 1 / 3), at(1, 2 / 3), at(0, 2 / 3)], FRONT_FILL))
  for (let i = 1; i < 24; i++) out.push(line(at(i / 24, 0), at(i / 24, 1), 1, PLANK, { opacity: 0.14 }))
  out.push(poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], null, { color: LINE, width: 3 }))
  for (const v of [1 / 3, 2 / 3]) out.push(line(at(0, v), at(1, v), 2.5), line(at(-0.07, v), at(0, v), 1.5, LINE, { dash: 'dash' }), line(at(1, v), at(1.07, v), 1.5, LINE, { dash: 'dash' }))
  out.push(line(at(0, 0.5), at(1, 0.5), 3))
  // Cones: each spiker's usual course (of two attacks or more), in the colour of where they mostly hit
  // from; the stronger the more of the side-out they took. Their number at the cone's far end.
  const total = so.length || 1, sp = splitSets(so)
  const bySpiker = new Map<string, SetterSet[]>()
  for (const s of so) if (s.place !== 'dump') bySpiker.set(s.attack.playerKey, [...(bySpiker.get(s.attack.playerKey) ?? []), s])
  const tips: Annotation[] = []
  for (const list of [...bySpiker.values()].filter(l => l.length >= 2).sort((a, b) => a.length - b.length)) {
    const c = mainCourse(list.flatMap(s => { const l = attackLine(s.attack); return l ? [l] : [] }))
    if (!c) continue
    const places = new Map<SetPlace, number>()
    for (const s of list) places.set(s.place, (places.get(s.place) ?? 0) + 1)
    const place = [...places.entries()].sort((a, b) => b[1] - a[1])[0][0], color = PLACE_COLOR[place] ?? '#0F172A'
    const steps = 14, rim: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const a = c.from + ((c.to - c.from) * i) / steps
      rim.push(team({ u: c.apex.u + (Math.sin(a) * c.reach) / COURT_W, v: c.apex.v + (Math.cos(a) * c.reach) / COURT_L }))
    }
    const share = list.length / total
    out.push(poly([team(c.apex), ...rim], color, { fillOpacity: 0.28 + 0.4 * share, color: mix(color, '#000000', 0.25), width: 1.5 }))
    const mid = rim[steps >> 1]
    tips.push(words(mid[0], mid[1] + 0.006, `#${list[0].attack.jersey}`, 12, '#FFFFFF', { align: 'center', groupId: g, box: { fill: mix(color, '#000000', 0.2), fillOpacity: 0.95, stroke: null, strokeWidth: 0, padding: 2, radius: 3 } }))
  }
  out.push(...tips)
  // The players: a shadow on the floor, then the disc; the far ones first so nearer ones cover them.
  const corners = COURT, rimColor = mix(teamColor, '#000000', 0.45)
  const disc = (p: [number, number], fill: string, rim: string, label: string, ink: string) => {
    const gg = uid(), f = invert(H, p)
    out.push({ id: uid(), kind: 'polygon', color: '#000000', width: 0, points: discOutline(corners, { u: f.u + 0.004, v: f.v + 0.006, r: 0.6, z: 0 }).top, fill: '#000000', fillOpacity: 0.28, groupId: gg })
    const [side, top] = discShapes(corners, { u: f.u, v: f.v, r: 0.5, z: 0.3 }, { color: rim, fill, fillOpacity: 1, width: 1.5 }, { side: uid(), top: uid(), group: gg })
    out.push(side, top)
    if (!label) return
    const pts = top.kind === 'polygon' ? top.points : [], cx = pts.reduce((a, q) => a + q[0], 0) / (pts.length || 1), cy = pts.reduce((a, q) => a + q[1], 0) / (pts.length || 1)
    out.push(words(cx, cy - 10 / 720, label, 16, ink, { align: 'center', groupId: gg }))
  }
  for (const s of [...formation].sort((a, b) => a.at.v - b.at.v)) {
    const p = team({ u: Math.min(1, Math.max(0, s.at.u)), v: Math.min(0.49, Math.max(0.02, s.at.v)) })
    if (s.libero) disc(p, '#FFFFFF', teamColor, String(s.jersey), teamColor)
    else disc(p, teamColor, rimColor, String(s.jersey), light(teamColor) ? '#0F172A' : '#FFFFFF')
  }
  // The net: posts, a see-through mesh, the white tape along its top and the cable at its foot, and
  // the antennas over the sidelines.
  const [nl, nr] = [at(-0.05, 0.5), at(1.05, 0.5)], up = 0.12, low = 0.03, netTop = nl[1] - up
  out.push(poly([[nl[0], netTop], [nr[0], netTop], [nr[0], nr[1] - low], [nl[0], nl[1] - low]], '#0F172A', { fillOpacity: 0.16 }))
  for (let i = 1; i < 30; i++) { const x = nl[0] + ((nr[0] - nl[0]) * i) / 30; out.push(line([x, netTop], [x, nl[1] - low], 1, '#0F172A', { opacity: 0.22 })) }
  for (let i = 1; i < 4; i++) { const y = netTop + ((up - low) * i) / 4; out.push(line([nl[0], y], [nr[0], y], 1, '#0F172A', { opacity: 0.18 })) }
  out.push(line([nl[0], netTop], [nr[0], netTop], 5, '#FFFFFF'), line([nl[0], nl[1] - low], [nr[0], nr[1] - low], 1.5, '#F8FAFC'))
  // Each place's share in a row hung on the net's tape, each over where it is hit from across the court: Z2/1 on the team's right, the quick right
  // of the middle, Pipe left of it (from the back), Z4 on the team's left. A tab in the place's colour
  // with its name, the share beside it.
  const LABEL: [SetPlace, number][] = [['right', 0.86], ['middle', 0.62], ['pipe', 0.38], ['left', 0.14]]
  const tw = 0.04, nw = 0.056, bh = 0.042, by = netTop - bh / 2
  for (const [k, u] of LABEL) {
    const [cx] = team({ u, v: 0.5 }), x0 = cx - (tw + nw) / 2, gg = uid(), color = PLACE_COLOR[k]!
    const box = (fill: string, w: number, o: Partial<TextBox> = {}): TextBox => ({ fill, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 3, radius: 5, width: w, height: bh, ...o })
    out.push(words(x0 + (tw + nw) / 2 + 0.003, by + 0.005, ' ', 22, '#000000', { align: 'center', groupId: gg, box: box('#000000', tw + nw, { fillOpacity: 0.3 }) }))
    out.push(words(x0 + tw + nw / 2, by, pct(sp.by[k].n, total), 22, '#0F172A', { align: 'center', groupId: gg, box: box('#FFFFFF', nw, { stroke: color, strokeWidth: 2 }) }))
    out.push(words(x0 + tw / 2, by, PLACE_LABEL[k], 12, '#FFFFFF', { align: 'center', groupId: gg, box: box(color, tw) }))
  }
  for (const u of [0, 1]) {
    const [x, y] = at(u, 0.5)
    for (let i = 0; i < 5; i++) out.push(line([x, y - up - i * 0.014], [x, y - up - (i + 1) * 0.014], 3, i % 2 ? '#FFFFFF' : '#DC2626'))
  }
  for (const p of [nl, nr]) out.push({ id: uid(), kind: 'rect', color: '#1E293B', x: p[0] - 0.006, y: p[1] - up - 0.02, w: 0.012, h: up + 0.05, width: 1, fill: '#475569', fillOpacity: 1, groupId: g })
  // The other team's front row at the net: three blockers, plain.
  for (const u of [0.2, 0.5, 0.8]) disc(at(u, 0.535), BLOCKER, '#94A3B8', '', '')
  const setter = formation.find(s => s.setter)
  const [sx, sy] = team(setter?.at ?? { u: 0.62, v: 0.46 })
  out.push(words(sx + 0.042, sy - 0.04, `SD ${pct(sp.by.dump.n, total)}`, 13, '#0F172A', { groupId: g, box: { fill: '#FACC15', fillOpacity: 0.95, stroke: null, strokeWidth: 0, padding: 3, radius: 3 } }))
  return out
}

// A picture point back to court units (the homography's inverse, by solving its 2×2 system).
function invert(H: ReturnType<typeof homography>, p: [number, number]): { u: number; v: number } {
  // x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (g u + h v + 1)
  const { a, b, c, d, e, f, g, h } = H, [x, y] = p
  const m11 = a - g * x, m12 = b - h * x, m21 = d - g * y, m22 = e - h * y, r1 = x - c, r2 = y - f
  const det = m11 * m22 - m12 * m21
  return { u: (r1 * m22 - m12 * r2) / det, v: (m11 * r2 - r1 * m21) / det }
}

export interface RotationSlideData {
  rotation: number
  team: string
  setter: Player
  sets: SetterSet[] // the setter's, every rotation
  formation: FormationSpot[]
  callNames?: Record<string, string>
  teamColor?: string // the side-out team's colour, its players' discs
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
  out.push(...courtView(so, v.formation, v.teamColor ?? TEAM_COLOR))
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
