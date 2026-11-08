import { describe, expect, it } from 'vitest'
import { attackCones, playClicks, ATTACK_Z, DEFAULT_CORNERS, DEFAULT_GRID_STYLE, FLOAT_SERVE_Z, JUMP_SERVE_Z, SET_Z, courtCamera, drawFlight, handleAt, floorAt, floorRect, zoneCellQuad, zoneOfCell, cleanGridStyle, markStyle, marksBySkill, flightTiming, nearestShots, zoneAt, flightsProgress, heatAt, heatColor, heatGrid, flightZ, playerMarks, serveSpeed, hasFlight, homography, nearSide, playDirection, playMarks, playPoints, playZones, project, servePath, serveSpot, zoneCell, type CourtFit } from './court'
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

  it('turns with the sides, and is empty with neither clicks nor zones; marks carry the zones too', () => {
    const swapped: CourtFit = { ...fit, nearSet1: 'a' }
    expect(playPoints(serve, swapped).start!.y).toBeGreaterThan(0.99)
    expect(playPoints({ ...attack, startZone: null, endZone: null, startClick: null, endClick: undefined }, fit)).toEqual({ start: null, end: null })
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

describe('a set without a click for where it left', () => {
  const set = { skill: 'E', side: '*', code: '*21EQ+KAC~3B', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, startZone: null, endZone: 3, startSub: null, endSub: 'B', startClick: null, endClick: { u: 0.2, v: 0.45 } } as never
  it('starts from its coded zone and still flies', () => {
    const p = playPoints(set, fit)
    expect(p.start).not.toBeNull()
    expect(p.start!.y).toBeGreaterThan(0.5) // the team near the camera, on its own side of the net
    expect(p.startZ).toBe(SET_Z)
    expect(hasFlight({ ...DEFAULT_GRID_STYLE, detail: 'point', flight: true }, { start: null, end: null, points: p })).toBe(true)
  })
  it('starts from the setter\'s spot with no zone either', () => {
    const p = playPoints({ ...(set as object), endZone: null, endSub: null } as never, fit)
    expect(p.start!.x).toBeCloseTo(0.6)
    expect(p.start!.y).toBeCloseTo(0.556)
  })
  it('is left alone when nothing says where it went', () => {
    expect(playPoints({ ...(set as object), endClick: null } as never, fit).start).toBeNull()
  })
})

describe('servePath', () => {
  it('comes down the court, with the serve\'s height', () => {
    const p = servePath({ startClick: { u: 0.2, v: -0.05 }, endClick: { u: 0.7, v: 0.8 }, code: '*05SQ-~~~15' })!
    expect(p.start).toEqual({ x: 0.8, y: -0.05 })
    expect(p.end!.y).toBeCloseTo(0.8)
    expect(p.startZ).toBe(JUMP_SERVE_Z)
  })
  it('needs both ends', () => {
    expect(servePath({ startClick: null, endClick: { u: 0, v: 0 }, code: '*05SQ-' })).toBeNull()
  })
})

describe('flightsProgress', () => {
  it('waits, flies, then stays', () => {
    expect(flightsProgress(0.3)).toBe(0)
    expect(flightsProgress(1.25)).toBeCloseTo(0.5)
    expect(flightsProgress(4)).toBe(1)
  })
})

describe('heatGrid', () => {
  it('is thickest where the shots land, and fades away from there', () => {
    const g = heatGrid([{ x: 0.5, y: 0.75 }, { x: 0.5, y: 0.75 }, { x: 0.1, y: 0.6 }])
    expect(heatAt(g, 0.5, 0.75)).toBeCloseTo(1, 1)
    expect(heatAt(g, 0.1, 0.6)).toBeCloseTo(0.5, 1)
    expect(heatAt(g, 0.9, 0.1)).toBe(0)
  })
  it('spreads as far across the court as along it, in metres', () => {
    const g = heatGrid([{ x: 0.5, y: 0.5 }])
    expect(heatAt(g, 0.5 + 1 / 9, 0.5)).toBeCloseTo(heatAt(g, 0.5, 0.5 + 1 / 18), 2)
  })
  it('is empty with no shots, and ignores what is off the map', () => {
    expect(heatGrid([]).data.every(v => v === 0)).toBe(true)
    expect(heatAt(heatGrid([{ x: 5, y: 5 }]), 0.5, 0.5)).toBe(0)
  })
})

describe('flightTiming with the red line moved', () => {
  const serve = { time: 100, code: '*05SM-', skill: 'S' } as never, reception = { time: 102, code: 'a01RM+', shotCode: '*05SM-', skill: 'R' } as never
  it('leaves from it, or reaches it for a reception, in place of the DVW time', () => {
    expect(flightTiming(serve, 5).startSec).toBe(105)
    expect(flightTiming(serve, 5, { skillSec: 106.3 }).startSec).toBe(106.3)
    expect(flightTiming(reception, 5, { skillSec: 108 }).startSec).toBeCloseTo(108 - 1.4)
  })
})

describe('heatColor', () => {
  it('runs from blue through to red', () => {
    expect(heatColor(0)).toEqual([37, 99, 235])
    expect(heatColor(1)).toEqual([220, 38, 38])
    const [r, g, b] = heatColor(0.5)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })
})

describe('a set by the attack it is for', () => {
  const set = { skill: 'E', side: '*', code: '*21EM+K8F~3B', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, startZone: null, endZone: 3, startSub: null, endSub: 'B', startClick: { u: 0.6, v: 0.45 }, endClick: { u: 0.2, v: 0.45 } }
  it('goes straight to a quick', () => {
    expect(playPoints({ ...set, setTo: 'Q' } as never, fit).arc).toBe(0)
  })
  it('is 15% quicker to an M or U, as high as gravity takes it in that time', () => {
    for (const setTo of ['M', 'U']) {
      expect(flightTiming({ ...set, time: 10, setTo } as never, 0).sec).toBeCloseTo(0.85)
      expect(playPoints({ ...set, setTo } as never, fit).arc).toBeCloseTo((9.8 * 0.85 * 0.85) / 8)
    }
  })
  it('keeps its own shape to other attacks', () => {
    expect(flightTiming({ ...set, time: 10, setTo: 'H' } as never, 0).sec).toBe(1)
    expect(playPoints({ ...set, setTo: 'H' } as never, fit).arc).toBe(1.5)
  })
})

describe('a DVW with zones but no clicks', () => {
  const base = { side: '*', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, playerKey: 'a', startSub: null, endSub: null, startClick: null, endClick: null }
  const attack = { ...base, skill: 'A', startZone: 4, endZone: 6, code: '*05AQ-X5~46' } as never
  const serve = { ...base, skill: 'S', startZone: 1, endZone: 5, code: '*05SQ-~~~15' } as never
  const near = { ...fit, nearSet1: '*' as const }
  it('puts the point in the middle of the zone, marked as rough', () => {
    const p = playPoints(attack, near)
    expect(p.start!.x).toBeCloseTo(1 / 6); expect(p.start!.y).toBeCloseTo(3.5 / 6)
    expect(p.end!.x).toBeCloseTo(0.5); expect(p.end!.y).toBeCloseTo(0.5 / 6)
    expect(p).toMatchObject({ startRough: true, endRough: true })
  })
  it('turns with the sides', () => {
    expect(playPoints(attack, { ...fit, nearSet1: 'a' }).start!.y).toBeCloseTo(2.5 / 6)
  })
  it('uses the sub-zone when there is one', () => {
    const p = playPoints({ ...(attack as object), endSub: 'A' } as never, near)
    expect(p.end!.y).not.toBeCloseTo(0.5 / 6)
  })
  it('starts a serve behind the end line', () => {
    expect(playPoints(serve, near).start!.y).toBeGreaterThan(1)
  })
  it('keeps a real click, and only guesses the end that lacks one', () => {
    const p = playPoints({ ...(attack as object), startClick: { u: 0.3, v: 0.4 } } as never, near)
    expect(p.start!.x).toBeCloseTo(0.3)
    expect(p.startRough).toBeUndefined(); expect(p.endRough).toBe(true)
    expect(playClicks({ ...(attack as object), startClick: { u: 0.3, v: 0.4 }, endClick: { u: 0.5, v: 0.9 } } as never)).toEqual({ start: { u: 0.3, v: 0.4 }, end: { u: 0.5, v: 0.9 } })
  })
  it('leaves a set alone', () => {
    expect(playClicks({ ...base, skill: 'E', startZone: null, endZone: 3 } as never)).toEqual({ start: null, end: null })
  })
  it('gives the player heatmap, landings and flights, the rough ones scattered and told apart', () => {
    const plays = [serve, serve, serve, { ...(serve as object), endClick: { u: 0.5, v: 0.8 } } as never]
    const m = playerMarks(serve, near, { ...DEFAULT_GRID_STYLE, heat: true, landings: true, serveFlights: true }, () => plays)!
    expect(m.heat!.points).toHaveLength(4)
    expect(m.heat!.rough).toEqual([1.4, 1.4, 1.4, 0])
    expect(playerMarks(serve, near, { ...DEFAULT_GRID_STYLE, heat: true }, () => [{ ...(serve as object), endSub: 'A' } as never])!.heat!.rough).toEqual([1])
    expect(m.heat!.points[0]).toEqual(m.heat!.points[1]) // the heatmap spreads them itself
    expect(m.landings!.points[0]).not.toEqual(m.landings!.points[1])
    expect(m.landings!.points[0]).toEqual(playerMarks(serve, near, { ...DEFAULT_GRID_STYLE, landings: true }, () => plays)!.landings!.points[0])
    expect(m.flights!.paths).toHaveLength(4)
    expect(m.flights!.paths[0].endRough).toBe(true)
  })
  it('finds a serve its length', () => {
    expect(serveSpeed({ ...(serve as object), time: 1 } as never)).toBeGreaterThan(0)
  })
  it('spreads a rough point wider and thinner in the heatmap', () => {
    const at = { x: 0.5, y: 0.5 }
    const sharp = heatGrid([at, { x: 0.1, y: 0.1 }]), rough = heatGrid([at, { x: 0.1, y: 0.1 }], [1.4, 0])
    expect(heatAt(rough, 0.5, 0.5)).toBeLessThan(heatAt(sharp, 0.5, 0.5))
    expect(heatAt(rough, 0.5 + 2 / 9, 0.5)).toBeGreaterThan(heatAt(sharp, 0.5 + 2 / 9, 0.5))
  })
})

describe('attackCones', () => {
  const near = { x: 0.1, y: 0.55 } // a left-side hitter on the near half, a little off the net
  const shot = (x: number, y: number) => ({ start: near, end: { x, y } })
  it('fans from where they hit over the other half, sideline to sideline at the attack line', () => {
    const c = attackCones(fit, [shot(0.1, 0.05)])!
    expect(c.apex).toEqual(near)
    expect(c.rays).toHaveLength(6)
    const depth = (0.55 - 1 / 3) * 18
    expect(c.rays[0]).toBeCloseTo(Math.atan2(-0.9, depth))
    expect(c.rays[5]).toBeCloseTo(Math.atan2(8.1, depth))
  })
  it('counts each shot in its cone, down the line to the sharp cross', () => {
    const c = attackCones(fit, [shot(0.1, 0.05), shot(0.12, 0.1), shot(0.95, 0.35), shot(0.5, 0.05)])!
    expect(c.shares).toEqual([0.5, 0, 0.25, 0, 0.25])
    expect(c.shares.reduce((a, b) => a + b)).toBeCloseTo(1)
  })
  it('puts a shot outside the fan in the nearest cone', () => {
    expect(attackCones(fit, [shot(0.95, 0.48)])!.shares[4]).toBe(1)
  })
  it('mirrors for the far half, and has nothing to show without shots', () => {
    const far = attackCones(fit, [{ start: { x: 0.9, y: 0.45 }, end: { x: 0.9, y: 0.95 } }])!
    expect(far.shares[4]).toBe(1)
    expect(attackCones(fit, [])).toBeNull()
  })
  it('carries the colour picked', () => {
    const base = { side: '*', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, playerKey: 'a', startSub: null, endSub: null, startClick: { u: 0.1, v: 0.45 }, endClick: { u: 0.5, v: 0.9 } }
    const attack = { ...base, skill: 'A', startZone: 4, endZone: 6, code: '*05AQ-X5~46' } as never
    expect(playerMarks(attack, fit, { ...DEFAULT_GRID_STYLE, cones: true, coneColor: '#2563EB' }, () => [attack])!.cones!.color).toBe('#2563EB')
    expect(playerMarks(attack, fit, { ...DEFAULT_GRID_STYLE, cones: true }, () => [attack])!.cones!.color).toBeUndefined()
  })
  it('only comes with an attack', () => {
    const base = { side: '*', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, playerKey: 'a', startSub: null, endSub: null, startClick: { u: 0.1, v: 0.45 }, endClick: { u: 0.5, v: 0.9 } }
    const attack = { ...base, skill: 'A', startZone: 4, endZone: 6, code: '*05AQ-X5~46' } as never, serve = { ...base, skill: 'S', startZone: 1, endZone: 6, code: '*05SQ-~~~16' } as never
    expect(playerMarks(attack, fit, { ...DEFAULT_GRID_STYLE, cones: true }, () => [attack])!.cones!.shares).toHaveLength(5)
    expect(playerMarks(serve, fit, { ...DEFAULT_GRID_STYLE, cones: true }, () => [serve])).toBeNull()
  })
})

describe('playerMarks', () => {
  const base = { side: '*', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, endZone: null, startSub: null, endSub: null }
  const shot = (playerKey: string, skill: string, u: number, startZone: number | null, combo = '~~') =>
    ({ ...base, playerKey, skill, startZone, code: `*05${skill}Q-${combo}~1`, startClick: { u, v: 0 }, endClick: { u, v: 0.8 } }) as never
  const plays = [shot('a', 'S', 0.1, 1), shot('a', 'S', 0.2, 1), shot('a', 'S', 0.25, 5), shot('b', 'S', 0.4, 1), shot('a', 'A', 0.3, 4, 'P1'), shot('a', 'A', 0.35, 4, 'P1'), shot('a', 'A', 0.5, 2, 'X5')]
  const style = { ...DEFAULT_GRID_STYLE, heat: true, serveFlights: true }
  it('keeps a serve heatmap to the same start zone, and its flights to the player', () => {
    const m = playerMarks(plays[0], fit, style, () => plays)!
    expect(m.heat!.points).toHaveLength(2)
    expect(m.flights!.paths).toHaveLength(3)
  })
  it('keeps an attack heatmap to the same attack code, with no flights', () => {
    const m = playerMarks(plays[4], fit, style, () => plays)!
    expect(m.heat!.points).toHaveLength(2)
    expect(playerMarks(plays[6], fit, style, () => plays)!.heat!.points).toHaveLength(1)
    expect(m.flights).toBeUndefined()
  })
  it('shows landings as points: all the serves, attacks of the same code', () => {
    const on = { ...DEFAULT_GRID_STYLE, landings: true }
    expect(playerMarks(plays[0], fit, on, () => plays)!.landings!.points).toHaveLength(3)
    expect(playerMarks(plays[4], fit, on, () => plays)!.landings!.points).toHaveLength(2)
    expect(playerMarks(plays[0], fit, on, () => plays)!.flights).toBeUndefined()
  })
  it('has nothing on other skills or with both off', () => {
    expect(playerMarks(shot('a', 'R', 0.5, 1), fit, style, () => plays)).toBeNull()
    expect(playerMarks(plays[0], fit, DEFAULT_GRID_STYLE, () => plays)).toBeNull()
  })
})

describe('flightZ', () => {
  it('is a parabola meeting both ends, whose top is past halfway when it rises', () => {
    const p = { start: null, end: null, startZ: 2.4, endZ: 3.15, arc: 0.885 }
    expect(flightZ(p, 0)).toBeCloseTo(2.4)
    expect(flightZ(p, 1)).toBeCloseTo(3.15)
    const top = Array.from({ length: 101 }, (_, i) => i / 100).reduce((a, b) => (flightZ(p, b) > flightZ(p, a) ? b : a))
    expect(top).toBeGreaterThan(0.55)
    expect(top).toBeLessThan(0.65)
    // Equal steps in time drop by the same growing amounts: the second difference is constant.
    const second = (s: number) => flightZ(p, s) - 2 * flightZ(p, s + 0.1) + flightZ(p, s + 0.2)
    expect(second(0)).toBeCloseTo(second(0.8))
  })
})

describe('a serve with its speed', () => {
  const serve = { time: 100, code: '*05SQ-', skill: 'S', startClick: { u: 0.5, v: 0 }, endClick: { u: 0.5, v: 1 } } as never
  it('takes its distance at that speed', () => {
    expect(flightTiming(serve, 0, { speedKmh: 72 }).sec).toBeCloseTo(18 / 20)
  })
  it('keeps the usual time without a speed, and shows that speed', () => {
    expect(flightTiming(serve, 0).sec).toBe(1)
    expect(serveSpeed(serve)).toBe(65)
  })
  it('needs both clicks, and is only for serves', () => {
    expect(flightTiming({ ...(serve as object), endClick: null } as never, 0, { speedKmh: 72 }).sec).toBe(1)
    expect(flightTiming({ ...(serve as object), skill: 'A', code: '*05AH-' } as never, 0, { speedKmh: 72 }).sec).toBe(0.5)
    expect(serveSpeed({ ...(serve as object), startClick: null } as never)).toBeNull()
  })
})

describe('the height line', () => {
  const ctx = () => {
    const calls: number[] = []
    const noop = () => {}
    return { calls, ctx: new Proxy({ setLineDash: (d: number[]) => { calls.push(d.length) } }, { get: (t, k) => (k in t ? t[k as 'setLineDash'] : noop), set: () => true }) as never }
  }
  const zones = { start: null, end: null, points: { start: { x: 0.5, y: 0.9 }, end: { x: 0.5, y: 0.1 }, startZ: 3, arc: 1 } }
  const corners = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.05, y: 0.95 }, { x: 0.95, y: 0.95 }] as CourtFit['corners']
  it('goes with the flight, and can be left out', () => {
    const on = ctx(), off = ctx()
    drawFlight(on.ctx, 1280, 720, { corners, nearSet1: '*' }, zones, 1)
    drawFlight(off.ctx, 1280, 720, { corners, nearSet1: '*' }, zones, 1, false)
    expect(on.calls.some(n => n > 0)).toBe(true)
    expect(off.calls.some(n => n > 0)).toBe(false)
  })
})

