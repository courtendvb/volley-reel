import { describe, expect, it } from 'vitest'
import { ATTACK_Z, DEFAULT_CORNERS, DEFAULT_GRID_STYLE, FLOAT_SERVE_Z, JUMP_SERVE_Z, SET_Z, courtCamera, flightTiming, hasFlight, homography, nearSide, playDirection, playMarks, playPoints, playZones, project, serveSpot, zoneCell, type CourtFit } from './court'
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
    expect(nearSide(fit, { setNum: 4, score: { home: 0, away: 0 } })).toBe('a')
    expect(nearSide(fit, { setNum: 5, score: { home: 0, away: 0 } })).toBe('a') // set 5 starts as set 4
    expect(nearSide(fit, { setNum: 5, score: { home: 7, away: 5 } })).toBe('a')
    expect(nearSide(fit, { setNum: 5, score: { home: 8, away: 5 } })).toBe('*') // a team has 8: swapped
    expect(nearSide(fit, { setNum: 5, score: { home: 3, away: 8 } })).toBe('*')
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
    // Zone 5 behind the far end line: the camera's right of 1-9-6-7-5.
    expect(playZones(serve, fit)).toEqual({ start: { cell: { row: -1, col: 4 }, sub: null, behind: true }, end: { cell: { row: 4, col: 1 }, sub: 'A' } })
  })

  it('serve zones behind the end line: 1-9-6-7-5 from the zone 1 side', () => {
    expect([1, 9, 6, 7, 5].map(z => serveSpot(z, false)?.cell.col)).toEqual([0, 1, 2, 3, 4]) // far: zone 1 on the camera's left
    expect([1, 9, 6, 7, 5].map(z => serveSpot(z, true)?.cell.col)).toEqual([4, 3, 2, 1, 0]) // near: on the right
    expect(serveSpot(1, true)?.cell.row).toBe(6)
    expect(serveSpot(8, true)).toBeNull() // not a serve zone: the court's own cell is lit instead
    expect(playZones({ ...serve, startZone: 8 }, fit).start).toEqual({ cell: { row: 1, col: 1 }, sub: null })
  })

  it('reception and dig: the ball comes from the other side', () => {
    expect(cellOf(playZones(reception, fit))).toEqual([{ row: -1, col: 4 }, { row: 4, col: 1 }]) // served from behind the far end line
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

describe('courtCamera', () => {
  // A real fit (2026-10-31 HTH-TGB) on 1280 × 720; in its video the net's top runs y 253–256 and its
  // bottom tape is at 345 on the left.
  const px = [{ x: 0.23770491803278687, y: 0.48451730418943534 }, { x: 0.7730696798493408, y: 0.49246231155778897 }, { x: 0.1016949152542373, y: 0.9179229480737019 }, { x: 0.903954802259887, y: 0.9179229480737019 }]
    .map(p => ({ x: p.x * 1280, y: p.y * 720 })) as CourtFit['corners']

  it('finds where heights show: the net of the real video', () => {
    const cam = courtCamera(px, 1280, 720)!
    expect(cam(0, 0, 0).x).toBeCloseTo(px[0].x, 3) // the floor stays on the fit
    expect(cam(1, 1, 0).y).toBeCloseTo(px[3].y, 3)
    expect(Math.abs(cam(0, 0.5, 2.43).y - 253)).toBeLessThan(5)
    expect(Math.abs(cam(0, 0.5, 1.43).y - 345)).toBeLessThan(5)
    expect(cam(0.5, 0.5, 3).y).toBeLessThan(cam(0.5, 0.5, 2).y) // higher is up the picture
  })

  it('gives up on corners that cannot tell', () => {
    const flat: CourtFit['corners'] = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 500 }, { x: 300, y: 500 }]
    expect(courtCamera(flat, 400, 600)).toBeNull()
  })
})

