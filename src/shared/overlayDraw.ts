// Drawing for the automatic overlays — the design picked in the M6 review: black plates with
// slanted ends, an accent block for the number, Bahnschrift bold. One renderer for the preview and
// the export. Layout is authored at 720p and scaled by H / 720 × the element's own scale.
import type { Anchor, CaptionData, OverlaySettings, OverlayTheme, ScoreboardData } from './overlay'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const OVERLAY_FONT = 'Bahnschrift, "Arial Narrow", "Segoe UI", sans-serif'
const TEXT = '#FFFFFF'
const SUB = '#BDBDBD'
const MUTED = '#8F8F8F'

export function drawScoreboard(ctx: Ctx, W: number, H: number, d: ScoreboardData, s: OverlaySettings['scoreboard'], theme: OverlayTheme): void {
  const k = (H / 720) * s.scale
  const h = (s.showSets ? 56 : 46) * k, slant = 14 * k, padIn = 20 * k, padOut = 26 * k
  const teamFont = font(19 * k), ptsFont = font(26 * k), setsFont = font(10 * k, 400)

  ctx.save()
  const teamW = (t: string) => measure(ctx, t, teamFont, 0.1 * 19 * k)
  const wL = teamW(d.left) + padIn + padOut, wR = teamW(d.right) + padIn + padOut
  const ptsL = pad2(d.ptsL), ptsR = pad2(d.ptsR), dash = '—'
  const gap = 8 * k
  const pW = measure(ctx, ptsL, ptsFont, 0), dW = measure(ctx, dash, ptsFont, 0), qW = measure(ctx, ptsR, ptsFont, 0)
  const setsText = `SET ${d.setsL} · ${d.setsR}`
  const centerW = Math.max(pW + dW + qW + gap * 2, s.showSets ? measure(ctx, setsText, setsFont, 0.3 * 10 * k) : 0) + 32 * k
  const total = wL + centerW + wR
  const { x, y } = place(s.anchor, total, h, W, H)

  // Left plate (slanted outer edge), center block, right plate.
  fillPoly(ctx, theme.base, [[x + slant, y], [x + wL, y], [x + wL, y + h], [x, y + h]])
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[x + wL, y], [x + wL + centerW, y], [x + wL + centerW, y + h], [x + wL, y + h]])
  const xr = x + wL + centerW
  fillPoly(ctx, theme.base, [[xr, y], [xr + wR, y], [xr + wR - slant, y + h], [xr, y + h]])

  ctx.textBaseline = 'middle'
  text(ctx, d.left, x + padOut, y + h / 2, teamFont, TEXT, 0.1 * 19 * k)
  text(ctx, d.right, xr + padIn, y + h / 2, teamFont, SUB, 0.1 * 19 * k)

  const cy = s.showSets ? y + h * 0.4 : y + h / 2
  let px = x + wL + (centerW - (pW + dW + qW + gap * 2)) / 2
  // No mark for who took the rally: an underline read as "serving".
  text(ctx, ptsL, px, cy, ptsFont, TEXT, 0)
  px += pW + gap
  text(ctx, dash, px, cy, ptsFont, '#6B6B6B', 0)
  px += dW + gap
  text(ctx, ptsR, px, cy, ptsFont, TEXT, 0)
  if (s.showSets) {
    const sw = measure(ctx, setsText, setsFont, 0.3 * 10 * k)
    text(ctx, setsText, x + wL + (centerW - sw) / 2, y + h * 0.8, setsFont, MUTED, 0.3 * 10 * k)
  }
  ctx.restore()
}

export function drawCaption(ctx: Ctx, W: number, H: number, d: CaptionData, s: OverlaySettings['playerCaption'], theme: OverlayTheme): void {
  if (d.number === null && !d.name && !d.line) return
  const k = (H / 720) * s.scale
  const h = (d.line && d.name ? 56 : 44) * k, slant = 10 * k
  const numFont = font(26 * k), nameFont = font(19 * k), lineFont = font(11 * k, 400)

  ctx.save()
  const numW = d.number !== null ? measure(ctx, String(d.number), numFont, 0) + 30 * k : 0
  const nameW = d.name ? measure(ctx, d.name, nameFont, 0.06 * 19 * k) : 0
  const lineW = d.line ? measure(ctx, d.line, lineFont, 0.2 * 11 * k) : 0
  const plateW = Math.max(nameW, lineW) + 42 * k
  const overlap = numW ? 6 * k : 0
  const total = numW + plateW - overlap
  const { x, y } = place(s.anchor, total, h, W, H)

  // Plate first so the number block's slanted edge sits on top of it.
  const px = x + numW - overlap
  fillPoly(ctx, theme.base, [[px + slant, y], [px + plateW, y], [px + plateW - 14 * k, y + h], [px, y + h]])
  if (numW) {
    fillPoly(ctx, theme.accent, [[x, y], [x + numW, y], [x + numW - slant, y + h], [x, y + h]])
    ctx.textBaseline = 'middle'
    const nw = measure(ctx, String(d.number), numFont, 0)
    text(ctx, String(d.number), x + (numW - slant - nw) / 2, y + h / 2, numFont, onColor(theme.accent), 0)
  }
  const tx = px + slant + 12 * k
  ctx.textBaseline = 'middle'
  if (d.name && d.line) {
    text(ctx, d.name, tx, y + h * 0.38, nameFont, TEXT, 0.06 * 19 * k)
    text(ctx, d.line, tx, y + h * 0.74, lineFont, mix(theme.accent, '#FFFFFF', 0.45), 0.2 * 11 * k)
  } else if (d.name) {
    text(ctx, d.name, tx, y + h / 2, nameFont, TEXT, 0.06 * 19 * k)
  } else if (d.line) {
    text(ctx, d.line, tx, y + h / 2, lineFont, mix(theme.accent, '#FFFFFF', 0.45), 0.2 * 11 * k)
  }
  ctx.restore()
}

