import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, homography, nearSide, playZones, project, zoneCell, type CourtFit } from './court'

const fit: CourtFit = { corners: DEFAULT_CORNERS, nearSet1: '*' }
const play = (code: string, over: Partial<{ setNum: number; home: number; away: number }> = {}) => ({
  code, skill: code.charAt(3), side: code.charAt(0) as '*' | 'a',
  startZone: +code.charAt(9) || null, endZone: +code.charAt(10) || null,
  setNum: over.setNum ?? 1, score: { home: over.home ?? 0, away: over.away ?? 0 },
})

describe('homography', () => {
  it('maps the unit square onto the corners', () => {
    const H = homography(DEFAULT_CORNERS)
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => { expect(p.x).toBeCloseTo(q.x); expect(p.y).toBeCloseTo(q.y) }
    near(project(H, 0, 0), DEFAULT_CORNERS[0])
    near(project(H, 1, 0), DEFAULT_CORNERS[1])
    near(project(H, 0, 1), DEFAULT_CORNERS[2])
    near(project(H, 1, 1), DEFAULT_CORNERS[3])
  })

  it('puts the net nearer the far end line than halfway down the picture', () => {
    const H = homography(DEFAULT_CORNERS)
    const net = project(H, 0.5, 0.5).y
    expect(net).toBeLessThan((DEFAULT_CORNERS[0].y + DEFAULT_CORNERS[2].y) / 2)
  })
})

describe('sides', () => {
  it('swaps every set, and at 8 in set 5', () => {
    expect(nearSide(fit, { setNum: 1, score: { home: 0, away: 0 } })).toBe('*')
    expect(nearSide(fit, { setNum: 2, score: { home: 0, away: 0 } })).toBe('a')
    expect(nearSide(fit, { setNum: 3, score: { home: 0, away: 0 } })).toBe('*')
    expect(nearSide(fit, { setNum: 5, score: { home: 7, away: 5 } })).toBe('*')
    expect(nearSide(fit, { setNum: 5, score: { home: 8, away: 5 } })).toBe('a')
  })

  it('finds zones on each half as seen from the camera', () => {
    expect(zoneCell(1, true)).toEqual({ row: 5, col: 2 })
    expect(zoneCell(1, false)).toEqual({ row: 0, col: 0 })
    expect(zoneCell(4, true)).toEqual({ row: 3, col: 0 })
    expect(zoneCell(8, false)).toEqual({ row: 1, col: 1 })
  })
})

describe('playZones', () => {
  it('serve: from the server\'s side to the other', () => {
    expect(playZones(play('*01SQ-~~~16A'), fit)).toEqual({ start: { row: 5, col: 2 }, end: { row: 0, col: 1 } })
  })

  it('reception: the serve comes from the other side', () => {
    expect(playZones(play('a09RQ+~~~16AR'), fit)).toEqual({ start: { row: 5, col: 2 }, end: { row: 0, col: 1 } })
  })

  it('attack from the far side in set 1 lands near', () => {
    expect(playZones(play('a01AQ#PA~36BH1'), fit)).toEqual({ start: { row: 2, col: 1 }, end: { row: 5, col: 1 } })
  })

  it('follows the side change in set 2', () => {
    expect(playZones(play('*01SQ-~~~16A', { setNum: 2 }), fit).start).toEqual({ row: 0, col: 0 })
  })

  it('set: start only; missing zones are null', () => {
    expect(playZones(play('*05EH#~~~3'), fit)).toEqual({ start: { row: 3, col: 1 }, end: null })
    expect(playZones(play('*05AH#'), fit)).toEqual({ start: null, end: null })
  })
})
