// A rotation's slide: one of a team's six rotations (P1–P6, the setter's position) with its setter's
// side-out. Big "P2" at the top left; a half court with the side-out distribution after a #, + or !
// reception and the six players where the rotation puts them; on the right, the distribution after each
// reception (# / + / !) and after a # or + reception for the two setter calls used most, as small
// tables. Made of objects the slide editor moves and restyles. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { setterCall } from './setChart'
import { splitSets, type SetPlace, type SetSplit, type SetterSet, type SetView } from './setterBoard'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'
import { homography, project, type CourtFit } from './courtGeometry'
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

// One of the side-out team's players as it lines up to receive in a rotation: where they received (the
// mean of their receptions there), the setter where they set from, the others at their spot in the
// rotation (the front row by the net, the back row deep). libero: not in the lineup (a libero).
export interface FormationSpot { jersey: number; role?: PlayerRole; libero?: boolean; at: TeamPt; receives: boolean }
const BASE: Record<number, TeamPt> = { 1: { u: 0.83, v: 0.12 }, 2: { u: 0.83, v: 0.44 }, 3: { u: 0.5, v: 0.44 }, 4: { u: 0.17, v: 0.44 }, 5: { u: 0.17, v: 0.12 }, 6: { u: 0.5, v: 0.12 } }
export function rotationFormation(dvws: ParsedDVW[], team: string, r: number, lineup: Lineup | null, setter: string): FormationSpot[] {
  const recs = new Map<string, { jersey: number; role?: PlayerRole; pts: TeamPt[] }>(), sets: TeamPt[] = []
  let total = 0
  for (const d of dvws) {
    const i = d.teams.findIndex(t => t.code.toUpperCase() === team.toUpperCase())
    if (i < 0) continue
    const side = i === 0 ? '*' : 'a'
    for (const p of d.plays) {
      if (p.side !== side || (side === '*' ? p.homeRot : p.awayRot) !== r) continue
      if (p.skill === 'E' && p.playerKey === setter && p.phase === 'r') {
        const at = p.startClick && p.startClick.v >= 0.3 && p.startClick.v <= 0.55 ? p.startClick : null
        if (at) sets.push(at)
      }
      if (p.skill !== 'R') continue
      const at = p.endClick && p.endClick.v >= -0.05 && p.endClick.v <= 0.5 ? p.endClick : zoneMiddle(p.endZone, true, p.endSub)
      if (!at) continue
      total++
      const k = `${p.jersey}`, had = recs.get(k) ?? { jersey: p.jersey, role: d.players[`${side}${p.jersey}`]?.role, pts: [] }
      had.pts.push(at)
      recs.set(k, had)
    }
  }
  // Receivers: a tenth of the receptions or more. The libero (who receives most, not in the lineup)
  // comes on for the back row's middle blocker who doesn't receive.
  const receivers = [...recs.values()].filter(x => x.pts.length >= 2 && x.pts.length >= total * 0.1)
  const libero = receivers.filter(x => !lineup?.jerseys.includes(x.jersey)).sort((a, b) => b.pts.length - a.pts.length)[0]
  const out: FormationSpot[] = []
  let liberoIn = false
  for (const [k, jersey] of (lineup?.jerseys ?? []).entries()) {
    const role = lineup?.players[k]?.role, rec = receivers.find(x => x.jersey === jersey)
    const isSetter = lineup?.players[k]?.key === setter, back = k === 0 || k === 4 || k === 5
    if (libero && !liberoIn && back && role === 'MB' && !rec) { out.push({ jersey: libero.jersey, libero: true, at: mean(libero.pts), receives: true }); liberoIn = true; continue }
    const at = rec ? mean(rec.pts) : isSetter && sets.length ? mean(sets) : isSetter ? { u: 0.62, v: 0.46 } : BASE[k + 1]
    out.push({ jersey, ...(role ? { role } : {}), at, receives: !!rec })
  }
  if (libero && !liberoIn) out.push({ jersey: libero.jersey, libero: true, at: mean(libero.pts), receives: true })
  return spread(out)
}

// Players standing on top of each other (the same zones) are moved apart across the court, at
// least ~1.5 m between them.
function spread(list: FormationSpot[]): FormationSpot[] {
  const out = list.map(s => ({ ...s, at: { ...s.at } }))
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i].at, b = out[j].at, du = (b.u - a.u) * 9, dv = (b.v - a.v) * 18
      if (Math.hypot(du, dv) >= 1.5) continue
      const push = (1.5 - Math.abs(du)) / 9 / 2 + 0.005, dir = du >= 0 ? 1 : -1
      a.u = Math.max(0.04, a.u - push * dir); b.u = Math.min(0.96, b.u + push * dir)
    }
  }
  return out
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
const LIBERO_FILL = '#F8FAFC'
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

