// Reel = the blueprint of one highlight video (design §3.4). Pure functions returning new reels,
// so the UI can treat a reel as immutable state and every change is unit-testable.
import { roundCoords, type Annotation } from './annotation'
import type { ClipOverlayOverride, OverlaySettings } from './overlay'
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
  annotations: Annotation[] // design §3.6; times are absolute video times
  overlayOverride?: ClipOverlayOverride // design §3.7: hide an auto element or rewrite the caption
}

export interface Reel {
  id: string
  name: string
  markerNames: Record<Marker, string>
  groupOrder: Marker[]
  groups: Record<Group, string[]> // array order = clip order inside the group ('none' is shown chronologically)
  clips: Record<string, Clip>
  scope: 'marked' | 'all'
  rangeDefaults?: RangeDefaults // added in M4; read through rangeDefaults()
  overlay?: Partial<OverlaySettings> // added in M6; read through overlaySettings()
  updatedAt: string
}

const uid = () => globalThis.crypto.randomUUID()

export function newReel(name: string): Reel {
  return {
    id: uid(), name,
    markerNames: { 1: '', 2: '', 3: '', 4: '', 5: '' },
    groupOrder: [...MARKERS],
    groups: { 1: [], 2: [], 3: [], 4: [], 5: [], none: [] },
    clips: {}, scope: 'marked', rangeDefaults: { ...DEFAULT_RANGE }, updatedAt: new Date().toISOString(),
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

// ---- clip ranges (design §3.5) -----------------------------------------------------------
// All times are video times. "rally": first serve - lead → last contact + tail (the point line is
// logged ~10s after the last contact, M0 finding, so it is not used). "keyplay": key play ± seconds.
export interface RangeDefaults {
  mode: 'rally' | 'keyplay'
  rallyLead: number
  rallyTail: number
  keyBefore: number
  keyAfter: number
}

export const DEFAULT_RANGE: RangeDefaults = { mode: 'rally', rallyLead: 1.5, rallyTail: 2.5, keyBefore: 3, keyAfter: 4 }
export const MIN_CLIP_SEC = 0.5

// Reels saved before M4 have no rangeDefaults.
export function rangeDefaults(r: Reel): RangeDefaults {
  return { ...DEFAULT_RANGE, ...(r.rangeDefaults ?? {}) }
}

export function defaultRange(dvw: ParsedDVW, play: Play, offsetSec: number, d: RangeDefaults = DEFAULT_RANGE): { in: number; out: number } {
  const r = play.rallyId !== null ? dvw.rallies[play.rallyId] : null
  const [a, b] = d.mode === 'rally' && r
    ? [r.serveTime - d.rallyLead, r.lastActionTime + d.rallyTail]
    : [play.time - d.keyBefore, play.time + d.keyAfter]
  return { in: Math.max(0, a + offsetSec), out: b + offsetSec }
}

export function clipRange(c: Clip, dvw: ParsedDVW, offsetSec: number, d: RangeDefaults = DEFAULT_RANGE): { in: number; out: number } | null {
  const play = dvw.plays[c.playId]
  if (!play) return null
  const def = defaultRange(dvw, play, offsetSec, d)
  return { in: c.inSec ?? def.in, out: c.outSec ?? def.out }
}

// Sets IN or OUT (null = back to the default) while keeping the clip at least MIN_CLIP_SEC long:
// an IN past the OUT pushes nothing — it is clamped instead, so a stray key press can't flip the clip.
export function trimClip(reel: Reel, clipId: string, edge: 'in' | 'out', t: number | null,
  current: { in: number; out: number }, def: { in: number; out: number }, durationSec = Infinity): Reel {
  const c = reel.clips[clipId]
  if (!c) return reel
  let next: Clip
  if (t === null) next = edge === 'in' ? { ...c, inSec: null } : { ...c, outSec: null }
  else if (edge === 'in') next = { ...c, inSec: round(Math.max(0, Math.min(t, current.out - MIN_CLIP_SEC))) }
  else next = { ...c, outSec: round(Math.min(durationSec, Math.max(t, current.in + MIN_CLIP_SEC))) }
  // A value equal to the default is stored as "default" so later changes to the defaults apply.
  if (next.inSec !== null && Math.abs(next.inSec - def.in) < 0.001) next.inSec = null
  if (next.outSec !== null && Math.abs(next.outSec - def.out) < 0.001) next.outSec = null
  return touch({ ...reel, clips: { ...reel.clips, [clipId]: next } })
}

const round = (t: number) => Math.round(t * 1000) / 1000

// Clips of the same match whose ranges overlap (e.g. two plays of one rally). Warned, never merged.
export function findOverlaps(items: { id: string; matchId: string; in: number; out: number }[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const sorted = [...items].sort((a, b) => a.matchId.localeCompare(b.matchId) || a.in - b.in)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].matchId === sorted[i].matchId && sorted[j].in < sorted[i].out; j++) {
      out.set(sorted[i].id, [...(out.get(sorted[i].id) ?? []), sorted[j].id])
      out.set(sorted[j].id, [...(out.get(sorted[j].id) ?? []), sorted[i].id])
    }
  }
  return out
}

export function setAnnotations(reel: Reel, clipId: string, annotations: Annotation[]): Reel {
  const c = reel.clips[clipId]
  if (!c) return reel
  return touch({ ...reel, clips: { ...reel.clips, [clipId]: { ...c, annotations: annotations.map(roundCoords) } } })
}

export function setOverlayOverride(reel: Reel, clipId: string, o: ClipOverlayOverride | undefined): Reel {
  const c = reel.clips[clipId]
  if (!c) return reel
  return touch({ ...reel, clips: { ...reel.clips, [clipId]: { ...c, overlayOverride: o } } })
}
