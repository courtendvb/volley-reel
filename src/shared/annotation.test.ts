import { describe, expect, it } from 'vitest'
import { applyStyle, freshIds, hitTest, normalizeBox, pasteCopies, shiftTimes, translate, visibleAt, type Annotation } from './annotation'

// Enough of a 2D context for hit testing: text width = 0.5 * font px per character.
const fake = { font: '', measureText: (t: string) => ({ width: t.length * 0.5 * parseFloat(/(\d+(\.\d+)?)px/.exec(fake.font)![1]) }) }
const ctx = fake as unknown as CanvasRenderingContext2D

const arrow: Annotation = { id: 'a', kind: 'arrow', color: '#FFF', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, width: 6 }
const rect: Annotation = { id: 'r', kind: 'rect', color: '#FFF', x: 0.6, y: 0.6, w: 0.2, h: 0.2, width: 6 }
const text: Annotation = { id: 't', kind: 'text', color: '#FFF', x: 0.1, y: 0.8, text: 'Watch', size: 36 }

describe('visibility', () => {
  const clip = { in: 100, out: 110 }
  it('defaults to the whole clip', () => {
    expect(visibleAt(arrow, 100, clip)).toBe(true)
    expect(visibleAt(arrow, 110, clip)).toBe(true)
    expect(visibleAt(arrow, 110.5, clip)).toBe(false)
  })
  it('honours absolute show/hide times', () => {
    const a = { ...arrow, showFrom: 103, showTo: 105 }
    expect([102.9, 103, 104, 105, 105.1].map(t => visibleAt(a, t, clip))).toEqual([false, true, true, true, false])
  })
})

describe('editing', () => {
  it('moves every kind by the same offset', () => {
    expect(translate(arrow, 0.1, 0)).toMatchObject({ x1: 0.2, x2: 0.6 })
    expect(translate(rect, 0, -0.1)).toMatchObject({ x: 0.6, y: 0.5 })
    const f: Annotation = { id: 'f', kind: 'freehand', color: '#FFF', width: 3, points: [[0, 0], [0.1, 0.1]] }
    expect((translate(f, 0.5, 0.5) as { points: number[][] }).points).toEqual([[0.5, 0.5], [0.6, 0.6]])
  })

  it('stores boxes drawn up-left with positive size', () => {
    expect(normalizeBox({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 })).toEqual({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 })
  })

  it('applies size to text and width to shapes', () => {
    expect(applyStyle(text, { color: '#EF4444', width: 10, size: 52 })).toMatchObject({ color: '#EF4444', size: 52 })
    expect(applyStyle(rect, { width: 10, size: 52 })).toMatchObject({ width: 10 })
  })
})

describe('hit testing', () => {
  const list = [arrow, rect, text]
  it('finds shapes near the point, topmost first', () => {
    expect(hitTest(ctx, list, 0.3, 0.3, 1280, 720)?.id).toBe('a') // on the arrow line
    expect(hitTest(ctx, list, 0.3, 0.2, 1280, 720)).toBeNull() // off the line
    expect(hitTest(ctx, list, 0.7, 0.7, 1280, 720)?.id).toBe('r')
    expect(hitTest(ctx, list, 0.15, 0.82, 1280, 720)?.id).toBe('t')
  })
})

describe('saving', () => {
  it('rounds coordinates to 4 places', async () => {
    const { roundCoords } = await import('./annotation')
    expect(roundCoords({ ...rect, x: 0.6499999999999998, w: 0.20000000000000007 })).toMatchObject({ x: 0.65, w: 0.2 })
  })
})

describe('copy and paste', () => {
  const g1: Annotation = { ...rect, id: 'g1', groupId: 'G', showFrom: 12, showTo: 14 }
  const g2: Annotation = { ...arrow, id: 'g2', groupId: 'G' }
  it('gives new ids and one new group id per group', () => {
    let n = 0
    const out = freshIds([g1, g2, text], () => `n${++n}`)
    expect(out.map(a => a.id)).toEqual(['n2', 'n3', 'n4'])
    expect(out[0].groupId).toBe('n1')
    expect(out[1].groupId).toBe('n1')
    expect(out[2].groupId).toBeUndefined()
  })
  it('moves times, or drops them for a title card', () => {
    expect(shiftTimes(g1, -10)).toMatchObject({ showFrom: 2, showTo: 4 })
    expect(shiftTimes(g1, null).showFrom).toBeUndefined()
  })
  it('steps off the originals, stays in place elsewhere', () => {
    const copy = freshIds([g1])
    expect(pasteCopies(copy, [])[0]).toMatchObject({ x: 0.6, y: 0.6 })
    const moved = pasteCopies(copy, [g1])[0] as unknown as { x: number }
    expect(moved.x).toBeCloseTo(0.62)
    const twice = pasteCopies(copy, [g1, moved as unknown as Annotation])[0] as unknown as { x: number }
    expect(twice.x).toBeCloseTo(0.64)
  })
})
