// Drawing for the automatic overlays — the design picked in the M6 review: black plates with
// slanted ends, an accent block for the number, Bahnschrift bold. One renderer for the preview and
// the export. Layout is authored at 720p and scaled by H / 720 × the element's own scale.
import type { ImageLookup } from './annotation'
import type { Ctx } from './court'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, DEFAULT_VIDEO_LAYOUT, sceneTopLeft, type Anchor, type CaptionData, type CaptionStat, type CardKind, type CardLayout, type LookTheme, type OverlaySettings, type OverlayTheme, type ScoreboardData } from './overlay'
import type { SlideBg } from './reel'


// Bahnschrift has no Japanese: names and titles in Japanese fall through to Yu Gothic / Meiryo.
// A Mac has no Bahnschrift: Arial Narrow, then Hiragino for Japanese.
const OVERLAY_FONT = 'Bahnschrift, "Arial Narrow", "Segoe UI", "Yu Gothic UI", "Yu Gothic", Meiryo, "Hiragino Sans", sans-serif'
const TEXT = '#FFFFFF'
const SUB = '#BDBDBD'
const MUTED = '#8F8F8F'

export function drawScoreboard(ctx: Ctx, W: number, H: number, d: ScoreboardData, s: OverlaySettings['scoreboard'], theme: LookTheme): void {
  const k = (H / 720) * s.scale, L = lookOf(theme, k)
  const h = (s.showSets ? 56 : 46) * k, slant = 14 * k, padIn = 20 * k, padOut = 26 * k
  const teamFont = font(19 * k), ptsFont = font(26 * k), setsFont = font(10 * k, 400)

  ctx.save()
  L.begin(ctx)
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
  L.shape(ctx, 'plate', x, y, wL, h, { tl: slant }, { l: true })
  L.shape(ctx, 'plate2', x + wL, y, centerW, h)
  const xr = x + wL + centerW
  L.shape(ctx, 'plate', xr, y, wR, h, { br: slant }, { r: true })

  L.texts(ctx)
  ctx.textBaseline = 'middle'
  text(ctx, d.left, x + padOut, y + h / 2, teamFont, L.text, 0.1 * 19 * k)
  text(ctx, d.right, xr + padIn, y + h / 2, teamFont, L.sub, 0.1 * 19 * k)

  const cy = s.showSets ? y + h * 0.4 : y + h / 2
  let px = x + wL + (centerW - (pW + dW + qW + gap * 2)) / 2
  // No mark for who took the rally: an underline read as "serving".
  text(ctx, ptsL, px, cy, ptsFont, L.text, 0)
  px += pW + gap
  text(ctx, dash, px, cy, ptsFont, L.dash, 0)
  px += dW + gap
  text(ctx, ptsR, px, cy, ptsFont, L.text, 0)
  if (s.showSets) {
    const sw = measure(ctx, setsText, setsFont, 0.3 * 10 * k)
    text(ctx, setsText, x + wL + (centerW - sw) / 2, y + h * 0.8, setsFont, L.muted, 0.3 * 10 * k)
  }
  ctx.restore()
}

