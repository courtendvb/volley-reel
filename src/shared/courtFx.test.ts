import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, cleanGridStyle, drawLandingFx, isLandingFx, landingFxEnd, landingFxStill, type LandingFx } from './court'

const fit = { corners: DEFAULT_CORNERS, nearSet1: '*' as const }
const impact = { x: 0.6, y: 0.3 }, start = { x: 0.3, y: 1.05 }

const strokes = (fx: LandingFx, sec: number, track = { start }) => {
  let n = 0
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'fill' || k === 'stroke' ? () => { n++ } : () => {}), set: () => true }) as unknown as Parameters<typeof drawLandingFx>[0]
  drawLandingFx(ctx, 1280, 720, fit, fx, impact, sec, '#FFC23D', track)
  return n
}

describe('landing effects', () => {
  it('knows its kinds, and keeps one other than the ripple in the style', () => {
    expect(isLandingFx('lock')).toBe(true)
    expect(isLandingFx('x')).toBe(false)
    expect(cleanGridStyle({ ripple: true, rippleKind: 'flash' }).rippleKind).toBe('flash')
    expect(cleanGridStyle({ ripple: true, rippleKind: 'ripple' }).rippleKind).toBeUndefined()
    expect(cleanGridStyle({ ripple: true, rippleKind: 'nope' }).rippleKind).toBeUndefined()
  })

  it('draws each one while it lasts, and nothing before the landing or after the end', () => {
    for (const fx of ['lock', 'flash', 'trail'] as const) {
      expect(strokes(fx, landingFxStill[fx])).toBeGreaterThan(0)
      expect(strokes(fx, -0.1)).toBe(0)
      expect(strokes(fx, landingFxEnd(fx) + 0.1)).toBe(0)
    }
  })

  it('shows the trail only with a start, but keeps the landing mark', () => {
    const withStart = strokes('trail', 0.5), without = strokes('trail', 0.5, null as unknown as { start: typeof start })
    expect(withStart).toBeGreaterThan(without)
    expect(without).toBeGreaterThan(0)
  })
})
