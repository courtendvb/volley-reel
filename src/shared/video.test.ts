import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { DEFAULT_OVERLAY, type OverlaySettings } from './overlay'
import { addClips, newReel, newSlide, playOrder, putSlides, toggleMarker, type Clip, type Reel } from './reel'
import type { Match } from './types'
import { addScene, chapterMetadata, chapterText, planChapters, dropScene, moveSceneAt, newVideo, planVideo, planVideoChapters, removeSceneAt, sceneFileNames, sharedPrefix, type PlanItem } from './video'

const D = parseDVW(`[3TEAMS]
HTH;HOME;;;;
SMT;AWAY;;;;
[3SCOUT]
*07AQ#PA~36BH1;;;;;;;;1;1;1;1;100;;
*07AQ+PA~36BH1;;;;;;;;1;1;1;1;110;;
*07AQ-PA~36BH1;;;;;;;;1;1;1;1;120;;
*01SQ#~~~16A;;;;;;;;1;1;1;1;130;;
`)
const match = { id: 'M', date: '2026-10-11', teams: D.teams } as unknown as Match
const matches = { M: match }

function scene(name: string, plays: number[], markers: (1 | 2 | null)[]): Reel {
  let r = addClips(newReel(name), plays.map(i => ({ matchId: 'M', play: D.plays[i] }))).reel
  const ids = r.groups.none.slice()
  markers.forEach((m, i) => { if (m) r = toggleMarker(r, ids[i], m) })
  return r
}
const order = (s: Reel) => playOrder(s, c => ['2026-10-11', D.plays[c.playId].time])
const cards = (o: Partial<OverlaySettings['titleCard']>): OverlaySettings => ({ ...DEFAULT_OVERLAY, titleCard: { ...DEFAULT_OVERLAY.titleCard, ...o } })
const describePlan = (items: ReturnType<typeof planVideo>) => items.map(it => it.kind === 'card' ? `[${it.card.marker ?? 'scene'}:${it.card.name}]` : `${D.plays[it.clip.playId].code.slice(0, 6)}`)

describe('videos made of scenes', () => {
  const attack = { ...scene('7番のアタック', [0, 1, 2], [1, 2, 1]), markerNames: { 1: 'Kills', 2: 'Others', 3: '', 4: '', 5: '' } }
  const serve = scene('サーブ', [3], [1])
  const scenes = { [attack.id]: attack, [serve.id]: serve }
  const video = newVideo('7番用', [attack.id, serve.id])

  it('plays scenes in order, each scene by its marker groups', () => {
    expect(describePlan(planVideo(video, scenes, order, cards({ sceneCards: false }), matches, ['HTH']))).toEqual(['*07AQ#', '*07AQ-', '*07AQ+', '*01SQ#'])
  })

  it('puts a scene card before each scene and marker cards inside, when on', () => {
    const plan = planVideo(video, scenes, order, cards({ sceneCards: true, enabled: true }), matches, ['HTH'])
    expect(describePlan(plan)).toEqual(['[scene:7番のアタック]', '[1:Kills]', '*07AQ#', '*07AQ-', '[2:Others]', '*07AQ+', '[scene:サーブ]', '[1:]', '*01SQ#'])
    expect(plan[0]).toMatchObject({ kind: 'card', card: { match: 'VS SMT · 2026-10-11', opp: 'SMT' } })
  })

  it('lets each marker of a scene turn its own card on or off', () => {
    const only2 = { ...attack, markerCards: { 2: true } }
    const plan = planVideo(newVideo('v', [only2.id]), { [only2.id]: only2 }, order, cards({ sceneCards: false, enabled: false }), matches, ['HTH'])
    expect(describePlan(plan)).toEqual(['*07AQ#', '*07AQ-', '[2:Others]', '*07AQ+'])
    const not1 = { ...attack, markerCards: { 1: false } }
    expect(describePlan(planVideo(newVideo('v', [not1.id]), { [not1.id]: not1 }, order, cards({ sceneCards: false, enabled: true }), matches, ['HTH'])))
      .toEqual(['*07AQ#', '*07AQ-', '[2:Others]', '*07AQ+'])
  })

  it('shares scenes: a change to a scene shows in every video that uses it', () => {
    const other = newVideo('サーブ集', [serve.id])
    const fixed = toggleMarker(serve, serve.groups[1][0], null) // unmark the serve: out of scope 'marked'
    const s2 = { ...scenes, [serve.id]: fixed }
    expect(planVideo(video, s2, order, cards({ sceneCards: false }), matches, ['HTH'])).toHaveLength(3)
    expect(planVideo(other, s2, order, cards({ sceneCards: true }), matches, ['HTH'])).toHaveLength(0) // empty scenes get no card
  })

  it('skips scenes that no longer exist', () => {
    expect(planVideo(newVideo('x', ['gone', serve.id]), scenes, order, cards({ sceneCards: false }), matches, ['HTH'])).toHaveLength(1)
  })

  it('starts a chapter at each scene, and at each marker group of a scene with several', () => {
    const { plan, chapters } = planVideoChapters(video, scenes, order, cards({ sceneCards: true, enabled: true, videoCard: true }), matches, ['HTH'])
    expect(describePlan(plan)).toEqual(describePlan(planVideo(video, scenes, order, cards({ sceneCards: true, enabled: true, videoCard: true }), matches, ['HTH'])))
    // The first chapter takes in the opening card; a scene's first group takes in the scene card.
    expect(chapters).toEqual([{ at: 0, title: '7番のアタック - Kills' }, { at: 5, title: '7番のアタック - Others' }, { at: 7, title: 'サーブ' }])
  })
})

