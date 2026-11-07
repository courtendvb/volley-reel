// A direction chart: a player's attacks or serves on a small court seen from above, coloured by how
// each ended, with their numbers. Drawn on the video from the court tab, or on a slide. Pure: the draw function
// takes a canvas context, no DOM access.
import { heatColor, heatGrid } from './court'
import type { ParsedDVW, Play } from './types'

interface Pt { x: number; y: number }
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type ChartResult = 'kill' | 'error' | 'blocked' | 'pos' | 'neg'
export type ChartCorner = 'tl' | 'tr' | 'bl' | 'br'
// all the player's shots, those of the attack code (a serve has none: all of them), of the start zone, or those in the search
export type ChartScope = 'player' | 'code' | 'zone' | 'filter'

// What a chart looks like, kept with it on a slide.
export interface ChartLook {
  lines: boolean; stats: boolean; name: boolean; colors: Record<ChartResult, string>
  points?: boolean // the landings as points; missing: yes
  heat?: boolean // a heatmap of the landings under them
  lineOpacity?: number // 0..1; missing: LINE_OPACITY
  lineColors?: Record<string, string> // the lines by evaluation (# + ! - / =); missing: the point's colour
}
export const LINE_OPACITY = 0.7
export type ChartDisplay = Partial<Pick<ChartLook, 'points' | 'lines' | 'heat' | 'lineOpacity' | 'lineColors'>>
export const CHART_EFFECTS = ['#', '+', '!', '-', '/', '=']
export interface ChartStyle extends ChartLook { scope: ChartScope; corner: ChartCorner; scale: number }

export const DEFAULT_CHART: ChartStyle = {
  lines: true, points: true, heat: false, lineOpacity: LINE_OPACITY, stats: false, name: false, scope: 'code', corner: 'tr', scale: 1,
  colors: { kill: '#22C55E', error: '#DC2626', blocked: '#111827', pos: '#F59E0B', neg: '#94A3B8' },
}

// A chart setting as read back: anything missing or of the wrong kind takes the usual value.
export function cleanChart(x: unknown): ChartStyle {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<ChartStyle>
  const colors = { ...DEFAULT_CHART.colors }
  for (const k of Object.keys(colors) as ChartResult[]) if (typeof o.colors?.[k] === 'string') colors[k] = o.colors[k]
  return {
    lines: o.lines !== false, points: o.points !== false, heat: o.heat === true, stats: o.stats === true, name: o.name === true, colors,
    lineOpacity: typeof o.lineOpacity === 'number' && o.lineOpacity >= 0.05 && o.lineOpacity <= 1 ? o.lineOpacity : LINE_OPACITY,
    scope: o.scope === 'player' || o.scope === 'zone' || o.scope === 'filter' ? o.scope : 'code',
    corner: o.corner === 'tl' || o.corner === 'bl' || o.corner === 'br' ? o.corner : 'tr',
    ...(o.lineColors && typeof o.lineColors === 'object' ? { lineColors: Object.fromEntries(Object.entries(o.lineColors).filter(([k, v]) => CHART_EFFECTS.includes(k) && typeof v === 'string')) } : {}),
    scale: typeof o.scale === 'number' && o.scale >= 0.5 && o.scale <= 2 ? o.scale : 1,
  }
}

// A serve's ace counts as a kill and its overpass as blocked: they take those colours.
export const chartResult = (effect: string): ChartResult =>
  effect === '#' ? 'kill' : effect === '=' ? 'error' : effect === '/' ? 'blocked' : effect === '+' ? 'pos' : 'neg'

// The lines' usual colours, by skill; other evaluations take their point's.
const LINE_BLACK = '#000000', LINE_GREEN = '#22C55E', LINE_RED = '#DC2626'
const USUAL_LINES: Record<'A' | 'S', Record<string, string>> = {
  S: { '#': LINE_BLACK, '+': LINE_GREEN, '/': LINE_GREEN },
  A: { '#': LINE_BLACK, '=': LINE_RED, '/': LINE_RED, '+': LINE_GREEN },
}
export const lineColor = (look: Pick<ChartLook, 'colors' | 'lineColors'>, effect: string, skill: 'A' | 'S' = 'A') =>
  look.lineColors?.[effect] ?? USUAL_LINES[skill][effect] ?? look.colors[chartResult(effect)]

