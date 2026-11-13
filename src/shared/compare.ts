// Skill comparison: two teams side by side over their own matches — the open project's (mostly the
// scouted opponent) and ours from our own project (each project's target team), as a data slide
// (compareSlide; made from the データスライド dialog). Each figure is the team's total over its matches.
import { sideOutReport } from './analysis'
import { matchReport, type ReportMatch } from './report'
import type { Annotation } from './annotation'
import type { ParsedDVW } from './types'

export interface SkillCounts {
  matches: number; sets: number
  oppServe: number; soWon: number // the other team's serves (its errors too), rallies won on them
  serve: number; bpWon: number // own serves, rallies won on them
  attack: number; kill: number; attackErr: number; blocked: number
  ace: number; serveErr: number; serveWeight: number // serve # / =, and every serve's SERVE_WEIGHTS added up
  rec: number; recPos: number // receptions, # and +
  blockPts: number
}

const zero = (): SkillCounts => ({ matches: 0, sets: 0, oppServe: 0, soWon: 0, serve: 0, bpWon: 0, attack: 0, kill: 0, attackErr: 0, blocked: 0, ace: 0, serveErr: 0, serveWeight: 0, rec: 0, recPos: 0, blockPts: 0 })

export function skillCounts(list: ReportMatch[]): SkillCounts {
  const c = zero()
  for (const m of list) {
    const r = matchReport(m.d), t = r.teams[m.side === '*' ? 0 : 1].total
    c.matches++
    c.sets += m.d.info?.sets.length || Math.max(0, ...m.d.plays.map(p => p.setNum))
    c.attack += t.att.tot; c.kill += t.att.pts; c.attackErr += t.att.err; c.blocked += t.att.blo
    c.ace += t.serve.pts; c.serveErr += t.serve.err
    for (const p of m.d.plays) if (p.side === m.side && p.skill === 'S') c.serveWeight += SERVE_WEIGHTS[p.effect] ?? 0
    c.rec += t.rec.tot; c.recPos += t.rec.pos
    c.blockPts += t.blk
  }
  const so = sideOutReport(list).team.total
  c.oppServe = so.oppServe; c.soWon = so.soWon; c.serve = so.serve; c.bpWon = so.bpWon
  return c
}

// SERVE INDEX: what a serve of each evaluation is worth (an ace 1, an error nothing), as the team's
// VolleyStation sheet weighs them.
export const SERVE_WEIGHTS: Record<string, number> = { '#': 1, '/': 0.752, '+': 0.455, '!': 0.344, '-': 0.281, '=': 0 }

// The rows of the table, in order: the label, the figure ('' when there is nothing to count) and
// whether a higher figure is the better one (for marking the better team).
export interface SkillRow { id: string; label: string; value: (c: SkillCounts) => number | null; format: (v: number) => string; higher: boolean; title: string }
const ratio = (n: number, of: number) => (of ? n / of : null)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
export const SKILL_ROWS: SkillRow[] = [
  { id: 'so', label: 'SO%', value: c => ratio(c.soWon, c.oppServe), format: pct, higher: true, title: 'SO 得点 ÷ 相手サーブ（相手のサーブミスを含む）' },
  { id: 'bp', label: 'BP%', value: c => ratio(c.bpWon, c.serve), format: pct, higher: true, title: 'BP 得点 ÷ サーブ' },
  { id: 'kill', label: 'ATTACK KILL%', value: c => ratio(c.kill, c.attack), format: pct, higher: true, title: 'アタック決定（#）÷ 打数' },
  { id: 'eff', label: 'ATTACK EFF', value: c => ratio(c.kill - c.attackErr - c.blocked, c.attack), format: pct, higher: true, title: '（決定 − ミス − 被ブロック）÷ 打数' },
  // The team's serve index: each serve weighed by its evaluation (SERVE_WEIGHTS), per serve.
  { id: 'serveIndex', label: 'SERVE INDEX', value: c => ratio(c.serveWeight, c.serve), format: v => v.toFixed(3), higher: true, title: '（# × 1 ＋ / × 0.752 ＋ + × 0.455 ＋ ! × 0.344 ＋ - × 0.281）÷ サーブ' },
  { id: 'ace', label: 'ACE%', value: c => ratio(c.ace, c.serve), format: pct, higher: true, title: 'サーブエース（#）÷ サーブ' },
  { id: 'err', label: 'ERR%', value: c => ratio(c.serveErr, c.serve), format: pct, higher: false, title: 'サーブミス（=）÷ サーブ' },
  { id: 'rec', label: 'RECEPTION#+%', value: c => ratio(c.recPos, c.rec), format: pct, higher: true, title: 'レセプションの # と + ÷ レセプション' },
  { id: 'block', label: 'BLOCK PTS/SET', value: c => ratio(c.blockPts, c.sets), format: v => v.toFixed(2), higher: true, title: 'ブロック得点（#）÷ セット数' },
]

// Which side is better on a row: 'a', 'b', or null (a tie, or a side with nothing to count).
export function better(row: SkillRow, a: SkillCounts, b: SkillCounts): 'a' | 'b' | null {
  const x = row.value(a), y = row.value(b)
  if (x === null || y === null || row.format(x) === row.format(y)) return null
  return (x > y) === row.higher ? 'a' : 'b'
}

