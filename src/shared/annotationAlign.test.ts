import { describe, expect, it } from 'vitest'
import { pointsBox, type Annotation, type Rect } from './annotation'
import { alignObjects, centerInFrame, distributeObjects, snapMove, unitCount } from './annotationAlign'

const box = (id: string, x: number, y: number, w: number, h: number, groupId?: string): Annotation =>
  ({ id, kind: 'rect', color: '#FFF', x, y, w, h, width: 4, ...(groupId ? { groupId } : {}) })
// Boxes and point shapes are measured from their own coordinates; no canvas needed here.
const boxOf = (a: Annotation): Rect => (a.kind === 'rect' ? { x: a.x, y: a.y, w: a.w, h: a.h } : 'points' in a ? pointsBox(a.points) : { x: 0, y: 0, w: 0, h: 0 })
const xs = (l: Annotation[]) => l.map(a => +boxOf(a).x.toFixed(6))
const ys = (l: Annotation[]) => l.map(a => +boxOf(a).y.toFixed(6))

const a = box('a', 0.1, 0.1, 0.2, 0.1), b = box('b', 0.4, 0.3, 0.1, 0.2), c = box('c', 0.7, 0.6, 0.2, 0.1)

describe('aligning picked objects', () => {
  it('lines up left, right and middles on the picked objects together', () => {
    expect(xs(alignObjects([a, b, c], ['a', 'b', 'c'], 'left', boxOf))).toEqual([0.1, 0.1, 0.1])
    expect(alignObjects([a, b, c], ['a', 'b', 'c'], 'right', boxOf).map(o => +(boxOf(o).x + boxOf(o).w).toFixed(6))).toEqual([0.9, 0.9, 0.9])
    expect(alignObjects([a, b, c], ['a', 'c'], 'hcenter', boxOf).map(o => +(boxOf(o).x + boxOf(o).w / 2).toFixed(6))).toEqual([0.5, 0.45, 0.5])
    expect(ys(alignObjects([a, b, c], ['a', 'b', 'c'], 'top', boxOf))).toEqual([0.1, 0.1, 0.1])
    expect(alignObjects([a, b], ['a', 'b'], 'bottom', boxOf).map(o => +(boxOf(o).y + boxOf(o).h).toFixed(6))).toEqual([0.5, 0.5])
  })

  it('moves a group as one object, keeping its members where they are to each other', () => {
    const g1 = box('g1', 0.5, 0.2, 0.1, 0.1, 'g'), g2 = box('g2', 0.7, 0.2, 0.1, 0.1, 'g')
    const out = alignObjects([a, g1, g2], ['a', 'g1'], 'left', boxOf)
    expect(xs(out)).toEqual([0.1, 0.1, 0.3])
    expect(unitCount([a, g1, g2], ['a', 'g1'])).toBe(2)
  })

  it('lines one object up with the picture', () => {
    expect(xs(alignObjects([a, b], ['b'], 'left', boxOf))).toEqual([0.1, 0])
    expect(alignObjects([a, b], ['b'], 'vcenter', boxOf).map(o => +(boxOf(o).y + boxOf(o).h / 2).toFixed(6))).toEqual([0.15, 0.5])
  })

  it('spaces three or more evenly, the first and last staying', () => {
    const out = distributeObjects([c, a, b], ['a', 'b', 'c'], 'x', boxOf)
    // a ends at 0.3, c starts at 0.7: b (0.1 wide) leaves gaps of 0.15 on each side.
    expect(xs(out)).toEqual([0.7, 0.1, 0.45])
    expect(distributeObjects([a, b], ['a', 'b'], 'x', boxOf)).toEqual([a, b]) // two: nothing to space
    expect(ys(distributeObjects([a, b, c], ['a', 'b', 'c'], 'y', boxOf))).toEqual([0.1, 0.3, 0.6])
  })

  it('puts the picked, as they are, in the middle of the picture', () => {
    const out = centerInFrame([a, b, c], ['a', 'b'], 'x', boxOf)
    // a and b together run 0.1..0.5, so they move 0.2 right; c is not picked.
    expect(xs(out)).toEqual([0.3, 0.6, 0.7])
    const t = centerInFrame([a], ['a'], 'y', boxOf)
    expect(+(boxOf(t[0]).y + boxOf(t[0]).h / 2).toFixed(6)).toBe(0.5)
  })

  it('moves every kind of object, a line by its points', () => {
    const l: Annotation = { id: 'l', kind: 'polyline', color: '#FFF', width: 3, points: [[0.6, 0.6], [0.8, 0.7]] }
    expect(xs(alignObjects([a, l], ['a', 'l'], 'left', boxOf))).toEqual([0.1, 0.1])
  })
})

describe('smart guides', () => {
  const W = 1000, H = 500
  const moving: Rect = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }
  const other: Rect = { x: 0.6, y: 0.5, w: 0.2, h: 0.2 }

  it('sticks an edge to another object edge when it comes within the threshold', () => {
    // Moved by 0.396 the left edge is at 0.596, 4 px from the other's left at 0.6: it sticks.
    const r = snapMove(moving, 0.396, 0, [other], W, H)
    expect(+r.dx.toFixed(6)).toBe(0.4)
    expect(r.guides).toContainEqual({ axis: 'x', at: 0.6, from: 0.2, to: 0.7 })
  })

  it('does not stick from further away', () => {
    const r = snapMove(moving, 0.38, 0, [other], W, H) // 20 px off
    expect(r.dx).toBe(0.38)
    expect(r.guides.filter(g => g.axis === 'x')).toEqual([])
  })

  it('sticks to the middle of the picture, with a line all the way across it', () => {
    // The box's middle at 0.25 + 0.248 = 0.498, 2 px from the picture's middle.
    const r = snapMove(moving, 0.248, 0.248, [], W, H)
    expect(+r.dx.toFixed(6)).toBe(0.25)
    expect(+r.dy.toFixed(6)).toBe(0.25)
    expect(r.guides).toContainEqual({ axis: 'x', at: 0.5, from: 0, to: 1 })
    expect(r.guides).toContainEqual({ axis: 'y', at: 0.5, from: 0, to: 1 })
  })

  it('sticks the middles of two objects, and each axis on its own', () => {
    // The moving box's middle (0.25) moved by 0.447 is 3 px left of the other's middle (0.7).
    const r = snapMove(moving, 0.447, 0.1, [other], W, H)
    expect(+r.dx.toFixed(6)).toBe(0.45)
    expect(r.dy).toBe(0.1)
  })

  it('picks the nearest when several are within reach', () => {
    const near: Rect = { x: 0.503, y: 0, w: 0.1, h: 0.1 }
    // The left edge at 0.5: the picture's middle (0 px) wins over the other's left (3 px).
    const r = snapMove(moving, 0.3, 0, [near], W, H)
    expect(+r.dx.toFixed(6)).toBe(0.3)
  })
})
