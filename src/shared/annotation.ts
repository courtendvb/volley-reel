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
// With a quad its four corners are placed one by one, so the picture (a heatmap from analysis
// software, say) lies on the court with the camera's perspective; x, y, w, h are then its bounds.
import { homography, project, type Ctx } from './court'

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
  groupId?: string // objects with the same group id are selected and moved together
  fadeIn?: number // seconds it fades in from when it appears (show time, else the clip's IN)
  fadeOut?: number // seconds it fades out before it leaves (hide time, else the clip's OUT)
}

interface Fillable {
  fill?: string | null // none when missing or null
  fillOpacity?: number // 0..1; default 1
}

export interface TextBox {
  fill: string | null
  fillOpacity: number
  stroke: string | null
  strokeWidth: number // px at 720p
  padding: number // px at 720p
  radius?: number // corners, px at 720p
  width?: number // the box's width as a share of the picture, however short the text; missing: the text's
  height?: number // a cell of fixed height (share of the picture): the text sits in its middle and is made
  // smaller when it would not fit (with a width, across too), so the box keeps its shape whatever is written
  circle?: boolean // a round box around centred text: a numbered circle
}

// A numbered circle at a point (x and y its middle), and the next number for a set of objects.
export function numberCircle(id: string, x: number, y: number, n: number, color: string, size: number): Annotation {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  const light = !!m && 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) > 170
  return { id, kind: 'text', color: light ? '#0F172A' : '#FFFFFF', x, y: y - (size * 1.2) / 2 / REF_HEIGHT, text: String(n), size, bold: true, outline: false, align: 'center',
    box: { fill: color, fillOpacity: 1, stroke: '#FFFFFF', strokeWidth: 2, padding: Math.round(size * 0.22), circle: true } }
}
export function nextNumber(list: Annotation[]): number {
  return 1 + Math.max(0, ...list.map(a => (a.kind === 'text' && a.box?.circle ? parseInt(a.text) || 0 : 0)))
}

export type Annotation = Base & (
  // align center: x is the middle of the text. quick: the clip's headline from the text field in the tools.
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; outline?: boolean; box?: TextBox | null; align?: 'center'; quick?: boolean; font?: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; width: number; heads?: Heads }
  | ({ kind: 'circle' | 'rect'; x: number; y: number; w: number; h: number; width: number } & Fillable)
  | { kind: 'freehand' | 'polyline'; points: [number, number][]; width: number }
  | ({ kind: 'polygon'; points: [number, number][]; width: number } & Fillable)
  // crop: the part of the picture shown (fractions of its width / height); missing = all of it.
  | { kind: 'image'; x: number; y: number; w: number; h: number; assetId: string; crop?: Crop; quad?: Quad }
)

// Corners of a picture laid with perspective: top-left, top-right, bottom-left, bottom-right of the picture.
export type Quad = [[number, number], [number, number], [number, number], [number, number]]
export type ImageAnnotation = Extract<Annotation, { kind: 'image' }>

export type ImageLookup = (assetId: string) => CanvasImageSource | null
export interface Crop { x: number; y: number; w: number; h: number }

export type PointsAnnotation = Extract<Annotation, { points: [number, number][] }>
export const isPoints = (a: Annotation): a is PointsAnnotation => a.kind === 'freehand' || a.kind === 'polyline' || a.kind === 'polygon'

const REF_HEIGHT = 720
const FONT_FAMILY = '"Segoe UI", "Yu Gothic UI", "Helvetica Neue", "Hiragino Sans", sans-serif'
export const COLORS = ['#EF4444', '#FFFFFF', '#3B82F6', '#22C55E', '#0F172A']
export const DEFAULT_TEXT_BOX: TextBox = { fill: '#0F172A', fillOpacity: 0.7, stroke: null, strokeWidth: 2, padding: 8 }

// How a new headline looks, set for the project; anything missing stays as it always was.
export interface HeadlineStyle {
  font?: string // a font's name; a computer without it uses the usual ones
  size?: number // px at 720p
  color?: string
  bold?: boolean
  outline?: boolean
  box?: string // the plate's color behind the text; missing: no plate
}
export const HEADLINE_SIZE = 48

