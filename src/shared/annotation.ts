// Clip annotations (design §3.6). Coordinates are normalized to the video frame (0..1), so the same
// data redraws sharp at any size; line widths and text sizes are px at 720p and scale with height.
// showFrom / showTo are absolute video times (not clip-relative), so trimming IN doesn't shift them.
// drawAnnotation is the single renderer for the preview and the export.
//
// v3 step 3 adds Office-like formatting (fill and its transparency, dash, arrow heads, bold, a box
// behind text) and polyline / polygon shapes. Every new field is optional and its default is the
// old look, so annotations saved before draw exactly as they did.
//
// An image annotation shows a picture (or page 1 of a PDF, rendered to PNG) stored in the project's
// assets/ folder. Drawing it needs the decoded image, so drawAnnotation takes a lookup for it.

export type AnnotationKind = 'text' | 'arrow' | 'circle' | 'rect' | 'freehand' | 'polyline' | 'polygon' | 'image'
export type Dash = 'solid' | 'dash' | 'dot'
export type Heads = 'end' | 'both' | 'none'

interface Base {
  id: string
  color: string // line color; for text, the text color
  showFrom?: number
  showTo?: number
  dash?: Dash // default solid
  opacity?: number // whole object, 0..1; default 1
}

export interface Fillable {
  fill?: string | null // none when missing or null
  fillOpacity?: number // 0..1; default 1
}

export interface TextBox {
  fill: string | null
  fillOpacity: number
  stroke: string | null
  strokeWidth: number // px at 720p
  padding: number // px at 720p
}

export type Annotation = Base & (
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; outline?: boolean; box?: TextBox | null }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; width: number; heads?: Heads }
  | ({ kind: 'circle' | 'rect'; x: number; y: number; w: number; h: number; width: number } & Fillable)
  | { kind: 'freehand' | 'polyline'; points: [number, number][]; width: number }
  | ({ kind: 'polygon'; points: [number, number][]; width: number } & Fillable)
  | { kind: 'image'; x: number; y: number; w: number; h: number; assetId: string }
)

export type ImageLookup = (assetId: string) => CanvasImageSource | null

export type PointsAnnotation = Extract<Annotation, { points: [number, number][] }>
export const isPoints = (a: Annotation): a is PointsAnnotation => a.kind === 'freehand' || a.kind === 'polyline' || a.kind === 'polygon'

export const REF_HEIGHT = 720
export const FONT_FAMILY = '"Segoe UI", "Yu Gothic UI", sans-serif'
export const COLORS = ['#EF4444', '#FFFFFF', '#3B82F6', '#22C55E', '#0F172A']
export const WIDTHS = [3, 6, 10]
export const TEXT_SIZES = [24, 36, 52]
export const DEFAULT_TEXT_BOX: TextBox = { fill: '#0F172A', fillOpacity: 0.7, stroke: null, strokeWidth: 2, padding: 8 }

export interface Rect { x: number; y: number; w: number; h: number } // normalized

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function visibleAt(a: Annotation, t: number, clip: { in: number; out: number }): boolean {
  return t >= (a.showFrom ?? clip.in) - 1e-3 && t <= (a.showTo ?? clip.out) + 1e-3
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'text': return { ...a, x: a.x + dx, y: a.y + dy }
    case 'arrow': return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'circle': case 'rect': case 'image': return { ...a, x: a.x + dx, y: a.y + dy }
    default: return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
  }
}

// Shapes drawn by dragging may go either way; store them with positive w/h.
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(a: T): T {
  return { ...a, x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) }
}

export interface StylePatch {
  color?: string
  width?: number
  size?: number
  dash?: Dash
  opacity?: number
  fill?: string | null
  fillOpacity?: number
  heads?: Heads
  bold?: boolean
  outline?: boolean
  box?: TextBox | null
}

// Applies the parts of a style that make sense for the annotation's kind.
export function applyStyle(a: Annotation, s: StylePatch): Annotation {
  const common = { ...a, color: s.color ?? a.color, ...(s.opacity !== undefined ? { opacity: s.opacity } : {}) }
  if (common.kind === 'image') return common
  if (common.kind === 'text') {
    return { ...common, size: s.size ?? common.size, ...(s.bold !== undefined ? { bold: s.bold } : {}),
      ...(s.outline !== undefined ? { outline: s.outline } : {}), ...(s.box !== undefined ? { box: s.box } : {}) }
  }
  const lined = { ...common, width: s.width ?? common.width, ...(s.dash !== undefined ? { dash: s.dash } : {}) }
  if (lined.kind === 'arrow') return s.heads !== undefined ? { ...lined, heads: s.heads } : lined
  if (lined.kind === 'rect' || lined.kind === 'circle' || lined.kind === 'polygon') {
    return { ...lined, ...(s.fill !== undefined ? { fill: s.fill } : {}), ...(s.fillOpacity !== undefined ? { fillOpacity: s.fillOpacity } : {}) }
  }
  return lined
}

