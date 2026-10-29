// Drawing for the automatic overlays — the design picked in the M6 review: black plates with
// slanted ends, an accent block for the number, Bahnschrift bold. One renderer for the preview and
// the export. Layout is authored at 720p and scaled by H / 720 × the element's own scale.
import type { ImageLookup } from './annotation'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, DEFAULT_VIDEO_LAYOUT, type Anchor, type CaptionData, type CardLayout, type OverlaySettings, type OverlayTheme, type ScoreboardData } from './overlay'
import type { SlideBg } from './reel'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Bahnschrift has no Japanese: names and titles in Japanese fall through to Yu Gothic / Meiryo.
export const OVERLAY_FONT = 'Bahnschrift, "Arial Narrow", "Segoe UI", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif'
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

// The cards' background: the video's choice, else a darker shade of the theme's base.
export function cardBackground(s: OverlaySettings['titleCard'], theme: OverlayTheme): string {
  return s.background ?? mix(theme.base, '#000000', 0.4)
}

// A card's text, one entry per line (a line break in the name starts a new line).
const titleLines = (name: string, fallback: string): string[] => {
  const lines = name.split('\n').map(l => l.trim()).filter(Boolean)
  return (lines.length ? lines : [fallback]).map(l => l.toUpperCase())
}

// Full-frame card at the head of a marker group: small match line over "[n] MARKER NAME".
// marker null = a scene card: the scene name, a little larger, behind a narrow accent block.
// A name with line breaks is drawn as several lines on a taller plate.
// logo: the opponent's logo, drawn beside the marker title or above the scene title.
// Returns the title's box in pixels (for the card editor to grab). Position and size come from
// s.markerLayout / s.sceneLayout, which the editor changes.
export function drawTitleCard(ctx: Ctx, W: number, H: number, d: { marker: number | null; name: string; match: string | null; video?: boolean }, s: OverlaySettings['titleCard'], theme: OverlayTheme, logo?: CanvasImageSource | null): Box {
  const k = H / 720
  ctx.save()
  fillRect(ctx, cardBackground(s, theme), 0, 0, W, H)
  if (d.marker === null) {
    // The video's opening card is drawn like a scene card, larger by default, with its own layout.
    const L = d.video ? s.videoLayout ?? DEFAULT_VIDEO_LAYOUT : s.sceneLayout ?? DEFAULT_SCENE_LAYOUT
    const box = drawSceneCard(ctx, W, H, k, d.name, s.showMatch ? d.match : null, theme, logo ?? null, L)
    ctx.restore()
    return box
  }
  // Marker cards: 3× the base size times the layout's scale, the title's top-left at the layout's
  // point (10% / 30% by default); shrunk to stay inside the frame when the name is long.
  const L = s.markerLayout ?? DEFAULT_MARKER_LAYOUT
  const names = titleLines(s.showMarkerName ? d.name : '', `MARKER ${d.marker}`)
  const more = names.length - 1 // each further line makes the plate 34 (× q) taller
  const match = s.showMatch && d.match ? d.match : null
  const x = W * L.x, top = H * L.y
  const lr = logo ? logoRatio(logo) : 0 // width / height
  // Without the number (showMarkerNumber off) its block is a slim accent stripe, as on scene cards.
  const showNum = s.showMarkerNumber !== false
  const layout = (q: number) => {
    const numW = showNum ? measure(ctx, String(d.marker), font(24 * q), 0) + 32 * q : 16 * q
    const plateW = Math.max(...names.map(n => measure(ctx, n, font(28 * q), 0.08 * 28 * q))) + 46 * q
    const logoH = (match ? 22 * q : 0) + (46 + 34 * more) * q
    const matchW = match ? measure(ctx, match, font(12 * q, 400), 0.4 * 12 * q) : 0
    const total = Math.max(numW + plateW - 6 * q, matchW) // the logo goes after the plate or the match line, whichever is wider
    return { numW, plateW, logoH, total: total + (logo ? 28 * q + logoH * lr : 0) }
  }
  let q = k * 3 * L.scale
  const first = layout(q)
  if (x + first.total > W * 0.98) q *= Math.max(0.2, (W * 0.98 - x) / first.total)
  const { numW, plateW, logoH, total } = layout(q)
  const numFont = font(24 * q), nameFont = font(28 * q), matchFont = font(12 * q, 400)
  const h = (46 + 34 * more) * q, slant = 10 * q
  ctx.textBaseline = 'middle'
  if (match) text(ctx, match, x, top + 8 * q, matchFont, MUTED, 0.4 * 12 * q)
  const y = top + (match ? 22 * q : 0)
  const px = x + numW - 6 * q
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[px + slant, y], [px + plateW, y], [px + plateW - 14 * q, y + h], [px, y + h]])
  fillPoly(ctx, theme.accent, [[x, y], [x + numW, y], [x + numW - slant, y + h], [x, y + h]])
  if (showNum) {
    const nw = measure(ctx, String(d.marker), numFont, 0)
    text(ctx, String(d.marker), x + (numW - slant - nw) / 2, y + h / 2, numFont, onColor(theme.accent), 0)
  }
  names.forEach((n, i) => text(ctx, n, px + slant + 14 * q, y + h / 2 + (i - more / 2) * 34 * q, nameFont, TEXT, 0.08 * 28 * q))
  if (logo) ctx.drawImage(logo, x + total - logoH * lr, top, logoH * lr, logoH) // as tall as the whole title
  ctx.restore()
  return { x, y: top, w: total, h: logoH }
}