// As read back from project.json: what isn't usable is dropped. Undefined when nothing is left.
export function cleanHeadline(x: unknown): HeadlineStyle | undefined {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
  const out: HeadlineStyle = {
    ...(typeof o.font === 'string' && /^[\p{L}\p{N} _-]{1,60}$/u.test(o.font) ? { font: o.font } : {}), // it goes into a canvas font string
    ...(typeof o.size === 'number' && o.size >= 12 && o.size <= 200 ? { size: o.size } : {}),
    ...(hex(o.color) ? { color: o.color } : {}),
    ...(typeof o.bold === 'boolean' ? { bold: o.bold } : {}),
    ...(typeof o.outline === 'boolean' ? { outline: o.outline } : {}),
    ...(hex(o.box) ? { box: o.box } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

export interface Rect { x: number; y: number; w: number; h: number } // normalized


// The objects that move together with these: the ids themselves and every member of their groups.
export function withGroups(list: Annotation[], ids: string[]): string[] {
  const groups = new Set(list.filter(a => ids.includes(a.id) && a.groupId).map(a => a.groupId))
  return list.filter(a => ids.includes(a.id) || (a.groupId && groups.has(a.groupId))).map(a => a.id)
}

// How opaque an object is at time t from its own fades (1 when it has none or is past them).
export function fadeAlpha(a: Annotation, t: number, clip: { in: number; out: number }): number {
  if (!a.fadeIn && !a.fadeOut) return 1
  const from = a.showFrom ?? clip.in, to = a.showTo ?? clip.out
  const fin = a.fadeIn ? Math.min(1, Math.max(0, (t - from) / a.fadeIn)) : 1
  const fout = a.fadeOut ? Math.min(1, Math.max(0, (to - t) / a.fadeOut)) : 1
  return Math.min(fin, fout)
}

export function visibleAt(a: Annotation, t: number, clip: { in: number; out: number }): boolean {
  return t >= (a.showFrom ?? clip.in) - 1e-3 && t <= (a.showTo ?? clip.out) + 1e-3
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'text': return { ...a, x: a.x + dx, y: a.y + dy }
    case 'arrow': return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'image': return a.quad ? withQuad(a, a.quad.map(([x, y]) => [x + dx, y + dy]) as Quad) : { ...a, x: a.x + dx, y: a.y + dy }
    case 'circle': case 'rect': return { ...a, x: a.x + dx, y: a.y + dy }
    default: return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
  }
}

// A picture laid on these corners (null: flat again, in its bounds).
export function withQuad(a: ImageAnnotation, quad: Quad | null): ImageAnnotation {
  const { quad: _q, ...rest } = a
  if (!quad) return rest
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { ...rest, quad, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// The corners of the picture's box, to start laying it with perspective from where it is.
export const boxQuad = (b: Rect): Quad => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]

// The quad's outline in drawing order.
const quadRing = (q: Quad): [number, number][] => [q[0], q[1], q[3], q[2]]

// Moves show / hide times by delta seconds; null drops them (the object shows the whole time).
export function shiftTimes(a: Annotation, delta: number | null): Annotation {
  const { showFrom, showTo, ...rest } = a
  if (delta === null) return rest as Annotation
  return { ...rest, ...(showFrom !== undefined ? { showFrom: Math.round((showFrom + delta) * 100) / 100 } : {}),
    ...(showTo !== undefined ? { showTo: Math.round((showTo + delta) * 100) / 100 } : {}) } as Annotation
}

// The same objects with new ids, and one new group id per group, so they can sit next to the originals.
export function freshIds(list: Annotation[], newId: () => string = () => crypto.randomUUID()): Annotation[] {
  const groups = new Map<string, string>()
  return list.map(a => {
    const g = a.groupId ? groups.get(a.groupId) ?? (groups.set(a.groupId, newId()), groups.get(a.groupId)!) : undefined
    return { ...a, id: newId(), ...(g ? { groupId: g } : {}) }
  })
}

// Copies to paste into list: moved down-right a step at a time while the first one would land exactly
// on an object already there (pasting where the originals are), else left in place (another clip).
export function pasteCopies(copies: Annotation[], list: Annotation[], step = 0.02): Annotation[] {
  const shape = (a: Annotation) => { const { id: _i, groupId: _g, showFrom: _f, showTo: _t, ...rest } = a; return JSON.stringify(roundCoords(rest as Annotation)) }
  const taken = new Set(list.map(shape))
  let out = copies
  for (let n = 0; n < 20 && out.length && taken.has(shape(out[0])); n++) out = out.map(a => translate(a, step, step))
  return out
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
      setTextFont(ctx, a.size * s, a.bold !== false, a.font)
      const lines = textLines(a.text)
      const pad = a.box ? a.box.padding / REF_HEIGHT : 0
      const w = Math.max(...lines.map(l => ctx.measureText(l || ' ').width), a.box?.width ? (a.box.width - pad * 2 * (H / W)) * W : 0) / W
      const left = a.align === 'center' ? a.x - w / 2 : a.x
      if (a.box?.circle) {
        const tall = (a.size * 1.2 * lines.length) / REF_HEIGHT, side = Math.max(w * (W / H), tall) + 2 * pad
        return { x: a.x - (side * (H / W)) / 2, y: a.y + tall / 2 - side / 2, w: side * (H / W), h: side }
      }
      return { x: left - pad * (H / W), y: a.y - pad, w: w + 2 * pad * (H / W), h: a.box?.height ?? (a.size * 1.2 * lines.length) / REF_HEIGHT + 2 * pad }
    }
    case 'arrow': return pointsBox([[a.x1, a.y1], [a.x2, a.y2]])
    case 'circle': case 'rect': case 'image': return { x: a.x, y: a.y, w: a.w, h: a.h }
    default: return pointsBox(a.points)
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
    if (a.kind === 'image' && a.quad) { if (nearPath(quadRing(a.quad), true, 0) || pointInPolygon(x, y, quadRing(a.quad))) return a; continue }
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
      if (img) {
        const c = a.crop, iw = (img as { width: number }).width, ih = (img as { height: number }).height
        const src = c ? { x: c.x * iw, y: c.y * ih, w: c.w * iw, h: c.h * ih } : { x: 0, y: 0, w: iw, h: ih }
        if (a.quad) drawWarped(ctx, img, src, a.quad.map(([x, y]) => [x * W, y * H]) as Quad)
        else if (c) ctx.drawImage(img, c.x * iw, c.y * ih, c.w * iw, c.h * ih, a.x * W, a.y * H, a.w * W, a.h * H)
        else ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H)
        break
      }
      // Not loaded (yet): a placeholder, so the object can still be seen and picked.
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(148,163,184,0.9)'
      if (a.quad) { ctx.beginPath(); for (const [x, y] of quadRing(a.quad)) ctx.lineTo(x * W, y * H); ctx.closePath(); ctx.stroke() }
      else ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H)
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

// Canvas has no perspective transform, so the picture is cut into a mesh of small triangles, each
// drawn with the affine transform that puts it where the perspective map sends its corners. Each
// triangle is clipped a little larger than itself so no seams show between them.
export const WARP_STEPS = 16

function drawWarped(ctx: Ctx, img: CanvasImageSource, src: { x: number; y: number; w: number; h: number }, quad: Quad, n = WARP_STEPS): void {
  const pt = ([x, y]: [number, number]) => ({ x, y })
  const hm = homography([pt(quad[0]), pt(quad[1]), pt(quad[2]), pt(quad[3])])
  const dst: { x: number; y: number }[][] = []
  for (let i = 0; i <= n; i++) { dst.push([]); for (let j = 0; j <= n; j++) dst[i].push(project(hm, j / n, i / n)) }
  const sp = (i: number, j: number) => ({ x: src.x + (j / n) * src.w, y: src.y + (i / n) * src.h })
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = { x: src.x + (j / n) * src.w, y: src.y + (i / n) * src.h, w: src.w / n, h: src.h / n }
      drawTriangle(ctx, img, cell, [sp(i, j), sp(i, j + 1), sp(i + 1, j)], [dst[i][j], dst[i][j + 1], dst[i + 1][j]])
      drawTriangle(ctx, img, cell, [sp(i + 1, j + 1), sp(i + 1, j), sp(i, j + 1)], [dst[i + 1][j + 1], dst[i + 1][j], dst[i][j + 1]])
    }
  }
}

