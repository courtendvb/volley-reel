import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import {
  addClips, clipRange, defaultRange, groupOf, markersOf, moveClip, newReel, placeGroup, playOrder, relink, removeClip,
  setServeSpeed, setSkillTime, toggleMarker, trimClip, findOverlaps, rangeDefaults, DEFAULT_RANGE, MIN_CLIP_SEC, parseFingerprint, type Reel,
  chronological, groupRows, newSlide, putSlides, removeSlide, setSlide, spotAt, setTag, sortByTag, clipEdits,
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

  it('adds a second marker at the end of that group and keeps the first', () => {
    let { reel, c } = reelWith([0, 2, 4])
    reel = toggleMarker(toggleMarker(reel, c[0], 1), c[1], 2)
    reel = toggleMarker(reel, c[2], 1)
    reel = toggleMarker(reel, c[1], 1)
    expect(reel.groups[1]).toEqual([c[0], c[2], c[1]])
    expect(reel.groups[2]).toEqual([c[1]])
    expect(markersOf(reel, c[1])).toEqual([1, 2])
    expect(reel.groups.none).toEqual([])
  })

  it('puts a newly marked clip into the group in time order', () => {
    let { reel, c } = reelWith([0, 2, 4])
    const when = (cl: { playId: number }): [string, number] => ['2026-10-11', d.plays[cl.playId].time]
    reel = toggleMarker(toggleMarker(reel, c[0], 1, when), c[2], 1, when)
    reel = toggleMarker(reel, c[1], 1, when) // between the two in time
    expect(reel.groups[1]).toEqual([c[0], c[1], c[2]])
  })

  it('takes one marker off and keeps the other; with none left the clip is unmarked', () => {
    let { reel, c } = reelWith([0])
    reel = toggleMarker(toggleMarker(reel, c[0], 1), c[0], 3)
    expect(markersOf(toggleMarker(reel, c[0], 1), c[0])).toEqual([3])
    expect(toggleMarker(toggleMarker(reel, c[0], 1), c[0], 3).groups.none).toEqual([c[0]])
    expect(toggleMarker(reel, c[0], null).groups.none).toEqual([c[0]])
  })

  it('plays a clip once in each of its groups', () => {
    let { reel, c } = reelWith([0, 2])
    reel = toggleMarker(toggleMarker(toggleMarker(reel, c[0], 1), c[0], 2), c[1], 1)
    expect(playOrder(reel, cl => ['2026-10-11', d.plays[cl.playId].time], 'marked').map(x => x.playId)).toEqual([0, 2, 0])
  })

  it('moves a clip out of one group by dragging, keeping its other marker', () => {
    let { reel, c } = reelWith([0])
    reel = toggleMarker(toggleMarker(reel, c[0], 1), c[0], 2)
    const r = moveClip(reel, c[0], 4, undefined, 2)
    expect(markersOf(r, c[0])).toEqual([1, 4])
  })
})

describe('reordering', () => {
  it('moves a clip inside its group and clamps at the ends', () => {
    let { reel, c } = reelWith([0, 2, 4])
    for (const id of c) reel = toggleMarker(reel, id, 1)
    expect(moveClip(reel, c[2], 1, 1).groups[1]).toEqual([c[0], c[2], c[1]])
    expect(moveClip(reel, c[0], 1, -1).groups[1]).toEqual(c)
  })

  it('drops a clip at an index in another group', () => {
    let { reel, c } = reelWith([0, 2, 4])
    reel = toggleMarker(toggleMarker(toggleMarker(reel, c[0], 1), c[1], 1), c[2], 2)
    expect(moveClip(reel, c[2], 1, 1).groups[1]).toEqual([c[0], c[2], c[1]])
  })

  it('reorders marker groups', () => {
    const { reel } = reelWith([0])
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
    reel = placeGroup(reel, 2, 1) // 2 before 1
    const when = (x: { playId: number }) => ['2026-10-11', d.plays[x.playId].time] as [string, number]
    expect(playOrder(reel, when, 'marked').map(x => x.playId)).toEqual([2, 4])
    expect(playOrder(reel, when, 'all').map(x => x.playId)).toEqual([2, 4, 0, 1])
  })
})