export interface Box { x: number; y: number; w: number; h: number }

// A card or a slide (a card with `slide`). Returns the title's box, or null for a slide.
export function drawCard(ctx: Ctx, W: number, H: number, card: Parameters<typeof drawTitleCard>[3] & { slide?: { bg: SlideBg } }, s: OverlaySettings['titleCard'],
  theme: OverlayTheme, logo: CanvasImageSource | null, image: ImageLookup): Box | null {
  if (!card.slide) return drawTitleCard(ctx, W, H, card, s, theme, logo)
  drawSlide(ctx, W, H, card.slide.bg, cardBackground(s, theme), image)
  return null
}

// A slide's page: blank in the title cards' background color, or its picture fitted inside the
// frame on black (a 4:3 page gets bars). Drawn black while the picture loads.
export function drawSlide(ctx: Ctx, W: number, H: number, bg: SlideBg, cardBg: string, image: ImageLookup): void {
  if (bg.kind === 'blank') { fillRect(ctx, cardBg, 0, 0, W, H); return }
  fillRect(ctx, '#000000', 0, 0, W, H)
  const img = image(bg.assetId)
  if (!img) return
  const iw = Number((img as { width: number }).width), ih = Number((img as { height: number }).height)
  if (!iw || !ih) return
  const q = Math.min(W / iw, H / ih)
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (W - iw * q) / 2, (H - ih * q) / 2, iw * q, ih * q)
  ctx.restore()
}

function logoRatio(img: CanvasImageSource): number {
  const w = (img as { width: number }).width, h = (img as { height: number }).height
  return w > 0 && h > 0 ? w / h : 1
}

// The scene title (with its match line and the logo above), centered on the layout's point.
function drawSceneCard(ctx: Ctx, W: number, H: number, k0: number, name: string, match: string | null, theme: OverlayTheme, logo: CanvasImageSource | null, L: CardLayout): Box {
  const k = k0 * L.scale
  const nameFont = font(36 * k), matchFont = font(12 * k, 400)
  const labels = titleLines(name, 'SCENE')
  const more = labels.length - 1 // each further line makes the plate 44 (× k) taller
  const blockW = 22 * k, h = (58 + 44 * more) * k, slant = 12 * k
  const plateW = Math.max(...labels.map(l => measure(ctx, l, nameFont, 0.08 * 36 * k))) + 56 * k
  const total = blockW + plateW - 6 * k
  const mw = match ? measure(ctx, match, matchFont, 0.4 * 12 * k) : 0
  // Logo: at most 120 px tall at 720p and half the width.
  let lh = logo ? 120 * k : 0, lw = logo ? lh * logoRatio(logo) : 0
  if (logo && lw > W * 0.5) { lw = W * 0.5; lh = lw / logoRatio(logo) }
  // Heights above the plate's top: the match line, then the logo.
  const above = logo ? (match ? 44 : 20) * k + lh : match ? 32 * k : 0
  const cx = W * L.x, y = H * L.y - (above + h) / 2 + above
  const x = cx - total / 2
  if (match) {
    ctx.textBaseline = 'middle'
    text(ctx, match, cx - mw / 2, y - 26 * k, matchFont, MUTED, 0.4 * 12 * k)
  }
  if (logo) ctx.drawImage(logo, cx - lw / 2, y - (match ? 44 : 20) * k - lh, lw, lh)
  const px = x + blockW - 6 * k
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[px + slant, y], [px + plateW, y], [px + plateW - 16 * k, y + h], [px, y + h]])
  fillPoly(ctx, theme.accent, [[x, y], [x + blockW, y], [x + blockW - slant, y + h], [x, y + h]])
  ctx.textBaseline = 'middle'
  labels.forEach((l, i) => text(ctx, l, px + slant + 18 * k, y + h / 2 + (i - more / 2) * 44 * k, nameFont, TEXT, 0.08 * 36 * k))
  const w = Math.max(total, mw, lw)
  return { x: cx - w / 2, y: y - above, w, h: above + h }
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
