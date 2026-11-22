import { describe, expect, it } from 'vitest'
import { PACK_ID, PACK_PHOTO, readManifest } from './pack'
import { cropHeight, firstCrop, keepCrop, packIdOf, packManifest, photoFile, playerForFile, rosterOf, type RosterPlayer } from './packMaker'
import type { ParsedDVW } from './types'

const dvw = (home: string, away: string, players: [string, '*' | 'a', number, string, string][]) => ({
  teams: [{ code: home, name: `${home} team` }, { code: away, name: `${away} team` }],
  players: Object.fromEntries(players.map(([key, side, jersey, lastName, firstName]) => [`${side}${jersey}`, { key, side, jersey, lastName, firstName }])),
}) as unknown as ParsedDVW

describe('rosterOf', () => {
  it('lists each person once, by team and jersey', () => {
    const r = rosterOf([dvw('HTH', 'SMT', [['A-1', '*', 7, 'Tanaka', 'Ken'], ['A-2', '*', 2, 'Sato', ''], ['B-1', 'a', 3, 'Mori', '']]), dvw('HTH', 'OKB', [['A-1', '*', 7, 'Tanaka', 'Ken']])])
    expect(r.map(p => `${p.team}${p.jersey}`)).toEqual(['HTH2', 'HTH7', 'SMT3'])
  })
  it('keeps the newest team and jersey, and the old team as another code', () => {
    const [p] = rosterOf([dvw('OLD', 'X', [['A-1', '*', 7, 'Tanaka', '']]), dvw('NEW', 'X', [['A-1', '*', 9, 'Tanaka', '']])])
    expect(p).toMatchObject({ team: 'NEW', jersey: 9, teams: ['OLD'] })
  })
  it('leaves out empty names', () => {
    expect(rosterOf([dvw('HTH', 'X', [['A-1', '*', 7, ' ', '']])])).toEqual([])
  })
})

describe('playerForFile', () => {
  const roster = rosterOf([dvw('HTH', 'SMT', [['A', '*', 7, 'Tanaka', ''], ['B', '*', 8, 'Sato', ''], ['C', 'a', 7, 'Sato', ''], ['D', 'a', 9, 'Mori-Yama', '']])])
  const name = (f: string) => playerForFile(f, roster)?.key ?? null
  it('reads team and jersey, or team and surname', () => {
    expect(name('HTH_7.jpg')).toBe('A')
    expect(name('smt-7.PNG')).toBe('C')
    expect(name('HTH 8.jpeg')).toBe('B')
    expect(name('SMT_SATO.jpg')).toBe('C')
  })
  it('reads a surname only when it is one player', () => {
    expect(name('tanaka.jpg')).toBe('A')
    expect(name('sato.jpg')).toBeNull()
    expect(name('MoriYama.jpg')).toBe('D')
  })
  it('says nothing for other names', () => {
    expect(name('IMG_0001.jpg')).toBeNull()
    expect(name('HTH_99.jpg')).toBeNull()
  })
})

describe('the manifest', () => {
  const p: RosterPlayer = { key: 'A-1', team: 'HTH', teamName: '', teams: [], jersey: 7, lastName: "O'Neil Jr.", firstName: 'Ken', ids: ['A-1'] }
  it('names photos as a pack may', () => {
    expect(PACK_PHOTO.test(photoFile(p))).toBe(true)
    expect(PACK_PHOTO.test(photoFile({ ...p, team: 'H&T' }))).toBe(true)
  })
  it('makes a pack the app can read', () => {
    const m = readManifest(packManifest('Team 2026', [p]))!
    expect(m).toMatchObject({ id: 'team-2026', name: 'Team 2026' })
    expect(m.players[0]).toMatchObject({ team: 'HTH', jersey: 7, ids: ['A-1'], photo: photoFile(p) })
  })
  it('gives every name a usable id, the same each time', () => {
    expect(packIdOf('2026 シーズン')).toBe(packIdOf('2026 シーズン'))
    expect(packIdOf('2026 シーズン')).not.toBe(packIdOf('2027 シーズン'))
    for (const n of ['選手写真', 'local', 'Local', '!!!']) { expect(PACK_ID.test(packIdOf(n))).toBe(true); expect(packIdOf(n)).not.toBe('local') }
  })
})

describe('crops', () => {
  it('starts as the largest that fits, near the top', () => {
    const wide = firstCrop(2000, 1000)
    expect(cropHeight(wide)).toBeCloseTo(1000)
    expect(wide.x).toBeCloseTo(600)
    const tall = firstCrop(1000, 2000)
    expect(tall.w).toBe(1000)
    expect(tall.y).toBeCloseTo((2000 - 1250) * 0.15)
  })
  it('stays inside the picture', () => {
    expect(keepCrop({ x: -50, y: 9999, w: 400 }, 1000, 1000)).toEqual({ x: 0, y: 500, w: 400 })
    expect(keepCrop({ x: 0, y: 0, w: 5000 }, 1000, 1000).w).toBe(800)
  })
})
