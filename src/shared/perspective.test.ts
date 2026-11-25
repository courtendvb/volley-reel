import { describe, expect, it } from 'vitest'
import { WARP_STEPS, affine, boxQuad, drawAnnotation, hitTest, imageOnFloor, roundCoords, translate, withQuad, type Annotation, type Quad } from './annotation'
import { dragHandle, handlesOf } from './annotationEdit'
import { DEFAULT_CORNERS, courtQuad, floorAt } from './court'

// A picture laid with perspective (a heatmap on the court).
type Img = Extract<Annotation, { kind: 'image' }>
const flat: Img = { id: 'i', kind: 'image', color: '#FFF', x: 0.2, y: 0.2, w: 0.4, h: 0.3, assetId: 'a.png' }
const trapezoid: Quad = [[0.4, 0.3], [0.6, 0.3], [0.2, 0.8], [0.8, 0.8]]
const laid = withQuad(flat, trapezoid)
const ctx = {} as CanvasRenderingContext2D

describe('perspective pictures', () => {
  it('keep their bounds in x, y, w, h and go flat again in them', () => {
    expect([laid.x, laid.y, laid.w, laid.h]).toEqual([0.2, 0.3, 0.6000000000000001, 0.5])
    const back = withQuad(laid, null)
    expect(back.quad).toBeUndefined()
    expect(back.x).toBe(0.2)
    expect(boxQuad(flat)).toEqual([[0.2, 0.2], [0.6000000000000001, 0.2], [0.2, 0.5], [0.6000000000000001, 0.5]])
  })

  it('move with their corners, and round them when saved', () => {
    const moved = translate(laid, 0.1, 0) as Img
    expect(moved.quad![0][0]).toBeCloseTo(0.5)
    expect(moved.x).toBeCloseTo(0.3)
    expect((roundCoords(withQuad(flat, [[0.123456, 0.3], [0.6, 0.3], [0.2, 0.8], [0.8, 0.8]])) as Img).quad![0][0]).toBe(0.1235)
  })

  it('are hit inside the quad, not in the corners of their bounds', () => {
    expect(hitTest(ctx, [laid], 0.5, 0.6, 1280, 720)?.id).toBe('i')
    expect(hitTest(ctx, [laid], 0.22, 0.32, 1280, 720)).toBeNull() // inside the bounds, outside the trapezoid
  })

  it('show one handle per corner, each dragged on its own', () => {
    expect(handlesOf(laid).map(h => h.id)).toEqual(['q0', 'q1', 'q2', 'q3'])
    const r = dragHandle(laid, 'q3', 0.9, 0.9).a as Img
    expect(r.quad![3]).toEqual([0.9, 0.9])
    expect(r.quad![0]).toEqual([0.4, 0.3])
    expect(r.w).toBeCloseTo(0.7)
  })

  it('are laid on the whole court or a half of it', () => {
    const full = courtQuad(DEFAULT_CORNERS, 'full')
    expect(full[0][0]).toBeCloseTo(DEFAULT_CORNERS[0].x)
    expect(full[3][1]).toBeCloseTo(DEFAULT_CORNERS[3].y)
    const near = courtQuad(DEFAULT_CORNERS, 'near'), far = courtQuad(DEFAULT_CORNERS, 'far')
    expect(near[0]).toEqual(far[2]) // both halves meet at the net
    expect(near[2][1]).toBeCloseTo(DEFAULT_CORNERS[2].y)
  })

  it('maps triangles exactly', () => {
    const m = affine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], [{ x: 5, y: 5 }, { x: 25, y: 7 }, { x: 3, y: 30 }])!
    const at = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
    expect(at(10, 0)).toEqual([25, 7])
    expect(at(0, 10)).toEqual([3, 30])
  })

  it('are drawn as a mesh of triangles, each a part of the picture', () => {
    const calls: number[][] = []
    const noop = () => {}
    const fake = { save: noop, restore: noop, beginPath: noop, lineTo: noop, closePath: noop, clip: noop, transform: noop, setLineDash: noop, strokeRect: noop,
      globalAlpha: 1, drawImage: (...a: unknown[]) => calls.push(a.slice(1) as number[]) } as unknown as CanvasRenderingContext2D
    const img = { width: 320, height: 160 } as unknown as CanvasImageSource
    drawAnnotation(fake, laid, 1280, 720, () => img)
    expect(calls.length).toBe(2 * WARP_STEPS * WARP_STEPS)
    for (const [x, y, w, h] of calls) { expect(x + w).toBeLessThanOrEqual(320); expect(y + h).toBeLessThanOrEqual(160) }
  })
})

describe('pictures on the floor', () => {
  const logo: Img = { id: 'l', kind: 'image', color: '#FFF', x: 0.4, y: 0.55, w: 0.2, h: 0.2 * 1280 / 2 / 720, assetId: 'logo.png' } // 2:1 on screen
  const metres = (q: Quad) => q.map(([x, y]) => { const p = floorAt({ corners: DEFAULT_CORNERS }, { x, y })!; return [p.x * 9, p.y * 18] })

  it('lie in the middle of a half, keeping their shape on the floor', () => {
    for (const part of ['near', 'far'] as const) {
      const a = imageOnFloor(logo, part, DEFAULT_CORNERS, 1280, 720)!
      expect(a.floor).toBe('lay')
      const [tl, tr, bl] = metres(a.quad!)
      const w = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), h = Math.hypot(bl[0] - tl[0], bl[1] - tl[1])
      expect(w / h).toBeCloseTo(2, 3)
      expect((tl[1] + bl[1]) / 2).toBeCloseTo(part === 'near' ? 13.5 : 4.5, 3)
      expect((tl[0] + tr[0]) / 2).toBeCloseTo(4.5, 3)
    }
  })

  it('move over the floor, and go back flat where they were', () => {
    const a = imageOnFloor(logo, 'lay', DEFAULT_CORNERS, 1280, 720)!
    const moved = translate(a, 0, -0.1, { corners: DEFAULT_CORNERS, W: 1280, H: 720 }) as Img
    const before = metres(a.quad!), after = metres(moved.quad!)
    // The same size on the floor, so it shows smaller farther away.
    expect(Math.hypot(after[1][0] - after[0][0], after[1][1] - after[0][1])).toBeCloseTo(Math.hypot(before[1][0] - before[0][0], before[1][1] - before[0][1]), 3)
    expect(moved.w).toBeLessThan(a.w)
    const back = withQuad(moved, null)
    expect([back.floor, back.flat, back.quad]).toEqual([undefined, undefined, undefined])
    expect(back.y).toBeCloseTo(logo.y - 0.1)
    expect(back.w).toBeCloseTo(logo.w)
  })

  it('stand on the floor with their foot where their bottom edge was', () => {
    const a = imageOnFloor(logo, 'stand', DEFAULT_CORNERS, 1280, 720)!
    expect(a.floor).toBe('stand')
    expect(a.quad![2][1]).toBeCloseTo(logo.y + logo.h, 3)
  })
})
