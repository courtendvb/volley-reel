// Videos (v3): a video is an ordered list of scenes, and a scene is what v2 called a reel (marker
// groups of clips). Scenes are shared: a video only refers to them by id, so fixing a scene fixes
// every video that uses it (design §0). The overlay look belongs to the video.
import { ourSide } from './filter'
import type { Annotation } from './annotation'
import type { OverlayPatch, OverlaySettings } from './overlay'
import { markerCardOn, type Clip, type Reel } from './reel'
import type { Match } from './types'

export interface Video {
  id: string
  name: string
  sceneIds: string[] // play order; the same scene may appear in several videos
  overlay?: OverlayPatch // read through overlaySettings()
  annotations?: Annotation[] // objects shown on every clip of the video (表示範囲: 動画全体)
  cardAnnotations?: Annotation[] // objects on the video's title card (its opening card)
  updatedAt: string
}

const uid = () => globalThis.crypto.randomUUID()
const touch = (v: Video): Video => ({ ...v, updatedAt: new Date().toISOString() })

export function newVideo(name: string, sceneIds: string[] = [], overlay?: OverlayPatch): Video {
  return { id: uid(), name, sceneIds: [...sceneIds], overlay, updatedAt: new Date().toISOString() }
}

export function addScene(v: Video, sceneId: string, index = v.sceneIds.length): Video {
  const ids = [...v.sceneIds]
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, sceneId)
  return touch({ ...v, sceneIds: ids })
}

// By position, since the same scene may be in a video twice on purpose.
export function removeSceneAt(v: Video, index: number): Video {
  return touch({ ...v, sceneIds: v.sceneIds.filter((_, i) => i !== index) })
}

export function moveSceneAt(v: Video, from: number, to: number): Video {
  const ids = [...v.sceneIds]
  const [id] = ids.splice(from, 1)
  if (id === undefined) return v
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id)
  return touch({ ...v, sceneIds: ids })
}

// After a scene is deleted, every video drops it.
export function dropScene(v: Video, sceneId: string): Video {
  return v.sceneIds.includes(sceneId) ? touch({ ...v, sceneIds: v.sceneIds.filter(id => id !== sceneId) }) : v
}

// marker null = scene card. opp: the opponent's team code when every clip is from one match (for its logo).
// video: the opening card with the video's name. annotations: objects drawn on the card.
export type Card = { marker: number | null; name: string; match: string | null; opp?: string | null; video?: boolean; annotations?: Annotation[] }
export type PlanItem =
  | { kind: 'card'; card: Card; durationSec: number }
  | { kind: 'clip'; clip: Clip; sceneId: string }

// One scene's clips in play order, with a card before each marker group when marker cards are on.
// order is the scene's play order (playOrder, minus clips that can't be played). A clip with two
// markers is in it twice; walking the groups tells which group each occurrence belongs to.
export function planScene(order: Clip[], scene: Reel, overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const out: PlanItem[] = []
  const playable = new Set(order.map(c => c.id))
  for (const g of scene.groupOrder.filter(m => !scene.markerOff?.[m])) {
    const ids = scene.groups[g].filter(id => playable.has(id))
    if (!ids.length) continue
    if (markerCardOn(scene, g, overlay.titleCard.enabled)) {
      out.push({ kind: 'card', card: { marker: g, name: scene.markerNames[g], ...cardMatch(scene, scene.groups[g], matches, ourCodes), annotations: scene.markerCardAnnotations?.[g] ?? [] }, durationSec: overlay.titleCard.durationSec })
    }
    for (const id of ids) out.push({ kind: 'clip', clip: scene.clips[id], sceneId: scene.id })
  }
  const unmarked = new Set(scene.groups.none)
  for (const c of order) if (unmarked.has(c.id)) out.push({ kind: 'clip', clip: c, sceneId: scene.id })
  return out
}

// A whole video: each scene in turn, led by a scene card (the scene's name) when scene cards are on.
// orderOf gives a scene's clips in play order (its scope, minus clips that can't be played).
// Used by both the through-play and the export, so the two never disagree.
export function planVideo(video: Video, scenes: Record<string, Reel>, orderOf: (s: Reel) => Clip[], overlay: OverlaySettings,
  matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const out: PlanItem[] = []
  if (overlay.titleCard.videoCard) out.push({ kind: 'card', card: videoCard(video, scenes, matches, ourCodes), durationSec: overlay.titleCard.durationSec })
  for (const id of video.sceneIds) {
    const s = scenes[id]
    if (!s) continue
    const order = orderOf(s)
    if (!order.length) continue
    if (s.sceneCard ?? overlay.titleCard.sceneCards) {
      const ids = order.map(c => c.id)
      out.push({ kind: 'card', card: { marker: null, name: s.name, ...cardMatch(s, ids, matches, ourCodes), annotations: s.cardAnnotations ?? [] }, durationSec: overlay.titleCard.durationSec })
    }
    out.push(...planScene(order, s, overlay, matches, ourCodes))
  }
  return out
}

// The video's opening card: its name, and the match line when the whole video is one match.
export function videoCard(video: Video, scenes: Record<string, Reel>, matches: Record<string, Match>, ourCodes: string[]): Card {
  const ids = new Set(video.sceneIds.flatMap(id => Object.values(scenes[id]?.clips ?? {}).map(c => c.matchId)))
  const m = ids.size === 1 ? matches[[...ids][0]] : undefined
  return { marker: null, video: true, name: video.name, match: m ? cardMatchLabel(m, ourCodes) : null, opp: m ? cardOpponent(m, ourCodes) : null, annotations: video.cardAnnotations ?? [] }
}

// The card's match line, when every clip it introduces comes from one match.
export function cardMatch(scene: Reel, clipIds: string[], matches: Record<string, Match>, ourCodes: string[]): { match: string | null; opp: string | null } {
  const ids = new Set(clipIds.map(id => scene.clips[id]?.matchId).filter(Boolean))
  const m = ids.size === 1 ? matches[[...ids][0]!] : undefined
  return m ? { match: cardMatchLabel(m, ourCodes), opp: cardOpponent(m, ourCodes) } : { match: null, opp: null }
}

// The other team's code, or null when neither or both teams are ours.
export function cardOpponent(m: Match, codes: string[]): string | null {
  const side = ourSide(m.teams, codes)
  if (side === null || codes.includes(m.teams[0].code) && codes.includes(m.teams[1].code)) return null
  return side === '*' ? m.teams[1].code : m.teams[0].code
}

// Title card match line: "VS SMT · 2026-10-11".
export function cardMatchLabel(m: Match, codes: string[]): string {
  const side = ourSide(m.teams, codes)
  const opp = side === '*' ? m.teams[1].code : side === 'a' ? m.teams[0].code : `${m.teams[0].code}-${m.teams[1].code}`
  return `VS ${opp}${m.date ? ` · ${m.date}` : ''}`
}
