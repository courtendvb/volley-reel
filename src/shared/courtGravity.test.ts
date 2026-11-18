import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, drawGravity, gravityField, gravityLook, gravitySteps, GRAVITY_END_SEC, GRAVITY_PRE_SEC } from './court'

const fit = { corners: DEFAULT_CORNERS, nearSet1: '*' as const }
const around = (x: number, y: number, r: number) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dy]) => ({ x: x + dx / 9, y: y + dy / 18 }))

describe('gravity field', () => {
  it('needs three past landings besides this one', () => {
    expect(gravityField(around(0.5, 0.2, 1).slice(0, 3), { x: 0.9, y: 0.9 })).not.toBeNull()
    expect(gravityField(around(0.5, 0.2, 1).slice(0, 2), { x: 0.9, y: 0.9 })).toBeNull()
  })

  it('leaves this shot out of its own past', () => {
    const past = around(0.5, 0.2, 1)
    const g = gravityField([...past, { x: 0.8, y: 0.3 }], { x: 0.8, y: 0.3 })!
    expect(g.nodes).toHaveLength(past.length)
  })

  it('is caught inside the core and broken away outside it', () => {
    const past = around(0.5, 0.2, 1)
    expect(gravityField(past, { x: 0.5, y: 0.2 })!.caught).toBe(true)
    expect(gravityField(past, { x: 0.95, y: 0.45 })!.caught).toBe(false)
  })

  it('reads how tight the landings are into its look', () => {
    expect(gravityLook(1).label).toBe('sharp')
    expect(gravityLook(3).label).toBe('area')
    expect(gravityLook(7).label).toBe('scattered')
    expect(gravityField(around(0.5, 0.2, 1), { x: 0.5, y: 0.2 })!.spread).toBeCloseTo(1, 5)
  })

  it('draws at every moment without failing, and nothing outside its span', () => {
    let drawn = 0
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'lineTo' ? () => { drawn++ } : () => {}), set: () => true }) as unknown as Parameters<typeof drawGravity>[0]
    const g = gravityField(around(0.5, 0.2, 1), { x: 0.95, y: 0.45 })!
    for (const st of gravitySteps()) drawGravity(ctx, 1280, 720, fit, g, st.at)
    expect(drawn).toBeGreaterThan(0)
    drawn = 0
    drawGravity(ctx, 1280, 720, fit, g, -GRAVITY_PRE_SEC - 1)
    drawGravity(ctx, 1280, 720, fit, g, GRAVITY_END_SEC + 1)
    expect(drawn).toBe(0)
  })

  it('steps run from before the landing to the end, with no gap', () => {
    const steps = gravitySteps()
    expect(steps[0].from).toBeCloseTo(-GRAVITY_PRE_SEC, 5)
    expect(steps[steps.length - 1].to).toBeCloseTo(GRAVITY_END_SEC, 5)
    steps.slice(1).forEach((s, i) => expect(s.from).toBeCloseTo(steps[i].to, 5))
  })
})
