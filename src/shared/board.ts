// A slide comparing players at a glance: for each column, a number coloured by position, a name, a photo
// and rates, with a direction chart of their serves or attacks. Made of objects the slide editor already
// moves and restyles (text, pictures, boxes), and charts placed on the slide (Slide.charts), so it can
// be finished by hand with arrows and notes. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { DEFAULT_CHART, chartWidth, type ChartDisplay, type ChartStyle, type DirectionChart } from './chart'
import { directionChart } from './court'
import { mix } from './overlayDraw'
import { setterCourts, setterSets, splitSets, type SetLayout, type SetterSet } from './setterBoard'
import { ROTATIONS, ROTATION_CHART, rotationFormation, rotationLineup, rotationSideOut, rotationSlide, type FormationSpot, type SideOutRate } from './rotationBoard'
import { setChart, type SetChart } from './setChart'
import { logoKey, serveTargetSlide, teamReceptions, type Received } from './serveTargetBoard'
import type { PlacedSetChart } from './court'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'

// E: a setter's sets, shown by where the attack after each came from; R: a rotation of the team, from its setter's sets;
// T: a team's receptions against the serves (serveTargetBoard.ts), its receivers as the columns
export type BoardSkill = 'S' | 'A' | 'E' | 'R' | 'T'
export interface PlacedChart { chart: DirectionChart; x: number; y: number; h: number } // the picture as 0..1

export interface BoardPlayer {
  key: string
  team: string
  teamName: string
  player: Player
  plays: Play[]
  won: number // of a server's serves, those whose rally their team won
  code?: string // a column of one attack code: the code, and its name in the DVW
  codeName?: string
  follow?: (Play | null)[] // a setter's sets: the same team's attack right after each, if there was one
  attention?: boolean // marked "Attention" on the card: the one to watch
  sets?: SetterSet[] // a setter's sets and dumps with the attack each led to (setterBoard.ts)
  callNames?: Record<string, string> // the setter calls' names in the DVWs
  formations?: Record<number, FormationSpot[]> // a rotation slide: where the team lines up to receive in each rotation
  sideOut?: Record<number, SideOutRate> // and its serve receive in each
  setCharts?: Record<number, SetChart | null> // and the setter's set chart in each, after a # + ! reception
  receptions?: Received[] // a serve-target slide: all the team's receptions (the same list on each of its players)
}

// Everyone who served or attacked, most plays first. keep: only these plays (the search).
export function boardPlayers(dvws: ParsedDVW[], skill0: BoardSkill, keep?: (p: Play) => boolean): BoardPlayer[] {
  const skill = skill0 === 'R' ? 'E' : skill0 === 'T' ? 'R' : skill0 // a rotation is read from its setter's sets, a serve target from the receptions
  const out = new Map<string, BoardPlayer>()
  for (const d of dvws) {
    for (const [i, p] of d.plays.entries()) {
      if (p.skill !== skill || (keep && !keep(p))) continue
      const player = d.players[`${p.side}${p.jersey}`]
      if (!player) continue
      const t = d.teams[p.side === '*' ? 0 : 1], key = p.playerKey
      const had = out.get(key) ?? { key, team: t.code.toUpperCase(), teamName: t.name, player, plays: [], won: 0 }
      had.plays.push(p)
      if (skill === 'E') (had.follow ??= []).push(attackAfter(d.plays, i))
      if (p.rallyId !== null && d.rallies[p.rallyId]?.wonBy === p.side) had.won++
      out.set(key, had)
    }
  }
  if (skill === 'E') {
    const callNames = Object.assign({}, ...dvws.map(d => d.codeNames)) as Record<string, string>
    for (const p of out.values()) {
      p.sets = setterSets(dvws, p.key, keep); p.callNames = callNames
      if (skill0 === 'R') {
        p.formations = Object.fromEntries(ROTATIONS.map(r => [r, rotationFormation(dvws, p.team, r, rotationLineup(dvws, p.team, r), p.key)]))
        p.sideOut = rotationSideOut(dvws, p.team, keep)
        const plays = dvws.flatMap(d => d.plays), set = p.plays[0], name = `#${p.player.jersey} ${p.player.lastName.toUpperCase()}`
        p.setCharts = Object.fromEntries(ROTATIONS.map(r => [r, set ? setChart(set, plays, () => name, { rot: [r], phases: ['r'], recs: ['#', '+', '!'] }) : null]))
      }
    }
  }
  if (skill0 === 'T') {
    const byTeam = new Map<string, Received[]>()
    for (const p of out.values()) {
      if (!byTeam.has(p.team)) byTeam.set(p.team, teamReceptions(dvws, p.team, keep))
      p.receptions = byTeam.get(p.team)
    }
  }
  return [...out.values()].sort((a, b) => b.plays.length - a.plays.length)
}