// photo: the player's photo (when the caption shows one), put above a caption at the bottom, below one at the top.
export function drawCaption(ctx: Ctx, W: number, H: number, d: CaptionData, s: OverlaySettings['playerCaption'], theme: LookTheme, photo?: Photo | null): void {
  if (d.number === null && !d.name && !d.line) return
  const k = (H / 720) * s.scale, L = lookOf(theme, k)
  const h = (d.line && d.name ? 56 : 44) * k, slant = 10 * k
  const numFont = font(26 * k), nameFont = font(19 * k), lineFont = font(11 * k, 400)

  ctx.save()
  L.begin(ctx)
  const numW = d.number !== null ? measure(ctx, String(d.number), numFont, 0) + 30 * k : 0
  const nameW = d.name ? measure(ctx, d.name, nameFont, 0.06 * 19 * k) : 0
  const lineW = d.line ? measure(ctx, d.line, lineFont, 0.2 * 11 * k) : 0
  const plateW = Math.max(nameW, lineW) + 42 * k
  const overlap = numW ? 6 * k : 0
  // The player's figures on a plate of their own right after it: each a label over its percentage,
  // with the count it comes from beside that.
  const stats = d.stats?.length ? d.stats : null
  const labFont = font(10 * k), valFont = font(27 * k), cntFont = font(11 * k, 400), statGap = 18 * k, statPad = 14 * k
  const statW = (st: CaptionStat) => Math.max(measure(ctx, st.label, labFont, 0.15 * 10 * k), measure(ctx, st.value, valFont, 0) + (st.count ? 5 * k + measure(ctx, st.count, cntFont, 0) : 0))
  const statsW = stats ? stats.reduce((w, st) => w + statW(st), 0) + statGap * (stats.length - 1) + 2 * statPad + L.cut(slant) : 0
  const join = stats ? 4 * k : 0
  const total = numW + plateW - overlap + join + statsW
  const { x, y } = place(s.anchor, total, h, W, H)

  // Plate first so the number block's slanted edge sits on top of it.
  const px = x + numW - overlap
  L.shape(ctx, 'plate', px, y, plateW, h, { tl: slant, br: 14 * k }, { l: !numW, r: true })
  if (numW) {
    L.shape(ctx, 'accent', x, y, numW, h, { br: slant }, { l: true })
    L.texts(ctx)
    ctx.textBaseline = 'middle'
    const nw = measure(ctx, String(d.number), numFont, 0)
    text(ctx, String(d.number), x + (numW - L.cut(slant) - nw) / 2, y + h / 2, numFont, L.onAccent, 0)
  }
  L.texts(ctx)
  const tx = px + L.cut(slant) + 12 * k
  ctx.textBaseline = 'middle'
  if (d.name && d.line) {
    text(ctx, d.name, tx, y + h * 0.38, nameFont, L.text, 0.06 * 19 * k)
    text(ctx, d.line, tx, y + h * 0.74, lineFont, L.line, 0.2 * 11 * k)
  } else if (d.name) {
    text(ctx, d.name, tx, y + h / 2, nameFont, L.text, 0.06 * 19 * k)
  } else if (d.line) {
    text(ctx, d.line, tx, y + h / 2, lineFont, L.line, 0.2 * 11 * k)
  }
  if (stats) {
    const sx = px + plateW + join
    L.shape(ctx, 'plate', sx, y, statsW, h, { tl: slant, br: 14 * k }, { r: true })
    L.texts(ctx)
    ctx.textBaseline = 'middle'
    let bx = sx + L.cut(slant) + statPad
    for (const st of stats) {
      // The label high up, so the percentage below it can be large.
      text(ctx, st.label, bx, y + h * 0.17, labFont, L.line, 0.15 * 10 * k)
      const vw = measure(ctx, st.value, valFont, 0)
      text(ctx, st.value, bx, y + h * 0.62, valFont, L.text, 0)
      if (st.count) text(ctx, st.count, bx + vw + 5 * k, y + h * 0.72, cntFont, L.sub, 0)
      bx += statW(st) + statGap
    }
  }
  if (photo && s.photo) drawCaptionPhoto(ctx, photo, s.anchor, { x, y, w: total, h }, k, theme)
  ctx.restore()
}

