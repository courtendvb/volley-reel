import { describe, expect, it } from 'vitest'
import { applyStyle, bounds, hitTest, pointInPolygon, roundCoords, translate, type Annotation } from './annotation'
import { cropHandle, fullRect, panCrop, zoomCrop, dragHandle, handlesOf, removeVertex, resizeBox, setClosed, simplify, simplifyPoints, toPolygon, trianglePoints } from './annotationEdit'

const rect: Annotation = { id: 'r', kind: 'rect', color: '#FFF', x: 0.2, y: 0.2, w: 0.4, h: 0.2, width: 6 }
const poly: Annotation = { id: 'p', kind: 'polygon', color: '#FFF', width: 4, points: [[0.1, 0.1], [0.5, 0.1], [0.3, 0.5]] }
const line: Annotation = { id: 'l', kind: 'polyline', color: '#FFF', width: 4, points: [[0.1, 0.8], [0.5, 0.8]] }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('handles', () => {
  it('gives arrows two ends, boxes eight, and point shapes vertices plus midpoints', () => {
    expect(handlesOf({ id: 'a', kind: 'arrow', color: '#FFF', x1: 0, y1: 0, x2: 1, y2: 1, width: 3 }).map(h => h.id)).toEqual(['p1', 'p2'])
    expect(handlesOf(rect)).toHaveLength(8)
    expect(handlesOf(poly, true).map(h => h.id)).toEqual(['v0', 'v1', 'v2', 'm0', 'm1', 'm2']) // closed: 3 midpoints
    expect(handlesOf(line, true).map(h => h.id)).toEqual(['v0', 'v1', 'm0'])
    expect(handlesOf(poly).map(h => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) // not editing points
  })

  it('resizes a point shape as a box, scaling every point', () => {
    const r = dragHandle(poly, 'e', 0.9, 0.3).a as { points: number[][] }
    expect(r.points.map(p => +p[0].toFixed(6))).toEqual([0.1, 0.9, 0.5])
  })

  it('makes triangles and turns boxes into polygons', () => {
    expect(trianglePoints([0.4, 0.6], [0.2, 0.2])).toEqual([[0.30000000000000004, 0.2], [0.4, 0.6], [0.2, 0.6]])
    const p = toPolygon({ ...rect, fill: '#000' } as Annotation)
    expect(p).toMatchObject({ kind: 'polygon', fill: '#000', width: 6 })
    expect((p as { points: unknown[] }).points).toHaveLength(4)
    expect((toPolygon({ ...rect, kind: 'circle' } as Annotation) as { points: unknown[] }).points).toHaveLength(16)
  })
})

describe('resizing boxes', () => {
  it('moves one edge or corner', () => {
    expect(resizeBox(rect as never, 'e', 0.8, 0.5, false)).toMatchObject({ x: 0.2, w: 0.6000000000000001 })
    const r = resizeBox(rect as never, 'nw', 0.1, 0.1, false)
    expect([r.x, r.y].every((v, i) => near(v, [0.1, 0.1][i]))).toBe(true)
    expect(near(r.w, 0.5) && near(r.h, 0.3)).toBe(true)
  })

  it('flips when dragged past the opposite side and stays positive', () => {
    const r = resizeBox(rect as never, 'e', 0.1, 0, false)
    expect(near(r.x, 0.1) && near(r.w, 0.1)).toBe(true)
  })

  it('keeps the aspect ratio on a corner with Shift', () => {
    const r = resizeBox(rect as never, 'se', 1.0, 0.25, true) // width grows to 0.8 → height follows to 0.4
    expect(near(r.w / r.h, 2)).toBe(true)
  })
})

describe('editing points', () => {
  it('drags a vertex', () => {
    const r = dragHandle(poly, 'v2', 0.3, 0.7)
    expect((r.a as { points: number[][] }).points[2]).toEqual([0.3, 0.7])
  })

  it('inserts a vertex by dragging a midpoint and keeps dragging the new one', () => {
    const r = dragHandle(line, 'm0', 0.3, 0.6)
    expect((r.a as { points: number[][] }).points).toEqual([[0.1, 0.8], [0.3, 0.6], [0.5, 0.8]])
    expect(r.id).toBe('v1')
  })

  it('deletes a vertex but keeps the minimum for the shape', () => {
    expect((removeVertex(poly, 0) as { points: unknown[] }).points).toHaveLength(3) // polygon needs 3
    const four = dragHandle(poly, 'm0', 0.3, 0).a
    expect((removeVertex(four, 1) as { points: unknown[] }).points).toHaveLength(3)
    expect(removeVertex(line, 0)).toBe(line)
  })

  it('simplifies a freehand stroke so its points can be edited', () => {
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [i / 199, 0.5 + (i % 2 ? 0.0001 : 0)])
    expect(simplifyPoints(pts, 2, 1280, 720)).toHaveLength(2) // a jittery straight line
    const free: Annotation = { id: 'f', kind: 'freehand', color: '#FFF', width: 3, points: pts }
    expect(handlesOf(free, true)).toHaveLength(0) // too many points to edit
    expect(handlesOf(simplify(free, 2, 1280, 720), true).length).toBeGreaterThan(0)
  })

  it('closes and opens a path', () => {
    expect(setClosed(line, true)).toBe(line) // needs 3 points
    const three = dragHandle(line, 'm0', 0.3, 0.6).a
    expect(setClosed(three, true).kind).toBe('polygon')
    expect(setClosed({ ...poly, fill: '#000' } as Annotation, false)).not.toHaveProperty('fill')
  })
})