// Full-frame card at the head of a marker group: small match line over "[n] MARKER NAME".
// marker null = a scene card: the scene name, a little larger, behind a narrow accent block.
export function drawTitleCard(ctx: Ctx, W: number, H: number, d: { marker: number | null; name: string; match: string | null }, s: OverlaySettings['titleCard'], theme: OverlayTheme): void {
  const k = H / 720
  ctx.save()
  fillRect(ctx, mix(theme.base, '#000000', 0.4), 0, 0, W, H)
  if (d.marker === null) { drawSceneCard(ctx, W, H, k, d.name, s.showMatch ? d.match : null, theme); ctx.restore(); return }
  // Marker cards: 3× the base size, the title's top-left at 10% from the left and 30% from the top
  // (shrunk to stay inside the frame when the name is long).
  const name = (s.showMarkerName && d.name ? d.name : `MARKER ${d.marker}`).toUpperCase()
  const match = s.showMatch && d.match ? d.match : null
  const x = W * 0.1, top = H * 0.3
  const layout = (q: number) => {
    const numW = measure(ctx, String(d.marker), font(24 * q), 0) + 32 * q
    const plateW = measure(ctx, name, font(28 * q), 0.08 * 28 * q) + 46 * q
    return { numW, plateW, total: numW + plateW - 6 * q }
  }
  let q = k * 3
  const first = layout(q)
  if (x + first.total > W * 0.95) q *= (W * 0.95 - x) / first.total
  const { numW, plateW } = layout(q)
  const numFont = font(24 * q), nameFont = font(28 * q), matchFont = font(12 * q, 400)
  const h = 46 * q, slant = 10 * q
  ctx.textBaseline = 'middle'
  if (match) text(ctx, match, x, top + 8 * q, matchFont, MUTED, 0.4 * 12 * q)
  const y = top + (match ? 22 * q : 0)
  const px = x + numW - 6 * q
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[px + slant, y], [px + plateW, y], [px + plateW - 14 * q, y + h], [px, y + h]])
  fillPoly(ctx, theme.accent, [[x, y], [x + numW, y], [x + numW - slant, y + h], [x, y + h]])
  const nw = measure(ctx, String(d.marker), numFont, 0)
  text(ctx, String(d.marker), x + (numW - slant - nw) / 2, y + h / 2, numFont, onColor(theme.accent), 0)
  text(ctx, name, px + slant + 14 * q, y + h / 2, nameFont, TEXT, 0.08 * 28 * q)
  ctx.restore()
}

function drawSceneCard(ctx: Ctx, W: number, H: number, k: number, name: string, match: string | null, theme: OverlayTheme): void {
  const nameFont = font(36 * k), matchFont = font(12 * k, 400)
  const label = (name || 'SCENE').toUpperCase()
  const blockW = 22 * k, h = 58 * k, slant = 12 * k
  const plateW = measure(ctx, label, nameFont, 0.08 * 36 * k) + 56 * k
  const total = blockW + plateW - 6 * k
  const x = (W - total) / 2, y = H / 2 - h / 2 + (match ? 12 * k : 0)
  if (match) {
    const mw = measure(ctx, match, matchFont, 0.4 * 12 * k)
    ctx.textBaseline = 'middle'
    text(ctx, match, (W - mw) / 2, y - 26 * k, matchFont, MUTED, 0.4 * 12 * k)
  }
  const px = x + blockW - 6 * k
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[px + slant, y], [px + plateW, y], [px + plateW - 16 * k, y + h], [px, y + h]])
  fillPoly(ctx, theme.accent, [[x, y], [x + blockW, y], [x + blockW - slant, y + h], [x, y + h]])
  ctx.textBaseline = 'middle'
  text(ctx, label, px + slant + 18 * k, y + h / 2, nameFont, TEXT, 0.08 * 36 * k)
}

// Top / bottom × left / center / right, with a margin of 2.5% of the height.
export function place(a: Anchor, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const m = H * 0.025
  const x = a[1] === 'l' ? m : a[1] === 'r' ? W - m - w : (W - w) / 2
  const y = a[0] === 't' ? m : H - m - h
  return { x, y }
}

function font(px: number, weight = 700): string {
  return `${weight} ${px}px ${OVERLAY_FONT}`
}

// Letter spacing is drawn by hand: Canvas letterSpacing isn't available in every context we draw in.
function measure(ctx: Ctx, s: string, f: string, spacing: number): number {
  ctx.font = f
  return ctx.measureText(s).width + spacing * Math.max(0, s.length - 1)
}

function text(ctx: Ctx, s: string, x: number, y: number, f: string, color: string, spacing: number): void {
  ctx.font = f
  ctx.fillStyle = color
  if (!spacing) { ctx.fillText(s, x, y); return }
  let cx = x
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing }
}

function fillPoly(ctx: Ctx, color: string, pts: [number, number][]): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fill()
}

function fillRect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// #RRGGBB blend; t = share of `b`.
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

// White or near-black text, whichever reads better on the accent.
export function onColor(bg: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6 ? '#111111' : '#FFFFFF'
}
