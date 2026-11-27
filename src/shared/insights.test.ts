import { describe, expect, it } from 'vitest'
import { MAX_P, binomTail, cleanVideoInsight, findInsights, leagueOf, inFocus, insightReels, isClutch, rankOf, sureOf, refindInsights, videoInsight, zScore, type Insight, type InsightOrder } from './insights'
import type { PlayRef } from './filter'
import { getLang, inLang } from './i18n'
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

  it('finds who a rotation goes to after a good and a poor reception', () => {
    // Rotation 5 shares its side-out between #9 and #10, but on #+ it is nearly all #9, on !- #10.
    const so = (jersey: number, rot: number, recEffect: string) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect })
    const scope = [
      ...times(17, () => so(9, 5, '#')), ...times(1, () => so(10, 5, '+')), ...times(3, () => so(9, 5, '-')), ...times(15, () => so(10, 5, '!')),
      ...[1, 6, 4, 3, 2].flatMap(rot => ['#', '-'].flatMap(e => [...times(3, () => so(9, rot, e)), ...times(3, () => so(10, rot, e))])),
    ]
    const found = findInsights(scope, 'opp', noWon, 50).filter(i => i.kind === 'share')
    const good = found.find(i => i.key === 'share|rot5good|opp|opp9')!
    expect(good.headline).toBe('ローテ 5・レセプション #+ のサイドアウトは #9 N9 が 94%')
    expect(good.detail).toBe('18 本中 17 本（ローテ 5 全体では 56%）')
    expect(found.find(i => i.key === 'share|rot5poor|opp|opp10')!.headline).toBe('ローテ 5・レセプション !- のサイドアウトは #10 N10 が 83%')
    // The rotation as a whole goes to neither.
    expect(found.some(i => i.subject === 'share|rot5')).toBe(false)
    // The poor reception's habit is ranked lower.
    expect(found.find(i => i.key === 'share|rot5poor|opp|opp10')!.weight).toBe(0.5)
    expect(good.weight).toBeUndefined()
  })

  it("tells a rotation's side-out as a whole only when its good receptions lean the same way", () => {
    // Rotation 5 goes to #10 as a whole, from the poor receptions alone in the first; on #+ too in the second.
    const so = (jersey: number, rot: number, recEffect: string) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect })
    const rest = [1, 6, 4, 3, 2].flatMap(rot => ['#', '-'].flatMap(e => [...times(4, () => so(9, rot, e)), ...times(2, () => so(10, rot, e))]))
    const whole = (scope: PlayRef[]) => findInsights(scope, 'opp', noWon, 50).find(i => i.subject === 'share|rot5')
    expect(whole([...times(8, () => so(9, 5, '#')), ...times(4, () => so(10, 5, '#')), ...times(24, () => so(10, 5, '-')), ...rest])).toBeUndefined()
    expect(whole([...times(4, () => so(9, 5, '#')), ...times(10, () => so(10, 5, '#')), ...times(20, () => so(10, 5, '-')), ...rest])?.key).toBe('share|rot5|opp|opp10')
  })

  it('finds a place a setter all but stops setting to', () => {
    // In the front row on a perfect pass #1 never goes to Zone2/1; elsewhere a third of the time or so.
    const plays: PlayRef[] = []
    const set = (rot: number, pass: string, z4: number, z3: number, z2: number) => {
      for (const [z, n] of [[4, z4], [3, z3], [2, z2]]) for (let i = 0; i < n; i++) {
        const r = rally++
        plays.push(ref({ skill: 'E', jersey: 1, rot, phase: 'r', recEffect: pass, rally: r }), ref({ skill: 'A', jersey: 10 + z, start: z, rot, phase: 'r', recEffect: pass, rally: r }))
      }
    }
    for (const rot of [2, 3, 4]) { set(rot, '#', 4, 3, 0); set(rot, '-', 2, 3, 2) }
    for (const rot of [1, 6, 5]) { set(rot, '#', 2, 3, 2); set(rot, '-', 2, 3, 2) }
    const low = findInsights(plays, 'opp', noWon, 50).filter(i => i.kind === 'setDist' && i.key.endsWith('|low'))
    const none = low.find(i => i.key.includes('row=front&pass=#'))!
    expect(none.headline).toBe('#1 N1 は自分が前衛・レセプション「#」のとき Zone2/1 へ 0%')
    expect(none.detail).toMatch(/^21 本中 0 本（ふだんは \d+%）$/)
    expect(none.refs).toHaveLength(21)
    expect(none.others).toEqual([])
    expect(none.low).toBe(true)
    expect(none.paint).toEqual({ zones: [2, 1], side: 'own' })
    expect(none.weight).toBeUndefined()
    // After a poor reception a setter's choice counts less.
    expect(findInsights(plays, 'opp', noWon, 50).filter(i => i.kind === 'setDist' && /pass=-/.test(i.key)).every(i => i.weight === 0.5)).toBe(true)
    // A side of two (the front row alone) is not told low: that is the back row's high.
    expect(low.some(i => i.key.includes('|row=front|'))).toBe(false)
  })

  it('finds an attacker in the front row the side-out hardly goes to', () => {
    // Rotation 1: #11 is in the front row but gets 0 of 20; in the other rotations each gets a third.
    const plays: PlayRef[] = []
    const so = (jersey: number, rot: number, front: number[]) => {
      const r = ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '+' })
      ;(r.play as { front?: string[] }).front = front.map(j => `opp${j}`)
      plays.push(r)
    }
    for (let i = 0; i < 10; i++) { so(9, 1, [9, 10, 11]); so(10, 1, [9, 10, 11]) }
    for (const rot of [6, 5, 4, 3, 2]) for (let i = 0; i < 4; i++) for (const j of [9, 10, 11]) so(j, rot, [9, 10, 11])
    const low = findInsights(plays, 'opp', noWon, 50).filter(i => i.kind === 'share' && i.key.endsWith('|low'))
    const r1 = low.find(i => i.key === 'share|rot1|opp|opp11|low')!
    expect(r1.headline).toBe('ローテ 1 のサイドアウトは #11 N11 が 0%')
    expect(r1.mark).toBe('#11 N11 以外')
    // Not in the front row: no habit, only where the player stands.
    for (const p of plays) if (p.play.jersey !== 11 && p.oppRot === 1) (p.play as { front?: string[] }).front = ['opp9', 'opp10']
    expect(findInsights(plays, 'opp', noWon, 50).some(i => i.key === 'share|rot1|opp|opp11|low')).toBe(false)
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
    // Where and whom a server serves come after every other habit, however sure.
    const zoneAt = found.findIndex(i => i.kind === 'serveZone'), targetAt = found.findIndex(i => i.kind === 'serveTarget')
    expect(targetAt).toBeGreaterThan(zoneAt)
    expect(rankOf(found[targetAt])).toBeCloseTo(sureOf(found[targetAt]))
    const mixed = findInsights([...scope, ...serves], 'opp', noWon)
    const firstServe = mixed.findIndex(i => i.kind === 'serveZone' || i.kind === 'serveTarget')
    expect(firstServe).toBeGreaterThan(0)
    expect(mixed.slice(firstServe).every(i => i.kind === 'serveZone' || i.kind === 'serveTarget')).toBe(true)
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

  it('tells a blocker\'s habit from the front row, whichever way it goes', () => {
    // The other team's Zone4 attacks: with #15 in our front row 5 kills in 21, without him 16 in 26.
    // Zone3: with #10 in front 10 in 11, without him 10 in 21.
    const plays: PlayRef[] = []
    const attack = (start: number, front: number[], n: number, kills: number) => {
      for (let i = 0; i < n; i++) {
        const r = ref({ skill: 'A', jersey: 4, start, effect: i < kills ? '#' : '-', team: 'opp' })
        ;(r.play as { front?: string[] }).front = front.map(j => `our${j}`)
        plays.push(r)
      }
    }
    plays.push(ref({ skill: 'S', jersey: 15, team: 'our' }), ref({ skill: 'S', jersey: 10, team: 'our' }))
    attack(4, [15], 21, 5); attack(4, [10], 26, 16)
    attack(3, [10], 11, 10); attack(3, [15], 21, 10)
    const found = findInsights(plays, 'our', noWon, 50).filter(i => i.kind === 'blockFront')
    const z4 = found.find(i => i.subject.startsWith('blockFront|our15|'))!
    expect(z4.headline).toBe('相手の Zone4 からのアタックは#15 N15 が前衛のとき 決定率が 24% に落ちる')
    expect(z4.detail).toBe('21 本中 5 本（#15 N15 が後衛のときは 62%・26 本中 16 本）')
    expect(z4.refs.every(r => r.play.effect !== '#')).toBe(true)
    expect(z4.low).toBe(true)
    expect(z4.paint).toEqual({ zones: [4], side: 'own' })
    const z3 = found.find(i => i.subject.startsWith('blockFront|our10|') && i.headline.includes('Zone3'))!
    expect(z3.headline).toBe('相手の Zone3 からのアタックは#10 N10 が前衛のとき 決定率 91%')
    expect(z3.detail).toBe('11 本中 10 本（#10 N10 が後衛のときは 48%・21 本中 10 本）')
    expect(z3.low).toBeUndefined()
    expect(found.some(i => i.headline.includes('後衛のとき'))).toBe(false)
  })

  it('finds where a server breaks', () => {
    // #12 breaks on 16 of 20 to Zone1, on 4 of 20 to Zone5: half the serves overall, as the team.
    // Each zone is set against the other zones; neither is told from the other zones' side.
    const serves: PlayRef[] = [], won = new Map<number, '*' | 'a'>()
    const serve = (end: number, n: number, breaks: number) => { for (let i = 0; i < n; i++) { const r = rally++; serves.push(ref({ skill: 'S', jersey: 12, end, rally: r })); won.set(r, i < breaks ? 'a' : '*') } }
    serve(1, 20, 16); serve(5, 20, 4)
    const byRally = (r: PlayRef) => (r.play.rallyId === null ? null : won.get(r.play.rallyId) ?? null)
    const found = findInsights(serves, 'opp', byRally, 50).filter(i => i.subject.startsWith('serverBreak|opp|opp12|zone'))
    const up = found.find(i => i.key.endsWith('z1=in|won'))!
    expect(up.headline).toBe('#12 N12 のサーブはZone1 へのサーブのとき ブレイク率 80%')
    expect(up.detail).toBe('20 本中 16 本（ほかのゾーンへのサーブのときは 20%・20 本中 4 本）')
    const down = found.find(i => i.key.endsWith('z3=in|!won'))!
    expect(down.headline).toBe('#12 N12 のサーブはZone5 へのサーブのとき ブレイク率が 20% に落ちる')
    expect(down.refs).toHaveLength(16)
    expect(found.some(i => i.headline.includes('ほかのゾーン'))).toBe(false)
    expect(up.maxP).toBe(0.1)
    // The server as a whole breaks as the team does.
    expect(findInsights(serves, 'opp', byRally, 50).some(i => i.subject === 'serverBreak|opp|opp12')).toBe(false)
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

    // A gap of 10 points is told (the set and the attack come after the reception); one of 5 is not.
    recs.length = 0; out.clear()
    face(22, 1, 100, 60); face(22, 2, 100, 60); face(22, 3, 100, 60); face(22, 4, 200, 144); face(22, 10, 200, 130)
    const near = findInsights(recs, 'opp', r => (r.play.rallyId === null ? null : out.get(r.play.rallyId) ?? null)).filter(i => i.kind === 'receiverSO')
    expect(near.map(i => i.person)).toContain('opp|opp4')
    expect(near.map(i => i.person)).not.toContain('opp|opp10')
  })

  it('finds whether a setter goes back to the attacker who just scored', () => {
    // #4 attacks without a set (scores or errs); in the next rally #1 sets #4 or #3: back to #4 18
    // times in 24 after a score, 4 in 24 after an error.
    const plays: PlayRef[] = []
    const set = (attacker: number) => { const r = rally++; plays.push(ref({ skill: 'E', jersey: 1, phase: 't', rally: r }), ref({ skill: 'A', jersey: attacker, start: attacker, effect: '+', phase: 't', rally: r })) }
    const lead = (effect: string) => plays.push(ref({ skill: 'A', jersey: 4, start: 4, effect, phase: 't' }))
    for (let i = 0; i < 24; i++) { lead('#'); set(i < 18 ? 4 : 3) }
    for (let i = 0; i < 24; i++) { lead('='); set(i < 4 ? 4 : 3) }
    const follow = findInsights(plays, 'opp', noWon).filter(i => i.kind === 'setFollow')
    expect(follow.map(i => i.headline)).toContain('#1 N1 は#4 N4 が決めた直後のとき #4 N4 へ 75%')
    expect(follow.every(i => i.refs.every(r => r.play.skill === 'E'))).toBe(true)
  })

  it('sets the recent matches against the earlier, and the rallies after a timeout against the rest', () => {
    // #9 hits from Zone4 to Zone5 in the newest match, to Zone1 in the three before it.
    const plays: PlayRef[] = []
    for (const [m, end] of [['m1', 1], ['m2', 1], ['m3', 1], ['m4', 5]] as const) for (let i = 0; i < 12; i++) plays.push({ ...ref({ skill: 'A', jersey: 9, start: 4, end, phase: 't' }), matchId: m })
    const index = (id: string) => +id.slice(1)
    const recent = findInsights(plays, 'opp', { wonBy: noWon, matchIndex: index }).find(i => i.kind === 'zoneBy' && i.key.includes('recent=recent'))!
    expect(recent.headline).toBe('#9 N9 の Zone4 からのアタックは直近 1 試合のとき Zone5 へ 100%')
    expect(recent.detail).toBe('12 本中 12 本（それより前の試合のときは 0%・36 本中 0 本）')
    // Without the matches' order, no recent and earlier.
    expect(findInsights(plays, 'opp', noWon).filter(i => i.kind === 'zoneBy')).toEqual([])

    // The team sides out 11 of 12 right after its own timeout, 20 of 40 otherwise.
    const rallies: PlayRef[] = [], won = new Map<number, '*' | 'a'>(), timeout = new Set<number>()
    for (let i = 0; i < 52; i++) {
      const r = rally++
      rallies.push(ref({ skill: 'S', jersey: 20, team: 'our', rally: r }), ref({ skill: 'R', jersey: 5, rally: r }))
      if (i < 12) timeout.add(r)
      won.set(r, (i < 12 ? i < 11 : i % 2 === 0) ? 'a' : '*')
    }
    const by = (r: PlayRef) => (r.play.rallyId === null ? null : won.get(r.play.rallyId) ?? null)
    const flow = findInsights(rallies, 'opp', { wonBy: by, timeoutBy: r => (timeout.has(r.play.rallyId!) ? 'a' : null) }).find(i => i.subject.startsWith('flow|rec'))!
    expect(flow.headline).toBe('相手のサーブのラリーは自分たちのタイムアウト明けのとき サイドアウト率 92%')
  })

  it('leaves out what every team in the league does the same way', () => {
    // On a poor pass every setter goes to Zone4 (32 of 40, against 52% in all): the league's shift +28.
    const sets = (team: 'our' | 'opp', jersey: number, perfect: [number, number, number], poor: [number, number]) => {
      const plays: PlayRef[] = []
      const add = (pass: string, zone: number, n: number) => {
        for (let i = 0; i < n; i++) { const r = rally++; plays.push(ref({ skill: 'E', jersey, team, phase: 'r', recEffect: pass, rally: r }), ref({ skill: 'A', jersey: 10 + zone, team, start: zone, phase: 'r', recEffect: pass, rally: r })) }
      }
      add('#', 4, perfect[0]); add('#', 3, perfect[1]); add('#', 2, perfect[2]); add('-', 4, poor[0]); add('-', 3, poor[1])
      return plays
    }
    const league = leagueOf([1, 2, 3].map(j => ({ scope: sets('our', j, [20, 20, 20], [32, 8]), look: { wonBy: noWon } })), 6)
    expect(league.shift.get('setDist|pass=-|left')?.d).toBeCloseTo(0.28)
    const poorPass = (l: Insight[]) => l.filter(i => i.kind === 'setDist' && i.key.includes('|pass=-|') && !i.key.endsWith('|low'))
    // A setter like the league's: a habit on its own, none beside the league.
    const usual = sets('opp', 7, [20, 20, 20], [32, 8])
    expect(poorPass(findInsights(usual, 'opp', noWon)).map(i => i.headline)).toEqual(['#7 N7 はレセプション「-」のとき Zone4 へ 80%'])
    expect(poorPass(findInsights(usual, 'opp', { wonBy: noWon, league }))).toEqual([])
    // A setter who goes further than the league does stays, with the league's shift in the numbers.
    const keen = poorPass(findInsights(sets('opp', 8, [20, 20, 20], [40, 0]), 'opp', { wonBy: noWon, league }))[0]
    expect(keen.detail).toBe('40 本中 40 本（ふだんは 60%。リーグでは同じ場面で +28 ポイント）')
    expect(keen.league).toBeCloseTo(0.28)
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
    // Less sure all told, it is still listed: its own p is what keeps it.
    expect(among).toBeDefined()
    expect(among!.p).toBeLessThanOrEqual(MAX_P)
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
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '#' })
    const scope = [...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...times(20, () => so(10, 2)), ...times(5, () => so(9, 2))]
    const [top] = findInsights(scope, 'opp', noWon)
    const [plain] = insightReels([top], { mode: 'keyplay', limit: 5, withOthers: false, prefix: 'OPP', order: 'new' })
    expect(plain.name).toBe(`OPP ${top.headline}`)
    expect(plain.cardTitle).toBe(`${top.headline}\n${top.detail}`)
    expect(plain.groups[1]).toHaveLength(5)
    expect(plain.groups[2]).toHaveLength(0)
    expect(plain.markerNames[1]).toBe(top.mark)
    const [both] = insightReels([top], { mode: 'keyplay', limit: null, withOthers: true, prefix: '', order: 'new' })
    expect(both.groups[1]).toHaveLength(top.refs.length)
    expect(both.groups[2]).toHaveLength(top.others.length)
    expect(both.markerNames[2]).toBe('それ以外')
    // Every clip has the habit as its headline, with which way it goes.
    expect(plain.annotations).toHaveLength(1)
    expect(plain.annotations![0]).toMatchObject({ kind: 'text', quick: true, align: 'center', text: `↑ ${top.headline}` })
  })

  it('words the habits in the language chosen for the headlines, the same habits', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '#' })
    const scope = [...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...times(20, () => so(10, 2)), ...times(5, () => so(9, 2))]
    const ja = findInsights(scope, 'opp', noWon)
    const vi = videoInsight('opp', ja, { mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'old', lang: 'en' })
    expect(cleanVideoInsight(JSON.parse(JSON.stringify(vi)))!.lang).toBe('en')
    expect(cleanVideoInsight({ ...vi, lang: 'fr' })!.lang).toBeUndefined()
    for (const l of ['en', 'es'] as const) {
      const [r] = inLang(l, () => insightReels(refindInsights(scope, vi, noWon).insights, vi))
      expect(r.annotations![0]).toMatchObject({ kind: 'text' })
      const text = (r.annotations![0] as { text: string }).text
      expect(text).not.toMatch(/[ぁ-んァ-ン]/)
      expect(r.groups[1]).toHaveLength(ja[0].refs.length)
    }
    expect(getLang()).toBe('ja')
  })

  it('paints the zone a habit is about on each clip, red above usual and blue below', () => {
    // #9 hits from Zone4 to Zone5 11 times in 12; the others spread out.
    const habit = times(12, i => ref({ skill: 'A', jersey: 9, start: 4, end: i < 11 ? 5 : 1, phase: 't' }))
    const plain = times(36, i => ref({ skill: 'A', jersey: 11, start: 4, end: [1, 5, 6][i % 3], phase: 't' }))
    const found = findInsights([...habit, ...plain], 'opp', noWon, 50)
    const up = found.find(i => i.key === 'zone|opp|opp9|4|5')!
    expect(up.low).toBeUndefined()
    expect(up.paint).toEqual({ zones: [5], side: 'other' })
    const fit = { corners: [{ x: 0.36, y: 0.28 }, { x: 0.64, y: 0.28 }, { x: 0.14, y: 0.9 }, { x: 0.86, y: 0.9 }] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }], nearSet1: '*' as const }
    const [r] = insightReels([up], { mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'old' }, undefined, Math.random, { courtOf: () => fit })
    const clip = r.clips[r.groups[1][0]]
    // The attack is the other team's (a), set 1: they are far, so Zone5 is painted on the near half.
    expect(clip.annotations).toHaveLength(1)
    expect(clip.annotations[0]).toMatchObject({ kind: 'polygon', fill: '#DC2626', cell: { row: 5, col: 0, div: 3 } })
    // Without a fitted court nothing is painted.
    const [bare] = insightReels([up], { mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'old' })
    expect(bare.clips[bare.groups[1][0]].annotations).toEqual([])
    // A habit of less: blue, its headline with ↓.
    const low = { ...up, low: true }
    const [down] = insightReels([low], { mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'old' }, undefined, Math.random, { courtOf: () => fit })
    expect(down.clips[down.groups[1][0]].annotations[0]).toMatchObject({ fill: '#2563EB' })
    expect(down.annotations![0]).toMatchObject({ text: `↓ ${up.headline}` })
  })

  it('lays out a scene newest first, oldest first or at random from the matches in turn', () => {
    // Plays 0–2 in the old match, 3–5 in the new one; the search lists the new match first.
    const play = (matchId: string, k: number) => ({ ...ref({ skill: 'A', jersey: 9 }), matchId, play: { id: k } as Play })
    const refs = [play('new', 3), play('new', 4), play('new', 5), play('old', 0), play('old', 1), play('old', 2)]
    const insight = { headline: 'h', detail: 'd', mark: 'm', refs, others: [] } as unknown as Insight
    const index = (id: string) => (id === 'old' ? 0 : 1)
    const ids = (order: InsightOrder, limit: number | null, rand?: () => number) => {
      const [r] = insightReels([insight], { mode: 'keyplay', limit, withOthers: false, prefix: '', order }, index, rand)
      return r.groups[1].map(c => r.clips[c].playId)
    }
    expect(ids('new', null)).toEqual([3, 4, 5, 0, 1, 2])
    expect(ids('new', 4)).toEqual([3, 4, 5, 2]) // the latest four
    expect(ids('old', null)).toEqual([0, 1, 2, 3, 4, 5])
    expect(ids('old', 4)).toEqual([0, 1, 2, 3]) // the earliest four
    // At random, four from two matches are two from each, the matches taking turns.
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < 5; k++) {
      const four = ids('random', 4, rand)
      expect(four.filter(i => i < 3)).toHaveLength(2)
      expect(four[0] < 3).not.toBe(four[1] < 3)
    }
    expect(ids('random', null, rand).sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('finds the habits of a video again by subject, as the matches have them now', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '#' })
    const rest = [6, 5, 4, 3, 2].flatMap(rot => [...times(2, () => so(9, rot)), ...times(6, () => so(10, rot))])
    const before = [...times(14, () => so(9, 1)), ...times(1, () => so(10, 1)), ...rest]
    const rot1 = findInsights(before, 'opp', noWon).find(i => i.subject === 'share|rot1')!
    const vi = videoInsight('opp', [rot1], { mode: 'toEnd', limit: 5, withOthers: true, prefix: 'OPP', order: 'new' })
    expect(vi).toEqual({ team: 'opp', subjects: ['share|rot1'], focus: { skills: [], persons: [] }, mode: 'toEnd', limit: 5, withOthers: true, prefix: 'OPP', order: 'new' })
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
      .toEqual({ team: 'opp', subjects: ['rotWeak|4'], focus: { skills: [], persons: [] }, mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'random' })
    expect(cleanVideoInsight({ subjects: ['a'], focus: { skills: ['A', 'X'], persons: ['opp|opp9', 2] } })?.focus).toEqual({ skills: ['A'], persons: ['opp|opp9'] })
  })

  it('looks at the skills and players asked for only', () => {
    const so = (jersey: number, rot: number) => ref({ skill: 'A', jersey, rot, phase: 'r', recEffect: '#' })
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
    const vi = videoInsight('opp', ten, { mode: 'keyplay', limit: null, withOthers: false, prefix: '', order: 'new' }, { skills: [], persons: ['opp|opp10'] })
    expect(refindInsights(scope, vi, won).insights.map(i => i.key)).toEqual(['share|rot2|opp|opp10'])
  })
})