type P = { x: number; y: number }
function drawTriangle(ctx: Ctx, img: CanvasImageSource, cell: { x: number; y: number; w: number; h: number }, s: [P, P, P], d: [P, P, P]): void {
  const m = affine(s, d)
  if (!m) return
  const cx = (d[0].x + d[1].x + d[2].x) / 3, cy = (d[0].y + d[1].y + d[2].y) / 3
  ctx.save()
  ctx.beginPath()
  for (const p of d) {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1
    ctx.lineTo(p.x + (dx / len) * 0.7, p.y + (dy / len) * 0.7)
  }
  ctx.closePath()
  ctx.clip()
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  // A pixel of margin around the cell, so the edges of each triangle have picture under them.
  const iw = (img as { width: number }).width, ih = (img as { height: number }).height
  const x0 = Math.max(0, Math.floor(cell.x - 1)), y0 = Math.max(0, Math.floor(cell.y - 1))
  const w = Math.min(iw - x0, Math.ceil(cell.w + 2)), h = Math.min(ih - y0, Math.ceil(cell.h + 2))
  if (w > 0 && h > 0) ctx.drawImage(img, x0, y0, w, h, x0, y0, w, h)
  ctx.restore()
}

// The affine map (canvas transform order a, b, c, d, e, f) taking triangle s onto triangle d.
export function affine(s: [P, P, P], d: [P, P, P]): [number, number, number, number, number, number] | null {
  const dx1 = s[1].x - s[0].x, dy1 = s[1].y - s[0].y, dx2 = s[2].x - s[0].x, dy2 = s[2].y - s[0].y
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-12) return null
  const du1 = d[1].x - d[0].x, dv1 = d[1].y - d[0].y, du2 = d[2].x - d[0].x, dv2 = d[2].y - d[0].y
  const a = (du1 * dy2 - du2 * dy1) / det, c = (du2 * dx1 - du1 * dx2) / det
  const b = (dv1 * dy2 - dv2 * dy1) / det, dd = (dv2 * dx1 - dv1 * dx2) / det
  return [a, b, c, dd, d[0].x - a * s[0].x - c * s[0].y, d[0].y - b * s[0].x - dd * s[0].y]
}

