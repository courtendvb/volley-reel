// Videos (v3): a video is an ordered list of scenes, and a scene is what v2 called a reel (marker
// groups of clips). Scenes are shared: a video only refers to them by id, so fixing a scene fixes
// every video that uses it (design §0). The overlay look belongs to the video.
import { ourSide } from './filter'
import type { OverlayPatch, OverlaySettings } from './overlay'
import { groupOf, markerCardOn, type Clip, type Reel } from './reel'
import type { Match } from './types'

export interface Video {
  id: string
  name: string
  sceneIds: string[] // play order; the same scene may appear in several videos
  overlay?: OverlayPatch // read through overlaySettings()
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

export type Card = { marker: number | null; name: string; match: string | null } // marker null = scene card
export type PlanItem =
  | { kind: 'card'; card: Card; durationSec: number }
  | { kind: 'clip'; clip: Clip; sceneId: string }

// One scene's clips in play order, with a card before each marker group when marker cards are on.
export function planScene(order: Clip[], scene: Reel, overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const out: PlanItem[] = []
  order.forEach((c, i) => {
    const g = groupOf(scene, c.id)
    if (g !== null && g !== 'none' && markerCardOn(scene, g, overlay.titleCard.enabled) && (i === 0 || groupOf(scene, order[i - 1].id) !== g)) {
      out.push({ kind: 'card', card: { marker: g, name: scene.markerNames[g], match: groupMatch(scene, scene.groups[g], matches, ourCodes) }, durationSec: overlay.titleCard.durationSec })
    }
    out.push({ kind: 'clip', clip: c, sceneId: scene.id })
  })
  return out
}

// A whole video: each scene in turn, led by a scene card (the scene's name) when scene cards are on.
// orderOf gives a scene's clips in play order (its scope, minus clips that can't be played).
// Used by both the through-play and the export, so the two never disagree.
export function planVideo(video: Video, scenes: Record<string, Reel>, orderOf: (s: Reel) => Clip[], overlay: OverlaySettings,
  matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const out: PlanItem[] = []
  for (const id of video.sceneIds) {
    const s = scenes[id]
    if (!s) continue
    const order = orderOf(s)
    if (!order.length) continue
    if (overlay.titleCard.sceneCards) {
      const ids = order.map(c => c.id)
      out.push({ kind: 'card', card: { marker: null, name: s.name, match: groupMatch(s, ids, matches, ourCodes) }, durationSec: overlay.titleCard.durationSec })
    }
    out.push(...planScene(order, s, overlay, matches, ourCodes))
  }
  return out
}

// The card's match line, when every clip it introduces comes from one match.
function groupMatch(scene: Reel, clipIds: string[], matches: Record<string, Match>, ourCodes: string[]): string | null {
  const ids = new Set(clipIds.map(id => scene.clips[id]?.matchId).filter(Boolean))
  if (ids.size !== 1) return null
  const m = matches[[...ids][0]!]
  return m ? cardMatchLabel(m, ourCodes) : null
}

// Title card match line: "VS SMT · 2026-10-11".
export function cardMatchLabel(m: Match, codes: string[]): string {
  const side = ourSide(m.teams, codes)
  const opp = side === '*' ? m.teams[1].code : side === 'a' ? m.teams[0].code : `${m.teams[0].code}-${m.teams[1].code}`
  return `VS ${opp}${m.date ? ` · ${m.date}` : ''}`
}
