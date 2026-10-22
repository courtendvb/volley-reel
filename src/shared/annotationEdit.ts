// Editing annotation geometry with handles (v3 step 3): arrow ends, 8-way box resize, and
// Office-style "edit points" for polylines, polygons and freehand — drag a vertex, drag a midpoint
// to insert one, delete one. Pure functions on normalized coordinates, so they are unit-tested.
import { isPoints, normalizeBox, type Annotation, type PointsAnnotation } from './annotation'

export type HandleKind = 'end' | 'resize' | 'vertex' | 'mid'
export interface Handle { id: string; kind: HandleKind; x: number; y: number }

export const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type BoxHandle = (typeof BOX_HANDLES)[number]

// Freehand strokes can have hundreds of points; past this many, simplify before editing points.
export const MAX_EDIT_POINTS = 80
export const MIN_POINTS = { polyline: 2, freehand: 2, polygon: 3 } as const

export function handlesOf(a: Annotation): Handle[] {
  switch (a.kind) {
    case 'arrow': return [{ id: 'p1', kind: 'end', x: a.x1, y: a.y1 }, { id: 'p2', kind: 'end', x: a.x2, y: a.y2 }]
    case 'rect': case 'circle': {
      const { x, y, w, h } = a
      const at: Record<BoxHandle, [number, number]> = {
        nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
        se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2],
      }
      return BOX_HANDLES.map(id => ({ id, kind: 'resize' as const, x: at[id][0], y: at[id][1] }))
    }
    case 'text': return []
    default: {
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

// Drags a handle to (x, y). Dragging a midpoint inserts a vertex there; the result says which
// handle to keep dragging (the new vertex). keepAspect (Shift) holds a box's proportions.
export function dragHandle(a: Annotation, id: string, x: number, y: number, opts: { keepAspect?: boolean } = {}): { a: Annotation; id: string } {
  if (a.kind === 'arrow') return { a: id === 'p1' ? { ...a, x1: x, y1: y } : { ...a, x2: x, y2: y }, id }
  if (a.kind === 'rect' || a.kind === 'circle') return { a: { ...a, ...resizeBox(a, id as BoxHandle, x, y, !!opts.keepAspect) }, id }
  if (!isPoints(a)) return { a, id }
  const i = Number(id.slice(1))
  if (id[0] === 'v' && a.points[i]) return { a: withPoints(a, a.points.map((p, j) => (j === i ? [x, y] : p))), id }
  if (id[0] === 'm') {
    const pts = [...a.points]
    pts.splice(i + 1, 0, [x, y])
    return { a: withPoints(a, pts), id: `v${i + 1}` }
  }
  return { a, id }
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
