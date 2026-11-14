import { describe, expect, it, vi } from 'vitest'
import { BLINK_ON, BLINK_SEC, PULSE_SEC, RIPPLE_SEC, animAfter, animAt, cutPoints, drawAnnotation, emphasisOf, fadeAlpha, isAnimated, withEmphasis, type Annotation } from './annotation'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '' } }))
const { layerEnable } = await import('../main/export')

const arrow: Annotation = { id: 'a', kind: 'arrow', color: '#FFF', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, width: 6 }

describe('motion', () => {
  const clip = { in: 100, out: 110 }
  it('is none for an object that does not move', () => {
    expect(isAnimated(arrow)).toBe(false)
    expect(animAt(arrow, 101, clip)).toBeUndefined()
  })
  it('draws in over drawIn seconds from its show time, then stands still', () => {
    const a = { ...arrow, showFrom: 102, drawIn: 2 }
    expect(animAt(a, 102, clip)).toEqual({ reveal: 0 })
    expect(animAt(a, 103, clip)).toEqual({ reveal: 0.5 })
    expect(animAt(a, 104, clip)).toBeUndefined()
  })
  it('counts from the clip IN when it has no show time', () => {
    expect(animAt({ ...arrow, drawIn: 1 }, 100.25, clip)).toEqual({ reveal: 0.25 })
  })
  it('swells once drawn, again every PULSE_SEC', () => {
    const a = { ...arrow, drawIn: 1, pulse: true }
    expect(animAfter(a, 0.5)).toEqual({ reveal: 0.5 })
    expect(animAfter(a, 1)!.pulse).toBeCloseTo(0)
    expect(animAfter(a, 1 + PULSE_SEC / 2)!.pulse).toBeCloseTo(0.5)
    expect(animAfter(a, 1 + PULSE_SEC * 3.25)!.pulse).toBeCloseTo(0.25)
  })
  it('drawing in replaces the fade-in, but keeps the fade-out', () => {
    const a = { ...arrow, fadeIn: 2, fadeOut: 2, drawIn: 1 }
    expect(fadeAlpha(a, 100.5, clip)).toBe(1)
    expect(fadeAlpha(a, 109, clip)).toBeCloseTo(0.5)
    expect(fadeAlpha({ ...a, drawIn: undefined }, 101, clip)).toBeCloseTo(0.5)
  })
})

describe('cutPoints', () => {
  const l: [number, number][] = [[0, 0], [0.5, 0], [0.5, 0.5]] // two pieces of equal length on a square frame
  it('cuts a line at a share of its length', () => {
    expect(cutPoints(l, 0.25, 100, 100)).toEqual([[0, 0], [0.25, 0]])
    expect(cutPoints(l, 0.75, 100, 100)).toEqual([[0, 0], [0.5, 0], [0.5, 0.25]])
    expect(cutPoints(l, 1, 100, 100)).toEqual(l)
  })
  it('measures length on the frame, not in shares', () => {
    // On a frame twice as wide as tall, the first piece is twice as long as the second.
    const p = cutPoints(l, 0.5, 200, 100)
    expect(p).toHaveLength(2)
    expect(p[1][0]).toBeCloseTo(0.375)
  })
})

describe('layerEnable', () => {
  it('is nothing for a layer over the whole clip', () => {
    expect(layerEnable({}, 0, 5)).toBe('')
  })
  it('switches a layer on in its window', () => {
    expect(layerEnable({ from: 1, to: 2 }, 1, 2)).toBe(":enable='between(t,1.000,2.000)'")
  })
  it('switches a pulse layer on at its moment of every period', () => {
    expect(layerEnable({ from: 1, to: 4, every: { period: 1.2, at: 0.3, len: 0.1 } }, 1, 4))
      .toBe(":enable='between(t,1.000,4.000)*gte(mod(t-1.000,1.200),0.300)*lt(mod(t-1.000,1.200),0.400)'")
  })
})

describe('emphasis', () => {
  it('reads the older pulse flag as a pulse, and drops it when the emphasis is set', () => {
    expect(emphasisOf({ ...arrow, pulse: true })).toBe('pulse')
    const a = withEmphasis({ ...arrow, pulse: true }, 'blink')
    expect(a).not.toHaveProperty('pulse')
    expect(emphasisOf(a)).toBe('blink')
    expect(withEmphasis(a, undefined)).not.toHaveProperty('emphasis')
    expect(isAnimated({ ...arrow, emphasis: 'ripple' })).toBe(true)
  })
  it('blinks: shown for the first part of every blink, off for the rest', () => {
    const a: Annotation = { ...arrow, emphasis: 'blink' }
    expect(animAfter(a, 0)).toBeUndefined()
    expect(animAfter(a, BLINK_SEC * (BLINK_ON - 0.05))).toBeUndefined()
    expect(animAfter(a, BLINK_SEC * (BLINK_ON + 0.05))).toEqual({ hidden: true })
    expect(animAfter(a, BLINK_SEC * 3.1)).toBeUndefined()
  })
  it('sends out a ring every RIPPLE_SEC, after drawing in', () => {
    const a: Annotation = { ...arrow, drawIn: 1, emphasis: 'ripple' }
    expect(animAfter(a, 0.5)).toEqual({ reveal: 0.5 })
    expect(animAfter(a, 1 + RIPPLE_SEC * 0.25)!.ripple).toBeCloseTo(0.25)
    expect(animAfter(a, 1 + RIPPLE_SEC * 2.5)!.ripple).toBeCloseTo(0.5)
  })
})

describe('a triangle drawing in', () => {
  // A canvas context that records the path's points and the opacity of each fill.
  const recorder = () => {
    const pts: [number, number][] = [], fills: number[] = []
    const ctx: Record<string, unknown> = { globalAlpha: 1 }
    const state: number[] = []
    Object.assign(ctx, {
      save: () => state.push(ctx.globalAlpha as number), restore: () => { ctx.globalAlpha = state.pop() },
      moveTo: (x: number, y: number) => pts.push([x, y]), lineTo: (x: number, y: number) => pts.push([x, y]),
      fill: () => fills.push(ctx.globalAlpha as number),
    })
    return { pts, fills, ctx: new Proxy(ctx, { get: (o, k) => (k in o ? o[k as string] : () => {}) }) as unknown as CanvasRenderingContext2D }
  }
  const cone: Annotation = { id: 'c', kind: 'polygon', color: '#EF4444', points: [[0.5, 0.2], [0.7, 0.8], [0.3, 0.8]], width: 4, fill: '#EF4444', fillOpacity: 1, drawIn: 1 }
  it('opens out from its tip (its first point) as it fades in', () => {
    const r = recorder()
    drawAnnotation(r.ctx, cone, 100, 100, undefined, { reveal: 0.5 })
    const e = 1 - 0.5 ** 3
    expect(r.pts[0]).toEqual([50, 20])
    expect(r.pts[1][0]).toBeCloseTo(50 + 20 * e)
    expect(r.pts[1][1]).toBeCloseTo(20 + 60 * e)
    expect(r.fills[0]).toBeCloseTo(0.75)
  })
  it('is whole once drawn', () => {
    const r = recorder()
    drawAnnotation(r.ctx, cone, 100, 100)
    expect(r.pts.slice(0, 3)).toEqual([[50, 20], [70, 80], [30, 80]])
    expect(r.fills[0]).toBe(1)
  })
})
