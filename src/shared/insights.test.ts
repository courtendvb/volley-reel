import { describe, expect, it } from 'vitest'
import { binomTail, cleanVideoInsight, findInsights, inFocus, insightReels, isClutch, rankOf, refindInsights, videoInsight, zScore, type Insight } from './insights'
import type { PlayRef } from './filter'
import type { Play } from './types'

let id = 0, rally = 0
interface O {
  skill: string; jersey: number; effect?: string; rot?: number; team?: 'our' | 'opp'; phase?: Play['phase']; recEffect?: string
  start?: number | null; end?: number | null; score?: [number, number]; set?: number; tempo?: string; rally?: number; side?: '*' | 'a'
}
const ref = (o: O): PlayRef => {
  const team = o.team ?? 'opp'
  return {
    matchId: 'm', teamRole: team, side: o.side ?? (team === 'opp' ? 'a' : '*'), teamCode: team === 'opp' ? 'OPP' : 'HTH', personKey: `${team}${o.jersey}`, name: `N${o.jersey}`,
    ourRot: team === 'our' ? o.rot ?? 1 : 1, oppRot: team === 'opp' ? o.rot ?? 1 : 1, tempo: o.tempo ?? null, combo: null, comboName: null, hit: null, dir: null,
    play: {
      id: id++, code: '', playerKey: `${team}${o.jersey}`, skill: o.skill, effect: o.effect ?? '+', jersey: o.jersey, phase: o.phase ?? null, recEffect: o.recEffect, startZone: o.start ?? null, endZone: o.end ?? null,
      endSub: null, rallyId: o.rally ?? rally++, setNum: o.set ?? 1, score: { home: o.score?.[0] ?? 5, away: o.score?.[1] ?? 5 }, before: [], after: [],
    } as unknown as Play,
  }
}
const times = (n: number, f: (i: number) => PlayRef): PlayRef[] => Array.from({ length: n }, (_, i) => f(i))
const noWon = () => null
const kinds = (l: Insight[]) => l.map(i => i.kind)