// The matches of a team (by its code) among some DVWs, as the reports take them.
export const teamMatches = (dvws: ParsedDVW[], code: string): ReportMatch[] => dvws.flatMap(d => {
  const i = d.teams.findIndex(x => x.code.toUpperCase() === code.toUpperCase())
  return i >= 0 ? [{ d, side: i === 0 ? '*' : 'a' as const, label: '' }] : []
})

// ---- the data slide ------------------------------------------------------------------------------
// One side of the slide: a team's code, its name and its figures.
export interface CompareSide { code: string; name: string; counts: SkillCounts }
export const compareSide = (dvws: ParsedDVW[], code: string): CompareSide => {
  const named = dvws.flatMap(d => d.teams).find(x => x.code.toUpperCase() === code.toUpperCase())
  return { code: code.toUpperCase(), name: named?.name ?? '', counts: skillCounts(teamMatches(dvws, code)) }
}

const uid = () => globalThis.crypto.randomUUID()
const REF = 720 // a text's size is in pixels of a 720-high picture
// A text centred in a cell of fixed size (x the cell's middle, y its top; 0..1 of the picture).
function cell(x: number, y: number, w: number, h: number, text: string, size: number, color: string, fill: string | null, extra: { stroke?: string; bold?: boolean; groupId?: string } = {}): Annotation {
  const pad = Math.max(1, (h * REF - size * 1.2) / 2)
  return { id: uid(), kind: 'text', color, x, y: y + pad / REF, text, size, bold: extra.bold ?? true, outline: false, align: 'center', ...(extra.groupId ? { groupId: extra.groupId } : {}),
    box: { fill, fillOpacity: fill ? 1 : 0, stroke: extra.stroke ?? null, strokeWidth: extra.stroke ? 1 : 0, padding: pad, width: w, height: h } }
}

const ASPECT = 16 / 9
export const COMPARE_COLORS = { label: '#1E293B', labelText: '#FFFFFF', value: '#FFFFFF', valueText: '#0F172A', better: '#E0F2FE', betterText: '#DC2626', line: '#CBD5E1' }

// The skill comparison as objects on a slide: a heading, each team's code (with its logo, when there
// is one) above its column, the matches and sets counted, then a row per figure — our team left, the
// label in the middle, the other team right — the better figure in red on blue. The table is one
// group; each heading moves on its own.
export function compareSlide(left: CompareSide, right: CompareSide, photos: Record<string, { assetId: string; width: number; height: number }>, ink = '#0F172A'): Annotation[] {
  const out: Annotation[] = [], c = COMPARE_COLORS
  const valueW = 0.24, labelW = 0.26, gap = 0.006
  const mid = 0.5, lx = mid - labelW / 2 - gap - valueW / 2, rx = mid + labelW / 2 + gap + valueW / 2
  out.push({ id: uid(), kind: 'text', color: ink, x: mid, y: 0.03, text: 'SKILL COMPARISON', size: 30, bold: true, outline: false, align: 'center' })
  // The teams: logo and code, the name under it, the matches and sets.
  const head = (side: CompareSide, x: number, logoFirst: boolean) => {
    const g = uid(), logo = photos[`logo:${side.code}`], codeSize = 44, top = 0.1
    const codeW = (side.code.length * codeSize * 0.68) / 1280
    if (logo) {
      const h = 0.1, w = (h * logo.width) / logo.height / ASPECT
      const lx0 = logoFirst ? x - codeW / 2 - 0.012 - w : x + codeW / 2 + 0.012
      out.push({ id: uid(), kind: 'image', color: '#FFFFFF', x: lx0, y: top + 0.005, w, h, assetId: logo.assetId, groupId: g })
    }
    out.push({ id: uid(), kind: 'text', color: ink, x, y: top + 0.012, text: side.code, size: codeSize, bold: true, outline: false, align: 'center', groupId: g })
    out.push({ id: uid(), kind: 'text', color: ink, x, y: top + 0.105, text: `${side.name ? `${side.name} · ` : ''}${side.counts.matches} ${side.counts.matches === 1 ? 'match' : 'matches'} · ${side.counts.sets} ${side.counts.sets === 1 ? 'set' : 'sets'}`, size: 16, bold: false, outline: false, align: 'center', groupId: g })
  }
  head(left, lx, true)
  head(right, rx, false)
  const top = 0.255, rowH = (0.965 - top) / SKILL_ROWS.length, g = uid()
  SKILL_ROWS.forEach((r, i) => {
    const y = top + i * rowH, h = rowH - gap * ASPECT, win = better(r, left.counts, right.counts)
    const value = (side: CompareSide) => { const v = r.value(side.counts); return v === null ? '–' : r.format(v) }
    const side = (x: number, s: CompareSide, mine: boolean) =>
      out.push(cell(x, y, valueW, h, value(s), 30, mine ? c.betterText : c.valueText, mine ? c.better : c.value, { stroke: c.line, groupId: g }))
    side(lx, left, win === 'a')
    out.push(cell(mid, y, labelW, h, r.label, 22, c.labelText, c.label, { groupId: g }))
    side(rx, right, win === 'b')
  })
  return out
}