export const hasFill = (a: Annotation): boolean => a.kind === 'rect' || a.kind === 'circle' || a.kind === 'polygon'

// Normalized bounding box, for selection and hit testing. Text needs the context to measure.
export function bounds(ctx: Ctx, a: Annotation, W: number, H: number): Rect {
  switch (a.kind) {
    case 'text': {
      const s = H / REF_HEIGHT
      setTextFont(ctx, a.size * s, a.bold !== false)
      const w = ctx.measureText(a.text || ' ').width / W
      const pad = a.box ? a.box.padding / REF_HEIGHT : 0
      return { x: a.x - pad * (H / W), y: a.y - pad, w: w + 2 * pad * (H / W), h: (a.size * 1.2) / REF_HEIGHT + 2 * pad }
    }
    case 'arrow': return box([[a.x1, a.y1], [a.x2, a.y2]])
    case 'circle': case 'rect': case 'image': return { x: a.x, y: a.y, w: a.w, h: a.h }
    default: return box(a.points)
  }
}

// Topmost annotation within `tolPx` of the point (normalized x/y), or null. Lines are hit near the
// stroke; filled polygons also inside.
export function hitTest(ctx: Ctx, list: Annotation[], x: number, y: number, W: number, H: number, tolPx = 8): Annotation | null {
  const tx = tolPx / W, ty = tolPx / H
  const nearPath = (pts: [number, number][], closed: boolean, width: number) => {
    const n = closed ? pts.length : pts.length - 1
    for (let j = 0; j < n; j++) {
      const p = pts[j], q = pts[(j + 1) % pts.length]
      if (segDist(x * W, y * H, p[0] * W, p[1] * H, q[0] * W, q[1] * H) <= tolPx + width) return true
    }
    return false
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]
    if (a.kind === 'arrow') { if (nearPath([[a.x1, a.y1], [a.x2, a.y2]], false, a.width)) return a; continue }
    if (a.kind === 'freehand' || a.kind === 'polyline') { if (nearPath(a.points, false, a.width)) return a; continue }
    if (a.kind === 'polygon') { if (nearPath(a.points, true, a.width) || (a.fill && pointInPolygon(x, y, a.points))) return a; continue }
    const b = bounds(ctx, a, W, H)
    if (x >= b.x - tx && x <= b.x + b.w + tx && y >= b.y - ty && y <= b.y + b.h + ty) return a
  }
  return null
}

export function drawAnnotation(ctx: Ctx, a: Annotation, W: number, H: number, images?: ImageLookup): void {
  const s = H / REF_HEIGHT
  ctx.save()
  ctx.globalAlpha *= a.opacity ?? 1
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  switch (a.kind) {
    case 'text': drawText(ctx, a, W, H, s); break
    case 'image': {
      const img = images?.(a.assetId) ?? null
      if (img) { ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H); break }
      // Not loaded (yet): a placeholder, so the object can still be seen and picked.
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(148,163,184,0.9)'
      ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H)
      break
    }
    case 'arrow': {
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H, lw = a.width * s
      const ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(lw * 3.2, 10 * s)
      const heads = a.heads ?? 'end'
      const pull = head * 0.8
      const sx = heads === 'both' ? x1 + Math.cos(ang) * pull : x1, sy = heads === 'both' ? y1 + Math.sin(ang) * pull : y1
      const ex = heads === 'none' ? x2 : x2 - Math.cos(ang) * pull, ey = heads === 'none' ? y2 : y2 - Math.sin(ang) * pull
      ctx.lineWidth = lw
      setDash(ctx, a.dash, lw)
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      ctx.setLineDash([])
      if (heads !== 'none') arrowHead(ctx, x2, y2, ang, head)
      if (heads === 'both') arrowHead(ctx, x1, y1, ang + Math.PI, head)
      break
    }
    case 'circle': case 'rect': {
      ctx.beginPath()
      if (a.kind === 'rect') ctx.rect(a.x * W, a.y * H, a.w * W, a.h * H)
      else ctx.ellipse((a.x + a.w / 2) * W, (a.y + a.h / 2) * H, (a.w / 2) * W, (a.h / 2) * H, 0, 0, Math.PI * 2)
      fillAndStroke(ctx, a, a.width * s)
      break
    }
    default: {
      if (a.points.length < 2) break
      ctx.beginPath()
      ctx.moveTo(a.points[0][0] * W, a.points[0][1] * H)
      for (const [x, y] of a.points.slice(1)) ctx.lineTo(x * W, y * H)
      if (a.kind === 'polygon') { ctx.closePath(); fillAndStroke(ctx, a, a.width * s) }
      else { ctx.lineWidth = a.width * s; setDash(ctx, a.dash, a.width * s); ctx.stroke() }
    }
  }
  ctx.restore()
}

