import { describe, expect, it } from 'vitest'
import { LOCAL_PACK, captionPhoto, findPhoto, fit, isFor, localEntry, matchesQuery, readManifest, type PackInfo, type PackPlayer } from './pack'
import type { ParsedDVW, Play, Player } from './types'

const player = (o: Partial<Player>): Player => ({ key: 'X', side: '*', jersey: 1, lastName: '', firstName: '', ...o })
const pp = (o: Partial<PackPlayer>): PackPlayer => ({ team: 'SUN', lastName: '', photo: 'a.jpg', ...o })

describe('readManifest', () => {
  it('keeps usable players and normalizes them', () => {
    const m = readManifest({
      format: 'volley-reel-pack', version: 1, id: 'vleague-2026', name: 'V.League 2026',
      players: [
        { team: 'sun', jersey: '7', lastName: ' YAMADA ', photo: 'yamada.jpg', label: '山田 太郎' },
        { team: 'SUN', lastName: 'NOPHOTO', photo: '' },
        { team: 'SUN', lastName: 'ESCAPE', photo: '../evil.jpg' },
        { team: 'SUN', lastName: 'WEBP', photo: 'a.webp' },
      ],
    })
    expect(m?.players).toEqual([{ team: 'SUN', jersey: 7, lastName: 'YAMADA', label: '山田 太郎', photo: 'yamada.jpg' }])
  })

  it('rejects another format, version or a bad id', () => {
    const ok = { format: 'volley-reel-pack', version: 1, id: 'a', name: 'A', players: [] }
    expect(readManifest(ok)).not.toBeNull()
    expect(readManifest({ ...ok, version: 2 })).toBeNull()
    expect(readManifest({ ...ok, format: 'x' })).toBeNull()
    expect(readManifest({ ...ok, id: '../a' })).toBeNull()
    expect(readManifest(null)).toBeNull()
  })
})

describe('fit / findPhoto', () => {
  it('an ID is enough, whatever the team code (and the scrimmage -a is ignored)', () => {
    expect(fit(pp({ team: 'OTHER', ids: ['YAM-TAR-01-a'] }), player({ key: 'YAM-TAR-01' }), 'SUN')).toBe(100)
  })

  it('otherwise the team must match', () => {
    expect(fit(pp({ lastName: 'YAMADA', jersey: 7 }), player({ lastName: 'YAMADA', jersey: 7 }), 'PAN')).toBe(0)
    expect(fit(pp({ teams: ['PAN'], lastName: 'YAMADA' }), player({ lastName: 'Yamada' }), 'pan')).toBe(10)
  })

  it('names match ignoring case, spaces and hyphens; jersey counts too', () => {
    expect(fit(pp({ lastName: 'Van-Dijk' }), player({ lastName: 'VAN DIJK' }), 'SUN')).toBe(10)
    expect(fit(pp({ lastName: 'ARAI', jersey: 7 }), player({ lastName: 'Arai', jersey: 7 }), 'SUN')).toBe(15)
  })

  it('a jersey alone is not enough: another surname is another person', () => {
    expect(fit(pp({ lastName: 'YANAGITA', jersey: 2 }), player({ lastName: 'HIGUCHI', jersey: 2 }), 'SUN')).toBe(0)
  })

  it('a teammate with the same surname but another first name is not the player', () => {
    expect(fit(pp({ lastName: 'SATO', firstName: 'Ken' }), player({ lastName: 'SATO', firstName: 'Yuki' }), 'SUN')).toBe(0)
  })

  it('picks the best fit, and nothing when two fit equally', () => {
    const packs: PackInfo[] = [{ id: 'p', name: 'P', players: [
      pp({ lastName: 'SATO', firstName: 'Ken', jersey: 4, photo: 'ken.jpg' }),
      pp({ lastName: 'SATO', firstName: 'Yuki', jersey: 9, photo: 'yuki.jpg' }),
      pp({ lastName: 'ITO', photo: 'ito1.jpg' }), pp({ lastName: 'ITO', photo: 'ito2.jpg' }),
    ] }]
    expect(findPhoto(packs, player({ lastName: 'SATO', firstName: 'Yuki', jersey: 9 }), 'SUN')?.player.photo).toBe('yuki.jpg')
    expect(findPhoto(packs, player({ lastName: 'SATO', jersey: 4 }), 'SUN')?.player.photo).toBe('ken.jpg')
    expect(findPhoto(packs, player({ lastName: 'ITO' }), 'SUN')).toBeNull()
    expect(findPhoto(packs, player({ lastName: 'KATO' }), 'SUN')).toBeNull()
  })
})

describe('photos added in the app', () => {
  const tg = { key: 'YAN-YUR-02', team: 'hth', jersey: 2, lastName: 'YANAKITA', firstName: 'Yuri' }

  it('win over a league pack, and still fit by team and name where the ID differs', () => {
    const packs: PackInfo[] = [
      { id: 'league', name: 'L', players: [pp({ team: 'HTH', ids: ['YAN-YUR-02'], lastName: 'YANAKITA', photo: 'league.jpg' })] },
      { id: LOCAL_PACK, name: 'local', players: [localEntry(tg, 'mine.jpg')] },
    ]
    expect(findPhoto(packs, player({ key: 'YAN-YUR-02', lastName: 'YANAKITA', jersey: 2 }), 'HTH')?.player.photo).toBe('mine.jpg')
    expect(findPhoto(packs, player({ key: 'OTHER-ID', lastName: 'Yanakita', firstName: 'Yuri', jersey: 2 }), 'HTH')?.player.photo).toBe('mine.jpg')
  })

  it('a new photo replaces the entry made for the same player', () => {
    expect(isFor(localEntry(tg, 'a.jpg'), tg)).toBe(true)
    expect(isFor(pp({ team: 'HTH', lastName: 'yanakita', jersey: 2 }), { ...tg, key: 'X' })).toBe(true)
    expect(isFor(pp({ team: 'HTH', lastName: 'YANAKITA', jersey: 3 }), { ...tg, key: 'X' })).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('every word must appear in the label, names, team or jersey', () => {
    const p = pp({ lastName: 'YAMADA', firstName: 'Taro', label: '山田 太郎', jersey: 7 })
    expect(matchesQuery(p, 'yamada sun')).toBe(true)
    expect(matchesQuery(p, '山田')).toBe(true)
    expect(matchesQuery(p, 'yamada pan')).toBe(false)
  })
})

describe('captionPhoto', () => {
  const dvw = { teams: [{ code: 'SUN', name: 'Sun' }, { code: 'OPP', name: 'Opp' }], players: {
    '*7': player({ key: 'YAM-TAR', side: '*', jersey: 7, lastName: 'YAMADA', firstName: 'Taro' }),
    'a7': player({ key: 'SAT-JIR', side: 'a', jersey: 7, lastName: 'SATO', firstName: 'Jiro' }),
  } } as unknown as ParsedDVW
  const packs: PackInfo[] = [{ id: 'sv', name: 'SV', players: [pp({ lastName: 'YAMADA', jersey: 7, photo: 'yamada.png' })] }]
  const play = (side: '*' | 'a', jersey: number) => ({ side, jersey }) as Play

  it("finds the play's player by side and jersey, with their team's code", () => {
    expect(captionPhoto(packs, dvw, play('*', 7))).toEqual({ pack: 'sv', photo: 'yamada.png' })
    expect(captionPhoto(packs, dvw, play('a', 7))).toBeNull() // the other team's #7
    expect(captionPhoto(packs, dvw, play('*', 9))).toBeNull() // not in the roster
  })
})