describe('clicks on the court', () => {
  const corners = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.05, y: 0.95 }, { x: 0.95, y: 0.95 }] as CourtFit['corners']
  it('finds the floor under a point of the picture', () => {
    const q = project(homography(corners), 0.25, 0.8), p = floorAt({ corners, nearSet1: '*' }, q)!
    expect(p.x).toBeCloseTo(0.25, 6)
    expect(p.y).toBeCloseTo(0.8, 6)
  })
  it('lays a rectangle on the floor in the court perspective', () => {
    const H = homography(corners), pt = (u: number, v: number) => project(H, u, v)
    const r = floorRect(corners, pt(0.2, 0.3), pt(0.8, 0.9))!
    const want = [pt(0.2, 0.3), pt(0.8, 0.3), pt(0.8, 0.9), pt(0.2, 0.9)]
    r.forEach(([x, y], i) => { expect(x).toBeCloseTo(want[i].x, 6); expect(y).toBeCloseTo(want[i].y, 6) })
    expect(r[1][0] - r[0][0]).toBeLessThan(r[2][0] - r[3][0]) // narrower far away: a trapezoid
    expect(floorRect(corners, { x: 0.5, y: -2 }, pt(0.5, 0.5))).toBeNull()
  })
  it('has no floor above the horizon', () => {
    expect(floorAt({ corners, nearSet1: '*' }, { x: 0.5, y: -2 })).toBeNull()
  })
  it('names the zone and stops at the lines', () => {
    expect(zoneAt({ x: 0.1, y: 0.95 })).not.toBeNull()
    expect(zoneAt({ x: 1.2, y: 0.5 })).toBeNull()
  })
  it('measures nearness in metres: the court is twice as long as wide', () => {
    expect(nearestShots([{ x: 0.5, y: 0.3 }, { x: 0.7, y: 0.5 }, { x: 0.5, y: 0.52 }], { x: 0.5, y: 0.5 }, 2)).toEqual([2, 1])
  })
})