describe('YouTube chapters', () => {
  it('writes m:ss (h:mm:ss past an hour), the first at 0:00, and names chapters under 10 seconds', () => {
    const r = chapterText([{ startSec: 2, title: 'A' }, { startSec: 65.9, title: 'B' }, { startSec: 70, title: 'C' }], 130)
    expect(r.text.split('\n\n')[0]).toBe('0:00 A\n1:05 B\n1:10 C')
    expect(r.short).toEqual(['B'])
    expect(chapterText([{ startSec: 0, title: 'A' }, { startSec: 3725, title: 'B' }], 4000).text.split('\n\n')[0]).toBe('0:00:00 A\n1:02:05 B')
  })

  it('adds a link to each chapter, the video ID left as 11 〇 to replace', () => {
    const r = chapterText([{ startSec: 2, title: 'A' }, { startSec: 65.9, title: 'B' }], 130)
    expect(r.text.split('\n\n')[1]).toBe('A\nhttps://youtu.be/〇〇〇〇〇〇〇〇〇〇〇?t=0\nB\nhttps://youtu.be/〇〇〇〇〇〇〇〇〇〇〇?t=65\n')
  })
})

describe('editing a video', () => {
  it('adds, moves and removes scenes by position (a scene may appear twice)', () => {
    let v = newVideo('v', ['a', 'b'])
    v = addScene(v, 'c', 1)
    expect(v.sceneIds).toEqual(['a', 'c', 'b'])
    v = addScene(v, 'a')
    expect(moveSceneAt(v, 3, 0).sceneIds).toEqual(['a', 'a', 'c', 'b'])
    expect(removeSceneAt(v, 0).sceneIds).toEqual(['c', 'b', 'a'])
    expect(dropScene(v, 'a').sceneIds).toEqual(['c', 'b'])
  })
})

describe('card text', () => {
  it('uses the card text when set (line breaks kept), else the name', () => {
    const s = { ...scene('アタック', [0], [1]), cardTitle: '7番\nアタック', markerCardTitles: { 1: '決定' } }
    const v = { ...newVideo('動画', [s.id]), cardTitle: '' }
    const plan = planVideo(v, { [s.id]: s }, order, cards({ sceneCards: true, enabled: true, videoCard: true }), matches, ['HTH'])
    expect(plan.flatMap(it => (it.kind === 'card' ? [it.card.name] : []))).toEqual(['動画', '7番\nアタック', '決定'])
  })
})

describe('slides in the plan', () => {
  const withSlide = (r: Reel, after: string | null, g: 1 | 'none' = 1) => putSlides(r, [{ ...newSlide({ kind: 'blank' }), durationSec: 4 }], { group: g, after, index: 0 })
  const kinds = (items: ReturnType<typeof planVideo>) => items.map(it => (it.kind === 'card' ? (it.card.slide ? 'slide' : `[${it.card.marker ?? 'scene'}]`) : D.plays[it.clip.playId].code.slice(0, 6)))

  it('plays a slide right after its clip, as a card with its own length', () => {
    const s = scene('s', [0, 1], [1, 1])
    const r = withSlide(s, s.groups[1][0])
    const plan = planVideo(newVideo('v', [r.id]), { [r.id]: r }, order, cards({ sceneCards: false, enabled: true }), matches, ['HTH'])
    expect(kinds(plan)).toEqual(['[1]', '*07AQ#', 'slide', '*07AQ+'])
    expect(plan[2]).toMatchObject({ kind: 'card', durationSec: 4 })
  })

  it('plays a scene of only slides', () => {
    const r = withSlide(newReel('only slides'), null)
    const plan = planVideo(newVideo('v', [r.id]), { [r.id]: r }, order, cards({ sceneCards: true, enabled: false }), matches, ['HTH'])
    expect(kinds(plan)).toEqual(['[scene]', 'slide'])
  })

  it('leaves out slides among unmarked clips unless the scene uses them all', () => {
    const s = scene('s', [0, 1], [1, null])
    const r = withSlide(s, s.groups.none[0], 'none')
    const plan = (x: Reel) => kinds(planVideo(newVideo('v', [x.id]), { [x.id]: x }, order, cards({ sceneCards: false, enabled: false }), matches, ['HTH']))
    expect(plan(r)).toEqual(['*07AQ#'])
    expect(plan({ ...r, scope: 'all' })).toEqual(['*07AQ#', '*07AQ+', 'slide'])
  })
})