describe('playPoints', () => {
  it('puts a far serve behind the far end line and a near attack from the near half to the far one', () => {
    const s = playPoints(serve, fit) // away, far in set 1: seen turned round
    expect(s.start!.y).toBeLessThan(0.01) // at the far end line
    expect(s.start!.x).toBeGreaterThan(0.8) // zone 5 side: the camera's right on the far side
    expect(s.end!.y).toBeGreaterThan(0.5) // lands on the near half
    const a = playPoints(attack, fit) // home, near
    expect(a.start!.y).toBeGreaterThan(0.5)
    expect(a.end!.y).toBeLessThan(0.5)
  })

  it('starts in the air by the shot: jump serve, float, attack, set, what a reception or dig answers', () => {
    expect(playPoints({ ...serve, code: 'a04SQ+~~~58A' }, fit).startZ).toBe(JUMP_SERVE_Z)
    expect(playPoints(serve, fit).startZ).toBe(FLOAT_SERVE_Z) // SM, a jump float
    expect(playPoints(attack, fit).startZ).toBe(ATTACK_Z)
    expect(playPoints(reception, fit).startZ).toBe(FLOAT_SERVE_Z)
    expect(playPoints(dig, fit).startZ).toBe(ATTACK_Z)
    expect(playPoints(set, fit)).toMatchObject({ startZ: SET_Z, endZ: ATTACK_Z, arc: 3 }) // EH: a high ball, to the hitter's hand
  })

  it('a hard attack goes straight; a tip or soft one, and a dig of it, arcs', () => {
    expect(playPoints(attack, fit).arc).toBe(0) // AH … H
    const tip = { ...attack, code: '*07AH#P1~41BT3' }, soft = { ...attack, code: '*07AH#P1~41BP3' }
    expect(playPoints(tip, fit).arc).toBeGreaterThan(0)
    expect(playPoints(soft, fit).arc).toBeGreaterThan(0)
    expect(playPoints({ ...dig, shotCode: tip.code }, fit).arc).toBeGreaterThan(0)
    expect(flightTiming(tip, 0).sec).toBeGreaterThan(flightTiming(attack, 0).sec)
  })

  it('a set goes by its tempo', () => {
    const tempo = (type: string) => { const p = { ...set, code: `*21E${type}+K8F~8C` }; return [flightTiming(p, 0).sec, playPoints(p, fit).arc] }
    expect(tempo('H')).toEqual([1.3, 3])
    expect(tempo('M')).toEqual([1, 1.5])
    expect(tempo('Q')).toEqual([0.6, 0.5])
  })

  it("a reception and a dig take the ball's path from the shot they answer", () => {
    expect(reception.startClick).toBeTruthy()
    const r = playPoints(reception, fit), s = playPoints(serve, fit)
    expect(r.start!.x).toBeCloseTo(s.start!.x); expect(r.start!.y).toBeCloseTo(s.start!.y)
    expect(r.end!.x).toBeCloseTo(s.end!.x); expect(r.end!.y).toBeCloseTo(s.end!.y)
    const g = playPoints(dig, fit), a = playPoints(attack, fit)
    expect(g.end!.x).toBeCloseTo(a.end!.x); expect(g.end!.y).toBeCloseTo(a.end!.y)
  })

  it('turns with the sides, and is empty without clicks; marks carry the zones too', () => {
    const swapped: CourtFit = { ...fit, nearSet1: 'a' }
    expect(playPoints(serve, swapped).start!.y).toBeGreaterThan(0.99)
    expect(playPoints({ ...attack, startClick: null, endClick: undefined }, fit)).toEqual({ start: null, end: null })
    expect(playMarks(attack, fit)).toMatchObject({ start: { cell: { row: 3, col: 0 } }, points: { start: expect.anything() } })
  })
})

describe('flight', () => {
  it('a shot leaves at its time; a reception or dig is reached at its time', () => {
    expect(flightTiming(attack, 10)).toEqual({ startSec: attack.time + 10, sec: 0.5 })
    expect(flightTiming(serve, 0)).toEqual({ startSec: serve.time, sec: 1.4 }) // SM: a float
    expect(flightTiming({ ...serve, code: 'a04SQ+~~~58A' }, 0).sec).toBe(1)
    expect(flightTiming(reception, 0)).toEqual({ startSec: reception.time - 1.4, sec: 1.4 })
    expect(flightTiming(dig, 0)).toEqual({ startSec: dig.time - 0.5, sec: 0.5 })
  })

  it('needs the points shown with the curve on, both ends and a height', () => {
    const style = { ...DEFAULT_GRID_STYLE, detail: 'point' as const, flight: true }
    const zones = playMarks(attack, fit)
    expect(hasFlight(style, zones)).toBe(true)
    expect(hasFlight({ ...style, detail: 'zone' }, zones)).toBe(false)
    expect(hasFlight({ ...style, flight: false }, zones)).toBe(false)
    expect(hasFlight({ ...style, playZones: false }, zones)).toBe(false)
    expect(hasFlight(style, playMarks(set, fit))).toBe(true) // a set flies too
    expect(hasFlight(style, null)).toBe(false)
  })
})

describe('playDirection', () => {
  it("serve and attack leave the player's side; reception and dig come to it; a set has no way", () => {
    expect(playDirection(serve, fit)).toBe('down') // away, far in set 1
    expect(playDirection(reception, fit)).toBe('down') // home, near: the serve comes down to it
    expect(playDirection(attack, fit)).toBe('up') // from the near side
    expect(playDirection(dig, fit)).toBe('up') // the far side digs the near side's attack
    expect(playDirection(set, fit)).toBeNull()
  })

  it('turns with the sides', () => {
    const swapped: CourtFit = { ...fit, nearSet1: fit.nearSet1 === '*' ? 'a' : '*' }
    expect(playDirection(serve, swapped)).toBe('up')
    expect(playDirection(attack, swapped)).toBe('down')
  })
})