describe('handleAt', () => {
  it('stays on a corner inside the picture and comes to the edge for one outside', () => {
    expect(handleAt({ x: 0.5, y: 0.4 }, 1000, 500, 10)).toEqual({ x: 0.5, y: 0.4 })
    expect(handleAt({ x: -0.2, y: 1.3 }, 1000, 500, 10)).toEqual({ x: 0.01, y: 0.98 })
  })
})

describe('painting zones', () => {
  const corners: CourtFit['corners'] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] // the court fills the picture
  it('cuts the court into the 9 zones of each half', () => {
    expect(zoneCellQuad(corners, { row: 5, col: 2, div: 3 }).map(p => p.map(v => +v.toFixed(4)))).toEqual([[0.6667, 0.8333], [1, 0.8333], [1, 1], [0.6667, 1]])
    expect(zoneOfCell({ row: 5, col: 2, div: 3 })).toBe(1) // near side, camera's right
    expect(zoneOfCell({ row: 0, col: 0, div: 3 })).toBe(1) // far side, camera's left
  })
  it('and each zone into 9 again', () => {
    expect(zoneCellQuad(corners, { row: 17, col: 8, div: 9 }).map(p => p.map(v => +v.toFixed(4)))).toEqual([[0.8889, 0.9444], [1, 0.9444], [1, 1], [0.8889, 1]])
    expect(zoneOfCell({ row: 9, col: 4, div: 9 })).toBe(3) // just past the net, middle: zone 3 of the near side
    expect(zoneOfCell({ row: 14, col: 0, div: 9 })).toBe(7)
  })
})

