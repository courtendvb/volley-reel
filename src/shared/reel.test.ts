import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import {
  addClips, clipRange, defaultRange, groupOf, moveClip, newReel, placeGroup, playOrder, relink, removeClip,
  shiftClip, shiftGroup, toggleMarker, type Reel,
} from './reel'

const DVW = `[3TEAMS]
HTH;HOME;;;;
OPP;AWAY;;;;
[3SCOUT]
*01SQ-~~~16A;;;;;;;;1;1;1;1;100;;
a09RQ+~~~16AR;;;;;;;;1;1;1;1;102;;
a01AQ#PA~36BH1;;;;;;;;1;1;1;1;104;;
ap00:01;;;;;;;;1;1;1;1;114;;
a01SQ=~~~15B;;;;;;;;1;1;2;1;130;;
*p01:01;;;;;;;;1;1;2;1;140;;
*02SM#~~~16D;;;;;;;;1;1;2;1;150;;
`
const d = parseDVW(DVW)
const items = (ids: number[], matchId = 'A') => ids.map(i => ({ matchId, play: d.plays[i] }))

function reelWith(ids: number[]): { reel: Reel; c: string[] } {
  const { reel, ids: c } = addClips(newReel('r'), items(ids))
  return { reel, c }
}

describe('adding clips', () => {
  it('puts new clips in the unmarked group and skips plays already in the reel', () => {
    const { reel, c } = reelWith([0, 2])
    const again = addClips(reel, items([2, 4]))
    expect(Object.keys(again.reel.clips)).toHaveLength(3)
    expect(again.ids[0]).toBe(c[1])
    expect(again.reel.groups.none).toHaveLength(3)
  })

  it('treats the same play id in another match as a different clip', () => {
    const { reel } = reelWith([0])
    expect(Object.keys(addClips(reel, items([0], 'B')).reel.clips)).toHaveLength(2)
  })
})

describe('markers', () => {
  it('moves a clip into a marker group, and the same number again clears it', () => {
    const { reel, c } = reelWith([0, 2])
    const r1 = toggleMarker(reel, c[0], 3)
    expect(groupOf(r1, c[0])).toBe(3)
    expect(groupOf(toggleMarker(r1, c[0], 3), c[0])).toBe('none')
    expect(groupOf(toggleMarker(r1, c[0], null), c[0])).toBe('none')
  })

  it('switching markers appends to the end of the new group', () => {
    let { reel, c } = reelWith([0, 2, 4])
    reel = toggleMarker(toggleMarker(reel, c[0], 1), c[1], 2)
    reel = toggleMarker(reel, c[2], 1)
    reel = toggleMarker(reel, c[1], 1)
    expect(reel.groups[1]).toEqual([c[0], c[2], c[1]])
    expect(reel.groups[2]).toEqual([])
  })
})

describe('reordering', () => {
  it('shifts a clip inside its group and clamps at the ends', () => {
    let { reel, c } = reelWith([0, 2, 4])
    for (const id of c) reel = toggleMarker(reel, id, 1)
    expect(shiftClip(reel, c[2], -1).groups[1]).toEqual([c[0], c[2], c[1]])
    expect(shiftClip(reel, c[0], -1).groups[1]).toEqual(c)
  })

  it('drops a clip at an index in another group', () => {
    let { reel, c } = reelWith([0, 2, 4])
    reel = toggleMarker(toggleMarker(toggleMarker(reel, c[0], 1), c[1], 1), c[2], 2)
    expect(moveClip(reel, c[2], 1, 1).groups[1]).toEqual([c[0], c[2], c[1]])
  })

  it('reorders marker groups', () => {
    const { reel } = reelWith([0])
    expect(shiftGroup(reel, 3, -2).groupOrder).toEqual([3, 1, 2, 4, 5])
    expect(placeGroup(reel, 1, 4).groupOrder).toEqual([2, 3, 1, 4, 5])
    expect(placeGroup(reel, 1, null).groupOrder).toEqual([2, 3, 4, 5, 1])
  })

  it('removes a clip from the reel and its group', () => {
    let { reel, c } = reelWith([0, 2])
    reel = toggleMarker(reel, c[0], 1)
    reel = removeClip(reel, c[0])
    expect(reel.clips[c[0]]).toBeUndefined()
    expect(reel.groups[1]).toEqual([])
  })
})

describe('play order', () => {
  it('plays marker groups in group order, then unmarked clips chronologically when scope is all', () => {
    let { reel, c } = reelWith([4, 0, 2, 1])
    reel = toggleMarker(reel, c[2], 2)
    reel = toggleMarker(reel, c[0], 1)
    reel = shiftGroup(reel, 2, -1) // 2 before 1
    const when = (x: { playId: number }) => ['2026-10-11', d.plays[x.playId].time] as [string, number]
    expect(playOrder(reel, when, 'marked').map(x => x.playId)).toEqual([2, 4])
    expect(playOrder(reel, when, 'all').map(x => x.playId)).toEqual([2, 4, 0, 1])
  })
})

describe('relink', () => {
  it('re-points clips by fingerprint when ids shift and reports the ones that vanished', () => {
    const { reel, c } = reelWith([2, 4])
    const edited = parseDVW(DVW.replace('*01SQ-', '*01SQ-~~~16A;;;;;;;;1;1;1;1;99;;\n*03SQ-'))
    const r = relink(reel, { A: edited })
    expect(r.changed).toBe(true)
    expect(edited.plays[r.reel.clips[c[0]].playId].fingerprint).toBe(d.plays[2].fingerprint)
    expect(relink(reel, { A: parseDVW(DVW.replace('a01AQ#', 'a01AQ+')) }).missing.has(c[0])).toBe(true)
    expect(relink(reel, {}).missing.size).toBe(2)
  })
})

describe('clip ranges', () => {
  it('defaults to serve - 1.5s → last contact + 2.5s, ignoring the late point line', () => {
    expect(defaultRange(d, d.plays[2], 0)).toEqual({ in: 98.5, out: 106.5 })
    expect(defaultRange(d, d.plays[2], 10)).toEqual({ in: 108.5, out: 116.5 })
  })

  it('uses per-clip IN/OUT when set', () => {
    const { reel, c } = reelWith([2])
    expect(clipRange({ ...reel.clips[c[0]], outSec: 110 }, d, 0)).toEqual({ in: 98.5, out: 110 })
  })
})