// Text can have several lines ("\n"); each is 1.2× the size apart, and centered text centers each line.
const textLines = (t: string): string[] => t.split('\n')

function drawText(ctx: Ctx, a: Extract<Annotation, { kind: 'text' }>, W: number, H: number, s: number): void {
  let px = a.size * s, lh = px * 1.2
  setTextFont(ctx, px, a.bold !== false, a.font)
  ctx.textBaseline = 'top'
  const lines = textLines(a.text)
  let widths = lines.map(l => ctx.measureText(l).width), wMax = Math.max(...widths)
  const cell = a.box?.height ? a.box : null
  if (cell) {
    const pad = cell.padding * s, roomW = cell.width ? cell.width * W - 2 * pad : Infinity, roomH = cell.height! * H - 2 * pad
    const k = Math.min(1, roomW / Math.max(wMax, 1), roomH / (lh * lines.length))
    if (k < 1) {
      px *= k; lh = px * 1.2
      setTextFont(ctx, px, a.bold !== false, a.font)
      widths = lines.map(l => ctx.measureText(l).width); wMax = Math.max(...widths)
    }
  }
  const x = a.align === 'center' ? a.x * W - wMax / 2 : a.x * W, y = a.y * H
  const lineX = (i: number) => (a.align === 'center' ? a.x * W - widths[i] / 2 : x)
  if (a.box) {
    const pad = a.box.padding * s, h = cell ? cell.height! * H - 2 * pad : lh * lines.length, w = Math.max(wMax, a.box.width ? a.box.width * W - 2 * pad : 0)
    const x = a.align === 'center' ? a.x * W - w / 2 : a.x * W // a wide box stays centred on the text
    if (a.box.circle) {
      // The number sits in the middle of the circle by the ink of its digits, not the font's line box,
      // which puts it off centre in some fonts. Ring, fill and number each have their own colour.
      const cx = a.x * W, cy = y + h / 2, radius = Math.max(wMax, h) / 2 + pad
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      if (a.box.fill) { ctx.save(); ctx.globalAlpha *= a.box.fillOpacity; ctx.fillStyle = a.box.fill; ctx.fill(); ctx.restore() }
      if (a.box.stroke && a.box.strokeWidth > 0) { ctx.save(); ctx.strokeStyle = a.box.stroke; ctx.lineWidth = a.box.strokeWidth * s; ctx.stroke(); ctx.restore() }
      ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = a.color // measured on this baseline too
      const text = lines.join(' '), m = ctx.measureText(text)
      ctx.fillText(text, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
      ctx.restore()
      return
    }
    if (a.box.fill) {
      ctx.save(); ctx.globalAlpha *= a.box.fillOpacity; ctx.fillStyle = a.box.fill
      if (a.box.radius) { ctx.beginPath(); ctx.roundRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, a.box.radius * s); ctx.fill() }
      else ctx.fillRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad)
      ctx.restore()
    }
    if (a.box.stroke && a.box.strokeWidth > 0) {
      ctx.save(); ctx.strokeStyle = a.box.stroke; ctx.lineWidth = a.box.strokeWidth * s
      ctx.strokeRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad); ctx.restore()
    }
  }
  // A number alone in a box (a jersey number) sits in its middle by the ink of its digits: the font's
  // line box leaves digits high in some fonts.
  let ty = cell ? y + (cell.height! * H - 2 * cell.padding * s - lh * lines.length) / 2 : y
  if (a.box && !cell && lines.length === 1 && /^\d+$/.test(lines[0])) {
    const m = ctx.measureText(lines[0])
    ty = y + lh / 2 - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2
  }
  // A black outline keeps light text readable on a bright court (on by default).
  if (a.outline !== false && a.color.toUpperCase() !== '#0F172A') {
    ctx.save(); ctx.lineWidth = Math.max(3, px * 0.18); ctx.strokeStyle = '#000000'; ctx.lineJoin = 'round'
    lines.forEach((l, i) => ctx.strokeText(l, lineX(i), ty + i * lh)); ctx.restore()
  }
  ctx.fillStyle = a.color
  lines.forEach((l, i) => ctx.fillText(l, lineX(i), ty + i * lh))
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

function setTextFont(ctx: Ctx, px: number, bold = true, font?: string): void {
  ctx.font = `${bold ? 'bold' : 'normal'} ${px}px ${font ? `"${font}", ` : ''}${FONT_FAMILY}`
}

// Keeps saved JSON readable (0.65, not 0.6499999999999998); 4 places is finer than a pixel at 1080p.
export function roundCoords(a: Annotation): Annotation {
  const r = (v: number) => Math.round(v * 10000) / 10000
  switch (a.kind) {
    case 'text': return { ...a, x: r(a.x), y: r(a.y) }
    case 'arrow': return { ...a, x1: r(a.x1), y1: r(a.y1), x2: r(a.x2), y2: r(a.y2) }
    case 'image': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h), ...(a.quad ? { quad: a.quad.map(([x, y]) => [r(x), r(y)]) as Quad } : {}) }
    case 'circle': case 'rect': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h) }
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

export function pointsBox(points: [number, number][]): Rect {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
