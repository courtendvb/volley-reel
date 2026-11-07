// A slide comparing players at a glance: for each column, a number coloured by position, a name, a photo
// and rates, with a direction chart of their serves or attacks. Made of objects the slide editor already
// moves and restyles (text, pictures, boxes), and charts placed on the slide (Slide.charts), so it can
// be finished by hand with arrows and notes. Pure: no files, no DOM.
import type { Annotation } from './annotation'
import { DEFAULT_CHART, chartWidth, type ChartDisplay, type ChartStyle, type DirectionChart } from './chart'
import { directionChart } from './court'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'

export type BoardSkill = 'S' | 'A'
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
}

// Everyone who served or attacked, most plays first. keep: only these plays (the search).
export function boardPlayers(dvws: ParsedDVW[], skill: BoardSkill, keep?: (p: Play) => boolean): BoardPlayer[] {
  const out = new Map<string, BoardPlayer>()
  for (const d of dvws) {
    for (const p of d.plays) {
      if (p.skill !== skill || (keep && !keep(p))) continue
      const player = d.players[`${p.side}${p.jersey}`]
      if (!player) continue
      const t = d.teams[p.side === '*' ? 0 : 1], key = p.playerKey
      const had = out.get(key) ?? { key, team: t.code.toUpperCase(), teamName: t.name, player, plays: [], won: 0 }
      had.plays.push(p)
      if (p.rallyId !== null && d.rallies[p.rallyId]?.wonBy === p.side) had.won++
      out.set(key, had)
    }
  }
  return [...out.values()].sort((a, b) => b.plays.length - a.plays.length)
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
  const n = p.plays.length, k = count(p, '#'), e = count(p, '='), b = count(p, '/')
  const share = (v: number) => (n ? (v / n) * 100 : 0)
  return skill === 'S'
    ? [{ label: 'BP%', value: pct(p.won, n), color: breakColor(share(p.won)) }, { label: 'ERR%', value: pct(e, n), color: share(e) >= ERR_HIGH ? BAD : PLAIN }]
    : [{ label: 'K%', value: pct(k, n), color: PLAIN }, { label: 'EFF%', value: pct(k - e - b, n), color: PLAIN }]
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
  skill: BoardSkill; team: string; columns: { key: string; code: string | null }[]
  split: boolean; notes: boolean; photos: boolean; background: string; searched: boolean
  display?: ChartDisplay // what the charts show
}
export interface BoardMade { config: BoardConfig; made: string[]; noteIds: string[] }

