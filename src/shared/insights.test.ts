import { describe, expect, it } from 'vitest'
import { cleanVideoInsight, findInsights, inFocus, insightReels, isClutch, refindInsights, videoInsight, zScore, type Insight } from './insights'
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
      id: id++, skill: o.skill, effect: o.effect ?? '+', jersey: o.jersey, phase: o.phase ?? null, recEffect: o.recEffect, startZone: o.start ?? null, endZone: o.end ?? null,
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