describe('insights', () => {
  it('tells the end of a close set', () => {
    const p = (home: number, away: number, set = 1) => ({ setNum: set, score: { home, away } }) as Play
    expect(isClutch(p(20, 19))).toBe(true)
    expect(isClutch(p(22, 18))).toBe(false)
    expect(isClutch(p(19, 18))).toBe(false)
    expect(isClutch(p(10, 9, 5))).toBe(true)
    expect(zScore(5, 10, 0.5)).toBeCloseTo(0)
    expect(zScore(9, 10, 0.5)).toBeGreaterThan(2)
  })

  it('finds who a rotation goes to, against the side-out as a whole', () => {
    // Over the side-out, #9 and #10 share the attacks; in rotation 1 #9 gets nearly all of them.
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '+' })
    const scope = [
      ...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)),
      ...[6, 5, 4, 3, 2].flatMap(rot => [...times(3, () => so(9, rot)), ...times(4, () => so(10, rot))]),
    ]
    const found = findInsights(scope, 'opp', noWon).filter(i => i.kind === 'share')
    const rot1 = found.find(i => i.key.startsWith('share|rot1|'))!
    expect(rot1.key).toBe('share|rot1|opp|opp9')
    expect([rot1.n, rot1.hits]).toEqual([15, 14])
    expect(rot1.headline).toBe('ローテ 1 のサイドアウトは #9 N9 が 93%')
    expect(rot1.detail).toBe('15 本中 14 本（チーム全体では 58%）')
    expect(rot1.refs.every(r => r.play.jersey === 9)).toBe(true)
    expect(rot1.others.map(r => r.play.jersey)).toEqual([10])
    // Our team's plays are not the opponent's habits.
    expect(findInsights(scope, 'our', noWon)).toEqual([])
  })

  it('leaves out a habit seen in too few plays', () => {
    const scope = [...times(4, () => ref({ skill: 'A', jersey: 9, rot: 1, phase: 'r' })), ...times(20, () => ref({ skill: 'A', jersey: 10, rot: 2, phase: 'r' }))]
    expect(findInsights(scope, 'opp', noWon).filter(i => i.key.startsWith('share|rot1|'))).toEqual([])
  })

  it('finds where an attacker hits from a zone and where and whom a server serves', () => {
    const scope = [
      ...times(12, i => ref({ skill: 'A', jersey: 9, start: 4, end: i < 10 ? 5 : 1, phase: 't' })),
      ...times(24, i => ref({ skill: 'A', jersey: 11, start: 4, end: i % 2 ? 1 : 6, phase: 't' })),
    ]
    const zone = findInsights(scope, 'opp', noWon).find(i => i.kind === 'zone')!
    expect(zone.headline).toBe('#9 N9 の Zone4 からのアタックは Zone5 へ 83%')

    // #12 serves Zone1 and at our #7; the rest of the team spread their serves.
    const serves: PlayRef[] = []
    for (let i = 0; i < 12; i++) {
      serves.push(ref({ skill: 'S', jersey: 12, end: 1, rally: 1000 + i }), ref({ skill: 'R', jersey: 7, team: 'our', rally: 1000 + i }))
    }
    for (let i = 0; i < 24; i++) {
      serves.push(ref({ skill: 'S', jersey: 3, end: [1, 6, 5][i % 3], rally: 2000 + i }), ref({ skill: 'R', jersey: [7, 8, 9][i % 3], team: 'our', rally: 2000 + i }))
    }
    const found = findInsights(serves, 'opp', noWon)
    expect(found.find(i => i.kind === 'serveZone')?.headline).toBe('#12 N12 のサーブは Zone1 へ 100%')
    expect(found.find(i => i.kind === 'serveTarget')?.headline).toBe('#12 N12 のサーブは #7 N7 を狙う（100%）')
    expect(found.find(i => i.kind === 'serveTarget')?.refs.every(r => r.play.skill === 'S')).toBe(true)
    // The target counts half: it comes after the zone.
    const zoneAt = found.findIndex(i => i.kind === 'serveZone'), targetAt = found.findIndex(i => i.kind === 'serveTarget')
    expect(targetAt).toBeGreaterThan(zoneAt)
    expect(rankOf(found[targetAt])).toBeCloseTo(-Math.log10(found[targetAt].adjP) / 2)
  })

  it('serves at a receiver against the matches that receiver was in only', () => {
    // Match a: #7 receives a third of the team's serves, as from #12. Match b: no #7 at all, and #12
    // serves at whoever is there. Over both, #7 gets a sixth of the serves; #12 aims no more at #7.
    const serves: PlayRef[] = []
    const add = (match: string, server: number, receiver: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const r = rally++
        serves.push({ ...ref({ skill: 'S', jersey: server, end: 1, rally: r }), matchId: match }, { ...ref({ skill: 'R', jersey: receiver, team: 'our', rally: r }), matchId: match })
      }
    }
    add('a', 12, 7, 8); add('a', 12, 8, 8); add('a', 12, 9, 8)
    add('a', 3, 7, 8); add('a', 3, 8, 8); add('a', 3, 9, 8)
    add('b', 12, 4, 8); add('b', 12, 5, 8); add('b', 12, 6, 8)
    add('b', 3, 4, 8); add('b', 3, 5, 8); add('b', 3, 6, 8)
    expect(findInsights(serves, 'opp', noWon).filter(i => i.kind === 'serveTarget')).toEqual([])
  })

  it('finds where a setter sets in a combination, against their own sets', () => {
    // #1 sets #4 (Zone4), #3 (Zone3) and #2 (Zone2) alike; but in rotation 3 on a perfect pass,
    // mostly Zone2, and on a positive one there never.
    const plays: PlayRef[] = []
    const set = (attacker: number, zone: number, rot: number, pass: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const r = rally++
        plays.push(ref({ skill: 'E', jersey: 1, rot, phase: 'r', recEffect: pass, rally: r }), ref({ skill: 'A', jersey: attacker, start: zone, rot, phase: 'r', recEffect: pass, rally: r }))
      }
    }
    for (const rot of [1, 2, 3, 4, 5, 6]) for (const pass of ['#', '+']) {
      if (rot === 3 && pass === '+') { set(4, 4, rot, pass, 6); set(3, 3, rot, pass, 6) } else for (const [a, z] of [[4, 4], [3, 3], [2, 2]]) set(a, z, rot, pass, 4)
    }
    set(2, 2, 3, '#', 24)
    const found = findInsights(plays, 'opp', noWon).filter(i => i.kind === 'setDist')
    const top = found[0]
    expect(top.headline).toBe('#1 N1 はローテ 3・レセプション「#」のとき Zone2/1 へ 78%')
    expect(top.detail).toBe('36 本中 28 本（ふだんは 40%）')
    expect(top.refs.every(r => r.play.skill === 'E')).toBe(true)
    expect(top.person).toBe('opp|opp1')
    expect(found.filter(i => i.subject === top.subject)).toHaveLength(1)

    // Rotation 3 to Zone2 whatever the pass: the rotation says it all, the combinations add nothing.
    plays.length = 0
    for (const rot of [1, 2, 4, 5, 6]) for (const pass of ['#', '+']) for (const [a, z] of [[4, 4], [3, 3], [2, 2]]) set(a, z, rot, pass, 4)
    set(2, 2, 3, '#', 12); set(2, 2, 3, '+', 12)
    const plain = findInsights(plays, 'opp', noWon).filter(i => i.kind === 'setDist').map(i => i.subject)
    expect(plain).toContain('setDist|opp|opp1|rot=3')
    expect(plain.filter(s => s.includes('rot=3&'))).toEqual([])
  })

  it('sets a setter in the front row against the back row', () => {
    // #1 in the front row (rotations 2–4) goes to Zone4 18 times in 30; in the back row 6 in 30.
    const plays: PlayRef[] = []
    for (const [rot, z4] of [[2, 6], [3, 6], [4, 6], [1, 2], [6, 2], [5, 2]]) for (let i = 0; i < 10; i++) {
      const r = rally++, [a, z] = i < z4 ? [4, 4] : [3, 3]
      plays.push(ref({ skill: 'E', jersey: 1, rot, phase: 't', rally: r }), ref({ skill: 'A', jersey: a, start: z, rot, phase: 't', rally: r }))
    }
    const front = findInsights(plays, 'opp', noWon).find(i => i.subject === 'setDist|opp|opp1|row=front')!
    expect(front.headline).toBe('#1 N1 は自分が前衛のとき Zone4 へ 60%')
    expect(front.detail).toBe('30 本中 18 本（自分が後衛のときは 20%・30 本中 6 本）')
    expect(front.base).toBeCloseTo(0.2)
  })

  it('finds the server the team breaks with, and the receiver it sides out with less than the servers faced say', () => {
    // #12 serves 20 and the team breaks on 14; #3 on 8 of 40.
    const serves: PlayRef[] = [], won = new Map<number, '*' | 'a'>()
    const serve = (jersey: number, n: number, breaks: number) => { for (let i = 0; i < n; i++) { const r = rally++; serves.push(ref({ skill: 'S', jersey, rally: r })); won.set(r, i < breaks ? 'a' : '*') } }
    serve(12, 20, 14); serve(3, 40, 8)
    const byRally = (r: PlayRef) => (r.play.rallyId === null ? null : won.get(r.play.rallyId) ?? null)
    const brk = findInsights(serves, 'opp', byRally).find(i => i.kind === 'serverBreak')!
    expect(brk.headline).toBe('#12 N12 のサーブはブレイク率 70%')
    expect(brk.detail).toBe('20 本中 14 本でブレイク（チーム全体では 37%）')

    // The other team's #20 breaks often, #21 seldom. #5 and #8 only face #20 and side out as seldom as
    // anyone does against #20; #7 faces #21 and sides out far less than #21's serves would have it.
    const recs: PlayRef[] = [], out = new Map<number, '*' | 'a'>()
    const face = (server: number, receiver: number, n: number, sideOuts: number) => {
      for (let i = 0; i < n; i++) {
        const r = rally++
        recs.push(ref({ skill: 'S', jersey: server, team: 'our', rally: r }), ref({ skill: 'R', jersey: receiver, rally: r }))
        out.set(r, i < sideOuts ? 'a' : '*')
      }
    }
    face(20, 5, 20, 8); face(20, 8, 20, 8); face(21, 6, 20, 18); face(21, 9, 20, 18); face(21, 7, 20, 8)
    const so = findInsights(recs, 'opp', r => (r.play.rallyId === null ? null : out.get(r.play.rallyId) ?? null)).filter(i => i.kind === 'receiverSO')
    const seven = so.find(i => i.person === 'opp|opp7')!
    expect(seven.headline).toBe('#7 N7 のレセプションはサイドアウト率 40%')
    expect(seven.refs.every(r => r.play.skill === 'R')).toBe(true)
    expect(so.map(i => i.person)).not.toContain('opp|opp5')
    expect(so.map(i => i.person)).not.toContain('opp|opp8')
  })

  it('makes a kind that looks at many situations surer before it keeps a habit', () => {
    expect(binomTail(10, 10, 0.5)).toBeCloseTo(1 / 1024)
    expect(binomTail(0, 10, 0.5, false)).toBeCloseTo(1 / 1024)
    expect(binomTail(0, 10, 0.5)).toBeCloseTo(1)
    // The same habit, alone or among many attackers' zones that show nothing.
    const habit = times(12, i => ref({ skill: 'A', jersey: 9, start: 4, end: i < 11 ? 5 : 1, phase: 't' }))
    const plain = times(30, i => ref({ skill: 'A', jersey: 11, start: 4, end: [1, 5, 6][i % 3], phase: 't' }))
    const alone = findInsights([...habit, ...plain], 'opp', noWon).find(i => i.kind === 'zone')!
    const noise = [2, 3].flatMap(zone => [20, 21, 22, 23, 24].flatMap(j => times(12, i => ref({ skill: 'A', jersey: j, start: zone, end: [1, 5, 6, 7][i % 4], phase: 't' }))))
    const among = findInsights([...habit, ...plain, ...noise], 'opp', noWon).find(i => i.key === alone.key)
    expect(alone.p).toBeLessThan(0.01)
    expect(among?.adjP ?? 1).toBeGreaterThan(alone.adjP)
  })

  it('finds who breaks down on a kind of serve and the rotation that cannot side out', () => {
    const recs = [
      ...times(12, i => ref({ skill: 'R', jersey: 5, tempo: 'Q', effect: i < 8 ? '-' : '#', rot: 4 })),
      ...times(30, i => ref({ skill: 'R', jersey: 6, tempo: 'Q', effect: i < 3 ? '-' : '+', rot: [1, 6, 5, 3, 2][i % 5] })),
    ]
    const won = new Map(recs.map(r => [r.play.id, r.play.jersey === 5 ? '*' : 'a'] as const))
    const found = findInsights(recs, 'opp', r => won.get(r.play.id) ?? null)
    const weak = found.find(i => i.kind === 'recWeak')!
    expect(weak.headline).toBe('#5 N5 はジャンプサーブで崩れる（67%）')
    expect(weak.refs.every(r => r.play.effect === '-')).toBe(true)
    const rot = found.find(i => i.kind === 'rotWeak')!
    expect(rot.headline).toBe('ローテ 4 のサイドアウト率 0%（全体 71%）')
    expect(rot.refs).toHaveLength(12)
  })

  it('finds who rises or falls at the end of a close set', () => {
    const attacks = [
      ...times(30, i => ref({ skill: 'A', jersey: 9, effect: i < 12 ? '#' : '+', phase: 't' })),
      ...times(12, i => ref({ skill: 'A', jersey: 9, effect: i < 11 ? '#' : '+', phase: 't', score: [22, 21] })),
      ...times(30, i => ref({ skill: 'A', jersey: 4, effect: i < 15 ? '#' : '+', phase: 't' })),
      ...times(12, i => ref({ skill: 'A', jersey: 4, effect: i < 1 ? '#' : '=', phase: 't', score: [23, 23] })),
    ]
    const clutch = findInsights(attacks, 'opp', noWon).filter(i => i.kind === 'clutch')
    expect(clutch.map(i => i.headline).sort()).toEqual(['#4 N4 は終盤の接戦で決定率が 8% に落ちる', '#9 N9 は終盤の接戦で決定率 92%'])
    const down = clutch.find(i => i.key.endsWith('down'))!
    expect(down.z).toBeLessThan(0)
    expect(down.refs.every(r => r.play.effect !== '#')).toBe(true)
    expect(down.detail).toBe('12 本中 1 本が決まった（ふだんは 38%）')
  })

  it('keeps one habit per subject, the surest first', () => {
    const scope = [
      ...times(20, () => ref({ skill: 'A', jersey: 9, rot: 1, phase: 'r', recEffect: '#' })), ...times(2, () => ref({ skill: 'A', jersey: 10, rot: 1, phase: 'r', recEffect: '#' })),
      ...times(20, () => ref({ skill: 'A', jersey: 10, rot: 2, phase: 'r', recEffect: '-' })), ...times(2, () => ref({ skill: 'A', jersey: 9, rot: 2, phase: 'r', recEffect: '-' })),
    ]
    const found = findInsights(scope, 'opp', noWon)
    expect(new Set(found.map(i => i.subject)).size).toBe(found.length)
    for (let i = 1; i < found.length; i++) expect(Math.abs(found[i - 1].z)).toBeGreaterThanOrEqual(Math.abs(found[i].z))
    expect(kinds(found).every(k => k === 'share')).toBe(true)
    expect(findInsights(scope, 'opp', noWon, 2)).toHaveLength(2)
  })

  it('makes a scene per insight with its numbers on the title card', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r' })
    const scope = [...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...times(20, () => so(10, 2)), ...times(5, () => so(9, 2))]
    const [top] = findInsights(scope, 'opp', noWon)
    const [plain] = insightReels([top], { mode: 'keyplay', limit: 5, withOthers: false, prefix: 'OPP' })
    expect(plain.name).toBe(`OPP ${top.headline}`)
    expect(plain.cardTitle).toBe(`${top.headline}\n${top.detail}`)
    expect(plain.groups[1]).toHaveLength(5)
    expect(plain.groups[2]).toHaveLength(0)
    expect(plain.markerNames[1]).toBe(top.mark)
    const [both] = insightReels([top], { mode: 'keyplay', limit: null, withOthers: true, prefix: '' })
    expect(both.groups[1]).toHaveLength(top.refs.length)
    expect(both.groups[2]).toHaveLength(top.others.length)
    expect(both.markerNames[2]).toBe('それ以外')
  })

  it('finds the habits of a video again by subject, as the matches have them now', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r' })
    const rest = [6, 5, 4, 3, 2].flatMap(rot => [...times(2, () => so(9, rot)), ...times(6, () => so(10, rot))])
    const before = [...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...rest]
    const rot1 = findInsights(before, 'opp', noWon).find(i => i.subject === 'share|rot1')!
    const vi = videoInsight('opp', [rot1], { mode: 'toEnd', limit: 5, withOthers: true, prefix: 'OPP' })
    expect(vi).toEqual({ team: 'opp', subjects: ['share|rot1'], focus: { skills: [], persons: [] }, mode: 'toEnd', limit: 5, withOthers: true, prefix: 'OPP' })
    expect(cleanVideoInsight(JSON.parse(JSON.stringify(vi)))).toEqual(vi)

    // More matches: rotation 1 now goes to #10. The scene follows; a habit gone leaves the video.
    const after = [...before, ...times(40, () => so(10, 1)), ...[6, 5, 4, 3, 2].flatMap(rot => times(6, () => so(9, rot)))]
    const again = refindInsights(after, vi, noWon)
    expect(again.gone).toBe(0)
    expect(again.insights[0].key).toBe('share|rot1|opp|opp10')
    const flat = [1, 6, 5, 4, 3, 2].flatMap(rot => [...times(6, () => so(9, rot)), ...times(6, () => so(10, rot))])
    expect(refindInsights(flat, vi, noWon)).toEqual({ insights: [], gone: 1 })
  })

  it('reads a saved insight with care', () => {
    expect(cleanVideoInsight(null)).toBeNull()
    expect(cleanVideoInsight({ subjects: [] })).toBeNull()
    expect(cleanVideoInsight({ subjects: ['rotWeak|4', 3], team: 'x', limit: -2, mode: 'x' }))
      .toEqual({ team: 'opp', subjects: ['rotWeak|4'], focus: { skills: [], persons: [] }, mode: 'keyplay', limit: null, withOthers: false, prefix: '' })
    expect(cleanVideoInsight({ subjects: ['a'], focus: { skills: ['A', 'X'], persons: ['opp|opp9', 2] } })?.focus).toEqual({ skills: ['A'], persons: ['opp|opp9'] })
  })

  it('looks at the skills and players asked for only', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r' })
    // Rotation 1 goes to #9, rotation 2 to #10; #12 serves Zone1; rotation 4 can't side out.
    const scope = [
      ...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...times(14, () => so(10, 2)), ...times(1, () => so(9, 2)),
      ...[6, 5, 4, 3].flatMap(rot => [...times(4, () => so(9, rot)), ...times(4, () => so(10, rot))]),
      ...times(12, () => ref({ skill: 'S', jersey: 12, end: 1 })), ...times(24, i => ref({ skill: 'S', jersey: 3, end: [1, 6, 5][i % 3] })),
      ...times(12, () => ref({ skill: 'R', jersey: 5, rot: 4 })), ...times(30, i => ref({ skill: 'R', jersey: 6, rot: [1, 6, 5, 3, 2][i % 5] })),
    ]
    const won = (r: PlayRef) => (r.play.skill === 'R' && r.play.jersey === 5 ? '*' : 'a')
    const all = findInsights(scope, 'opp', won)
    expect(new Set(kinds(all))).toEqual(new Set(['share', 'serveZone', 'rotWeak']))
    expect(kinds(findInsights(scope, 'opp', won, 20, { skills: ['S'], persons: [] }))).toEqual(['serveZone'])
    expect(new Set(kinds(findInsights(scope, 'opp', won, 20, { skills: ['A', 'R'], persons: [] })))).toEqual(new Set(['share', 'rotWeak']))
    // A player: only habits about them, and a rotation's is about no one.
    const ten = findInsights(scope, 'opp', won, 20, { skills: [], persons: ['opp|opp10'] })
    expect(ten.map(i => i.key)).toEqual(['share|rot2|opp|opp10'])
    expect(all.filter(i => inFocus(i, { skills: [], persons: ['opp|opp12'] })).map(i => i.kind)).toEqual(['serveZone'])
    // Made again, the video keeps its focus.
    const vi = videoInsight('opp', ten, { mode: 'keyplay', limit: null, withOthers: false, prefix: '' }, { skills: [], persons: ['opp|opp10'] })
    expect(refindInsights(scope, vi, won).insights.map(i => i.key)).toEqual(['share|rot2|opp|opp10'])
  })
})