// The team's next contact after a set, when it is an attack in the same rally.
function attackAfter(plays: Play[], i: number): Play | null {
  const set = plays[i], next = plays.slice(i + 1).find(q => q.rallyId === set.rallyId && q.side === set.side && q.skill !== 'E')
  return next && next.rallyId !== null && next.skill === 'A' ? next : null
}

const codeOf = (p: Play) => p.code.slice(6, 8)

// The attack codes of these players, most used first; a slot on the card picks from them.
export function attackCodes(players: BoardPlayer[]): { code: string; count: number }[] {
  const n = new Map<string, number>()
  for (const p of players) for (const a of p.plays) { const c = codeOf(a); if (/^[A-Z0-9]{2}$/i.test(c)) n.set(c, (n.get(c) ?? 0) + 1) }
  return [...n.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
}

// A slot on the card: a player, or only the attacks of one code; null when they never hit it.
export function boardColumn(p: BoardPlayer, code: string | null, names: Record<string, string> = {}): BoardPlayer | null {
  if (!code) return p
  const plays = p.plays.filter(a => codeOf(a) === code)
  return plays.length ? { ...p, plays, code, ...(names[code] ? { codeName: names[code] } : {}) } : null
}

const TYPE_NAMES: Record<string, string> = { Q: 'Jump', M: 'Float', H: 'Float' }
export const serveTypeName = (type: string) => TYPE_NAMES[type] ?? type
// A serve's label by its type, whichever is the main one: jump red, float blue, anything else green.
export const serveTypeColor = (type: string) => { const name = TYPE_NAMES[type]; return name === 'Jump' ? '#DC2626' : name === 'Float' ? '#1D4ED8' : '#16A34A' }

// A serve's types, the most used first.
export function serveTypes(plays: Play[]): { type: string; plays: Play[] }[] {
  const by = new Map<string, Play[]>()
  for (const p of plays) { const c = p.code.charAt(4) || '~'; by.set(c, [...(by.get(c) ?? []), p]) }
  return [...by.entries()].map(([type, list]) => ({ type, plays: list })).sort((a, b) => b.plays.length - a.plays.length)
}

const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`
const count = (p: BoardPlayer, e: string) => p.plays.filter(x => x.effect === e).length

// The rates on a card: break points and errors of serves; of attacks, kills and efficiency: (kills -
// errors - blocked) over attempts.
export function boardRates(p: BoardPlayer, skill: BoardSkill): { label: string; value: string; color: string }[] {
  if (skill === 'E') return boardRates({ ...p, plays: attacksOf(p) }, 'A') // the attacks after the sets
  const n = p.plays.length, k = count(p, '#'), e = count(p, '='), b = count(p, '/')
  const share = (v: number) => (n ? (v / n) * 100 : 0)
  return skill === 'S'
    ? [{ label: 'BP%', value: pct(p.won, n), color: breakColor(share(p.won)) }, { label: 'ERR%', value: pct(e, n), color: share(e) >= ERR_HIGH ? BAD : PLAIN }]
    : [{ label: 'K%', value: pct(k, n), color: PLAIN }, { label: 'EFF%', value: pct(k - e - b, n), color: PLAIN }]
}

const attacksOf = (p: BoardPlayer): Play[] => (p.follow ?? []).filter((a): a is Play => !!a)

// Where a setter's sets went: the attacks after them by the zone they were hit from, each with its
// share of all of them and its kills.
export interface SetZone { zone: number; n: number; share: number; kills: number }
export function setDistribution(p: BoardPlayer): { total: number; zones: SetZone[] } {
  const attacks = attacksOf(p).filter(a => a.startZone !== null), total = attacks.length
  const zones = [...new Set(attacks.map(a => a.startZone!))].map(zone => {
    const at = attacks.filter(a => a.startZone === zone)
    return { zone, n: at.length, share: total ? at.length / total : 0, kills: at.filter(a => a.effect === '#').length }
  }).sort((a, b) => b.n - a.n)
  return { total, zones }
}
export type SetView = 'zones' | 'arrows' | 'both'
export type { SetLayout } from './setterBoard'

// The attacking team's half seen from above, the net at the top: the zones' rows from the net back,
// left to right as the team faces the net.
const HALF_ZONES = [[4, 3, 2], [7, 8, 9], [5, 6, 1]]
const SETTER_AT = { u: 0.64, v: 0.06 } // where sets are given from: by the net, between zones 3 and 2

// The set distribution as objects on the slide, in a box (0..1 of the picture) w by h: a half court,
// its zones painted the stronger the more sets went there, and / or arrows from the setter, as thick as
// the share. Each zone used shows its share, and its count and kill rate. One group, to move as one.
function setDiagram(p: BoardPlayer, x: number, y: number, h: number, view: SetView, _ink: string): Annotation[] {
  const { zones } = setDistribution(p), groupId = uid(), w = h / ASPECT, top = Math.max(0, ...zones.map(z => z.share))
  const at = (u: number, v: number): [number, number] => [x + u * w, y + v * h]
  const cell = (zone: number) => { const r = HALF_ZONES.findIndex(row => row.includes(zone)), c = HALF_ZONES[r]?.indexOf(zone) ?? -1; return r < 0 ? null : { r, c } }
  const out: Annotation[] = [{ id: uid(), kind: 'rect', color: '#FFFFFF', x, y, w, h, width: 2, fill: '#F3D9B1', fillOpacity: 1, groupId }]
  const size = (k: number) => Math.max(11, Math.round(h * 720 * k))
  for (const z of zones) {
    const c = cell(z.zone)
    if (!c || view === 'arrows') continue
    out.push({ id: uid(), kind: 'rect', color: '#FFFFFF', x: x + (c.c * w) / 3, y: y + (c.r * h) / 3, w: w / 3, h: h / 3, width: 0,
      fill: mix('#FEE2E2', '#B91C1C', top ? z.share / top : 0), fillOpacity: 0.95, groupId })
  }
  for (const i of [1, 2]) {
    out.push({ id: uid(), kind: 'polyline', color: '#FFFFFF', width: 1.5, points: [at(i / 3, 0), at(i / 3, 1)], groupId })
    out.push({ id: uid(), kind: 'polyline', color: '#FFFFFF', width: i === 1 ? 2.5 : 1.5, points: [at(0, i / 3), at(1, i / 3)], groupId }) // the attack line thicker
  }
  out.push({ id: uid(), kind: 'polyline', color: '#0F172A', width: 5, points: [at(-0.03, 0), at(1.03, 0)], groupId }) // the net
  if (view !== 'zones') {
    for (const z of zones) {
      const c = cell(z.zone)
      if (!c) continue
      const [x1, y1] = at(SETTER_AT.u, SETTER_AT.v), [x2, y2] = at((c.c + 0.5) / 3, (c.r + 0.5) / 3 - 0.1) // the tip above the zone's numbers
      out.push({ id: uid(), kind: 'arrow', color: '#1D4ED8', width: Math.round(2 + 16 * z.share), x1, y1, x2, y2, opacity: 0.85, groupId })
    }
    out.push({ id: uid(), kind: 'circle', color: '#FFFFFF', x: x + SETTER_AT.u * w - 0.009, y: y + SETTER_AT.v * h - 0.016, w: 0.018, h: 0.032, width: 2, fill: '#FACC15', fillOpacity: 1, groupId })
  }
  for (const z of zones) {
    const c = cell(z.zone)
    if (!c) continue
    const [cx, cy] = at((c.c + 0.5) / 3, (c.r + 0.5) / 3)
    const strong = view !== 'arrows' && top > 0 && z.share / top > 0.55
    const color = strong ? '#FFFFFF' : '#0F172A'
    out.push(words(cx, cy - h * 0.05, pct(z.n, zones.reduce((s, q) => s + q.n, 0)), size(0.1), color, { align: 'center', groupId, ...(view === 'arrows' ? { box: { fill: '#FFFFFF', fillOpacity: 0.85, stroke: null, strokeWidth: 0, padding: 3, radius: 4 } } : {}) }))
    out.push(words(cx, cy + h * 0.065, `${z.n} · K ${pct(z.kills, z.n)}`, size(0.05), color, { align: 'center', groupId, bold: false }))
  }
  return out
}

// What the numbers say at a glance: many errors in red; many break points in blue, few in red.
const ERR_HIGH = 16, BP_HIGH = 33, BP_LOW = 20
const PLAIN = '#0F172A', BAD = '#DC2626', GOOD = '#2563EB'
const breakColor = (v: number) => (v >= BP_HIGH ? GOOD : v <= BP_LOW ? BAD : PLAIN)

// The number's colour by position.
const ROLE_COLORS: Record<PlayerRole, { fill: string; text: string }> = {
  OP: { fill: '#DC2626', text: '#FFFFFF' }, MB: { fill: '#16A34A', text: '#FFFFFF' }, OH: { fill: '#2563EB', text: '#FFFFFF' },
  S: { fill: '#FACC15', text: '#0F172A' }, L: { fill: '#64748B', text: '#FFFFFF' },
}
const NO_ROLE = { fill: '#E2E8F0', text: '#0F172A' }

export interface BoardPhoto { assetId: string; width: number; height: number }
// What a card was made from, so it can be made again with other choices; what it made, so what was
// added by hand stays. columns: the players and codes on this card, in their places.
export interface BoardConfig {
  skill: BoardSkill; team: string; columns: { key: string; code: string | null; attention?: boolean }[]
  split: boolean; notes: boolean; photos: boolean; background: string; searched: boolean
  noteSize?: number; noteFills?: [string, string]
  display?: ChartDisplay // what the charts show
  setView?: SetView // sets: what older cards were made with; set slides now paint the zones only
  setLayout?: SetLayout // sets: one setter's six courts (setterBoard.ts); missing: setters side by side (cards made before)
  rotation?: number // a rotation slide: which (1–6)
  teamColor?: string // a rotation slide: the side-out team's colour
  discLine?: string // and the outline of its players' discs
}
export interface BoardMade { config: BoardConfig; made: string[]; noteIds: string[] }

export interface BoardOptions {
  split: boolean // a serve's second type in a chart of its own
  notes?: boolean // a box under each column to write in
  background?: string // the text is made to show on it
  style?: ChartStyle
  noteTexts?: string[] // what was written in the note boxes, by column
  noteSize?: number // the notes' height, 1 = the usual (NOTE_SIZE)
  noteFills?: [string, string] // the notes' lines by turns
  display?: ChartDisplay
  setView?: SetView
  setLayout?: SetLayout
  rotation?: number // a rotation slide's rotation
  teamColor?: string // and the team's colour, its players' discs
  discLine?: string // and their outline
}
const ASPECT = 16 / 9, MIN_SECOND = 3 // a second type with fewer serves than this stays in the main chart
const TOP = 0.095, EDGE = 0.012
// Notes to read from across a room: a headline line, then three. Heights as shares of the picture.
const NOTE_LINES = [0.064, 0.044, 0.044, 0.044]
// The notes' lines and where they start, made taller or shorter (1 = as above); the type follows.
export const NOTE_SIZE = { min: 0.6, max: 1.6, step: 0.1 }
export const NOTE_FILLS: [string, string] = ['#E2E8F0', '#FFFFFF'] // the lines by turns
const noteLines = (scale = 1) => { const lines = NOTE_LINES.map(h => h * scale); return { lines, top: 0.975 - lines.reduce((a, b) => a + b, 0) } }
const NARROW = 4 // from this many columns the card stacks above the chart
export const MOST_PER_SLIDE = 6

const uid = () => globalThis.crypto.randomUUID()
type Text = Extract<Annotation, { kind: 'text' }>
const words = (x: number, y: number, text: string, size: number, color: string, extra: Partial<Text> = {}): Annotation =>
  ({ id: uid(), kind: 'text', color, x, y, text, size, bold: true, outline: false, ...extra })
const panel = (color: string) => ({ box: { fill: color, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 4 } })
const tag = (x: number, y: number, text: string, size: number, color: string) => words(x, y, text, size, '#FFFFFF', panel(color))

function isLight(color: string | undefined): boolean {
  const m = color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return false
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 150
}

// The rates in a framed box, the numbers large; moved as one.
function rateCard(p: BoardPlayer, skill: BoardSkill, x: number, y: number, w: number, h: number, size: number): Annotation[] {
  const rates = boardRates(p, skill), groupId = uid(), cell = w / rates.length, opts = { align: 'center' as const, groupId }
  const box: Annotation = { id: uid(), kind: 'rect', color: '#FACC15', x, y, w, h, width: 2, fill: '#FFFFFF', fillOpacity: 1, groupId }
  return [box, ...rates.flatMap((r, i) => {
    const cx = x + cell * (i + 0.5)
    return [words(cx, y + h * 0.1, r.label, Math.max(11, Math.round(size * 0.55)), '#64748B', opts), words(cx, y + h * 0.42, r.value, size, r.color, opts)]
  })]
}

// Four text boxes to write in, centred, grey and white by turns; the first is the headline. The narrower
// the column the smaller the type, but still large enough to give the point at a glance. Each is a cell
// of fixed size (what is written shrinks to fit), and all the slide's notes are one group: they move as
// one, and no line or column comes out of line with the rest.
function notesBox(x: number, w: number, notes: string[], columns: number, scale = 1, fills: [string, string] = NOTE_FILLS, groupId = uid()): Annotation[] {
  const big = Math.round((columns >= 6 ? 26 : columns >= 4 ? 30 : 34) * scale), small = Math.round((columns >= 6 ? 18 : columns >= 4 ? 19 : 22) * scale)
  const { lines, top: start } = noteLines(scale)
  let y = start
  return lines.map((h, i) => {
    const size = i ? small : big, pad = Math.min(4, Math.max(1, (h * 720 - size * 1.2) / 2)), top = y, fill = fills[i % 2]
    y += h
    return words(x + w / 2, top + pad / 720, notes[i] ?? '', size, isLight(fill) ? '#0F172A' : '#FFFFFF', {
      bold: i === 0, align: 'center', groupId, box: { fill, fillOpacity: 1, stroke: '#CBD5E1', strokeWidth: 1, padding: pad, width: w, height: h },
    })
  })
}

// A name on a ruled line, doubled, in the colour of the position.
function underline(x: number, x2: number, y: number, color: string, groupId: string): Annotation[] {
  return [[y, 2.5], [y + 0.008, 1]].map(([at, width]) => ({ id: uid(), kind: 'polyline', color, width, points: [[x, at], [x2, at]], groupId }) as Annotation)
}

// A photo in a square-cornered frame, always on white: a cut-out shows no slide colour through it.
function framed(x: number, y: number, w: number, h: number, assetId: string, color: string): Annotation[] {
  const groupId = uid()
  return [
    { id: uid(), kind: 'rect', color: '#FFFFFF', x, y, w, h, width: 0, fill: '#FFFFFF', fillOpacity: 1, groupId },
    { id: uid(), kind: 'image', color: '#FFFFFF', x, y, w, h, assetId, groupId },
    { id: uid(), kind: 'rect', color, x, y, w, h, width: 2, fill: null, groupId },
  ]
}

// "Attention": a red tag in yellow letters right of the name (with it in its group), for the player to watch.
const ATTENTION = '#DC2626', ATTENTION_TEXT = '#FACC15'
const attentionWidth = (size: number) => (size * 0.66 * 9 + 8) / 1280
const attentionTag = (cx: number, y: number, size: number, groupId: string): Annotation =>
  words(cx, y, 'Attention', size, ATTENTION_TEXT, { align: 'center', groupId, box: { fill: ATTENTION, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 3, radius: 3 } })

// One setter's slide (setterBoard.ts): the heading, the photo at the left, six courts.
const LAYOUT_NAMES: Record<SetLayout, string> = { reception: 'Set distribution by reception', rotation: 'Side-out by rotation (# + ! reception)' }
function setterSlide(p: BoardPlayer, layout: SetLayout, opts: BoardOptions, photo: BoardPhoto | undefined): Annotation[] {
  const ink = isLight(opts.background) ? '#0F172A' : '#FFFFFF', out: Annotation[] = []
  const role = (p.player.role && ROLE_COLORS[p.player.role]) || NO_ROLE, name = p.player.lastName.toUpperCase(), nameGroup = uid()
  out.push(words(EDGE + 0.004, 0.024, String(p.player.jersey), 26, role.text, { box: { fill: role.fill, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 5, radius: 7 } }))
  out.push(words(EDGE + 0.05, 0.024, `${name}  ${p.team}`, 28, ink, { groupId: nameGroup }))
  out.push(...underline(EDGE + 0.05, 0.6, 0.024 + 35 / 720, role.fill === NO_ROLE.fill ? ink : role.fill, nameGroup))
  const all = splitSets(p.sets ?? [])
  out.push(words(0.988 - 0.36, 0.022, LAYOUT_NAMES[layout], 18, ink, { bold: true }))
  out.push(words(0.988 - 0.36, 0.058, `n ${all.total} · K ${pct(all.kills, all.total)} · ERR ${pct(all.errors, all.total)}`, 15, ink, { bold: false }))
  const left = 0.19
  if (photo) {
    const w = 0.15, h = Math.min(0.27, (w * ASPECT * photo.height) / photo.width)
    out.push(...framed(EDGE + 0.008, 0.12, w, h, photo.assetId, ink))
  }
  out.push(...setterCourts(p.sets ?? [], layout, p.callNames ?? {}, 'zones', ink, { left, top: 0.1, bottom: 0.995, photo: !!photo }))
  return out
}

// One slide's columns, side by side; for a setter with a layout, their slide of six courts.
export function boardSlide(columns: BoardPlayer[], skill: BoardSkill, opts: BoardOptions, photos: Record<string, BoardPhoto>): { annotations: Annotation[]; charts: PlacedChart[]; noteIds: string[]; setCharts?: PlacedSetChart[] } {
  if (skill === 'T') {
    const p = columns[0], ink = isLight(opts.background) ? '#0F172A' : '#FFFFFF'
    return { annotations: p ? serveTargetSlide({ team: p.team, teamName: p.teamName, receptions: p.receptions ?? [], players: Object.fromEntries(columns.map(c => [c.key, c.player])), photos }, ink) : [], charts: [], noteIds: [] }
  }
  if (skill === 'R') {
    const p = columns[0], ink = isLight(opts.background) ? '#0F172A' : '#FFFFFF', r = opts.rotation ?? 1
    const sc = p?.setCharts?.[r]
    return { annotations: p ? rotationSlide({ rotation: r, team: p.team, setter: p.player, sets: p.sets ?? [], formation: p.formations?.[r] ?? [], callNames: p.callNames, ...(opts.teamColor ? { teamColor: opts.teamColor } : {}), ...(opts.discLine ? { discLine: opts.discLine } : {}), ...(photos[p.key] ? { photo: photos[p.key] } : {}), ...(photos[logoKey(p.team)] ? { logo: photos[logoKey(p.team)] } : {}), ...(p.sideOut?.[r] ? { rates: p.sideOut[r] } : {}) }, opts.setView ?? 'both', ink) : [], charts: [], noteIds: [],
      ...(sc ? { setCharts: [{ chart: sc, ...ROTATION_CHART }] } : {}) }
  }
  if (skill === 'E' && opts.setLayout) return { annotations: columns[0] ? setterSlide(columns[0], opts.setLayout, opts, photos[columns[0].key]) : [], charts: [], noteIds: [] }
  const annotations: Annotation[] = [], charts: PlacedChart[] = [], noteIds: string[] = [], notesGroup = uid()
  const style = { ...(opts.style ?? DEFAULT_CHART), ...opts.display, scope: 'player' as const, name: false, stats: false }
  const col = 1 / Math.max(1, columns.length), ink = isLight(opts.background) ? '#0F172A' : '#FFFFFF'
  const bottom = opts.notes ? noteLines(opts.noteSize).top - 0.015 : 0.95
  const widthOf = (h: number) => (skill === 'E' ? h : chartWidth(h)) / ASPECT // a set diagram is a square half court
  // The chart of these plays, or for a setter the set diagram, in its box.
  const place = (p: BoardPlayer, plays: Play[], x: number, y: number, h: number) => {
    if (skill === 'E') annotations.push(...setDiagram(p, x, y, h, 'zones', ink)) // the places painted, no arrows
    else charts.push({ chart: directionChart(plays[0], style, () => plays), x, y, h })
  }
  const countOf = (p: BoardPlayer, plays: Play[]) => (skill === 'E' ? setDistribution(p).total : plays.length)
  columns.forEach((p, i) => {
    const left = i * col + EDGE, width = col - EDGE * 2
    const types = skill === 'S' ? serveTypes(p.plays) : []
    // The same player side by side (their attack codes, say) shares one heading and one photo.
    const first = i === 0 || columns[i - 1].key !== p.key
    let span = 1
    if (first) while (columns[i + span]?.key === p.key) span++
    const shared = !first || span > 1
    const narrow = columns.length >= NARROW || shared, photo = photos[p.key], strip = col * 0.25
    const photoW = Math.min(strip, 0.13), tall = photo ? (photoW * ASPECT * photo.height) / photo.width : 0
    // Beside the chart, the second type goes under the photo and rates, if there is room left.
    const fits = !narrow && bottom - TOP - (tall ? tall + 0.015 : 0) - 0.118 - 0.03 >= 0.14
    const second = opts.split && fits && types[1]?.plays.length >= MIN_SECOND ? types[1] : null
    const main = second ? types[0].plays : p.plays
    const mainLabel = p.code ? `${p.code}${p.codeName ? ` ${p.codeName}` : ''}` : second ? serveTypeName(types[0].type) : null
    const mainColor = !p.code && second ? serveTypeColor(types[0].type) : '#1D4ED8'
    const role = (p.player.role && ROLE_COLORS[p.player.role]) || NO_ROLE
    const name = p.player.lastName.toUpperCase()
    const fit = (size: number, room: number, text: string) => Math.min(size, Math.floor((room * 1280) / (text.length * 0.72)))
    const numberW = narrow ? 0.035 : 0.045
    if (first) {
      // With "Attention", the name makes room for the tag after it.
      const tagSize = narrow ? 12 : 15, tagW = p.attention ? attentionWidth(tagSize) + 0.006 : 0
      const headW = col * span - EDGE * 2, nameGroup = uid(), nameSize = fit(narrow ? 20 : 28, headW - numberW - tagW, name)
      annotations.push({ ...words(left + 0.004, 0.028, String(p.player.jersey), narrow ? 20 : 26, role.text, { box: { fill: role.fill, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 5, radius: 7 } }) })
      annotations.push(words(left + numberW, 0.028, name, nameSize, ink, { groupId: nameGroup }))
      annotations.push(...underline(left + numberW, left + headW, 0.028 + (nameSize * 1.25) / 720, role.fill === NO_ROLE.fill ? ink : role.fill, nameGroup))
      if (p.attention) {
        const after = left + numberW + (name.length * nameSize * 0.72) / 1280 + 0.006, half = attentionWidth(tagSize) / 2
        annotations.push(attentionTag(Math.min(after + half, left + headW - half), 0.028 + ((nameSize - tagSize) * 0.6) / 720 - 3 / 720, tagSize, nameGroup))
      }
    }
    if (opts.notes) {
      const note = notesBox(left, width, (opts.noteTexts ?? []).slice(i * NOTE_LINES.length, (i + 1) * NOTE_LINES.length), columns.length, opts.noteSize, opts.noteFills, notesGroup)
      noteIds.push(...note.map(a => a.id))
      annotations.push(...note)
    }

    if (narrow) {
      // The card above the chart: the photo, the position and rates beside it.
      // Sharing a heading, each column's label takes the place of the position, and only the first has the photo.
      const rowH = photo ? 0.165 : 0, photoW = photo && first ? (rowH * photo.width) / photo.height / ASPECT : 0
      if (photo && first) annotations.push(...framed(left, TOP, photoW, rowH, photo.assetId, ink))
      const cardX = photoW ? left + photoW + 0.005 : left, cardW = left + width - cardX, cardH = 0.09
      const roleH = photo || (shared && mainLabel) ? 0.055 : 0
      if (shared && mainLabel) annotations.push(tag(cardX + 0.004, TOP + 0.012, mainLabel, 14, mainColor))
      else if (photo && p.player.role) annotations.push(words(cardX + cardW / 2, TOP + 0.006, p.player.role, 22, role.fill === ROLE_COLORS.S.fill ? ink : role.fill, { align: 'center' }))
      const cardY = TOP + roleH
      annotations.push(...rateCard(p, skill, cardX, cardY, cardW, cardH, Math.min(20, Math.floor((cardW * 1280) / 5.2))))
      const y = TOP + Math.max(rowH, roleH + cardH) + 0.01, h = Math.min(bottom - y - 0.03, width / widthOf(1)), cx = left + (width - widthOf(h)) / 2
      place(p, main, cx, y, h)
      if (mainLabel && !shared) annotations.push(tag(cx + 0.004, y + 0.006, mainLabel, 11, mainColor))
      annotations.push(words(left + width / 2, y + h + 0.006, `n: ${countOf(p, main)}`, 13, ink, { align: 'center' }))
      return
    }

    // The card left of the chart.
    const room = width - strip - EDGE, chartX = left + strip + EDGE
    const h = Math.min(bottom - TOP - 0.035, room / widthOf(1))
    place(p, main, chartX, TOP, h)
    if (mainLabel) annotations.push(tag(chartX + 0.006, TOP + 0.008, mainLabel, 15, mainColor))
    annotations.push(words(chartX + widthOf(h) / 2, TOP + h + 0.008, `n: ${countOf(p, main)}`, 16, ink, { align: 'center' }))
    let y = TOP
    if (photo) {
      annotations.push(...framed(left, y, photoW, tall, photo.assetId, ink))
      y += tall + 0.015
    }
    const cardH = 0.1
    annotations.push(...rateCard(p, skill, left, y, strip, cardH, Math.min(24, Math.floor((strip * 1280) / 5.5))))
    y += cardH + 0.018
    if (second) {
      const small = Math.min(bottom - y - 0.03, strip / widthOf(1))
      place(p, second.plays, left, y, small)
      annotations.push(tag(left + 0.004, y + 0.006, serveTypeName(second.type), 12, serveTypeColor(second.type)))
      annotations.push(words(left + widthOf(small) / 2, y + small + 0.006, `n: ${second.plays.length}`, 12, ink, { align: 'center' }))
    }
  })
  return { annotations, charts, noteIds }
}

// What the charts of a card show, changed for all of them at once.
export function restyleBoard<T extends { charts?: PlacedChart[]; board?: BoardMade }>(slide: T, patch: ChartDisplay): T {
  return {
    ...slide,
    charts: slide.charts?.map(c => ({ ...c, chart: { ...c.chart, look: { ...c.chart.look, ...patch } } })),
    ...(slide.board ? { board: { ...slide.board, config: { ...slide.board.config, display: { ...slide.board.config.display, ...patch } } } } : {}),
  }
}

// A card made again: its new objects with whatever was added by hand on top, keeping what was written
// in the notes. Handed the old card's record, or nothing for a new one.
export function keptByHand(old: { annotations: Annotation[]; board?: BoardMade }): { hand: Annotation[]; noteTexts: string[] } {
  const made = new Set(old.board?.made ?? [])
  const notes = (old.board?.noteIds ?? []).flatMap(id => old.annotations.filter((a): a is Text => a.id === id && a.kind === 'text').map(a => a.text))
  return { hand: old.annotations.filter(a => !made.has(a.id)), noteTexts: notes }
}