describe('one file per scene', () => {
  it('names files after the scenes, made safe and unique', () => {
    expect(sceneFileNames(['サーブ', 'A/B: 速攻?', 'サーブ', 'Serve', 'serve', '  ', 'end. ', 'a\\b'])).toEqual(
      ['サーブ', 'A_B_ 速攻_', 'サーブ (2)', 'Serve', 'serve (2)', 'シーン', 'end', 'a_b'])
  })
})

describe('chapters in the MP4', () => {
  it('writes them as ffmpeg metadata: from the start to the end, in ms, every one kept', () => {
    const m = chapterMetadata([{ startSec: 2, title: 'A' }, { startSec: 65.9, title: 'B' }, { startSec: 70, title: 'C' }], 130)
    expect(m.split('\n')).toEqual([
      ';FFMETADATA1',
      '[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=65900', 'title=A',
      '[CHAPTER]', 'TIMEBASE=1/1000', 'START=65900', 'END=70000', 'title=B',
      '[CHAPTER]', 'TIMEBASE=1/1000', 'START=70000', 'END=130000', 'title=C',
      '',
    ])
  })
  it('keeps a title to one line and escapes the signs the format reserves', () => {
    expect(chapterMetadata([{ startSec: 0, title: 'S1 #1\nA=B;C\\D' }], 5)).toContain(String.raw`title=S1 \#1 A\=B\;C\\D` + '\n')
  })
})

describe('chapters for a scene or a marker', () => {
  const scene = { id: 's1', name: 'Serve', markerNames: { 1: 'Jump', 2: 'Float', 3: '', 4: '', 5: '' } } as unknown as Reel
  const other = { id: 's2', name: 'Attack', markerNames: { 1: 'Left', 2: '', 3: '', 4: '', 5: '' } } as unknown as Reel
  const clip = (sceneId: string, group: number | 'none') => ({ kind: 'clip', clip: {} as Clip, sceneId, group }) as PlanItem
  const card = (marker: number | null) => ({ kind: 'card', card: { marker, name: '', match: null }, durationSec: 2 }) as PlanItem
  const slide = { kind: 'card', card: { marker: null, name: '', match: null, slide: {} }, durationSec: 5 } as unknown as PlanItem
  it('starts one at each marker group, a card going with what follows and a slide with what came before', () => {
    const plan = [card(1), clip('s1', 1), clip('s1', 1), slide, card(2), clip('s1', 2)]
    expect(planChapters(plan, { s1: scene })).toEqual([{ at: 0, title: 'Jump' }, { at: 4, title: 'Float' }])
  })
  it('names the scene too across scenes, and gives none for a single part', () => {
    expect(planChapters([clip('s1', 1), clip('s2', 1)], { s1: scene, s2: other }).map(c => c.title)).toEqual(['Serve - Jump', 'Attack - Left'])
    expect(planChapters([card(1), clip('s1', 1), clip('s1', 1)], { s1: scene })).toEqual([])
  })
})


describe('shared prefix of scene names', () => {
  it('finds the words every name starts with', () => {
    expect(sharedPrefix(['HTH ブロック #15 NISHIMOTO', 'HTH ブロック #4 MIWA'])).toBe('HTH ブロック ')
    expect(sharedPrefix(['相手 サイドアウト ローテ 1', '相手 サイドアウト ローテ 6'])).toBe('相手 サイドアウト ローテ ')
  })
  it('leaves something of every name, and nothing for one name', () => {
    expect(sharedPrefix(['HTH ブロック', 'HTH ブロック #4'])).toBe('HTH ')
    expect(sharedPrefix(['HTH ブロック #15'])).toBe('')
    expect(sharedPrefix(['A x', 'B x'])).toBe('')
  })
})
