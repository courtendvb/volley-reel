import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { parseDVW } from './dvw'
import { isVsm, parseScout, playCode, vsmToDvw, type Vsm } from './vsm'

const lineup = { home: { positions: { 1: 7, 2: 4, 3: 21, 4: 5, 5: 15, 6: 80 }, setterAt: 3 }, away: { positions: { 1: 99, 2: 21, 3: 77, 4: 90, 5: 10, 6: 9 }, setterAt: 6 } }
const vsm: Vsm = {
  startDate: '2026-11-08T02:45:05.342Z',
  team: {
    home: { name: 'HIROSHIMA', shortCode: 'HTH', libero: [3], players: [{ shirtNumber: 4, lastName: 'MIWA', firstName: 'Hiromasa', code: 'MIW-HIR-99', position: 3 }, { shirtNumber: 21, lastName: 'EIRO', code: 'EIR-MOT-96', position: 4 }, { shirtNumber: 7, lastName: 'ARAI', position: 1 }, { shirtNumber: 3, lastName: 'NISHIMURA', position: 0 }] },
    away: { name: 'SAKAI', shortCode: 'SAK', players: [{ shirtNumber: 99, lastName: 'RAMON', position: 1 }] },
  },
  setterCalls: [{ code: 'KQ', name: 'QUICK' }],
  scout: { sets: [{ startingLineup: lineup, score: { home: 1, away: 0 }, events: [{
    lineup, score: { home: 1, away: 0 },
    exchange: { point: '*', plays: [
      { team: 'a', player: '99', skill: 'S', hitType: 'Q', effect: '-', startZone: 1, endZone: 9, endSubZone: 'D', time: 2336, travelPath: [{ x: 807, y: -65 }, { x: 281, y: 1405 }] },
      { team: '*', player: '07', skill: 'R', hitType: 'Q', effect: '#', startZone: 9, startSubZone: 'D', endZone: 3, endSubZone: 'B', skillType: 'R', time: 2365 },
      { team: '*', player: '21', skill: 'E', hitType: 'Q', effect: '+', combination: 'KQ', targetAttacker: 'C', startZone: 3, startSubZone: 'B', endZone: 3, endSubZone: 'C', time: 2362, travelPath: [{ x: 543, y: 860 }, { x: 303, y: 867 }] },
      { team: '*', player: '04', skill: 'A', hitType: 'Q', effect: '#', combination: 'PQ', startZone: 3, startSubZone: 'C', endZone: 1, endSubZone: 'C', skillType: 'H', players: 1, time: 2370, travelPath: [{ x: 382, y: 826 }, { x: 223, y: 1554 }] },
      { team: 'a', player: '99', skill: 'D', hitType: 'Q', effect: '=', startZone: 1, startSubZone: 'C', time: 2400 },
    ] },
  }] }] },
}

describe('VolleyStation files', () => {
  it('tell themselves from a DVW', () => {
    expect(isVsm(JSON.stringify(vsm))).toBe(true)
    expect(isVsm('[3DATAVOLLEYSCOUT]\r\n')).toBe(false)
  })
  it("write each play's code as DataVolley does: a reception with the serve's zones, a set where it was played, a dig from the attack", () => {
    const plays = vsm.scout!.sets![0].events[0].exchange!.plays
    expect(plays.map((p, i) => playCode(p, plays.slice(0, i)))).toEqual(['a99SQ-~~~19D', '*07RQ#~~~19DR', '*21EQ+KQC~3B', '*04AQ#PQ~31CH1', 'a99DQ=~~~31C'])
  })
  it('read as a DVW: teams, players, plays, clicks, the rally and its point', () => {
    const d = parseScout(JSON.stringify(vsm))
    expect(d.teams.map(t => t.code)).toEqual(['HTH', 'SAK'])
    expect(d.players['*4']).toMatchObject({ key: 'MIW-HIR-99', lastName: 'MIWA', role: 'MB', sets: [2, null, null, null, null] })
    expect(d.players['*3']).toMatchObject({ libero: true, role: 'L' })
    expect(d.plays.map(p => p.code)).toEqual(['a99SQ-~~~19D', '*07RQ#~~~19DR', '*21EQ+KQC~3B', '*04AQ#PQ~31CH1', 'a99DQ=~~~31C'])
    expect(d.plays[0]).toMatchObject({ time: 233.6, homeRot: 3, awayRot: 6, setNum: 1 })
    expect(d.plays[0].startClick).not.toBeNull()
    expect(d.rallies).toHaveLength(1)
    expect(d.rallies[0]).toMatchObject({ wonBy: '*', court: { home: [7, 4, 21, 5, 15, 80], away: [99, 21, 77, 90, 10, 9] } })
    expect(d.codeNames.KQ).toBe('QUICK')
    expect(vsmToDvw(vsm)).toContain('[3SCOUT]')
  })
  // The same match exported both ways, when the files are on this computer.
  const dvwPath = 'C:/video/&261108HTH-SAK_3-1_2nd.dvw', vsmPath = 'C:/video/261108HTH-SAK_3-1_2nd.vsm'
  it.skipIf(!existsSync(dvwPath) || !existsSync(vsmPath))('read like the DVW of the same match', () => {
    const a = parseDVW(readFileSync(dvwPath, 'latin1')), b = parseScout(readFileSync(vsmPath, 'utf8'))
    expect(b.plays.length).toBe(a.plays.length)
    expect(b.rallies.length).toBe(a.rallies.length)
    expect(b.players).toEqual(a.players)
    const keys = ['code', 'playerKey', 'score', 'homeRot', 'awayRot', 'phase', 'recEffect', 'front', 'before', 'after'] as const
    for (const [i, p] of a.plays.entries()) for (const k of keys) expect(b.plays[i][k], `${i} ${k}`).toEqual(p[k])
  })
})
