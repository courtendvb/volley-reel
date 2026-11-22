// A team's players' basic figures as a table on a data slide: serves, attacks or receptions, one row
// per player (most plays first), totals over the team's matches. The columns of a player are their
// BoardPlayer (board.ts): the plays of that skill, and of them the rallies their team won.
import type { Annotation } from './annotation'
import { SERVE_WEIGHTS } from './compare'
import type { Player, Play } from './types'

export type StatKind = 'serve' | 'attack' | 'reception'
export const STAT_KINDS: StatKind[] = ['serve', 'attack', 'reception']
export const STAT_SKILL: Record<StatKind, 'S' | 'A' | 'R'> = { serve: 'S', attack: 'A', reception: 'R' }
export const MOST_ROWS = 20, STAT_ROWS = 14 // the most players a table takes, and how many by default (most plays first)

// A player's plays of the skill, and of them those whose rally their team won.
export interface StatPlayer { player: Player; plays: Play[]; wins: Set<Play> }
export interface StatColumn { label: string; title: string; group?: string; value: (p: StatPlayer) => number | null; format: (v: number) => string }

const share = (n: number, of: number) => (of ? n / of : null)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const whole = (v: number) => String(v)
const n = (plays: Play[], ...effects: string[]) => plays.filter(p => effects.includes(p.effect)).length
// A reception's serve: a jump spin (Q), or a float (H, and the jump float M).
const SPIN = ['Q'], FLOAT = ['H', 'M']
const ofType = (types: string[]) => (p: StatPlayer): StatPlayer => ({ ...p, plays: p.plays.filter(x => types.includes(x.code.charAt(4))) })
const won = (p: StatPlayer) => p.plays.filter(x => p.wins.has(x)).length

const receptionBlock = (group: string, pick: (p: StatPlayer) => StatPlayer): StatColumn[] => [
  { group, label: 'Rec', title: 'レセプション数', value: p => pick(p).plays.length, format: whole },
  { group, label: '#+%', title: '（# ＋ +）÷ レセプション', value: p => { const q = pick(p).plays; return share(n(q, '#', '+'), q.length) }, format: pct },
  { group, label: '#%', title: '# ÷ レセプション', value: p => { const q = pick(p).plays; return share(n(q, '#'), q.length) }, format: pct },
  { group, label: 'Ace%', title: '被エース（=）÷ レセプション', value: p => { const q = pick(p).plays; return share(n(q, '='), q.length) }, format: pct },
  { group, label: 'SO%', title: 'そのラリーを取った本数 ÷ レセプション', value: p => { const q = pick(p); return share(won(q), q.plays.length) }, format: pct },
]

export const STAT_COLUMNS: Record<StatKind, StatColumn[]> = {
  serve: [
    { label: 'STot', title: 'サーブ打数', value: p => p.plays.length, format: whole },
    { label: 'Ace', title: 'サーブエース（#）', value: p => n(p.plays, '#'), format: whole },
    { label: 'BP%', title: 'そのラリーを取った本数 ÷ サーブ', value: p => share(won(p), p.plays.length), format: pct },
    { label: 'ERR%', title: 'サーブミス（=）÷ サーブ', value: p => share(n(p.plays, '='), p.plays.length), format: pct },
    { label: 'SERVE INDEX', title: '（# × 1 ＋ / × 0.752 ＋ + × 0.455 ＋ ! × 0.344 ＋ - × 0.281）÷ サーブ', value: p => share(p.plays.reduce((s, x) => s + (SERVE_WEIGHTS[x.effect] ?? 0), 0), p.plays.length), format: v => v.toFixed(3) },
  ],
  attack: [
    { label: 'ATot', title: 'アタック打数', value: p => p.plays.length, format: whole },
    { label: 'A#', title: 'アタック決定（#）', value: p => n(p.plays, '#'), format: whole },
    { label: 'A#%', title: '決定 ÷ 打数', value: p => share(n(p.plays, '#'), p.plays.length), format: pct },
    { label: 'EFF', title: '（決定 − ミス − 被ブロック）÷ 打数', value: p => share(n(p.plays, '#') - n(p.plays, '=', '/'), p.plays.length), format: pct },
  ],
  reception: [
    { group: 'ALL', label: 'Rec', title: '全体のレセプション数', value: p => p.plays.length, format: whole },
    ...receptionBlock('SPIN', ofType(SPIN)),
    ...receptionBlock('FLOAT', ofType(FLOAT)),
  ],
}

const TITLES: Record<StatKind, string> = { serve: 'SERVE', attack: 'ATTACK', reception: 'RECEPTION' }