describe('cropping pictures', () => {
  const img = { id: 'i', kind: 'image', color: '#FFF', x: 0.2, y: 0.2, w: 0.4, h: 0.4, assetId: 'a.png' } as Extract<Annotation, { kind: 'image' }>
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

  it('narrows the frame by a handle and keeps the picture in place', () => {
    const c = cropHandle(img, fullRect(img), 'e', 0.4, 0.3)
    expect(near(c.w, 0.2) && near(c.crop!.w, 0.5) && near(c.crop!.x, 0)).toBe(true)
    const f0 = fullRect(img), f1 = fullRect(c)
    expect(near(f0.x, f1.x) && near(f0.y, f1.y) && near(f0.w, f1.w) && near(f0.h, f1.h)).toBe(true)
  })

  it('zooms the picture around the frame center and pans it under the frame', () => {
    const z = zoomCrop(img, 2)
    expect(near(z.crop!.w, 0.5) && near(z.crop!.x, 0.25)).toBe(true)
    expect(zoomCrop(img, 0.5)).not.toHaveProperty('crop') // never smaller than the frame
    const p = panCrop(z, fullRect(z), 1, 0) // too far right: stops with the picture's left edge at the frame's
    expect(near(p.crop!.x, 0)).toBe(true)
  })
})

describe('formats and polygons', () => {
  it('applies fill only to fillable shapes, heads only to arrows, box only to text', () => {
    expect(applyStyle(rect, { fill: '#123456', fillOpacity: 0.4, dash: 'dash' })).toMatchObject({ fill: '#123456', fillOpacity: 0.4, dash: 'dash' })
    expect(applyStyle(line, { fill: '#123456' })).not.toHaveProperty('fill')
    expect(applyStyle({ id: 'a', kind: 'arrow', color: '#FFF', x1: 0, y1: 0, x2: 1, y2: 1, width: 3 }, { heads: 'both' })).toMatchObject({ heads: 'both' })
    const text: Annotation = { id: 't', kind: 'text', color: '#FFF', x: 0.1, y: 0.1, text: 'x', size: 36 }
    expect(applyStyle(text, { bold: false, box: { fill: '#000', fillOpacity: 0.5, stroke: null, strokeWidth: 2, padding: 8 } })).toMatchObject({ bold: false, box: { fillOpacity: 0.5 } })
  })

  it('centers a text on its x when asked', () => {
    const ctx = { font: '', measureText: () => ({ width: 128 }) } as unknown as CanvasRenderingContext2D
    const text: Annotation = { id: 't', kind: 'text', color: '#FFF', x: 0.5, y: 0.1, text: 'x', size: 36, align: 'center' }
    expect(bounds(ctx, text, 1280, 720).x).toBeCloseTo(0.45)
  })

  it('moves and rounds point shapes', () => {
    expect((translate(poly, 0.1, 0) as { points: number[][] }).points[0]).toEqual([0.2, 0.1])
    expect((roundCoords({ ...line, points: [[0.123456789, 0.5]] } as Annotation) as { points: number[][] }).points[0]).toEqual([0.1235, 0.5])
  })

  it('hits a filled polygon inside, an unfilled one only on its edges', () => {
    const ctx = { font: '', measureText: () => ({ width: 10 }) } as unknown as CanvasRenderingContext2D
    expect(pointInPolygon(0.3, 0.2, poly.kind === 'polygon' ? poly.points : [])).toBe(true)
    expect(hitTest(ctx, [poly], 0.3, 0.2, 1280, 720)).toBeNull()
    expect(hitTest(ctx, [{ ...poly, fill: '#000' } as Annotation], 0.3, 0.2, 1280, 720)?.id).toBe('p')
    expect(hitTest(ctx, [poly], 0.3, 0.1, 1280, 720)?.id).toBe('p') // on the top edge
  })
})