// Attempts, kills, errors, blocks (on a serve: aces, errors, overpasses); shares of positive and negative
// ones (the ball stays in play: neg counts '-' and '!'), and the mix: hard, pushed and tipped attacks,
// or the serve types the player used, the most used first.
export interface ChartStats { att: number; k: number; e: number; b: number; pos: number; neg: number; mix: [string, number][] }
export function chartStats(plays: Pick<Play, 'effect' | 'code'>[], skill: 'A' | 'S' = 'A'): ChartStats {
  const att = plays.length, count = (want: (p: Pick<Play, 'effect' | 'code'>) => boolean) => plays.filter(want).length
  const share = (n: number) => (att ? n / att : 0)
  const types = [...new Set(plays.map(p => p.code.charAt(4)))].filter(c => c && c !== '~')
  const mix: [string, number][] = skill === 'S'
    ? types.map((c): [string, number] => [c, share(count(p => p.code.charAt(4) === c))]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : ['H', 'P', 'T'].map(c => [c, share(count(p => p.code.charAt(12) === c))])
  return {
    att, k: count(p => p.effect === '#'), e: count(p => p.effect === '='), b: count(p => p.effect === '/'),
    pos: share(count(p => chartResult(p.effect) === 'pos')), neg: share(count(p => chartResult(p.effect) === 'neg')), mix,
  }
}

// x across, y from the attacker's end line (0) to the other one (1), as court units.
export interface ChartDot { start: Pt | null; end: Pt | null; result: ChartResult; effect?: string; rough?: boolean } // no effect: made before lines had their own colours
export interface DirectionChart { name: string; skill?: 'A' | 'S'; dots: ChartDot[]; stats: ChartStats; look: ChartLook } // no skill: an attack

export function chartName(dvw: ParsedDVW | undefined, play: Pick<Play, 'side' | 'jersey'>): string {
  const p = dvw?.players[`${play.side}${play.jersey}`]
  return p ? `#${p.jersey} ${[p.firstName, p.lastName].filter(Boolean).join(' ')}` : `#${play.jersey}`
}

// Where a chart goes in a w × h picture; in the middle and large on a slide (center).
export interface ChartBox { x: number; y: number; h: number }
const HEAD = 0.075, MARGIN_X = 0.05, MARGIN_Y = 0.16 // of the panel's height; of the court's width at each side
const courtWidth = (h: number, named: boolean) => (h * (1 - (named ? HEAD : 0))) / (2 + MARGIN_Y * 2)
const panelWidth = (h: number, named: boolean) => courtWidth(h, named) * (1 + MARGIN_X * 2)
// A chart's width for a height, both in the same units, with no title bar.
export const chartWidth = (h: number) => panelWidth(h, false)
export function chartBox(w: number, h: number, where: ChartCorner | 'center', scale = 1, named = false): ChartBox {
  if (where === 'center') { const ph = h * 0.92; return { x: (w - panelWidth(ph, named)) / 2, y: h * 0.04, h: ph } }
  const ph = Math.min(h * 0.96, h * 0.6 * scale), edge = h * 0.02
  return { x: where === 'tl' || where === 'bl' ? edge : w - panelWidth(ph, named) - edge, y: where === 'tl' || where === 'tr' ? edge : h - ph - edge, h: ph }
}

// The landings as a small picture of the floor (the court and the 3 m around it, as heatGrid lays it),
// smoothed up when drawn; kept, since charts are drawn again and again while a card is edited.
const heatImages = new WeakMap<ChartDot[], OffscreenCanvas | null>()
function heatImage(dots: ChartDot[]): OffscreenCanvas | null {
  if (heatImages.has(dots)) return heatImages.get(dots)!
  const ends = dots.flatMap(d => (d.end ? [{ end: d.end, rough: !!d.rough }] : []))
  if (!ends.length || typeof OffscreenCanvas === 'undefined') return null
  const { cols, rows, data } = heatGrid(ends.map(e => e.end), ends.map(e => (e.rough ? 1 : 0)))
  const canvas = new OffscreenCanvas(cols, rows), c = canvas.getContext('2d')!, image = c.createImageData(cols, rows)
  data.forEach((v, i) => {
    if (v < 0.04) return
    const [r, g, b] = heatColor(v), at = i * 4
    image.data[at] = r; image.data[at + 1] = g; image.data[at + 2] = b; image.data[at + 3] = 255 * 0.7 * Math.min(1, v * 5)
  })
  c.putImageData(image, 0, 0)
  heatImages.set(dots, canvas)
  return canvas
}

const TEXT = '#0F172A', OFF_COURT = 0.3 // points further off the court than this are left out: a slip of the scout's

export function drawChart(ctx: Ctx, chart: DirectionChart, { x, y, h }: ChartBox): void {
  const { dots, stats, look, name, skill } = chart
  const pw = panelWidth(h, look.name), cw = courtWidth(h, look.name), head = look.name ? h * HEAD : 0
  const left = x + (pw - cw) / 2, top = y + head + cw * MARGIN_Y
  const at = (p: Pt): Pt => ({ x: left + p.x * cw, y: top + p.y * 2 * cw })
  const inView = (p: Pt | null): p is Pt => !!p && p.x > -OFF_COURT && p.x < 1 + OFF_COURT && p.y > -OFF_COURT / 2 && p.y < 1 + OFF_COURT / 2
  const thin = Math.max(1, cw / 170), r = Math.max(1.8, cw / 47)
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, pw, h); ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x, y, pw, h)

  ctx.strokeStyle = TEXT; ctx.lineWidth = thin
  ctx.strokeRect(left, top, cw, cw * 2)
  const across = (v: number, width: number, reach = 0) => { ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(left - reach, top + v * 2 * cw); ctx.lineTo(left + cw + reach, top + v * 2 * cw); ctx.stroke() }
  across(1 / 3, thin); across(2 / 3, thin); across(0.5, thin * 3, cw * 0.05)

  if (look.heat) {
    const image = heatImage(dots)
    if (image) { const metre = cw / 9, m = 3 * metre; ctx.drawImage(image, left - m, top - m, cw + m * 2, cw * 2 + m * 2) }
  }
  if (look.lines) {
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, cw / 110)
    for (const d of dots) {
      if (!inView(d.start) || !inView(d.end)) continue
      const a = at(d.start), b = at(d.end)
      ctx.strokeStyle = d.effect ? lineColor(look, d.effect, skill) : look.colors[d.result]
      ctx.globalAlpha = look.lineOpacity ?? LINE_OPACITY
      ctx.setLineDash(d.rough ? [cw / 40, cw / 50] : [])
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (look.points !== false) for (const d of dots) {
    if (!inView(d.end)) continue
    const p = at(d.end), color = look.colors[d.result]
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    if (d.rough) { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, r * 0.55); ctx.stroke() } else { ctx.fillStyle = color; ctx.fill() }
  }

  // Last, on a pale ground: a serve's lines start behind the end line, right through the numbers.
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (look.name) {
    ctx.fillStyle = '#E2E8F0'; ctx.fillRect(x, y, pw, head)
    ctx.fillStyle = TEXT
    ctx.font = `bold ${head * 0.52}px sans-serif`
    ctx.fillText(name, x + pw / 2, y + head / 2, pw * 0.96)
  }
  if (look.stats) {
    const font = cw * 0.085, line = font * 1.45, mid = left + cw / 2, row = (i: number) => top + line * (i + 0.8)
    const n = (v: number) => (Math.round(v * 100) / 100).toString()
    const rate = (v: number) => (stats.att ? v / stats.att : 0)
    const serve = skill === 'S', errors = serve ? stats.e : stats.e + stats.b
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(left + thin, top + thin, cw - thin * 2, line * 5.3)
    ctx.fillStyle = TEXT
    ctx.font = `${font}px sans-serif`
    ctx.fillText(stats.mix.map(([k, v]) => `${k}: ${n(v)}`).join(' | '), mid, row(0), cw * 0.96)
    ;[[serve ? 'Ace' : 'K', stats.k], ['E', stats.e], [serve ? 'Ov' : 'B', stats.b], ['Att', stats.att]].forEach(([label, value], i) => {
      const cx = left + (cw * (i as number + 0.5)) / 4
      ctx.fillText(String(label), cx, row(1)); ctx.fillText(String(value), cx, row(2))
    })
    ctx.fillText(`${serve ? 'Ace%' : 'K%'}: ${n(rate(stats.k))} | ERR%: ${n(rate(errors))}`, mid, row(3), cw * 0.96)
    ctx.fillText(`Pos: ${n(stats.pos)} | Neg: ${n(stats.neg)}`, mid, row(4), cw * 0.96)
  }
  ctx.restore()
}
