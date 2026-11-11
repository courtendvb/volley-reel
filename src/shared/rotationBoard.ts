// A rotation's slide: one of a team's six rotations (P1–P6, the setter's position) with its setter's
// side-out. Big "P2" at the top left; a half court with the side-out distribution after a #, + or !
// reception and the six players where the rotation puts them; on the right, the distribution after each
// reception (# / + / !) and after a # or + reception for the two setter calls used most, as small
// tables. Made of objects the slide editor moves and restyles. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { setterCall } from './setChart'
import { setCourt, splitSets, type SetPlace, type SetSplit, type SetterSet, type SetView } from './setterBoard'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'

export const ROTATIONS = [1, 6, 5, 4, 3, 2] // the order a team rotates

const ASPECT = 16 / 9
const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`
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
  const groupId = uid(), cw = w / 3, rh = 0.034, out: Annotation[] = []
  const cell = (c: number, r: number, text: string, o: { fill?: string; color?: string; bold?: boolean; span?: number; size?: number } = {}) => {
    const cwid = cw * (o.span ?? 1)
    out.push(words(x + c * cw + cwid / 2, y + r * rh, text, o.size ?? 14, o.color ?? '#0F172A', {
      align: 'center', bold: o.bold ?? false, groupId,
      box: { fill: o.fill ?? '#FFFFFF', fillOpacity: 1, stroke: '#94A3B8', strokeWidth: 1, padding: 3, width: cwid, height: rh },
    }))
  }
  cell(0, 0, title, { fill: head.fill, color: head.text, bold: true, span: 3, size: 15 })
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

// The rotation's players as discs with their numbers, in their places on the court drawn at (x, y),
// h tall, net at the top: the front row (P4 P3 P2) just above the net, the back row (P5 P6 P1) in the
// back third. Coloured by position.
function lineupDiscs(l: Lineup, x: number, y: number, h: number, groupId: string): Annotation[] {
  const w = h / ASPECT, d = Math.min(0.05, w / 5), dh = d * ASPECT, out: Annotation[] = []
  const place: [number, number, number][] = [[1, 5 / 6, 0.84], [2, 5 / 6, -0.09], [3, 1 / 2, -0.09], [4, 1 / 6, -0.09], [5, 1 / 6, 0.84], [6, 1 / 2, 0.84]] // P, u, v
  for (const [pos, u, v] of place) {
    const jersey = l.jerseys[pos - 1], role = l.players[pos - 1]?.role, cx = x + u * w, cy = y + v * h
    const fill = (role && ROLE_FILL[role]) || '#E2E8F0', dark = role === 'S' || !role
    out.push({ id: uid(), kind: 'circle', color: '#0F172A', x: cx - d / 2, y: cy - dh / 2, w: d, h: dh, width: 2, fill, fillOpacity: 1, groupId })
    out.push(words(cx, cy - (20 * 1.2) / 2 / 720, String(jersey), 20, dark ? '#0F172A' : '#FFFFFF', { align: 'center', groupId }))
  }
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

export function rotationSlide(v: RotationSlideData, view: SetView, ink: string): Annotation[] {
  const out: Annotation[] = [], rot = inRotation(v.sets, v.rotation), so = sideOut(rot)
  // The heading: the rotation large, underlined; the team and setter after it.
  const headGroup = uid()
  out.push(words(0.03, 0.015, `P${v.rotation}`, 72, ink, { groupId: headGroup }))
  out.push({ id: uid(), kind: 'polyline', color: ink, width: 4, points: [[0.03, 0.135], [0.13, 0.135]], groupId: headGroup })
  out.push(words(0.15, 0.04, `${v.team}  #${v.setter.jersey} ${v.setter.lastName.toUpperCase()}`, 22, ink, { groupId: headGroup }))
  const all = splitSets(so)
  out.push(words(0.15, 0.085, `Side-out (# + ! reception) · n ${all.total} · K ${pct(all.kills, all.total)} · ERR ${pct(all.errors, all.total)}`, 15, ink, { bold: false, groupId: headGroup }))
  // The court and the players in their places.
  const h = 0.7, w = h / ASPECT, cx = 0.06, cy = 0.255, courtGroup = uid()
  out.push(...setCourt({ title: '', sets: so }, cx, cy, h, view, ink, false, courtGroup))
  if (v.lineup) out.push(...lineupDiscs(v.lineup, cx, cy, h, courtGroup))
  // On the right: by reception, and by setter call.
  const colW = 0.19, gap = 0.012, x1 = cx + w + 0.06, x2 = x1 + colW + 0.02
  let y = 0.17
  const recs: [string, string, { fill: string; text: string }][] = [['#', '# pass', { fill: '#DBEAFE', text: '#0F172A' }], ['+', '+ pass', { fill: '#DCFCE7', text: '#0F172A' }], ['!', '! pass', { fill: '#FFEDD5', text: '#0F172A' }]]
  for (const [e, title, head] of recs) {
    const tb = table(title, head, splitSets(rot.filter(s => afterRec(s, e))), x1, y, colW)
    out.push(...tb.out); y += tb.h + gap
  }
  y = 0.17
  const heads = [{ fill: '#3B5BDB', text: '#FFFFFF' }, { fill: '#E03131', text: '#FFFFFF' }]
  topCalls(rot).forEach(({ call, sets }, i) => {
    const name = v.callNames?.[call]
    const tb = table(`CALL ${call}${name ? ` ${name}` : ''}`, heads[i], splitSets(sets), x2, y, colW)
    out.push(...tb.out); y += tb.h + gap
  })
  return out
}