// A serve's speed on its own plate: an accent block saying what it is, the number large on the plate.
export function drawServeSpeed(ctx: Ctx, W: number, H: number, kmh: number, s: OverlaySettings['serveSpeed'], theme: LookTheme): void {
  const k = (H / 720) * s.scale, L = lookOf(theme, k)
  const h = 50 * k, slant = 12 * k
  const tagFont = font(11 * k, 400), numFont = font(30 * k), unitFont = font(13 * k, 400)
  const tag1 = 'SERVE', tag2 = 'SPEED', num = String(Math.round(kmh)), unit = 'km/h'
  ctx.save()
  L.begin(ctx)
  const tagW = Math.max(measure(ctx, tag1, tagFont, 0.2 * 11 * k), measure(ctx, tag2, tagFont, 0.2 * 11 * k)) + 30 * k
  const nW = measure(ctx, num, numFont, 0), uW = measure(ctx, unit, unitFont, 0.05 * 13 * k)
  const plateW = nW + 6 * k + uW + 40 * k
  const total = tagW + plateW - 6 * k
  const { x, y } = place(s.anchor, total, h, W, H)
  const px = x + tagW - 6 * k
  L.shape(ctx, 'plate', px, y, plateW, h, { tl: slant, br: slant }, { r: true })
  L.shape(ctx, 'accent', x, y, tagW, h, { tl: slant, br: slant }, { l: true })
  L.texts(ctx)
  ctx.textBaseline = 'middle'
  const sx = x + L.cut(slant) + (L.cut(slant) ? 6 : 14) * k
  text(ctx, tag1, sx, y + h * 0.36, tagFont, L.onAccent, 0.2 * 11 * k)
  text(ctx, tag2, sx, y + h * 0.68, tagFont, L.onAccent, 0.2 * 11 * k)
  const nx = px + L.cut(slant) + 12 * k
  text(ctx, num, nx, y + h / 2, numFont, L.text, 0)
  text(ctx, unit, nx + nW + 6 * k, y + h * 0.58, unitFont, L.sub, 0.05 * 13 * k)
  ctx.restore()
}

type Photo = CanvasImageSource & { width: number; height: number }

