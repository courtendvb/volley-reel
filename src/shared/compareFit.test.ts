import { describe, expect, it } from 'vitest'
import { alignCourts, fitSimilarity, inBox, onScreen, pictureRect, type FitSide } from './compareFit'

// A court seen from a high camera: a trapezoid, far end narrower than the near end.
const court = (scale = 1, cx = 0.5, cy = 0.55) => [
  { x: cx - 0.2 * scale, y: cy - 0.2 * scale }, { x: cx + 0.2 * scale, y: cy - 0.2 * scale },
  { x: cx - 0.35 * scale, y: cy + 0.25 * scale }, { x: cx + 0.35 * scale, y: cy + 0.25 * scale },
]
const side = (corners: FitSide['corners'], view = { zoom: 1, x: 0, y: 0 }): FitSide => ({ corners, aspect: 16 / 9, view })

describe('pictures in a box', () => {
  it('fits a picture whole, with bars where the shapes differ', () => {
    expect(pictureRect(16 / 9, 16 / 9)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    const r = pictureRect(16 / 9, 4 / 3) // a wider picture in a squarer box: bars above and below
    expect(r.w).toBe(1)
    expect(r.h).toBeCloseTo(0.75)
    expect(pictureRect(4 / 3, 16 / 9).w).toBeCloseTo(0.75)
  })
  it('puts the picture centre at the box centre', () => {
    expect(inBox({ x: 0.5, y: 0.5 }, 16 / 9, 4 / 3)).toEqual({ x: 0, y: 0 })
  })
  it('zooms about the box centre, then moves', () => {
    const p = onScreen({ x: 0.1, y: -0.2 }, { zoom: 2, x: 0.5, y: 0.1 }, 2)
    expect(p.x).toBeCloseTo(1.2)
    expect(p.y).toBeCloseTo(-0.3)
  })
})

describe('similarity fit', () => {
  it('finds the zoom and move between two sets of points', () => {
    const p = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
    const q = p.map(a => ({ x: 3 * a.x + 0.5, y: 3 * a.y - 1 }))
    const f = fitSimilarity(p, q)
    expect(f.scale).toBeCloseTo(3)
    expect(f.tx).toBeCloseTo(0.5)
    expect(f.ty).toBeCloseTo(-1)
  })
})

describe('court alignment', () => {
  it('zooms in the right when its court is the smaller, leaving the left as it is', () => {
    const a = alignCourts(side(court(1)), side(court(0.5)), 16 / 9)
    expect(a.left).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(a.right.zoom).toBeCloseTo(2)
    expect(a.offBy).toBeLessThan(1e-6)
  })
  it('zooms in the left too when the right court is the bigger one', () => {
    const a = alignCourts(side(court(0.5)), side(court(1)), 16 / 9)
    expect(a.left.zoom).toBeGreaterThanOrEqual(2) // at least the ratio of the courts, more where the right needs room to move
    expect(a.right.zoom).toBeGreaterThanOrEqual(1)
    expect(a.offBy).toBeLessThan(1e-6)
  })
  it('gives both a little zoom to move by, when the courts are the same size but not in the same place', () => {
    // the right court a little to the right and lower in its picture
    const a = alignCourts(side(court(1)), side(court(1, 0.55, 0.6)), 16 / 9)
    expect(a.left.zoom).toBeGreaterThan(1)
    expect(a.right.zoom).toBeCloseTo(a.left.zoom)
    expect(a.offBy).toBeLessThan(0.01)
  })
  it('accounts for the view the left already has', () => {
    const a = alignCourts(side(court(1), { zoom: 2, x: 0, y: 0 }), side(court(1)), 16 / 9)
    expect(a.left.zoom).toBe(2)
    expect(a.right.zoom).toBeCloseTo(2)
  })
  it('reports what a difference of angle leaves', () => {
    const wider = [{ x: 0.2, y: 0.35 }, { x: 0.8, y: 0.35 }, { x: 0.05, y: 0.8 }, { x: 0.95, y: 0.8 }] // seen from lower down: a flatter, wider trapezoid
    expect(alignCourts(side(court(1)), side(wider), 16 / 9).offBy).toBeGreaterThan(0.005)
  })
})
