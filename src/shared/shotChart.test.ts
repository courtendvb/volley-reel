import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, type CourtFit } from './court'
import type { PlayRef } from './filter'
import { courtFan, fanCones, shotCharts } from './shotChart'

const fit: CourtFit = { corners: DEFAULT_CORNERS, nearSet1: '*' }
const ref = (skill: string, zone: number | null, effect: string, end: { u: number; v: number } | null = { u: 0.5, v: 0.9 }) => ({
  play: { skill, effect, code: `*07${skill}H${effect}`, startZone: zone, startClick: end ? { u: 0.2, v: 0.45 } : null, endClick: end },
}) as unknown as PlayRef
const shares = (a: { fillOpacity?: number }[]) => a.map(x => +(x.fillOpacity ?? 0).toFixed(2))

describe('fanCones', () => {
  it('cuts the fan in five and puts each shot in one, the outside ones in the nearest', () => {
    const cones = fanCones([0, 0.1, 0.5, 0.9, 1, 3, -1].map((angle, i) => ({ angle, kill: i === 0 })), 0, 1)
    expect(cones).toHaveLength(5)
    expect(cones.map(c => c.shots)).toEqual([3, 0, 1, 0, 3])
    expect(cones[0].kills).toBe(1)
    expect(cones[0].from).toBe(0)
    expect(cones[4].to).toBeCloseTo(1)
  })
})

describe('courtFan', () => {
  it('takes in the whole of the other court', () => {
    const { lo, hi } = courtFan(1, 8) // a left-side attack: from the far left sideline to the right one at the net
    expect(lo).toBeCloseTo(Math.atan2(-1, 1))
    expect(hi).toBeCloseTo(Math.atan2(8, 1))
    const serve = courtFan(4.5, -1) // from the middle, behind the end line: symmetric
    expect(serve.lo).toBeCloseTo(-serve.hi)
  })
})

describe('shotCharts', () => {
  it('makes one chart per skill and start zone, the busiest attack zone first', () => {
    const left = [1, 2, 3, 4].map(() => ref('A', 4, '#')), right = [1, 2, 3].map(() => ref('A', 2, '=')), serves = [1, 2, 3].map(() => ref('S', 1, '+'))
    const { charts, left: rest } = shotCharts([...serves, ...right, ...left], fit, 1280, 720, 'T')
    expect(charts.map(c => [c.skill, c.zone, c.shots])).toEqual([['A', 4, 4], ['A', 2, 3], ['S', 1, 3]])
    expect(rest).toBe(0)
  })

  it('leaves out zones with too few shots, shots without clicks, and other skills, and says how many', () => {
    const { charts, left } = shotCharts([ref('A', 4, '#'), ref('A', 4, '#'), ref('A', 2, '#', null), ref('E', 4, '#'), ref('R', 4, '#')], fit, 1280, 720, 'T')
    expect(charts).toEqual([])
    expect(left).toBe(3)
  })

  it('makes a cone darker for more shots, with the share and kill rate on it', () => {
    const shots = [...[1, 2, 3].map(() => ref('A', 4, '#', { u: 0.1, v: 0.9 })), ref('A', 4, '=', { u: 0.9, v: 0.9 })]
    const [c] = shotCharts(shots, fit, 1280, 720, 'T').charts
    const polys = c.annotations.flatMap(a => (a.kind === 'polygon' ? [a] : []))
    expect(polys).toHaveLength(5)
    const op = shares(polys)
    expect(Math.max(...op)).toBeCloseTo(0.75) // the fullest
    expect(op.filter(o => o === Math.max(...op))).toHaveLength(1) // and the one with a single shot is lighter
    expect(c.annotations.filter(a => a.kind === 'circle')).toHaveLength(1) // the start's mark
    const onCourt = polys.flatMap(a => a.points).every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1)
    expect(onCourt).toBe(true)
    const texts = c.annotations.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts).toContain('75%（3 本）\n決定 100%')
    expect(texts).toContain('25%（1 本）\n決定 0%')
    expect(texts.some(s => s.includes('ゾーン 4 から'))).toBe(true)
  })
})
