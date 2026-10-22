// Reel = the blueprint of one highlight video (design §3.4). Pure functions returning new reels,
// so the UI can treat a reel as immutable state and every change is unit-testable.
import type { ParsedDVW, Play } from './types'

export type Marker = 1 | 2 | 3 | 4 | 5
export type Group = Marker | 'none'
export const MARKERS: Marker[] = [1, 2, 3, 4, 5]
export const MARKER_COLORS: Record<Marker, string> = { 1: '#2563EB', 2: '#DC2626', 3: '#16A34A', 4: '#D97706', 5: '#9333EA' }

export interface Clip {
  id: string
  matchId: string
  playId: number
  fingerprint: string // re-links the clip when the DVW is edited and ids shift
  inSec: number | null // video time; null = default rule (rally start)
  outSec: number | null
  annotations: unknown[] // M5
}

export interface Reel {
  id: string
  name: string
  markerNames: Record<Marker, string>
  groupOrder: Marker[]
  groups: Record<Group, string[]> // array order = clip order inside the group ('none' is shown chronologically)
  clips: Record<string, Clip>
  scope: 'marked' | 'all'
  updatedAt: string
}

const uid = () => globalThis.crypto.randomUUID()

export function newReel(name: string): Reel {
  return {
    id: uid(), name,
    markerNames: { 1: '', 2: '', 3: '', 4: '', 5: '' },
    groupOrder: [...MARKERS],
    groups: { 1: [], 2: [], 3: [], 4: [], 5: [], none: [] },
    clips: {}, scope: 'marked', updatedAt: new Date().toISOString(),
  }
}

const touch = (r: Reel): Reel => ({ ...r, updatedAt: new Date().toISOString() })

export function groupOf(reel: Reel, clipId: string): Group | null {
  for (const g of [...MARKERS, 'none'] as Group[]) if (reel.groups[g].includes(clipId)) return g
  return null
}

export function findClip(reel: Reel, matchId: string, playId: number): Clip | undefined {
  return Object.values(reel.clips).find(c => c.matchId === matchId && c.playId === playId)
}

// Adds plays not already in the reel; returns the ids of the clips (new or existing) in input order.
export function addClips(reel: Reel, items: { matchId: string; play: Play }[], group: Group = 'none'): { reel: Reel; ids: string[] } {
  const clips = { ...reel.clips }
  const groups = { ...reel.groups, [group]: [...reel.groups[group]] }
  const ids: string[] = []
  for (const { matchId, play } of items) {
    const existing = Object.values(clips).find(c => c.matchId === matchId && c.playId === play.id)
    if (existing) { ids.push(existing.id); continue }
    const c: Clip = { id: uid(), matchId, playId: play.id, fingerprint: play.fingerprint, inSec: null, outSec: null, annotations: [] }
    clips[c.id] = c
    groups[group].push(c.id)
    ids.push(c.id)
  }
  return { reel: touch({ ...reel, clips, groups }), ids }
}

// Moves a clip to a group (appending by default). Moving into its own group with no index is a no-op.
export function moveClip(reel: Reel, clipId: string, to: Group, index?: number): Reel {
  const from = groupOf(reel, clipId)
  if (!from || (from === to && index === undefined)) return reel
  const groups = { ...reel.groups }
  for (const g of [from, to]) groups[g] = groups[g].filter(id => id !== clipId)
  const target = [...groups[to]]
  target.splice(index === undefined ? target.length : Math.max(0, Math.min(index, target.length)), 0, clipId)
  groups[to] = target
  return touch({ ...reel, groups })
}

// Number keys: the same marker again (or 0 → null) clears it.
export function toggleMarker(reel: Reel, clipId: string, m: Marker | null): Reel {
  const g = groupOf(reel, clipId)
  return moveClip(reel, clipId, m === null || g === m ? 'none' : m)
}

export function shiftClip(reel: Reel, clipId: string, delta: number): Reel {
  const g = groupOf(reel, clipId)
  if (!g || g === 'none') return reel
  const i = reel.groups[g].indexOf(clipId)
  return moveClip(reel, clipId, g, i + delta)
}