export interface BoardOptions {
  split: boolean // a serve's second type in a chart of its own
  notes?: boolean // a box under each column to write in
  background?: string // the text is made to show on it
  style?: ChartStyle
  noteTexts?: string[] // what was written in the note boxes, by column
  display?: ChartDisplay
}
const ASPECT = 16 / 9, MIN_SECOND = 3 // a second type with fewer serves than this stays in the main chart
const TOP = 0.095, EDGE = 0.012
// Notes to read from across a room: a headline line, then three. Heights as shares of the picture.
const NOTE_LINES = [0.064, 0.044, 0.044, 0.044], NOTES_Y = 0.975 - NOTE_LINES.reduce((a, b) => a + b, 0)
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
// the column the smaller the type, but still large enough to give the point at a glance.
function notesBox(x: number, w: number, notes: string[], columns: number): Annotation[] {
  const big = columns >= 6 ? 26 : columns >= 4 ? 30 : 34, small = columns >= 6 ? 18 : columns >= 4 ? 19 : 22
  let y = NOTES_Y
  return NOTE_LINES.map((h, i) => {
    const size = i ? small : big, pad = Math.max(1, (h * 720 - size * 1.2) / 2), top = y
    y += h
    return words(x + w / 2, top + pad / 720, notes[i] ?? '', size, '#0F172A', {
      bold: i === 0, align: 'center', box: { fill: i % 2 ? '#FFFFFF' : '#E2E8F0', fillOpacity: 1, stroke: '#CBD5E1', strokeWidth: 1, padding: pad, width: w },
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

// One slide's columns, side by side.
export function boardSlide(columns: BoardPlayer[], skill: BoardSkill, opts: BoardOptions, photos: Record<string, BoardPhoto>): { annotations: Annotation[]; charts: PlacedChart[]; noteIds: string[] } {
  const annotations: Annotation[] = [], charts: PlacedChart[] = [], noteIds: string[] = []
  const style = { ...(opts.style ?? DEFAULT_CHART), ...opts.display, scope: 'player' as const, name: false, stats: false }
  const col = 1 / Math.max(1, columns.length), ink = isLight(opts.background) ? '#0F172A' : '#FFFFFF'
  const bottom = opts.notes ? NOTES_Y - 0.015 : 0.95
  const widthOf = (h: number) => chartWidth(h) / ASPECT
  columns.forEach((p, i) => {
    const chartOf = (plays: Play[]) => directionChart(plays[0], style, () => plays)
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
    const role = (p.player.role && ROLE_COLORS[p.player.role]) || NO_ROLE
    const name = p.player.lastName.toUpperCase()
    const fit = (size: number, room: number, text: string) => Math.min(size, Math.floor((room * 1280) / (text.length * 0.72)))
    const numberW = narrow ? 0.035 : 0.045
    if (first) {
      const headW = col * span - EDGE * 2, nameGroup = uid(), nameSize = fit(narrow ? 20 : 28, headW - numberW, name)
      annotations.push({ ...words(left + 0.004, 0.028, String(p.player.jersey), narrow ? 20 : 26, role.text, { box: { fill: role.fill, fillOpacity: 1, stroke: null, strokeWidth: 0, padding: 5, radius: 7 } }) })
      annotations.push(words(left + numberW, 0.028, name, nameSize, ink, { groupId: nameGroup }))
      annotations.push(...underline(left + numberW, left + headW, 0.028 + (nameSize * 1.25) / 720, role.fill === NO_ROLE.fill ? ink : role.fill, nameGroup))
    }
    if (opts.notes) {
      const note = notesBox(left, width, (opts.noteTexts ?? []).slice(i * NOTE_LINES.length, (i + 1) * NOTE_LINES.length), columns.length)
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
      if (shared && mainLabel) annotations.push(tag(cardX + 0.004, TOP + 0.012, mainLabel, 14, '#1D4ED8'))
      else if (photo && p.player.role) annotations.push(words(cardX + cardW / 2, TOP + 0.006, p.player.role, 22, role.fill === ROLE_COLORS.S.fill ? ink : role.fill, { align: 'center' }))
      const cardY = TOP + roleH
      annotations.push(...rateCard(p, skill, cardX, cardY, cardW, cardH, Math.min(20, Math.floor((cardW * 1280) / 5.2))))
      const y = TOP + Math.max(rowH, roleH + cardH) + 0.01, h = Math.min(bottom - y - 0.03, width / widthOf(1)), cx = left + (width - widthOf(h)) / 2
      charts.push({ chart: chartOf(main), x: cx, y, h })
      if (mainLabel && !shared) annotations.push(tag(cx + 0.004, y + 0.006, mainLabel, 11, '#1D4ED8'))
      annotations.push(words(left + width / 2, y + h + 0.006, `n: ${main.length}`, 13, ink, { align: 'center' }))
      return
    }

    // The card left of the chart.
    const room = width - strip - EDGE, chartX = left + strip + EDGE
    const h = Math.min(bottom - TOP - 0.035, room / widthOf(1))
    charts.push({ chart: chartOf(main), x: chartX, y: TOP, h })
    if (mainLabel) annotations.push(tag(chartX + 0.006, TOP + 0.008, mainLabel, 15, '#1D4ED8'))
    annotations.push(words(chartX + widthOf(h) / 2, TOP + h + 0.008, `n: ${main.length}`, 16, ink, { align: 'center' }))
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
      charts.push({ chart: chartOf(second.plays), x: left, y, h: small })
      annotations.push(tag(left + 0.004, y + 0.006, serveTypeName(second.type), 12, '#DC2626'))
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
