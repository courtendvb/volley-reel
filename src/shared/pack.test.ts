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

  // Cases from the league's scouts against its pack.
  it('fits names a scout wrote another way', () => {
    const f = (a: Partial<PackPlayer>, b: Partial<Player>) => fit(pp(a), player(b), 'SUN')
    // The two names the other way round, a first name also written short.
    expect(f({ lastName: 'JUDSON', firstName: 'Nunes', jersey: 11 }, { lastName: 'NUNES', firstName: 'Judson', jersey: 11 })).toBe(12)
    expect(f({ lastName: 'RAMA', firstName: 'Zachary', jersey: 2 }, { lastName: 'ZACH', firstName: 'Rama', jersey: 2 })).toBe(12)
    // A first name's words in another order; a surname with more words; a long vowel spelt another way.
    expect(f({ lastName: 'EVBADE-DAN', firstName: 'IK Larry', jersey: 23 }, { lastName: 'EVBADE-DAN', firstName: 'Larry Ik', jersey: 23 })).toBe(18)
    expect(f({ lastName: 'LOPEZ', firstName: 'Miguel', jersey: 81 }, { lastName: 'LOPEZ CASTRO', firstName: 'Miguel Angel', jersey: 81 })).toBe(14)
    expect(f({ lastName: 'KAMIJO', firstName: 'Reimondo', jersey: 16 }, { lastName: 'KAMIJOU', firstName: 'Raymond', jersey: 16 })).toBe(14)
    // Another romanisation of the surname: only with the same jersey and first name.
    expect(f({ lastName: 'RI', firstName: 'Haku', jersey: 15 }, { lastName: 'LEE', firstName: 'Haku', jersey: 15 })).toBe(6)
    expect(f({ lastName: 'RI', firstName: 'Haku', jersey: 15 }, { lastName: 'LEE', firstName: 'Haku', jersey: 9 })).toBe(0)
    expect(f({ lastName: 'RI', firstName: 'Ken', jersey: 15 }, { lastName: 'LEE', firstName: 'Haku', jersey: 15 })).toBe(0)
    // A swap needs both names: a surname that is someone's first name alone is not enough.
    expect(f({ lastName: 'DAVID', firstName: 'Smith' }, { lastName: 'JONES', firstName: 'David' })).toBe(0)
  })

  it('keeps the names as written ahead of a looser fit', () => {
    const packs: PackInfo[] = [{ id: 'p', name: 'P', players: [
      pp({ lastName: 'SMITH', firstName: 'David', jersey: 15, photo: 'smith.jpg' }),
      pp({ lastName: 'DAVID', firstName: 'Smith', jersey: 15, photo: 'david.jpg' }),
    ] }]
    expect(findPhoto(packs, player({ lastName: 'SMITH', firstName: 'David', jersey: 15 }), 'SUN')?.player.photo).toBe('smith.jpg')
    expect(findPhoto([{ ...packs[0], players: [packs[0].players[0]] }], player({ lastName: 'DAVID', firstName: 'Smith', jersey: 15 }), 'SUN')?.player.photo).toBe('smith.jpg')
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