export function shiftGroup(reel: Reel, m: Marker, delta: number): Reel {
  const order = reel.groupOrder.filter(x => x !== m)
  const i = Math.max(0, Math.min(reel.groupOrder.indexOf(m) + delta, order.length))
  order.splice(i, 0, m)
  return touch({ ...reel, groupOrder: order })
}

export function placeGroup(reel: Reel, m: Marker, before: Marker | null): Reel {
  const order = reel.groupOrder.filter(x => x !== m)
  order.splice(before === null ? order.length : order.indexOf(before), 0, m)
  return touch({ ...reel, groupOrder: order })
}

export function removeClip(reel: Reel, clipId: string): Reel {
  const clips = { ...reel.clips }
  delete clips[clipId]
  const groups = Object.fromEntries(Object.entries(reel.groups).map(([g, ids]) => [g, ids.filter(id => id !== clipId)])) as Reel['groups']
  return touch({ ...reel, clips, groups })
}

export function renameMarker(reel: Reel, m: Marker, name: string): Reel {
  return touch({ ...reel, markerNames: { ...reel.markerNames, [m]: name } })
}

// Playback / export order: marker groups in groupOrder, then (scope 'all') unmarked clips by
// match date and time. `when` gives a clip's [match date, video time].
export function playOrder(reel: Reel, when: (c: Clip) => [string, number], scope = reel.scope): Clip[] {
  const marked = reel.groupOrder.flatMap(m => reel.groups[m].map(id => reel.clips[id]))
  if (scope === 'marked') return marked
  return [...marked, ...chronological(reel, reel.groups.none, when)]
}

export function chronological(reel: Reel, ids: string[], when: (c: Clip) => [string, number]): Clip[] {
  return ids.map(id => reel.clips[id]).sort((a, b) => {
    const [da, ta] = when(a), [db, tb] = when(b)
    return da.localeCompare(db) || ta - tb
  })
}

// After a DVW is re-read: keep clips whose play still has the same fingerprint, re-point the rest
// by fingerprint, and report those that can't be found (never drop them silently).
export function relink(reel: Reel, dvws: Record<string, ParsedDVW>): { reel: Reel; missing: Set<string>; changed: boolean } {
  const missing = new Set<string>()
  let changed = false
  const clips = { ...reel.clips }
  for (const c of Object.values(reel.clips)) {
    const d = dvws[c.matchId]
    if (!d) { missing.add(c.id); continue }
    if (d.plays[c.playId]?.fingerprint === c.fingerprint) continue
    const p = d.plays.find(x => x.fingerprint === c.fingerprint)
    if (p) { clips[c.id] = { ...c, playId: p.id }; changed = true } else missing.add(c.id)
  }
  return { reel: changed ? { ...reel, clips } : reel, missing, changed }
}

// Default clip range in video time (design §3.5 "ラリー全体"): serve to the last contact. The point
// line is logged ~10s after the last contact (M0 finding), so it is not used for the end.
export const RALLY_LEAD_SEC = 1.5
export const RALLY_TAIL_SEC = 2.5

export function defaultRange(dvw: ParsedDVW, play: Play, offsetSec: number): { in: number; out: number } {
  const r = play.rallyId !== null ? dvw.rallies[play.rallyId] : null
  const [a, b] = r ? [r.serveTime - RALLY_LEAD_SEC, r.lastActionTime + RALLY_TAIL_SEC] : [play.time - 3, play.time + 4]
  return { in: Math.max(0, a + offsetSec), out: b + offsetSec }
}

export function clipRange(c: Clip, dvw: ParsedDVW, offsetSec: number): { in: number; out: number } | null {
  const play = dvw.plays[c.playId]
  if (!play) return null
  const d = defaultRange(dvw, play, offsetSec)
  return { in: c.inSec ?? d.in, out: c.outSec ?? d.out }
}