// The court, the net, the side-out team's players where they line up, the other team's three
// blockers at the net, a cone for each place's attacks (from the data), each place's share large
// where it is hit from, and the dumps by the setter.
function courtView(so: SetterSet[], formation: FormationSpot[]): Annotation[] {
  const H = homography(COURT), at = (u: number, v: number): [number, number] => { const q = project(H, u, v); return [q.x, q.y] }
  const team = onPicture(H), out: Annotation[] = [], g = uid()
  const poly = (pts: [number, number][], fill: string, o: Partial<Extract<Annotation, { kind: 'polygon' }>> = {}): Annotation =>
    ({ id: uid(), kind: 'polygon', color: '#FFFFFF', width: 0, points: pts, fill, fillOpacity: 1, groupId: g, ...o })
  const line = (a: [number, number], b: [number, number], width: number, color = '#FFFFFF'): Annotation => ({ id: uid(), kind: 'polyline', color, width, points: [a, b], groupId: g })
  // Floor, court and lines: the centre line, and the attack lines 3 m each side.
  out.push(poly([at(-0.06, -0.03), at(1.06, -0.03), at(1.06, 1.02), at(-0.06, 1.02)], '#E9A8A8'))
  out.push(poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], '#F6C9C9', { width: 3 }))
  for (const v of [1 / 3, 2 / 3]) out.push(line(at(0, v), at(1, v), 2.5), line(at(-0.06, v), at(0, v), 1.5), line(at(1, v), at(1.06, v), 1.5))
  out.push(line(at(0, 0.5), at(1, 0.5), 3))
  // Cones: each place's attacks, see-through so they cross.
  const total = so.length || 1, sp = splitSets(so)
  for (const k of ['left', 'right', 'middle', 'pipe'] as SetPlace[]) {
    const c = attackCone(so.filter(s => s.place === k).flatMap(s => { const l = attackLine(s.attack); return l ? [l] : [] }))
    if (!c) continue
    const steps = 12, rim: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
      const a = c.from + ((c.to - c.from) * i) / steps
      rim.push(team({ u: c.apex.u + (Math.sin(a) * c.reach) / COURT_W, v: c.apex.v + (Math.cos(a) * c.reach) / COURT_L }))
    }
    out.push(poly([team(c.apex), ...rim], PLACE_COLOR[k]!, { fillOpacity: 0.3 + 0.4 * (sp.by[k].n / total) }))
  }
  // The far team's players (the near side's blockers come after the net, in front of it).
  const corners = COURT
  const disc = (p: [number, number], fill: string, label: string, dark: boolean) => {
    const gg = uid(), f = { u: 0, v: 0 }
    // Court units of the picture point (the disc stands on the floor there).
    const inv = invert(H, p); f.u = inv.u; f.v = inv.v
    const [side, top] = discShapes(corners, { u: f.u, v: f.v, r: 0.5, z: 0.3 }, { color: '#334155', fill, fillOpacity: 1, width: 1.5 }, { side: uid(), top: uid(), group: gg })
    out.push(side, top)
    if (!label) return
    const pts = top.kind === 'polygon' ? top.points : [], cx = pts.reduce((a, q) => a + q[0], 0) / (pts.length || 1), cy = pts.reduce((a, q) => a + q[1], 0) / (pts.length || 1)
    out.push(words(cx, cy - 10 / 720, label, 16, dark ? '#0F172A' : '#FFFFFF', { align: 'center', groupId: gg }))
  }
  // Back to front, so nearer discs cover farther ones.
  for (const s of [...formation].sort((a, b) => a.at.v - b.at.v)) {
    const fill = s.libero ? LIBERO_FILL : (s.role && ROLE_FILL[s.role]) || '#E2E8F0'
    disc(team({ u: Math.min(1, Math.max(0, s.at.u)), v: Math.min(0.49, Math.max(0.02, s.at.v)) }), fill, String(s.jersey), s.libero || s.role === 'S' || !s.role)
  }
  // The net: a band rising from the centre line, between two posts.
  const [nl, nr] = [at(-0.05, 0.5), at(1.05, 0.5)], up = 0.12
  out.push(poly([[nl[0], nl[1] - up], [nr[0], nr[1] - up], nr, nl], '#F8FAFC', { fillOpacity: 0.5, color: '#E2E8F0', width: 2 }))
  out.push(line([nl[0], nl[1] - up], [nr[0], nr[1] - up], 4, '#F8FAFC'), line(nl, nr, 3, '#F8FAFC'))
  for (const p of [nl, nr]) out.push({ id: uid(), kind: 'rect', color: '#7F1D1D', x: p[0] - 0.006, y: p[1] - up - 0.02, w: 0.012, h: up + 0.05, width: 1, fill: '#DC2626', fillOpacity: 1, groupId: g })
  // The other team's front row at the net: three blockers.
  for (const u of [0.2, 0.5, 0.8]) disc(at(u, 0.535), '#22C55E', '', false)
  // Each place's share where it is hit from: the front row's just this side of the net (the net hides
  // the far side's front), Pipe behind the far attack line; the dumps by the setter.
  const LABEL: Partial<Record<SetPlace, TeamPt>> = { left: { u: 0.17, v: 0.64 }, middle: { u: 0.5, v: 0.64 }, right: { u: 0.83, v: 0.64 }, pipe: { u: 0.5, v: 0.3 } }
  for (const k of ['left', 'middle', 'right', 'pipe'] as SetPlace[]) {
    const [lx, ly] = team(LABEL[k]!), gg = uid()
    out.push(words(lx, ly - 0.03, pct(sp.by[k].n, total), 36, '#0F172A', { align: 'center', groupId: gg,
      box: { fill: '#FFFFFF', fillOpacity: 0.72, stroke: null, strokeWidth: 0, padding: 4, radius: 4, width: 0.1, height: 0.064 } }))
    out.push(words(lx, ly + 0.036, PLACE_LABEL[k], 13, PLACE_COLOR[k]!, { align: 'center', groupId: gg }))
  }
  const setter = formation.find(s => s.role === 'S' && !s.receives)
  const [sx, sy] = team(setter?.at ?? { u: 0.62, v: 0.46 })
  out.push(words(sx + 0.025, sy - 0.17, `SD ${pct(sp.by.dump.n, total)}`, 13, '#0F172A', { groupId: g, box: { fill: '#FACC15', fillOpacity: 0.9, stroke: null, strokeWidth: 0, padding: 3, radius: 3 } }))
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
  out.push(...courtView(so, v.formation))
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
