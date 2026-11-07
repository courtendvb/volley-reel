// A direction chart: a player's attacks on a small court seen from above, coloured by how each ended,
// with their numbers. Drawn on the video from the court tab, or on a slide. Pure: the draw function
// takes a canvas context, no DOM access.
import type { ParsedDVW, Play } from './types'

interface Pt { x: number; y: number }
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type ChartResult = 'kill' | 'error' | 'blocked' | 'pos' | 'neg'
export type ChartCorner = 'tl' | 'tr' | 'bl' | 'br'
export type ChartScope = 'player' | 'code' | 'filter' // all the player's attacks, those of the code, or those in the search

// What a chart looks like, kept with it on a slide.
export interface ChartLook { lines: boolean; stats: boolean; colors: Record<ChartResult, string> }
export interface ChartStyle extends ChartLook { scope: ChartScope; corner: ChartCorner; scale: number }

export const DEFAULT_CHART: ChartStyle = {
  lines: true, stats: true, scope: 'player', corner: 'tr', scale: 1,
  colors: { kill: '#22C55E', error: '#DC2626', blocked: '#111827', pos: '#F59E0B', neg: '#94A3B8' },
}

// A chart setting as read back: anything missing or of the wrong kind takes the usual value.
export function cleanChart(x: unknown): ChartStyle {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<ChartStyle>
  const colors = { ...DEFAULT_CHART.colors }
  for (const k of Object.keys(colors) as ChartResult[]) if (typeof o.colors?.[k] === 'string') colors[k] = o.colors[k]
  return {
    lines: o.lines !== false, stats: o.stats !== false, colors,
    scope: o.scope === 'code' || o.scope === 'filter' ? o.scope : 'player',
    corner: o.corner === 'tl' || o.corner === 'bl' || o.corner === 'br' ? o.corner : 'tr',
    scale: typeof o.scale === 'number' && o.scale >= 0.5 && o.scale <= 2 ? o.scale : 1,
  }
}

export const chartResult = (effect: string): ChartResult =>
  effect === '#' ? 'kill' : effect === '=' ? 'error' : effect === '/' ? 'blocked' : effect === '+' ? 'pos' : 'neg'

// Attempts, kills, errors, blocks; shares of positive and negative attacks (the ball stays in play:
// neg counts '-' and '!'), and of hard, pushed and tipped ones.
export interface ChartStats { att: number; k: number; e: number; b: number; pos: number; neg: number; hard: number; push: number; tip: number }
export function chartStats(plays: Pick<Play, 'effect' | 'code'>[]): ChartStats {
  const att = plays.length, count = (want: (p: Pick<Play, 'effect' | 'code'>) => boolean) => plays.filter(want).length
  const share = (n: number) => (att ? n / att : 0)
  return {
    att, k: count(p => p.effect === '#'), e: count(p => p.effect === '='), b: count(p => p.effect === '/'),
    pos: share(count(p => chartResult(p.effect) === 'pos')), neg: share(count(p => chartResult(p.effect) === 'neg')),
    hard: share(count(p => p.code.charAt(12) === 'H')), push: share(count(p => p.code.charAt(12) === 'P')), tip: share(count(p => p.code.charAt(12) === 'T')),
  }
}

// x across, y from the attacker's end line (0) to the other one (1), as court units.
export interface ChartDot { start: Pt | null; end: Pt | null; result: ChartResult; rough?: boolean }
export interface DirectionChart { name: string; dots: ChartDot[]; stats: ChartStats; look: ChartLook }

export function chartName(dvw: ParsedDVW | undefined, play: Pick<Play, 'side' | 'jersey'>): string {
  const p = dvw?.players[`${play.side}${play.jersey}`]
  return p ? `#${p.jersey} ${[p.firstName, p.lastName].filter(Boolean).join(' ')}` : `#${play.jersey}`
}