describe('the player marks, per kind of play', () => {
  it('splits a style saved before into each kind, keeping only what applied to it', () => {
    const old = cleanGridStyle({ heat: true, serveFlights: true, cones: true, chart: { corner: 'bl' } })
    expect(old.bySkill?.S).toMatchObject({ heat: true, serveFlights: true, chart: { corner: 'bl' } })
    expect(old.bySkill?.S?.cones).toBeUndefined()
    expect(old.bySkill?.A).toMatchObject({ heat: true, cones: true })
    expect(old.bySkill?.A?.serveFlights).toBeUndefined()
    expect(old.bySkill?.E).toEqual({})
    expect(old.heat).toBeUndefined() // only per kind now
  })
  it('gives a play only its own kind\'s marks', () => {
    const s = cleanGridStyle({ bySkill: { S: { serveFlights: true }, A: { chart: {} }, E: { setChart: { corner: 'br' } } } })
    expect(markStyle(s, 'S').serveFlights).toBe(true)
    expect(markStyle(s, 'S').chart).toBeUndefined()
    expect(markStyle(s, 'A').chart).toBeDefined()
    expect(markStyle(s, 'E').setChart?.corner).toBe('br')
    expect(markStyle(s, 'R').serveFlights).toBeUndefined()
  })
  it('takes a style made in code as it is', () => {
    const s = { ...DEFAULT_GRID_STYLE, heat: true }
    expect(markStyle(s, 'A')).toBe(s)
    expect(marksBySkill(marksBySkill(s))).toEqual(marksBySkill(s))
  })
})
