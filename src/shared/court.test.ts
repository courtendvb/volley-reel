import { describe, expect, it } from 'vitest'
import { DEFAULT_CORNERS, homography, nearSide, playZones, project, zoneCell, type CourtFit } from './court'
import { parseDVW } from './dvw'

const fit: CourtFit = { corners: DEFAULT_CORNERS, nearSet1: '*' }

// One rally as VolleyStation writes it (with the click positions), and a set without a following attack.
const RALLY = `[3TEAMS]
HTH;HOME;0;;
TGB;AWAY;0;;
[3SCOUT]
a04SM+~~~58A;;;;0619;-1-1;7348;14.00.07;1;4;2;1;214;;
*05RM-~~~58AR;;;;;;;14.00.09;1;4;2;1;217;;
*21EH+K8F~8C;;;;3548;-1-1;4912;14.00.11;1;4;2;1;218;;
*07AH#P1~41BH3;s;r;;4717;-1-1;8017;14.00.11;1;4;2;1;218;;
a06DH=~~~41B;s;;;;;;14.00.14;1;4;2;1;221;;
*p01:00;;;;;;;14.00.24;1;4;2;1;231;;
**1set;;;;;;;14.30.00;1;4;2;1;2000;;
a11SQ-~~~67B;;;;0650;-1-1;6770;14.31.49;1;2;6;1;2117;;
*21EU+KAB~3B;;;;4460;-1-1;3587;14.31.52;1;2;6;1;2120;;
*p01:00;;;;;;;14.32.03;1;2;6;1;2130;;
`
const d = parseDVW(RALLY)
const [serve, reception, set, attack, dig] = d.plays
const lone = d.plays[6]

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

describe('sub-zones from the DVW', () => {
  it('end sub-zones as coded; start sub-zones from the click when it falls in the coded zone', () => {
    expect([serve.startSub, serve.endSub]).toEqual([null, 'A']) // the serve starts behind the end line
    expect([attack.startZone, attack.startSub, attack.endSub]).toEqual([4, 'C', 'B']) // C: front left, by the antenna
    expect([set.endZone, set.endSub]).toEqual([8, 'C'])
    expect(reception.endSub).toBe('A')
  })
})

describe('playZones', () => {
  const cellOf = (z: ReturnType<typeof playZones>) => [z.start?.cell ?? null, z.end?.cell ?? null]

  it("serve: from the server's side to the other", () => {
    // Away serves in set 1 with home near: from the far side to the near one.
    expect(playZones(serve, fit)).toEqual({ start: { cell: { row: 0, col: 2 }, sub: null }, end: { cell: { row: 4, col: 1 }, sub: 'A' } })
  })

  it('reception and dig: the ball comes from the other side', () => {
    expect(cellOf(playZones(reception, fit))).toEqual([{ row: 0, col: 2 }, { row: 4, col: 1 }])
    expect(cellOf(playZones(dig, fit))).toEqual([{ row: 3, col: 0 }, { row: 0, col: 0 }])
  })

  it('attack from the near side lands far, with its sub-zones', () => {
    expect(playZones(attack, fit)).toEqual({ start: { cell: { row: 3, col: 0 }, sub: 'C' }, end: { cell: { row: 0, col: 0 }, sub: 'B' } })
  })

  it('set: from where it was set to where the next attack started', () => {
    expect(playZones(set, fit, attack)).toEqual({ start: { cell: { row: 4, col: 1 }, sub: 'C' }, end: { cell: { row: 3, col: 0 }, sub: 'C' } })
    expect(playZones(set, fit, dig).end).toBeNull() // the other team's play
    expect(playZones(lone, fit, d.plays[7] ?? null)).toEqual({ start: { cell: { row: 2, col: 1 }, sub: 'B' }, end: null }) // set 2: home is far
  })
})
