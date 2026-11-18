import { describe, expect, it } from 'vitest'
import { attackFrom, buildTerritory, cellsOf, digSites, judgePoint, onCourt, receptionSites, SEAM_M } from './territory'
import type { CourtFit } from './courtGeometry'
import type { ParsedDVW, Play, Player } from './types'

const area = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y }, 0)) / 2
const player = (side: '*' | 'a', jersey: number, role?: Player['role'], libero?: boolean): Player => ({ key: `${side}${jersey}`, side, jersey, lastName: '', firstName: '', ...(role ? { role } : {}), ...(libero ? { libero } : {}) })

describe('cellsOf', () => {
  it('splits the half court among the sites, each nearest its own', () => {
    const sites = [{ x: 1.5, y: 3 }, { x: 4.5, y: 2.7 }, { x: 7.5, y: 3 }]
    const cells = cellsOf(sites)
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeCloseTo(81)
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
    cells.forEach((c, i) => c.forEach(p => sites.forEach(o => expect(d(p, sites[i])).toBeLessThanOrEqual(d(p, o) + 1e-6))))
  })
})

describe('judgePoint', () => {
  const sites = [{ jersey: 1, x: 1.5, y: 3, zone: 5 }, { jersey: 2, x: 7.5, y: 3, zone: 1 }]
  const cells = cellsOf(sites)
  it('gives the area and no seam away from the line', () => {
    expect(judgePoint(sites, cells, { x: 2, y: 3 })).toMatchObject({ owner: 0, seam: null })
  })
  it('finds the seam within 30 cm of the line between two areas, with its edge', () => {
    const j = judgePoint(sites, cells, { x: 4.5 + SEAM_M - 0.05, y: 5 })!
    expect(j.owner).toBe(1)
    expect(j.seam).not.toBeNull()
    expect(j.seam!.edge.every(p => Math.abs(p.x - 4.5) < 1e-6)).toBe(true)
    expect(judgePoint(sites, cells, { x: 4.5 + SEAM_M + 0.05, y: 5 })!.seam).toBeNull()
  })
})

describe('formations', () => {
  const team = [
    { jersey: 1, zone: 1, role: 'S' as const }, { jersey: 2, zone: 2, role: 'OH' as const }, { jersey: 3, zone: 3, role: 'MB' as const },
    { jersey: 4, zone: 4, role: 'OP' as const }, { jersey: 5, zone: 5, role: 'OH' as const }, { jersey: 10, zone: 6, role: 'L' as const, libero: true },
  ]
  it('receives with the libero in the middle and the hitters on either side', () => {
    const { sites, others } = receptionSites(team)
    expect(sites.map(s => s.jersey)).toEqual([5, 10, 2])
    expect(others.map(s => s.jersey).sort((a, b) => a - b)).toEqual([1, 3, 4])
  })
  it('falls back to the back row without positions', () => {
    const { sites } = receptionSites(team.map(({ jersey, zone }) => ({ jersey, zone })))
    expect(sites.map(s => s.zone)).toEqual([5, 6, 1])
  })
  it('blocks with two against a wing and one against the middle', () => {
    expect(digSites(team, 'right').others.map(s => s.zone).sort()).toEqual([2, 3])
    expect(digSites(team, 'left').others.map(s => s.zone).sort()).toEqual([3, 4])
    expect(digSites(team, 'center').others.map(s => s.zone)).toEqual([3])
    expect(digSites(team, 'center').sites).toHaveLength(5)
  })
  it('reads the attack from the attacker’s zone, turned round', () => {
    expect([4, 2, 3, 8, 5, 1].map(attackFrom)).toEqual(['right', 'left', 'center', 'center', 'right', 'left'])
  })
})

describe('buildTerritory', () => {
  const base = { code: '', time: 0, playerKey: '', effect: '', setsBefore: { home: 0, away: 0 }, score: { home: 0, away: 0 }, homeRot: 1, awayRot: 1, endZone: null, startSub: null, endSub: null, before: [], after: [], phase: null, setNum: 1, rallyId: 0, startZone: null } as unknown as Play
  const dvw = {
    players: Object.fromEntries([player('a', 1, 'S'), player('a', 2, 'OH'), player('a', 3, 'MB'), player('a', 4, 'OP'), player('a', 5, 'OH'), player('a', 6, 'MB'), player('a', 10, 'L', true)].map(p => [`a${p.jersey}`, p])),
    rallies: [{ id: 0, setNum: 1, serveTime: 0, lastActionTime: 0, pointTime: null, wonBy: null, court: { home: [11, 12, 13, 14, 15, 16], away: [1, 2, 3, 4, 5, 6] } }],
    plays: [
      { ...base, id: 0, skill: 'S', side: '*', jersey: 11, endClick: { u: 0.5, v: 1 - 3 / 18 } }, // lands 4.5 m across, 3 m from the receivers' end line
      { ...base, id: 1, skill: 'R', side: 'a', jersey: 10 },
    ],
  } as unknown as ParsedDVW
  const fit: CourtFit = { corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], nearSet1: '*' }
  const clicks = (p: Play) => ({ start: p.startClick ?? null, end: p.endClick ?? null })
  it('judges a serve taken by the libero in its own area', () => {
    const t = buildTerritory(dvw.plays[0], dvw, fit, clicks)!
    expect(t.kind).toBe('reception')
    expect(t.sites.map(s => s.jersey)).toEqual([5, 10, 2])
    expect(t.impact!.x).toBeCloseTo(4.5)
    expect(t.impact!.y).toBeCloseTo(3)
    expect(t.verdict).toBe('in')
    expect(buildTerritory(dvw.plays[1], dvw, fit, clicks)!.verdict).toBe('in') // the same from the reception
  })
  it('puts the libero in for the back-row middle blocker', () => {
    const d = { ...dvw, rallies: [{ ...dvw.rallies[0], court: { home: [], away: [1, 2, 3, 4, 5, 6] } }] } as unknown as ParsedDVW
    const team = onCourt(d, dvw.plays[0], 'a')!
    expect(team.find(p => p.zone === 6)).toMatchObject({ jersey: 10, libero: true })
    expect(team.find(p => p.zone === 3)).toMatchObject({ jersey: 3, role: 'MB' }) // the front-row one stays
  })
  it('says covered when another player took it', () => {
    const d = { ...dvw, plays: [dvw.plays[0], { ...dvw.plays[1], jersey: 2 }] } as ParsedDVW
    const t = buildTerritory(d.plays[0], d, fit, clicks)!
    expect(t.verdict).toBe('covered')
    expect(t.touch).toMatchObject({ jersey: 2, at: { x: 7.5 } })
  })
  it('has nothing without the lineup', () => {
    const d = { ...dvw, rallies: [{ ...dvw.rallies[0], court: undefined }] } as ParsedDVW
    expect(buildTerritory(d.plays[0], d, fit, clicks)).toBeNull()
  })
})
