import { describe, expect, it } from 'vitest'
import { cardPlayers, cardTeams, fillFrames, fillPlanFrames, topPhoto } from './cardPeople'
import { coverCrop, type Annotation } from './annotation'
import type { PlanItem } from './video'
import type { ParsedDVW } from './types'

const d = {
  teams: [{ code: 'hth', name: 'Hiroshima' }, { code: 'okb', name: 'Okayama' }],
  players: {
    '*4': { key: 'A', side: '*', jersey: 4, lastName: 'Miwa', firstName: '' }, '*21': { key: 'B', side: '*', jersey: 21, lastName: 'Eiro', firstName: '' },
    a6: { key: 'C', side: 'a', jersey: 6, lastName: 'Kim', firstName: '' },
  },
  plays: [{ side: '*', jersey: 4 }, { side: '*', jersey: 4 }, { side: 'a', jersey: 6 }, { side: '*', jersey: 99 }],
} as unknown as ParsedDVW

describe('cardPlayers', () => {
  it("lists the clips' players, the most clips first, then the matches' other players", () => {
    const list = cardPlayers([{ matchId: 'm', playId: 2 }, { matchId: 'm', playId: 0 }, { matchId: 'm', playId: 1 }, { matchId: 'x', playId: 0 }], { m: d })
    expect(list.map(p => [p.team, p.player.jersey, p.clips])).toEqual([['HTH', 4, 2], ['OKB', 6, 1], ['HTH', 21, 0]])
  })
})

describe('cardTeams', () => {
  it("lists the matches' teams, the team with the most clips first", () => {
    expect(cardTeams([{ matchId: 'm', playId: 2 }], { m: d }).map(t => [t.code, t.clips])).toEqual([['OKB', 1], ['HTH', 0]])
    expect(cardTeams([], { m: d })).toEqual([])
  })
})

describe('photo frames', () => {
  const frame = { id: 'f', kind: 'image', color: '#FFFFFF', x: 0, y: 0, w: 0.1, h: 0.2, assetId: 'frame:top', frame: 'top', fit: 'cover' } as Annotation
  const text = { id: 't', kind: 'text', color: '#FFFFFF', x: 0, y: 0, text: 'x', size: 20 } as Annotation
  it('fill with the photo, or leave the card without the frame', () => {
    expect(fillFrames([frame, text], 'pack:p/a.png')).toEqual([{ ...frame, assetId: 'pack:p/a.png' }, text])
    expect(fillFrames([frame, text], null)).toEqual([text])
    const plain = [text]
    expect(fillFrames(plain, null)).toBe(plain)
  })
  it("fill a plan's cards, asking only for cards with a frame", () => {
    const asked: (number | null)[] = []
    const plan = [
      { kind: 'card', card: { marker: 1, name: '', match: null, annotations: [frame] }, durationSec: 2 },
      { kind: 'card', card: { marker: 2, name: '', match: null, annotations: [text] }, durationSec: 2 },
    ] as PlanItem[]
    const out = fillPlanFrames(plan, c => { asked.push(c.marker); return 'pack:p/b.png' })
    expect(asked).toEqual([1])
    expect(out[0].kind === 'card' && out[0].card.annotations?.[0].kind === 'image' && out[0].card.annotations[0].assetId).toBe('pack:p/b.png')
    expect(out[1]).toBe(plan[1])
  })
  it("take the photo of the clips' player with the most clips who has one", () => {
    const clips = [{ matchId: 'm', playId: 0 }, { matchId: 'm', playId: 1 }, { matchId: 'm', playId: 2 }]
    expect(topPhoto(clips, { m: d }, p => `pack:p/${p.player.jersey}.png`)).toBe('pack:p/4.png')
    expect(topPhoto(clips, { m: d }, p => (p.player.jersey === 4 ? null : `pack:p/${p.player.jersey}.png`))).toBe('pack:p/6.png')
    expect(topPhoto(clips, { m: d }, () => null)).toBeNull()
  })
  it('cut a picture to fill its box', () => {
    expect(coverCrop(300, 400, 300, 400)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(coverCrop(400, 400, 200, 400)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
    expect(coverCrop(400, 400, 400, 200)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 })
  })
})
