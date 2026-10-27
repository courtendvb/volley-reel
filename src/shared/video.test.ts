import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { DEFAULT_OVERLAY, type OverlaySettings } from './overlay'
import { addClips, newReel, newSlide, playOrder, putSlides, toggleMarker, type Reel } from './reel'
import type { Match } from './types'
import { addScene, dropScene, moveSceneAt, newVideo, planVideo, removeSceneAt } from './video'

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