// The table's figures: a row per player, most plays first (serves, attacks or receptions; the top
// `top` of them), each column formatted ('–' when there is nothing to count).
export function statRows(kind: StatKind, players: StatPlayer[], top = STAT_ROWS): { name: string; values: string[] }[] {
  return players.filter(p => p.plays.length).sort((a, b) => b.plays.length - a.plays.length).slice(0, Math.max(1, Math.min(MOST_ROWS, top))).map(p => ({
    name: `#${String(p.player.jersey).padStart(2, '0')} ${p.player.lastName.toUpperCase()}`,
    values: STAT_COLUMNS[kind].map(c => { const v = c.value(p); return v === null ? '–' : c.format(v) }),
  }))
}

const uid = () => globalThis.crypto.randomUUID()
const REF = 720 // a text's size is in pixels of a 720-high picture
// The table's colours: the header row, the names' column, the figures, and with stripe the figures'
// every other row (from the second). The text on each is dark or white, whichever shows.
export interface StatLook { head: string; name: string; value: string; stripe?: string | null }
export const STAT_LOOK: StatLook = { head: '#4472C4', name: '#4472C4', value: '#E9EBF5' }
export const STAT_STRIPE = '#CFD5EA' // the second colour when every other row is coloured, at first
const LINE = '#FFFFFF'
const light = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex), v = m ? parseInt(m[1], 16) : 0xffffff
  return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 150
}
const textOn = (fill: string) => (light(fill) ? '#0F172A' : '#FFFFFF')

// A text in a cell of fixed size (x its left, y its top; 0..1 of the picture), centred or from the left.
// The text sits in the middle of the cell's height; too long, it is made smaller to fit.
function cell(x: number, y: number, w: number, h: number, text: string, size: number, fill: string, group: string, left = false): Annotation {
  const color = textOn(fill)
  const pad = Math.max(1, Math.min(10, (h * REF - size * 1.2) / 2))
  return { id: uid(), kind: 'text', color, x: left ? x + pad / 1280 : x + w / 2, y: y + pad / REF, text, size, bold: true, outline: false, ...(left ? {} : { align: 'center' as const }), groupId: group,
    box: { fill, fillOpacity: 1, stroke: LINE, strokeWidth: 1, padding: pad, width: w, height: h } }
}

// The table as objects on a slide: the heading over it, then a header row (with SPIN and FLOAT over
// theirs on a reception's), a row per player — names from the left, figures centred, in the look's
// colours. The table is one group; the heading moves on its own.
export function statsSlide(kind: StatKind, team: string, matches: number, rows: { name: string; values: string[] }[], ink = '#0F172A', look: StatLook = STAT_LOOK): Annotation[] {
  const out: Annotation[] = [], c = look, cols = STAT_COLUMNS[kind], g = uid()
  const grouped = cols.some(x => x.group)
  out.push({ id: uid(), kind: 'text', color: ink, x: 0.5, y: 0.03, text: `${team ? `${team} ` : ''}${TITLES[kind]} STATS TOTAL (LAST ${matches} ${matches === 1 ? 'MATCH' : 'MATCHES'})`, size: 40, bold: true, outline: false, align: 'center' })
  const left = grouped ? 0.025 : 0.09, right = grouped ? 0.975 : 0.91, nameW = grouped ? 0.2 : 0.28
  const valueW = (right - left - nameW) / cols.length
  const top = 0.15, heads = grouped ? 2 : 1, room = 0.97 - top
  // One size for the whole table: as the rows allow, but no larger than lets the longest figure,
  // label and name fit their columns (a bold character is about 0.62 of the size wide).
  const rowH = Math.min(0.077, room / (rows.length + heads)), fit = (w: number, texts: string[]) => (w * 1280 - 20) / (0.62 * Math.max(1, ...texts.map(x => x.length)))
  const size = Math.round(Math.min(rowH * REF * 0.48, fit(valueW, [...cols.map(x => x.label), ...rows.flatMap(r => r.values)]), fit(nameW, rows.map(r => r.name))))
  const x = (i: number) => left + nameW + i * valueW
  let y = top
  if (grouped) {
    out.push(cell(left, y, nameW, rowH, '', size, c.head, g))
    for (let i = 0; i < cols.length;) {
      let j = i
      while (j < cols.length && cols[j].group === cols[i].group) j++
      out.push(cell(x(i), y, (j - i) * valueW, rowH, cols[i].group ?? '', size, c.head, g))
      i = j
    }
    y += rowH
  }
  out.push(cell(left, y, nameW, rowH, 'Player', size, c.head, g, true))
  cols.forEach((col, i) => out.push(cell(x(i), y, valueW, rowH, col.label, size, c.head, g)))
  y += rowH
  for (const [k, r] of rows.entries()) {
    const fill = k % 2 && c.stripe ? c.stripe : c.value
    out.push(cell(left, y, nameW, rowH, r.name, size, c.name, g, true))
    r.values.forEach((v, i) => out.push(cell(x(i), y, valueW, rowH, v, size, fill, g)))
    y += rowH
  }
  return out
}
