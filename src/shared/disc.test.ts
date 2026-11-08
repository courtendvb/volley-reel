import { describe, expect, it } from 'vitest'
import { discOutline, discShapes, reshapeDisc, syncDiscSides } from './disc'
import { mix } from './overlayDraw'
import type { CourtFit } from './court'

// The fitted court of a real video (0..1 of the picture).
const corners: CourtFit['corners'] = [{ x: 0.2377, y: 0.4845 }, { x: 0.7731, y: 0.4925 }, { x: 0.1017, y: 0.9179 }, { x: 0.904, y: 0.9179 }]
const box = (ps: [number, number][]) => ({ top: Math.min(...ps.map(p => p[1])), bottom: Math.max(...ps.map(p => p[1])), left: Math.min(...ps.map(p => p[0])), right: Math.max(...ps.map(p => p[0])) })

describe('a disc on the court', () => {
  it('lies flat as an ellipse in perspective without thickness', () => {
    const o = discOutline(corners, { u: 0.5, v: 0.75, r: 1, z: 0 })
    expect(o.top).toEqual(o.side)
    const b = box(o.top)
    expect(b.right - b.left).toBeGreaterThan(b.bottom - b.top) // wider than deep, seen from the stands
  })
  it('stands up with a thickness: the top higher in the picture, the side reaching down to the floor', () => {
    const flat = box(discOutline(corners, { u: 0.5, v: 0.75, r: 1, z: 0 }).top)
    const o = discOutline(corners, { u: 0.5, v: 0.75, r: 1, z: 1 })
    const top = box(o.top), side = box(o.side)
    expect(top.top).toBeLessThan(flat.top - 0.02)
    expect(side.bottom).toBeCloseTo(flat.bottom, 3)
    expect(side.top).toBeCloseTo(top.top, 3)
  })
  it('makes a side and a top in one group, and changes its thickness later', () => {
    const shapes = discShapes(corners, { u: 0.5, v: 0.75, r: 1, z: 0.3 }, { color: '#FFFFFF', fill: '#EF4444', fillOpacity: 0.8, width: 2 }, { side: 's', top: 't', group: 'g' })
    expect(shapes.map(a => a.kind === 'polygon' && a.disc?.part)).toEqual(['side', 'top'])
    expect(shapes.every(a => a.groupId === 'g')).toBe(true)
    const thick = reshapeDisc(shapes, 'g', corners, { z: 1.5 })
    const topOf = (a: (typeof thick)[number]) => (a.kind === 'polygon' ? box(a.points).top : 0)
    expect(topOf(thick[1])).toBeLessThan(topOf(shapes[1]))
    expect(thick[1].kind === 'polygon' && thick[1].disc).toMatchObject({ z: 1.5, part: 'top' })
  })
})

describe('a disc\'s side', () => {
  it('follows its top\'s colour in a darker shade', () => {
    const [side, top] = discShapes(corners, { u: 0.5, v: 0.75, r: 1, z: 0.3 }, { color: '#FFFFFF', fill: '#EF4444', fillOpacity: 0.8, width: 2 }, { side: 's', top: 't', group: 'g' })
    const recoloured = top.kind === 'polygon' ? { ...top, fill: '#3B82F6', fillOpacity: 0.5 } : top
    const [s2] = syncDiscSides([side, recoloured])
    expect(s2).toMatchObject({ fill: mix('#3B82F6', '#000000', 0.35), fillOpacity: 0.5, color: '#FFFFFF', width: 2 })
  })
  it('takes the outline round the whole solid', () => {
    const [side, top] = discShapes(corners, { u: 0.5, v: 0.75, r: 1, z: 0.2 }, { color: '#111111', fill: '#EF4444', fillOpacity: 1, width: 3 }, { side: 's', top: 't', group: 'g' })
    expect(side).toMatchObject({ color: '#111111', width: 3 })
    const none = syncDiscSides([side, top.kind === 'polygon' ? { ...top, width: 0 } : top])[0]
    expect(none).toMatchObject({ width: 0 })
  })
})

describe('a moved disc', () => {
  it('keeps its new place when its thickness changes', () => {
    const shapes = discShapes(corners, { u: 0.5, v: 0.75, r: 1, z: 0.3 }, { color: '#FFFFFF', fill: '#EF4444', fillOpacity: 1, width: 2 }, { side: 's', top: 't', group: 'g' })
    const moved = shapes.map(a => (a.kind === 'polygon' ? { ...a, points: a.points.map(([x, y]) => [x + 0.1, y] as [number, number]) } : a))
    const out = reshapeDisc(moved, 'g', corners, { z: 0.6 })
    const d = out[1].kind === 'polygon' ? out[1].disc! : null
    expect(d!.u).toBeGreaterThan(0.6) // moved right across the court
    expect(d!.v).toBeCloseTo(0.75, 1)
    const cx = (a: (typeof out)[number]) => (a.kind === 'polygon' ? a.points.reduce((s, p) => s + p[0], 0) / a.points.length : 0)
    expect(Math.abs(cx(out[1]) - cx(moved[1]))).toBeLessThan(0.02) // still where it was dragged
    // left alone, it stays put
    const same = reshapeDisc(shapes, 'g', corners, { z: 0.6 })
    expect(same[1].kind === 'polygon' && same[1].disc).toMatchObject({ u: 0.5, v: 0.75 })
  })
})
