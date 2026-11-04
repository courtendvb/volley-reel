import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, homography, project, type CourtFit, type Pt } from './court'
import type { PlayRef } from './filter'
import { shotChart } from './shotChart'

const fit: CourtFit = { corners: DEFAULT_CORNERS, nearSet1: '*' }
const ref = (skill: string, effect: string, clicks = true) => ({
  play: { skill, effect, code: `*07${skill}H${effect}`, startClick: clicks ? { u: 0.2, v: 0.4 } : null, endClick: clicks ? { u: 0.8, v: 0.9 } : null },
}) as unknown as PlayRef
const arrows = (c: ReturnType<typeof shotChart>) => c.annotations.flatMap(a => (a.kind === 'arrow' ? [a] : []))

describe('shotChart', () => {
  it('draws serves and attacks from the near side up, coloured by result', () => {
    const c = shotChart([ref('A', '#'), ref('A', '='), ref('S', '/'), ref('S', '+'), ref('E', '#'), ref('R', '#')], fit, 1280, 720, 'T')
    expect(c.shots).toBe(4)
    const a = arrows(c)
    expect(a.map(x => x.color)).toEqual(['#EF4444', '#3B82F6', '#3B82F6', '#FACC15'])
    expect(a[0].y2).toBeLessThan(0.5 * 1) // lands on the far half
    const floor = homography(fit.corners.map(p => ({ x: p.x * 1280, y: p.y * 720 })) as [Pt, Pt, Pt, Pt])
    const end = project(floor, 0.8, 0.1)
    expect(a[0].x2 * 1280).toBeCloseTo(end.x, 3)
    expect(a[0].y2 * 720).toBeCloseTo(end.y, 3) // the landing is on the floor
  })

  it('counts shots without clicks and keeps the title and legend', () => {
    const c = shotChart([ref('A', '#'), ref('A', '#', false)], fit, 1280, 720, 'タイトル')
    expect([c.shots, c.left]).toEqual([1, 1])
    expect(c.annotations.some(a => a.kind === 'text' && a.text === 'タイトル')).toBe(true)
  })

  it('stays on the floor when the corners give no camera', () => {
    const flat: CourtFit = { corners: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }], nearSet1: '*' }
    const [a] = arrows(shotChart([ref('A', '#')], flat, 1000, 1000, 'T'))
    expect(a.y1).toBeCloseTo(0.2 + 0.6 * 0.6)
  })
})