function drawText(ctx: Ctx, a: Extract<Annotation, { kind: 'text' }>, W: number, H: number, s: number): void {
  const px = a.size * s
  setTextFont(ctx, px, a.bold !== false)
  ctx.textBaseline = 'top'
  const x = a.x * W, y = a.y * H
  if (a.box) {
    const pad = a.box.padding * s, w = ctx.measureText(a.text).width, h = px * 1.2
    if (a.box.fill) {
      ctx.save(); ctx.globalAlpha *= a.box.fillOpacity; ctx.fillStyle = a.box.fill
      ctx.fillRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad); ctx.restore()
    }
    if (a.box.stroke && a.box.strokeWidth > 0) {
      ctx.save(); ctx.strokeStyle = a.box.stroke; ctx.lineWidth = a.box.strokeWidth * s
      ctx.strokeRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad); ctx.restore()
    }
  }
  // A thin dark outline keeps light text readable on a bright court (on by default, as before).
  if (a.outline !== false && a.color.toUpperCase() !== '#0F172A') {
    ctx.save(); ctx.lineWidth = Math.max(2, px * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(a.text, x, y); ctx.restore()
  }
  ctx.fillStyle = a.color
  ctx.fillText(a.text, x, y)
}

function fillAndStroke(ctx: Ctx, a: Fillable & { color: string; dash?: Dash }, lw: number): void {
  if (a.fill) {
    ctx.save(); ctx.globalAlpha *= a.fillOpacity ?? 1; ctx.fillStyle = a.fill; ctx.fill(); ctx.restore()
  }
  if (lw > 0) { ctx.lineWidth = lw; setDash(ctx, a.dash, lw); ctx.stroke(); ctx.setLineDash([]) }
}

function arrowHead(ctx: Ctx, x: number, y: number, ang: number, head: number): void {
  ctx.beginPath(); ctx.moveTo(x, y)
  ctx.lineTo(x - head * Math.cos(ang - 0.45), y - head * Math.sin(ang - 0.45))
  ctx.lineTo(x - head * Math.cos(ang + 0.45), y - head * Math.sin(ang + 0.45))
  ctx.closePath(); ctx.fill()
}

function setDash(ctx: Ctx, d: Dash | undefined, lw: number): void {
  if (d === 'dash') { ctx.setLineDash([lw * 3, lw * 2]); ctx.lineCap = 'butt' }
  else if (d === 'dot') { ctx.setLineDash([0.01, lw * 2]); ctx.lineCap = 'round' }
  else ctx.setLineDash([])
}

function setTextFont(ctx: Ctx, px: number, bold = true): void {
  ctx.font = `${bold ? 'bold' : 'normal'} ${px}px ${FONT_FAMILY}`
}

// Keeps saved JSON readable (0.65, not 0.6499999999999998); 4 places is finer than a pixel at 1080p.
export function roundCoords(a: Annotation): Annotation {
  const r = (v: number) => Math.round(v * 10000) / 10000
  switch (a.kind) {
    case 'text': return { ...a, x: r(a.x), y: r(a.y) }
    case 'arrow': return { ...a, x1: r(a.x1), y1: r(a.y1), x2: r(a.x2), y2: r(a.y2) }
    case 'circle': case 'rect': case 'image': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h) }
    default: return { ...a, points: a.points.map(([x, y]) => [r(x), r(y)] as [number, number]) }
  }
}

export function pointInPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function box(points: [number, number][]): Rect {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