// Where a chart goes in a w × h picture; in the middle and large on a slide (center).
export interface ChartBox { x: number; y: number; h: number }
const HEAD = 0.075, MARGIN_X = 0.2, MARGIN_Y = 0.16 // of the panel's height; of the court's width at each side
const courtWidth = (h: number) => (h * (1 - HEAD)) / (2 + MARGIN_Y * 2)
const panelWidth = (h: number) => courtWidth(h) * (1 + MARGIN_X * 2)
export function chartBox(w: number, h: number, where: ChartCorner | 'center', scale = 1): ChartBox {
  if (where === 'center') { const ph = h * 0.92; return { x: (w - panelWidth(ph)) / 2, y: h * 0.04, h: ph } }
  const ph = Math.min(h * 0.96, h * 0.6 * scale), edge = h * 0.02
  return { x: where === 'tl' || where === 'bl' ? edge : w - panelWidth(ph) - edge, y: where === 'tl' || where === 'tr' ? edge : h - ph - edge, h: ph }
}

const TEXT = '#0F172A', OFF_COURT = 0.3 // points further off the court than this are left out: a slip of the scout's

export function drawChart(ctx: Ctx, chart: DirectionChart, { x, y, h }: ChartBox): void {
  const { dots, stats, look, name } = chart
  const pw = panelWidth(h), cw = courtWidth(h), head = h * HEAD
  const left = x + (pw - cw) / 2, top = y + head + cw * MARGIN_Y
  const at = (p: Pt): Pt => ({ x: left + p.x * cw, y: top + p.y * 2 * cw })
  const inView = (p: Pt | null): p is Pt => !!p && p.x > -OFF_COURT && p.x < 1 + OFF_COURT && p.y > -OFF_COURT / 2 && p.y < 1 + OFF_COURT / 2
  const thin = Math.max(1, cw / 170), r = Math.max(2, cw / 42)
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, pw, h); ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x, y, pw, h)
  ctx.fillStyle = '#E2E8F0'; ctx.fillRect(x, y, pw, head)

  ctx.strokeStyle = TEXT; ctx.lineWidth = thin
  ctx.strokeRect(left, top, cw, cw * 2)
  const across = (v: number, width: number, reach = 0) => { ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(left - reach, top + v * 2 * cw); ctx.lineTo(left + cw + reach, top + v * 2 * cw); ctx.stroke() }
  across(1 / 3, thin); across(2 / 3, thin); across(0.5, thin * 3, cw * 0.1)

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = TEXT
  ctx.font = `bold ${head * 0.52}px sans-serif`
  ctx.fillText(name, x + pw / 2, y + head / 2, pw * 0.96)
  if (look.stats) {
    const font = cw * 0.085, line = font * 1.45, mid = left + cw / 2, row = (i: number) => top + line * (i + 0.8)
    const n = (v: number) => (Math.round(v * 100) / 100).toString()
    const rate = (v: number) => (stats.att ? v / stats.att : 0)
    ctx.font = `${font}px sans-serif`
    ctx.fillText(`H: ${n(stats.hard)} | P: ${n(stats.push)} | T: ${n(stats.tip)}`, mid, row(0), cw * 0.96)
    ;[['K', stats.k], ['E', stats.e], ['B', stats.b], ['Att', stats.att]].forEach(([label, value], i) => {
      const cx = left + (cw * (i as number + 0.5)) / 4
      ctx.fillText(String(label), cx, row(1)); ctx.fillText(String(value), cx, row(2))
    })
    ctx.fillText(`K%: ${n(rate(stats.k))} | ERR%: ${n(rate(stats.e + stats.b))}`, mid, row(3), cw * 0.96)
    ctx.fillText(`Pos: ${n(stats.pos)} | Neg: ${n(stats.neg)}`, mid, row(4), cw * 0.96)
  }

  if (look.lines) {
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, cw / 110)
    for (const d of dots) {
      if (!inView(d.start) || !inView(d.end)) continue
      const a = at(d.start), b = at(d.end)
      ctx.strokeStyle = look.colors[d.result]
      ctx.globalAlpha = 0.7
      ctx.setLineDash(d.rough ? [cw / 40, cw / 50] : [])
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  for (const d of dots) {
    if (!inView(d.end)) continue
    const p = at(d.end), color = look.colors[d.result]
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    if (d.rough) { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, r * 0.55); ctx.stroke() } else { ctx.fillStyle = color; ctx.fill() }
  }
  ctx.restore()
}