// The photo as it is (cut-outs keep their transparent background), lined up with the caption's side
// (left, center or right), with an accent edge on the side that faces it.
function drawCaptionPhoto(ctx: Ctx, photo: Photo, a: Anchor, cap: Box, k: number, theme: OverlayTheme): void {
  const ph = 132 * k, pw = ph * (photo.width / photo.height), gap = 6 * k, edge = 3 * k
  const x = a[1] === 'l' ? cap.x : a[1] === 'r' ? cap.x + cap.w - pw : cap.x + (cap.w - pw) / 2
  const below = a[0] === 't'
  const y = below ? cap.y + cap.h + gap : cap.y - gap - ph
  ctx.drawImage(photo, x, y, pw, ph)
  fillRect(ctx, theme.accent, x, below ? y : y + ph - edge, pw, edge)
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
// The logo can instead have its own place and size (s.logos, per kind of card) or be left out; the
// returned box then carries the logo's own box too, for the editor.
export function drawTitleCard(ctx: Ctx, W: number, H: number, d: { marker: number | null; name: string; match: string | null; video?: boolean; layout?: CardLayout }, s: OverlaySettings['titleCard'], theme: OverlayTheme, logo0?: CanvasImageSource | null): TitleBox {
  const k = H / 720
  const place = logo0 ? s.logos?.[cardKind(d)] : undefined
  const logo = place === undefined ? logo0 ?? null : null // drawn with the title
  ctx.save()
  fillRect(ctx, cardBackground(s, theme), 0, 0, W, H)
  const own = (): Box | undefined => {
    if (!logo0 || !place || place === 'hidden') return undefined
    const h = place.h * H, w = h * logoRatio(logo0), b = { x: place.x * W - w / 2, y: place.y * H - h / 2, w, h }
    ctx.drawImage(logo0, b.x, b.y, b.w, b.h)
    return b
  }
  if (d.marker === null) {
    // The video's opening card is drawn like a scene card, larger by default, with its own layout.
    const L = sceneTopLeft(d.layout ?? (d.video ? s.videoLayout ?? DEFAULT_VIDEO_LAYOUT : s.sceneLayout ?? DEFAULT_SCENE_LAYOUT))
    const box = drawSceneCard(ctx, W, H, k, d.name, s.showMatch ? d.match : null, theme, logo, L)
    const ownBox = own()
    ctx.restore()
    return ownBox ? { ...box, logo: ownBox } : box
  }
  // Marker cards: 3× the base size times the layout's scale, the title's top-left at the layout's
  // point (10% / 30% by default); shrunk to stay inside the frame when the name is long.
  const L = d.layout ?? s.markerLayout ?? DEFAULT_MARKER_LAYOUT
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
  const logoBox = logo ? { x: x + total - logoH * lr, y: top, w: logoH * lr, h: logoH } : own()
  if (logo) ctx.drawImage(logo, logoBox!.x, logoBox!.y, logoBox!.w, logoBox!.h) // as tall as the whole title
  ctx.restore()
  return { x, y: top, w: total, h: logoH, ...(logoBox ? { logo: logoBox } : {}) }
}

export interface Box { x: number; y: number; w: number; h: number }
export type TitleBox = Box & { logo?: Box } // the logo's box, beside the title or on its own
export const cardKind = (d: { marker: number | null; video?: boolean }): CardKind => (d.video ? 'video' : d.marker === null ? 'scene' : 'marker')

// A card or a slide (a card with `slide`). Returns the title's box, or null for a slide.
export function drawCard(ctx: Ctx, W: number, H: number, card: Parameters<typeof drawTitleCard>[3] & { slide?: { bg: SlideBg } }, s: OverlaySettings['titleCard'],
  theme: OverlayTheme, logo: CanvasImageSource | null, image: ImageLookup): TitleBox | null {
  if (!card.slide) return drawTitleCard(ctx, W, H, card, s, theme, logo)
  drawSlide(ctx, W, H, card.slide.bg, cardBackground(s, theme), image)
  return null
}

// A slide's page: blank in the title cards' background color, or its picture fitted inside the
// frame on black (a 4:3 page gets bars). Drawn black while the picture loads.
function drawSlide(ctx: Ctx, W: number, H: number, bg: SlideBg, cardBg: string, image: ImageLookup): void {
  if (bg.kind === 'blank') { fillRect(ctx, bg.color ?? cardBg, 0, 0, W, H); return }
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

// The scene title (with the logo and the match line above it), its top-left at the layout's point
// (sceneTopLeft): a longer title grows to the right, and is made smaller to stay inside the frame.
function drawSceneCard(ctx: Ctx, W: number, H: number, k0: number, name: string, match: string | null, theme: OverlayTheme, logo: CanvasImageSource | null, L: CardLayout): TitleBox {
  const labels = titleLines(name, 'SCENE')
  const more = labels.length - 1 // each further line makes the plate 44 (× k) taller
  const x = W * L.x, top = H * L.y
  const sizes = (k: number) => {
    const plateW = Math.max(...labels.map(l => measure(ctx, l, font(36 * k), 0.08 * 36 * k))) + 56 * k
    const total = 22 * k + plateW - 6 * k
    const mw = match ? measure(ctx, match, font(12 * k, 400), 0.4 * 12 * k) : 0
    // Logo: at most 120 px tall at 720p and half the width.
    let lh = logo ? 120 * k : 0, lw = logo ? lh * logoRatio(logo) : 0
    if (logo && lw > W * 0.5) { lw = W * 0.5; lh = lw / logoRatio(logo) }
    return { plateW, total, mw, lh, lw, w: Math.max(total, mw, lw) }
  }
  let k = k0 * L.scale
  const first = sizes(k)
  if (x + first.w > W * 0.98) k *= Math.max(0.2, (W * 0.98 - x) / first.w)
  const { plateW, total, mw, lh, lw } = sizes(k)
  const nameFont = font(36 * k), matchFont = font(12 * k, 400)
  const blockW = 22 * k, h = (58 + 44 * more) * k, slant = 12 * k
  // Heights above the plate's top: the logo, then the match line.
  const above = logo ? (match ? 44 : 20) * k + lh : match ? 32 * k : 0
  const y = top + above
  if (match) {
    ctx.textBaseline = 'middle'
    text(ctx, match, x, y - 26 * k, matchFont, MUTED, 0.4 * 12 * k)
  }
  const logoBox = logo ? { x, y: y - (match ? 44 : 20) * k - lh, w: lw, h: lh } : null
  if (logoBox) ctx.drawImage(logo!, logoBox.x, logoBox.y, logoBox.w, logoBox.h)
  const px = x + blockW - 6 * k
  fillPoly(ctx, mix(theme.base, '#FFFFFF', 0.06), [[px + slant, y], [px + plateW, y], [px + plateW - 16 * k, y + h], [px, y + h]])
  fillPoly(ctx, theme.accent, [[x, y], [x + blockW, y], [x + blockW - slant, y + h], [x, y + h]])
  ctx.textBaseline = 'middle'
  labels.forEach((l, i) => text(ctx, l, px + slant + 18 * k, y + h / 2 + (i - more / 2) * 44 * k, nameFont, TEXT, 0.08 * 36 * k))
  return { x, y: top, w: Math.max(total, mw, lw), h: above + h, ...(logoBox ? { logo: logoBox } : {}) }
}

// ---- design patterns of the scoreboard, the caption and the serve speed plate -----------------------
// The layout stays; the plates' shape and colors change. slant: the original slanted black plates.
// box: square plates, rounded at the ends, a little see-through. light: white plates, dark text.
// float: no plates, white text over a soft shade that fades out to the right, and an accent rule under it.
type Role = 'plate' | 'plate2' | 'accent'
type Cuts = { tl?: number; tr?: number; bl?: number; br?: number } // how far each corner's edge is slanted in

function lookOf(theme: LookTheme, k: number) {
  const look = theme.look ?? 'slant'
  const light = look === 'light', float = look === 'float', slanted = look === 'slant'
  const r = slanted ? 0 : 6 * k
  const fill: Record<Role, string | null> = {
    plate: float ? null : light ? '#FFFFFF' : look === 'box' ? rgba(theme.base, 0.84) : theme.base,
    plate2: float ? null : light ? '#ECECEC' : look === 'box' ? rgba(mix(theme.base, '#FFFFFF', 0.08), 0.84) : mix(theme.base, '#FFFFFF', 0.06),
    accent: theme.accent,
  }
  return {
    text: light ? '#111111' : TEXT,
    sub: light ? '#555555' : SUB,
    muted: light ? '#8A8A8A' : float ? '#D0D0D0' : MUTED,
    dash: light ? '#B0B0B0' : float ? '#D0D0D0' : '#6B6B6B',
    line: light ? mix(theme.accent, '#000000', 0.15) : float ? mix(theme.accent, '#FFFFFF', 0.8) : mix(theme.accent, '#FFFFFF', 0.45),
    onAccent: onColor(theme.accent),
    // A slant only in the slanted look: elsewhere the text sits where the slant would have pushed it.
    cut: (n: number) => (slanted ? n : 0),
    begin(ctx: Ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0 },
    // Shadows on the text over the picture (the float look), none elsewhere.
    texts(ctx: Ctx) {
      if (!float) return
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6 * k; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1 * k
    },
    shape(ctx: Ctx, role: Role, x: number, y: number, w: number, h: number, cuts: Cuts = {}, round: { l?: boolean; r?: boolean } = {}) {
      ctx.shadowColor = 'transparent'
      if (float && role !== 'accent') {
        // No plate: a shade that fades out to the right (so the text reads on a light floor), and an
        // accent rule along its foot.
        const g = ctx.createLinearGradient(x, 0, x + w, 0)
        g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.7, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, y, w, h)
        fillRect(ctx, theme.accent, x, y + h - 3 * k, w, 3 * k)
        return
      }
      const color = fill[role]!
      if (slanted) {
        fillPoly(ctx, color, [[x + (cuts.tl ?? 0), y], [x + w - (cuts.tr ?? 0), y], [x + w - (cuts.br ?? 0), y + h], [x + (cuts.bl ?? 0), y + h]])
        return
      }
      const rl = round.l ? r : 0, rr = round.r ? r : 0
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x + rl, y); ctx.lineTo(x + w - rr, y)
      if (rr) ctx.arcTo(x + w, y, x + w, y + rr, rr); else ctx.lineTo(x + w, y)
      ctx.lineTo(x + w, y + h - rr)
      if (rr) ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr); else ctx.lineTo(x + w, y + h)
      ctx.lineTo(x + rl, y + h)
      if (rl) ctx.arcTo(x, y + h, x, y + h - rl, rl); else ctx.lineTo(x, y + h)
      ctx.lineTo(x, y + rl)
      if (rl) ctx.arcTo(x, y, x + rl, y, rl); else ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill()
    },
  }
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
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
