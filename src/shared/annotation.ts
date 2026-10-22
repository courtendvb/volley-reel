// Clip annotations (design §3.6). Coordinates are normalized to the video frame (0..1), so the same
// data redraws sharp at any size; line widths and text sizes are px at 720p and scale with height.
// showFrom / showTo are absolute video times (not clip-relative), so trimming IN doesn't shift them.
// drawAnnotation is the single renderer: the preview uses it now, the export (M7) will too.

export type AnnotationKind = 'text' | 'arrow' | 'circle' | 'rect' | 'freehand'

interface Base {
  id: string
  color: string
  showFrom?: number
  showTo?: number
}

export type Annotation = Base & (
  | { kind: 'text'; x: number; y: number; text: string; size: number }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'circle' | 'rect'; x: number; y: number; w: number; h: number; width: number }
  | { kind: 'freehand'; points: [number, number][]; width: number }
)

export const REF_HEIGHT = 720
export const FONT_FAMILY = '"Segoe UI", "Yu Gothic UI", sans-serif'
export const COLORS = ['#FFFFFF', '#FACC15', '#EF4444', '#3B82F6', '#22C55E', '#0F172A']
export const WIDTHS = [3, 6, 10]
export const TEXT_SIZES = [24, 36, 52]

export interface Rect { x: number; y: number; w: number; h: number } // normalized

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function visibleAt(a: Annotation, t: number, clip: { in: number; out: number }): boolean {
  return t >= (a.showFrom ?? clip.in) - 1e-3 && t <= (a.showTo ?? clip.out) + 1e-3
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'text': return { ...a, x: a.x + dx, y: a.y + dy }
    case 'arrow': return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'circle': case 'rect': return { ...a, x: a.x + dx, y: a.y + dy }
    case 'freehand': return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
  }
}

// Shapes drawn by dragging may go either way; store them with positive w/h.
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(a: T): T {
  return { ...a, x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) }
}

export function applyStyle(a: Annotation, s: { color?: string; width?: number; size?: number }): Annotation {
  const next = { ...a, color: s.color ?? a.color }
  if (next.kind === 'text') return { ...next, size: s.size ?? next.size }
  return { ...next, width: s.width ?? next.width }
}

// Normalized bounding box, for selection and hit testing. Text needs the context to measure.
export function bounds(ctx: Ctx, a: Annotation, W: number, H: number): Rect {
  switch (a.kind) {
    case 'text': {
      setTextFont(ctx, a.size * (H / REF_HEIGHT))
      const w = ctx.measureText(a.text || ' ').width / W
      return { x: a.x, y: a.y, w, h: (a.size * 1.2) / REF_HEIGHT }
    }
    case 'arrow': return box([[a.x1, a.y1], [a.x2, a.y2]])
    case 'circle': case 'rect': return { x: a.x, y: a.y, w: a.w, h: a.h }
    case 'freehand': return box(a.points)
  }
}

// Topmost annotation within `tolPx` of the point (normalized x/y), or null.
export function hitTest(ctx: Ctx, list: Annotation[], x: number, y: number, W: number, H: number, tolPx = 8): Annotation | null {
  const tx = tolPx / W, ty = tolPx / H
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]
    if (a.kind === 'arrow') { if (segDist(x * W, y * H, a.x1 * W, a.y1 * H, a.x2 * W, a.y2 * H) <= tolPx + a.width) return a; continue }
    if (a.kind === 'freehand') {
      for (let j = 1; j < a.points.length; j++) {
        const [p, q] = [a.points[j - 1], a.points[j]]
        if (segDist(x * W, y * H, p[0] * W, p[1] * H, q[0] * W, q[1] * H) <= tolPx + a.width) return a
      }
      continue
    }
    const b = bounds(ctx, a, W, H)
    if (x >= b.x - tx && x <= b.x + b.w + tx && y >= b.y - ty && y <= b.y + b.h + ty) return a
  }
  return null
}

export function drawAnnotation(ctx: Ctx, a: Annotation, W: number, H: number): void {
  const s = H / REF_HEIGHT
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  // A thin dark outline keeps light colors readable on a bright court.
  const outline = a.color.toUpperCase() !== '#0F172A'
  switch (a.kind) {
    case 'text': {
      setTextFont(ctx, a.size * s)
      ctx.textBaseline = 'top'
      if (outline) { ctx.lineWidth = Math.max(2, a.size * s * 0.16); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(a.text, a.x * W, a.y * H) }
      ctx.fillText(a.text, a.x * W, a.y * H)
      break
    }
    case 'arrow': {
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H, lw = a.width * s
      const ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(lw * 3.2, 10 * s)
      const bx = x2 - Math.cos(ang) * head * 0.8, by = y2 - Math.sin(ang) * head * 0.8
      const shape = () => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45))
        ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45))
        ctx.closePath(); ctx.fill()
      }
      ctx.lineWidth = lw
      shape()
      break
    }
    case 'circle': case 'rect': {
      ctx.lineWidth = a.width * s
      ctx.beginPath()
      if (a.kind === 'rect') ctx.rect(a.x * W, a.y * H, a.w * W, a.h * H)
      else ctx.ellipse((a.x + a.w / 2) * W, (a.y + a.h / 2) * H, (a.w / 2) * W, (a.h / 2) * H, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'freehand': {
      if (a.points.length < 2) break
      ctx.lineWidth = a.width * s
      ctx.beginPath()
      ctx.moveTo(a.points[0][0] * W, a.points[0][1] * H)
      for (const [x, y] of a.points.slice(1)) ctx.lineTo(x * W, y * H)
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

function setTextFont(ctx: Ctx, px: number): void {
  ctx.font = `bold ${px}px ${FONT_FAMILY}`
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

// Keeps saved JSON readable (0.65, not 0.6499999999999998); 4 places is finer than a pixel at 1080p.
export function roundCoords(a: Annotation): Annotation {
  const r = (v: number) => Math.round(v * 10000) / 10000
  switch (a.kind) {
    case 'text': return { ...a, x: r(a.x), y: r(a.y) }
    case 'arrow': return { ...a, x1: r(a.x1), y1: r(a.y1), x2: r(a.x2), y2: r(a.y2) }
    case 'circle': case 'rect': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h) }
    case 'freehand': return { ...a, points: a.points.map(([x, y]) => [r(x), r(y)] as [number, number]) }
  }
}
