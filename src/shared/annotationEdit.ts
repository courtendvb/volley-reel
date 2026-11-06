// Editing annotation geometry with handles (v3 step 3): arrow ends, 8-way box resize, and
// Office-style "edit points" for polylines, polygons and freehand — drag a vertex, drag a midpoint
// to insert one, delete one. Pure functions on normalized coordinates, so they are unit-tested.
import { isPoints, normalizeBox, withQuad, type Annotation, type PointsAnnotation, type Quad } from './annotation'

type HandleKind = 'end' | 'resize' | 'vertex' | 'mid'
export interface Handle { id: string; kind: HandleKind; x: number; y: number }

const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type BoxHandle = (typeof BOX_HANDLES)[number]

// Freehand strokes can have hundreds of points; past this many, simplify before editing points.
export const MAX_EDIT_POINTS = 80
const MIN_POINTS = { polyline: 2, freehand: 2, polygon: 3 } as const

// Point shapes show the 8 box handles (resize the whole shape) unless points are being edited,
// as in Office's "Edit Points" mode.
export function handlesOf(a: Annotation, editPoints = false): Handle[] {
  switch (a.kind) {
    case 'arrow': return [{ id: 'p1', kind: 'end', x: a.x1, y: a.y1 }, { id: 'p2', kind: 'end', x: a.x2, y: a.y2 }]
    case 'image': return a.quad ? a.quad.map(([x, y], i) => ({ id: `q${i}`, kind: 'vertex' as const, x, y })) : boxHandles(a)
    case 'rect': case 'circle': return boxHandles(a)
    case 'text': return []
    default: {
      if (!editPoints) return boxHandles(pointsBox(a.points))
      if (a.points.length > MAX_EDIT_POINTS) return []
      const pts = a.points, closed = a.kind === 'polygon'
      const out: Handle[] = pts.map((p, i) => ({ id: `v${i}`, kind: 'vertex' as const, x: p[0], y: p[1] }))
      const n = closed ? pts.length : pts.length - 1
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length]
        out.push({ id: `m${i}`, kind: 'mid', x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 })
      }
      return out
    }
  }
}

function boxHandles({ x, y, w, h }: { x: number; y: number; w: number; h: number }): Handle[] {
  const at: Record<BoxHandle, [number, number]> = {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
    se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2],
  }
  return BOX_HANDLES.map(id => ({ id, kind: 'resize' as const, x: at[id][0], y: at[id][1] }))
}