describe('marker groups switched off', () => {
  it('are left out of the play order but keep their clips', () => {
    const { reel, c } = reelWith([2, 4])
    let r = toggleMarker(toggleMarker(reel, c[0], 1), c[1], 2)
    r = { ...r, markerOff: { 1: true } }
    expect(playOrder(r, cl => ['2026-10-11', d.plays[cl.playId].time], 'all').map(x => x.playId)).toEqual([4])
    expect(r.groups[1]).toEqual([c[0]])
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

describe('range defaults and trimming', () => {
  const play = d.plays[2] // attack at 104 in the rally served at 100, last contact 104

  it('switches between rally and key-play defaults', () => {
    expect(defaultRange(d, play, 0, { ...DEFAULT_RANGE, mode: 'keyplay' })).toEqual({ in: 101, out: 108 })
    expect(defaultRange(d, play, 0, { ...DEFAULT_RANGE, rallyLead: 3, rallyTail: 1 })).toEqual({ in: 97, out: 105 })
  })

  it('cuts a clip by its own mode when it has one', () => {
    expect(defaultRange(d, d.plays[0], 0, DEFAULT_RANGE, 'toEnd')).toEqual({ in: 97, out: 106.5 }) // serve at 100 → rally end
    const { reel, c } = reelWith([2])
    expect(clipRange({ ...reel.clips[c[0]], mode: 'keyplay' }, d, 0)).toEqual({ in: 101, out: 108 })
  })

  it('reads reels saved before range defaults existed', () => {
    const { reel } = reelWith([2])
    const { rangeDefaults: _, ...old } = reel
    expect(rangeDefaults(old as Reel)).toEqual(DEFAULT_RANGE)
  })

  it('sets IN/OUT, clamps to keep a minimum length, and stores the default as null', () => {
    const { reel, c } = reelWith([2])
    const def = defaultRange(d, play, 0)
    const cur = { ...def }
    let r = trimClip(reel, c[0], 'in', 100.25, cur, def)
    expect(r.clips[c[0]].inSec).toBe(100.25)
    r = trimClip(reel, c[0], 'in', 200, cur, def)
    expect(r.clips[c[0]].inSec).toBe(def.out - MIN_CLIP_SEC)
    r = trimClip(reel, c[0], 'out', 50, cur, def, 105)
    expect(r.clips[c[0]].outSec).toBe(def.in + MIN_CLIP_SEC)
    expect(trimClip(reel, c[0], 'out', 999, cur, def, 105).clips[c[0]].outSec).toBe(105)
    expect(trimClip(reel, c[0], 'in', def.in, cur, def).clips[c[0]].inSec).toBeNull()
    expect(trimClip(r, c[0], 'out', null, cur, def).clips[c[0]].outSec).toBeNull()
  })

  it('finds overlapping clips within a match only', () => {
    const o = findOverlaps([
      { id: 'a', matchId: 'M', in: 0, out: 10 },
      { id: 'b', matchId: 'M', in: 8, out: 12 },
      { id: 'c', matchId: 'M', in: 12, out: 15 },
      { id: 'd', matchId: 'N', in: 9, out: 11 },
    ])
    expect(o.get('a')).toEqual(['b'])
    expect(o.get('b')).toEqual(['a'])
    expect(o.has('c')).toBe(false)
    expect(o.has('d')).toBe(false)
  })
})

describe('relink after scout fixes', () => {
  const ids = (r: Reel) => Object.values(r.clips).map(c => c.playId)

  it('follows plays when an added point shifts every later score', () => {
    const { reel } = reelWith([3, 4]) // a01S= (130) and *02S# in the next rally
    // A missed point inserted before the second rally: later scores move by one.
    const fixed = parseDVW(DVW.replace('a01SQ=~~~15B', '*p01:00;;;;;;;;1;1;1;1;125;;\na01SQ=~~~15B'))
    const r = relink(reel, { A: fixed })
    expect(r.missing.size).toBe(0)
    expect([...r.how.values()]).toContain('code+time')
    expect(ids(r.reel).map(i => fixed.plays[i].code.slice(0, 6))).toEqual(['a01SQ=', '*02SM#'])
  })

  it('follows a play whose timestamp was nudged, and updates the stored fingerprint', () => {
    const { reel, c } = reelWith([2])
    const fixed = parseDVW(DVW.replace(';1;1;1;1;104;;\nap00:01', ';1;1;1;1;105;;\nap00:01'))
    const r = relink(reel, { A: fixed })
    expect(r.how.get(c[0])).toBe('code+near-time')
    expect(r.reel.clips[c[0]].fingerprint).toBe(fixed.plays[r.reel.clips[c[0]].playId].fingerprint)
    expect(relink(r.reel, { A: fixed }).how.get(c[0])).toBe('id') // exact from now on
  })

  it('reports plays that were deleted or changed code rather than guessing', () => {
    const { reel, c } = reelWith([2])
    expect(relink(reel, { A: parseDVW(DVW.replace('a01AQ#PA~36BH1', 'a01AQ+PA~36BH1')) }).missing.has(c[0])).toBe(true)
    expect(relink(reel, { A: parseDVW(DVW.replace(';1;1;1;1;104;;\nap00:01', ';1;1;1;1;109;;\nap00:01')) }).missing.has(c[0])).toBe(true)
  })

  it('parses fingerprints', () => {
    expect(parseFingerprint('2|10-08|*01SQ#~~~16D|1234.5')).toEqual({ setNum: 2, code: '*01SQ#~~~16D', time: 1234.5 })
    expect(parseFingerprint('junk')).toBeNull()
  })
})

// Real files stay out of git; point VR_DVW_DIR at a folder of .dvw to run this.
const realDir = process.env.VR_DVW_DIR
describe.skipIf(!realDir)('relink on real DVW files after an added point', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const files = realDir ? fs.readdirSync(realDir).filter(f => f.toLowerCase().endsWith('.dvw')) : []
  it.each(files)('%s', f => {
    const text = fs.readFileSync(path.join(realDir!, f), 'latin1')
    const before = parseDVW(text)
    // Insert a home point right after the first point line of the file: every later score shifts.
    const lines = text.split(/\r?\n/)
    const at = lines.findIndex(l => /^[*a]p\d+:\d+/i.test(l))
    if (at < 0) return
    const extra = lines[at].replace(/^[*a]p(\d+):(\d+)/i, (_, h, a) => `*p${String(+h + 1).padStart(2, '0')}:${a}`)
    const after = parseDVW([...lines.slice(0, at + 1), extra, ...lines.slice(at + 1)].join('\n'))
    const { reel } = addClips(newReel('r'), before.plays.map(p => ({ matchId: 'M', play: p })))
    const r = relink(reel, { M: after })
    const lost = r.missing.size / before.plays.length
    expect(lost).toBeLessThan(0.01) // ambiguous duplicates (same code, same second) may stay unresolved
    for (const c of Object.values(r.reel.clips)) {
      if (r.missing.has(c.id)) continue
      const was = before.plays[reel.clips[c.id].playId], now = after.plays[c.playId]
      expect([now.code, now.time]).toEqual([was.code, was.time])
    }
  })
})

describe('slides', () => {
  const blank = () => newSlide({ kind: 'blank' })
  const marked = () => {
    let { reel, c } = reelWith([0, 2, 4])
    for (const id of c) reel = toggleMarker(reel, id, 1)
    return { reel, c }
  }
  const listed = (r: Reel, g: 1 | 'none' = 1) => groupRows(r, g).map(x => (x.kind === 'clip' ? x.id : `s:${x.slide.id}`))

  it('sits after a clip (or at the head) and lists in place', () => {
    const { reel, c } = marked()
    const [a, b] = [blank(), blank()]
    let r = putSlides(reel, [a], { group: 1, after: c[0], index: 0 })
    r = putSlides(r, [b], { group: 1, after: null, index: 0 })
    expect(listed(r)).toEqual([`s:${b.id}`, c[0], `s:${a.id}`, c[1], c[2]])
  })

  it('turns a row position into a spot, counting slides after the clip above', () => {
    const { reel, c } = marked()
    const [a, b] = [blank(), blank()]
    const r = putSlides(reel, [a, b], { group: 1, after: c[0], index: 0 })
    const rows = groupRows(r, 1)
    expect(spotAt(rows, 1, 0)).toEqual({ group: 1, after: null, index: 0 })
    expect(spotAt(rows, 1, 2)).toEqual({ group: 1, after: c[0], index: 1 })
    expect(spotAt(rows, 1, 4)).toEqual({ group: 1, after: c[1], index: 0 })
  })

  it('moves a slide to another spot', () => {
    const { reel, c } = marked()
    const a = blank()
    let r = putSlides(reel, [a], { group: 1, after: c[0], index: 0 })
    r = putSlides(r, [r.slides![0]], { group: 1, after: c[2], index: 0 })
    expect(listed(r)).toEqual([c[0], c[1], c[2], `s:${a.id}`])
    expect(r.slides).toHaveLength(1)
  })

  it('follows its clip when the clip is reordered', () => {
    const { reel, c } = marked()
    const a = blank()
    const r = moveClip(putSlides(reel, [a], { group: 1, after: c[0], index: 0 }), c[0], 1, 3)
    expect(listed(r)).toEqual([c[1], c[2], c[0], `s:${a.id}`])
  })

  it('stays in place, after the clip before, when its clip leaves the group', () => {
    const { reel, c } = marked()
    const [a, b] = [blank(), blank()]
    let r = putSlides(reel, [a], { group: 1, after: c[0], index: 0 })
    r = putSlides(r, [b], { group: 1, after: c[1], index: 0 })
    r = removeClip(r, c[1])
    expect(listed(r)).toEqual([c[0], `s:${a.id}`, `s:${b.id}`, c[2]])
    r = toggleMarker(r, c[0], 1) // the first clip loses marker 1: its slides go to the head
    expect(listed(r)).toEqual([`s:${a.id}`, `s:${b.id}`, c[2]])
  })

  it('is removed and changed by id', () => {
    const { reel, c } = marked()
    const a = blank()
    let r = putSlides(reel, [a], { group: 1, after: c[0], index: 0 })
    r = setSlide(r, { ...r.slides![0], durationSec: 5 })
    expect(r.slides![0].durationSec).toBe(5)
    expect(removeSlide(r, a.id).slides).toEqual([])
  })
})

describe('tags', () => {
  it('sets, trims and clears a tag', () => {
    const { reel, c } = reelWith([1, 2])
    const r = setTag(reel, c[0], '  A12345 ')
    expect(r.clips[c[0]].tag).toBe('A123')
    expect('tag' in setTag(r, c[0], '').clips[c[0]]).toBe(false)
    expect(setTag(r, c[0], 'A123')).toBe(r)
  })
  it('sorts a group by tag, numbers in number order, untagged last, ties kept', () => {
    let { reel, c } = reelWith([0, 1, 2, 3, 4])
    for (const id of c) reel = toggleMarker(reel, id, 1)
    reel = setTag(reel, c[0], '10')
    reel = setTag(reel, c[2], '2')
    reel = setTag(reel, c[3], '2')
    reel = setTag(reel, c[4], 'A')
    const r = sortByTag(reel, 1)
    expect(r.groups[1]).toEqual([c[2], c[3], c[0], c[4], c[1]])
    expect(sortByTag(r, 1)).toBe(r)
  })
})

describe('setSkillTime', () => {
  it('moves the red line of a clip and puts it back', () => {
    const { reel, ids } = addClips(newReel('x'), [{ matchId: 'm', play: { id: 1, fingerprint: 'f', time: 10, rallyId: 1 } as never }])
    const moved = setSkillTime(reel, ids[0], 12.4)
    expect(moved.clips[ids[0]].skillSec).toBe(12.4)
    expect('skillSec' in setSkillTime(moved, ids[0], null).clips[ids[0]]).toBe(false)
    expect(setSkillTime(reel, 'nope', 1)).toBe(reel)
  })
})

describe('setServeSpeed', () => {
  it('sets a clip serve speed and takes it off', () => {
    const { reel, ids } = addClips(newReel('x'), [{ matchId: 'm', play: { id: 1, fingerprint: 'f', time: 10, rallyId: 1 } as never }])
    const fast = setServeSpeed(reel, ids[0], 95)
    expect(fast.clips[ids[0]].speedKmh).toBe(95)
    expect('speedKmh' in setServeSpeed(fast, ids[0], null).clips[ids[0]]).toBe(false)
  })
})

describe('ungrouped clips by tag', () => {
  const reel = (noneByTag: boolean) => {
    let r = addClips(newReel('t'), [10, 20, 30, 40].map(id => ({ matchId: 'm', play: { id, time: id, fingerprint: `f${id}` } as never }))).reel
    const ids = r.groups.none
    r = setTag(setTag(setTag(r, ids[0], 'B'), ids[1], '10'), ids[3], '2')
    return { ...r, noneByTag }
  }
  const when = (c: { playId: number }): [string, number] => ['m', c.playId]
  const tags = (r: ReturnType<typeof reel>) => chronological(r, r.groups.none, when).map(c => c.tag ?? '')
  it('goes numbers, letters, then untagged, and back to time order when off', () => {
    expect(tags(reel(true))).toEqual(['2', '10', 'B', ''])
    expect(tags(reel(false))).toEqual(['B', '10', '', '2'])
  })
})

describe('marks of what was done to a clip', () => {
  it('names the headline, counts the other objects, and notes slow / hold and overlay changes', () => {
    const { reel, c } = reelWith([0])
    const clip = reel.clips[c[0]]
    expect(clipEdits(clip)).toEqual({ headline: null, objects: 0, timing: false, overlay: false })
    const done = {
      ...clip,
      annotations: [
        { id: 'h', kind: 'text', color: '#FFF', x: 0.5, y: 0.05, text: 'SIDE OUT', size: 48, quick: true },
        { id: 'a', kind: 'arrow', color: '#FFF', width: 4, from: [0, 0], to: [1, 1] },
      ],
      timing: { holds: [{ at: 101, sec: 1 }] },
      overlayOverride: { scoreboard: { hidden: true } },
    } as unknown as typeof clip
    expect(clipEdits(done)).toEqual({ headline: 'SIDE OUT', objects: 1, timing: true, overlay: true })
  })
})
