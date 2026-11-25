import { describe, expect, it } from 'vitest'
import { bounds, hitTest, layTextOnFloor, refloorTexts, standTextOnFloor, roundCoords, translate, withTextQuad, type Annotation, type TextAnnotation } from './annotation'
import { dragHandle, handlesOf } from './annotationEdit'
import { DEFAULT_CORNERS, floorAt, floorQuad, refloorQuad, restandQuad } from './court'

// A text laid on the court's floor.
const W = 1280, H = 720
// Measures every character as half the font size wide.
const ctx = { font: "", measureText(this: { font: string }, s: string) { const px = parseFloat(/([\d.]+)px/.exec(this.font)![1]); return { width: (s.length * px) / 2 } } } as unknown as CanvasRenderingContext2D
const text: TextAnnotation = { id: 't', kind: 'text', color: '#FFF', x: 0.5, y: 0.55, text: 'ATTACK', size: 48, align: 'center' }
const metres = (x: number, y: number) => { const p = floorAt({ corners: DEFAULT_CORNERS }, { x, y })!; return { x: p.x * 9, y: p.y * 18 } }
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('text on the floor', () => {
  it('is laid as wide as it shows, a true rectangle on the floor, its top away from the camera', () => {
    const laid = layTextOnFloor(ctx, text, DEFAULT_CORNERS, W, H)!
    const [tl, tr, bl, br] = laid.quad!.map(([x, y]) => metres(x, y))
    expect(dist(tl, tr)).toBeCloseTo(dist(bl, br), 6)
    expect(dist(tl, bl)).toBeCloseTo(dist(tr, br), 6)
    // Square corners: the diagonals are the same length.
    expect(dist(tl, br)).toBeCloseTo(dist(tr, bl), 6)
    // Its shape on the floor is the text's.
    const b = bounds(ctx, text, W, H)
    expect(dist(tl, tr) / dist(tl, bl)).toBeCloseTo((b.w * W) / (b.h * H), 6)
    // Top (far) edge higher in the picture and narrower: the court's perspective.
    expect(laid.quad![0][1]).toBeLessThan(laid.quad![2][1])
    expect(laid.quad![1][0] - laid.quad![0][0]).toBeLessThan(laid.quad![3][0] - laid.quad![2][0])
  })

  it('is not laid off the floor', () => {
    expect(layTextOnFloor(ctx, { ...text, y: -3 }, DEFAULT_CORNERS, W, H)).toBeNull()
    expect(floorQuad(DEFAULT_CORNERS, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 2)).toBeNull()
  })

  it('is laid again for new words: same middle and height, wider', () => {
    const laid = layTextOnFloor(ctx, text, DEFAULT_CORNERS, W, H)!
    const longer = { ...laid, text: 'ATTACK ZONE' }
    const [again] = refloorTexts(ctx, [laid], [longer], DEFAULT_CORNERS, W, H) as TextAnnotation[]
    const q0 = laid.quad!.map(([x, y]) => metres(x, y)), q1 = again.quad!.map(([x, y]) => metres(x, y))
    expect(dist(q1[0], q1[2])).toBeCloseTo(dist(q0[0], q0[2]), 6)
    expect(dist(q1[0], q1[1]) / dist(q0[0], q0[1])).toBeCloseTo(11 / 6, 6)
    const mid = (q: { x: number; y: number }[]) => ({ x: (q[0].x + q[3].x) / 2, y: (q[0].y + q[3].y) / 2 })
    expect(dist(mid(q0), mid(q1))).toBeLessThan(1e-6)
    // A larger font makes it larger on the floor, about the same middle.
    const [bigger] = refloorTexts(ctx, [laid], [{ ...laid, size: 72 }], DEFAULT_CORNERS, W, H) as TextAnnotation[]
    const q2 = bigger.quad!.map(([x, y]) => metres(x, y))
    expect(dist(q2[0], q2[2]) / dist(q0[0], q0[2])).toBeCloseTo(1.5, 6)
    expect(dist(q2[0], q2[1]) / dist(q0[0], q0[1])).toBeCloseTo(1.5, 6)
    expect(dist(mid(q0), mid(q2))).toBeLessThan(1e-6)
    // A move or a colour change leaves it where it is.
    const recolored = { ...laid, color: '#000' }
    expect(refloorTexts(ctx, [laid], [recolored], DEFAULT_CORNERS, W, H)[0]).toBe(recolored)
  })

  it('keeps its way up when turned to read from the far side', () => {
    const laid = layTextOnFloor(ctx, text, DEFAULT_CORNERS, W, H)!, q = laid.quad!
    const turned = refloorQuad(DEFAULT_CORNERS, [q[3], q[2], q[1], q[0]], 3)!
    expect(turned[0][1]).toBeGreaterThan(turned[2][1]) // its top is now the near edge
  })

  it('moves, is picked and has its corners dragged like a picture on the floor, and goes flat again', () => {
    const laid = layTextOnFloor(ctx, text, DEFAULT_CORNERS, W, H)!
    const moved = translate(laid, 0.1, 0) as TextAnnotation
    expect(moved.quad![0][0]).toBeCloseTo(laid.quad![0][0] + 0.1)
    expect(moved.x).toBeCloseTo(0.6)
    const c = laid.quad!.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0])
    expect(hitTest(ctx, [laid as Annotation], c[0], c[1], W, H)?.id).toBe('t')
    expect(handlesOf(laid).map(h => h.id)).toEqual(['q0', 'q1', 'q2', 'q3'])
    expect(handlesOf(text)).toEqual([])
    const dragged = dragHandle(laid, 'q0', 0.1, 0.1).a as TextAnnotation
    expect(dragged.quad![0]).toEqual([0.1, 0.1])
    expect((roundCoords(laid) as TextAnnotation).quad![0][0]).toBe(Math.round(laid.quad![0][0] * 10000) / 10000)
    expect(withTextQuad(laid, null).quad).toBeUndefined()
  })

  it('stands upright with its foot where its bottom edge was', () => {
    const stood = standTextOnFloor(ctx, text, DEFAULT_CORNERS, W, H)!, q = stood.quad!
    expect(stood.stand).toBe(true)
    const b = bounds(ctx, text, W, H)
    // Its foot is the bottom edge it had, its top higher up the picture.
    expect(q[2][1]).toBeCloseTo(b.y + b.h, 6)
    expect(q[3][1]).toBeCloseTo(b.y + b.h, 6)
    expect(q[0][1]).toBeLessThan(q[2][1])
    // Stood again with the same shape, it does not move; with longer words, its foot widens about its middle.
    const same = restandQuad(DEFAULT_CORNERS, W, H, q, (b.w * W) / (b.h * H))!
    same.forEach((p, i) => { expect(p[0]).toBeCloseTo(q[i][0], 4); expect(p[1]).toBeCloseTo(q[i][1], 4) })
    const [longer] = refloorTexts(ctx, [stood], [{ ...stood, text: 'ATTACK ZONE' }], DEFAULT_CORNERS, W, H) as TextAnnotation[]
    expect(longer.stand).toBe(true)
    expect((longer.quad![2][0] + longer.quad![3][0]) / 2).toBeCloseTo((q[2][0] + q[3][0]) / 2, 4)
    expect(longer.quad![3][0] - longer.quad![2][0]).toBeGreaterThan(q[3][0] - q[2][0])
    expect(longer.quad![2][1] - longer.quad![0][1]).toBeCloseTo(q[2][1] - q[0][1], 4)
    // A larger font makes it taller and wider, its foot staying.
    const [bigger] = refloorTexts(ctx, [stood], [{ ...stood, size: 72 }], DEFAULT_CORNERS, W, H) as TextAnnotation[]
    expect(bigger.quad![2][1]).toBeCloseTo(q[2][1], 4)
    expect(bigger.quad![2][1] - bigger.quad![0][1]).toBeGreaterThan((q[2][1] - q[0][1]) * 1.3)
    expect(bigger.quad![3][0] - bigger.quad![2][0]).toBeGreaterThan((q[3][0] - q[2][0]) * 1.3)
    // Flat again: neither laid nor stood.
    const back = withTextQuad(stood, null)
    expect(back.quad).toBeUndefined()
    expect(back.stand).toBeUndefined()
    expect(layTextOnFloor(ctx, back, DEFAULT_CORNERS, W, H)!.stand).toBeUndefined()
  })

  it('changes shape as it is moved over the floor: the same size there, slanted at the sides', () => {
    const floor = { corners: DEFAULT_CORNERS, W, H }
    const side = (q: [number, number][]) => (q[2][0] - q[0][0]) / (q[2][1] - q[0][1]) // how its left edge leans
    for (const make of [layTextOnFloor, standTextOnFloor]) {
      const put = make(ctx, text, DEFAULT_CORNERS, W, H)!
      const left = translate(put, -0.25, 0, floor) as TextAnnotation, right = translate(put, 0.25, 0, floor) as TextAnnotation
      expect(left.stand).toBe(put.stand)
      // Leaning one way on the left and the other on the right (a lying text with the side lines, a
      // standing one as uprights do from a camera looking down: the other way).
      const l = side(left.quad!) - side(put.quad!), r = side(right.quad!) - side(put.quad!)
      expect(Math.abs(l)).toBeGreaterThan(0.01)
      expect(Math.abs(r)).toBeGreaterThan(0.01)
      expect(Math.sign(l)).toBe(-Math.sign(r))
      expect(Math.sign(l)).toBe(put.stand ? 1 : -1)
      // The same width on the floor (its bottom edge in metres).
      const wide = (q: [number, number][]) => dist(metres(...q[2]), metres(...q[3]))
      expect(wide(left.quad!)).toBeCloseTo(wide(put.quad!), 6)
      // Moved back, it is where it was.
      const back = translate(left, 0.25, 0, floor) as TextAnnotation
      back.quad!.forEach((p, i) => { expect(p[0]).toBeCloseTo(put.quad![i][0], 4); expect(p[1]).toBeCloseTo(put.quad![i][1], 4) })
      // Nearer the camera it is larger on the picture.
      const near = translate(put, 0, 0.15, floor) as TextAnnotation
      expect(near.quad![3][0] - near.quad![2][0]).toBeGreaterThan(put.quad![3][0] - put.quad![2][0])
    }
  })
})