export function pointsBox(pts: [number, number][]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// An isosceles triangle in the box dragged from `from` to `to` (apex at the top middle).
export function trianglePoints(from: [number, number], to: [number, number]): [number, number][] {
  const b = normalizeBox({ x: from[0], y: from[1], w: to[0] - from[0], h: to[1] - from[1] })
  return [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
}

// A rectangle or ellipse as a polygon, so its points can be edited; the format is kept.
export function toPolygon(a: Annotation): Annotation {
  if (a.kind !== 'rect' && a.kind !== 'circle') return a
  const { x, y, w, h, kind: _k, ...rest } = a
  const points: [number, number][] = a.kind === 'rect'
    ? [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    : Array.from({ length: 16 }, (_, i) => {
      const t = (i / 16) * Math.PI * 2
      return [x + w / 2 + (Math.cos(t) * w) / 2, y + h / 2 + (Math.sin(t) * h) / 2] as [number, number]
    })
  return { ...rest, kind: 'polygon', points } as Annotation
}

// Drags a handle to (x, y). Dragging a midpoint inserts a vertex there; the result says which
// handle to keep dragging (the new vertex). keepAspect (Shift) holds a box's proportions.
export function dragHandle(a: Annotation, id: string, x: number, y: number, opts: { keepAspect?: boolean } = {}): { a: Annotation; id: string } {
  if (a.kind === 'arrow') return { a: id === 'p1' ? { ...a, x1: x, y1: y } : { ...a, x2: x, y2: y }, id }
  if (a.kind === 'rect' || a.kind === 'circle') return { a: { ...a, ...resizeBox(a, id as BoxHandle, x, y, !!opts.keepAspect) }, id }
  // A picture laid with perspective: each corner moves on its own.
  if (a.kind === 'image' && a.quad) {
    const i = Number(id.slice(1))
    return { a: id[0] === 'q' && a.quad[i] ? withQuad(a, a.quad.map((p, j) => (j === i ? [x, y] : p)) as Quad) : a, id }
  }
  // Pictures keep their proportions at the corners unless Shift is held (Office does the same).
  if (a.kind === 'image') return { a: { ...a, ...resizeBox(a, id as BoxHandle, x, y, !opts.keepAspect) }, id }
  if (!isPoints(a)) return { a, id }
  if ((BOX_HANDLES as readonly string[]).includes(id)) return { a: withPoints(a, resizePoints(a.points, id as BoxHandle, x, y, !!opts.keepAspect)), id }
  const i = Number(id.slice(1))
  if (id[0] === 'v' && a.points[i]) return { a: withPoints(a, a.points.map((p, j) => (j === i ? [x, y] : p))), id }
  if (id[0] === 'm') {
    const pts = [...a.points]
    pts.splice(i + 1, 0, [x, y])
    return { a: withPoints(a, pts), id: `v${i + 1}` }
  }
  return { a, id }
}

// Shift while dragging a vertex (or an arrow end): the point lines up with a neighbor — the nearer of
// "same x" and "same y" always, so that edge stays upright or level; the other one too when it is
// within tolPx. Neighbors are the vertices on either side (for a midpoint, the edge's two ends).
export function snapToNeighbors(a: Annotation, id: string, x: number, y: number, W: number, H: number, tolPx = 10): [number, number] {
  let nbrs: [number, number][] = []
  if (a.kind === 'arrow') nbrs = id === 'p1' ? [[a.x2, a.y2]] : id === 'p2' ? [[a.x1, a.y1]] : []
  else if (isPoints(a)) {
    const pts = a.points, n = pts.length, i = Number(id.slice(1)), closed = a.kind === 'polygon'
    const at = (j: number) => (closed ? pts[(j + n) % n] : pts[j])
    nbrs = (id[0] === 'v' ? [at(i - 1), at(i + 1)] : id[0] === 'm' ? [at(i), at(i + 1)] : []).filter((p): p is [number, number] => !!p)
  }
  if (!nbrs.length) return [x, y]
  const bx = nbrs.reduce((b, p) => (Math.abs(p[0] - x) * W < Math.abs(b - x) * W ? p[0] : b), nbrs[0][0])
  const by = nbrs.reduce((b, p) => (Math.abs(p[1] - y) * H < Math.abs(b - y) * H ? p[1] : b), nbrs[0][1])
  const dx = Math.abs(bx - x) * W, dy = Math.abs(by - y) * H
  if (dx <= dy) return [bx, dy <= tolPx ? by : y]
  return [dx <= tolPx ? bx : x, by]
}

// Dragging a show / hide time: it sticks to the nearest of the given times (other objects' times,
// the clip's IN / OUT, the key play) when within tol seconds. Returns the time and what it stuck to.
export function snapTime(t: number, targets: number[], tol: number): { t: number; snapped: number | null } {
  let best: number | null = null
  for (const x of targets) if (Math.abs(x - t) <= tol && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x
  return best === null ? { t, snapped: null } : { t: best, snapped: best }
}

// Moves one edge or corner; dragging past the opposite side flips the box, which is then stored
// with positive size again.
export function resizeBox(b: { x: number; y: number; w: number; h: number }, h: BoxHandle, x: number, y: number, keepAspect: boolean) {
  let l = b.x, t = b.y, r = b.x + b.w, btm = b.y + b.h
  if (h.includes('w')) l = x
  if (h.includes('e')) r = x
  if (h.includes('n')) t = y
  if (h.includes('s')) btm = y
  if (keepAspect && h.length === 2 && b.w > 0 && b.h > 0) {
    const ratio = b.w / b.h
    const w = Math.abs(r - l), hh = Math.abs(btm - t)
    // Follow whichever side moved further, and size the other from the original ratio.
    if (w / ratio > hh) { const nh = w / ratio; if (h.includes('n')) t = btm - Math.sign(btm - t || 1) * nh; else btm = t + Math.sign(btm - t || 1) * nh }
    else { const nw = hh * ratio; if (h.includes('w')) l = r - Math.sign(r - l || 1) * nw; else r = l + Math.sign(r - l || 1) * nw }
  }
  return normalizeBox({ x: l, y: t, w: r - l, h: btm - t })
}

// Scales every point with the shape's bounding box.
function resizePoints(pts: [number, number][], h: BoxHandle, x: number, y: number, keepAspect: boolean): [number, number][] {
  const o = pointsBox(pts), n = resizeBox(o, h, x, y, keepAspect)
  const map = (v: number, o0: number, ow: number, n0: number, nw: number) => (ow > 0 ? n0 + ((v - o0) / ow) * nw : v)
  return pts.map(([px, py]) => [map(px, o.x, o.w, n.x, n.w), map(py, o.y, o.h, n.y, n.h)])
}

// ---- cropping a picture (Office-style: the frame shows part of the picture; the picture can be
// moved and zoomed under the frame). "full" is where the whole picture would be on the frame.
type ImageAnnotation = Extract<Annotation, { kind: 'image' }>
type Box = { x: number; y: number; w: number; h: number }

export function fullRect(a: ImageAnnotation): Box {
  const c = a.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const w = a.w / c.w, h = a.h / c.h
  return { x: a.x - c.x * w, y: a.y - c.y * h, w, h }
}

function withFrame(a: ImageAnnotation, box: Box, full: Box): ImageAnnotation {
  const crop = { x: (box.x - full.x) / full.w, y: (box.y - full.y) / full.h, w: box.w / full.w, h: box.h / full.h }
  const whole = Math.abs(crop.x) < 1e-6 && Math.abs(crop.y) < 1e-6 && Math.abs(crop.w - 1) < 1e-6 && Math.abs(crop.h - 1) < 1e-6
  const { crop: _c, ...rest } = a
  return { ...rest, ...box, ...(whole ? {} : { crop }) }
}

// Drags a frame handle: the frame changes, the picture stays; the frame can't leave the picture.
export function cropHandle(a: ImageAnnotation, full: Box, h: BoxHandle, x: number, y: number): ImageAnnotation {
  const b = resizeBox(a, h, Math.max(full.x, Math.min(full.x + full.w, x)), Math.max(full.y, Math.min(full.y + full.h, y)), false)
  if (b.w < 0.01 || b.h < 0.01) return a
  return withFrame(a, b, full)
}

// Moves the picture under the frame, so the frame stays on the picture.
export function panCrop(a: ImageAnnotation, full: Box, dx: number, dy: number): ImageAnnotation {
  const x = Math.min(a.x, Math.max(a.x + a.w - full.w, full.x + dx))
  const y = Math.min(a.y, Math.max(a.y + a.h - full.h, full.y + dy))
  return withFrame(a, a, { ...full, x, y })
}

// Zooms the picture around the frame's center; it never gets smaller than the frame.
export function zoomCrop(a: ImageAnnotation, factor: number): ImageAnnotation {
  const full = fullRect(a)
  const s = Math.max(factor, a.w / full.w, a.h / full.h)
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2
  const z = { x: cx - (cx - full.x) * s, y: cy - (cy - full.y) * s, w: full.w * s, h: full.h * s }
  return panCrop(a, z, 0, 0)
}

// Deletes a vertex, keeping at least 2 points for lines and 3 for polygons.
export function removeVertex(a: Annotation, i: number): Annotation {
  if (!isPoints(a) || a.points.length <= MIN_POINTS[a.kind]) return a
  return withPoints(a, a.points.filter((_, j) => j !== i))
}

// Fewer points with the same look (Ramer–Douglas–Peucker), so a freehand stroke becomes editable.
// tolerance is in pixels at the given frame size.
export function simplifyPoints(pts: [number, number][], tolerancePx: number, W: number, H: number): [number, number][] {
  if (pts.length <= 2) return pts
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let max = 0, at = -1
    for (let i = s + 1; i < e; i++) {
      const d = distToLine(pts[i], pts[s], pts[e], W, H)
      if (d > max) { max = d; at = i }
    }
    if (at >= 0 && max > tolerancePx) { keep[at] = true; stack.push([s, at], [at, e]) }
  }
  return pts.filter((_, i) => keep[i])
}

export function simplify(a: Annotation, tolerancePx: number, W: number, H: number): Annotation {
  return isPoints(a) ? withPoints(a, simplifyPoints(a.points, tolerancePx, W, H)) : a
}

// Turns a line into a polygon or back (Office: "close path" / "open path").
export function setClosed(a: Annotation, closed: boolean): Annotation {
  if (!isPoints(a)) return a
  if (closed && a.kind !== 'polygon' && a.points.length >= 3) return { ...a, kind: 'polygon' } as Annotation
  if (!closed && a.kind === 'polygon') { const { fill: _f, fillOpacity: _o, ...rest } = a; return { ...rest, kind: 'polyline' } as Annotation }
  return a
}

function withPoints(a: PointsAnnotation, points: [number, number][]): Annotation {
  return { ...a, points } as Annotation
}

function distToLine(p: [number, number], a: [number, number], b: [number, number], W: number, H: number): number {
  const [px, py, ax, ay, bx, by] = [p[0] * W, p[1] * H, a[0] * W, a[1] * H, b[0] * W, b[1] * H]
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy)
  if (!len) return Math.hypot(px - ax, py - ay)
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
}
