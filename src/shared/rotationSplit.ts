// A rotation video: a search's plays put in marker groups by the rotation their team was in (a
// rotation video usually holds a team's side-out attacks), and the helpers presets.ts builds its
// marker groups with. Pure, so it is unit-tested.
import { EMPTY_FILTER, type PlayFilter, type PlayRef } from './filter'
import { MARKERS, type Marker } from './reel'
import type { Side } from './types'
import { t } from './i18n'

// A team's side-out attacks: its attacks in the reception phase (from its reception until the
// ball goes over).
export const sideOutFilter = (team: 'all' | 'our' | 'opp'): PlayFilter => ({ ...EMPTY_FILTER, team, skills: ['A'], phase: 'reception' })

// Plays put in marker groups: what a scene of a made video holds.
export interface Marked {
  items: { ref: PlayRef; marker: Marker | null }[] // in the search's order
  names: Partial<Record<Marker, string>> // the markers used, with their names
  counts: Partial<Record<Marker, number>>
  rest: number // the unmarked plays
}

// The order a team goes through its rotations in a set: DataVolley numbers a rotation by the
// setter's zone, so 1 → 6 → 5 → 4 → 3 → 2.
export const ROTATION_ORDER = [1, 6, 5, 4, 3, 2]

// The rotation of the play's own team: an opponent's play goes by the opponent's.
export const rotationOf = (r: PlayRef): number | null => (r.teamRole === 'opp' ? r.oppRot : r.ourRot)

// A player as markers and scenes name them: the jersey, then the name.
export const playerLabel = (r: PlayRef): string => `#${r.play.jersey} ${r.name}`
// The same person across matches (the DataVolley key), kept apart from the other team's.
export const personOf = (r: PlayRef): string => `${r.teamRole ?? r.teamCode}|${r.personKey}`

// Who won the play's rally; null when it isn't known.
export type WonBy = (r: PlayRef) => Side | null

export function marked(refs: PlayRef[], markerOf: (r: PlayRef) => Marker | null = () => null, names: Partial<Record<Marker, string>> = {}): Marked {
  const items = refs.map(ref => ({ ref, marker: markerOf(ref) }))
  const counts: Partial<Record<Marker, number>> = {}
  for (const i of items) if (i.marker !== null) counts[i.marker] = (counts[i.marker] ?? 0) + 1
  return { items, names, counts, rest: items.filter(i => i.marker === null).length }
}

// Keys in the order of how many plays they have, the most first (ties: the one seen first).
export function byCount<K>(refs: PlayRef[], key: (r: PlayRef) => K | null): { key: K; refs: PlayRef[] }[] {
  const seen = new Map<K, PlayRef[]>()
  for (const r of refs) {
    const k = key(r)
    if (k === null) continue
    seen.set(k, [...(seen.get(k) ?? []), r])
  }
  return [...seen.entries()].map(([k, list]) => ({ key: k, refs: list })).sort((a, b) => b.refs.length - a.refs.length)
}

// A marker per key, the most plays first; the sixth key on is unmarked.
export function rankedMarkers(refs: PlayRef[], key: (r: PlayRef) => string | null, label: (r: PlayRef) => string): Marked {
  const top = byCount(refs, key).slice(0, MARKERS.length)
  const markerOf = new Map(top.map((g, i) => [g.key, MARKERS[i]]))
  const names: Partial<Record<Marker, string>> = {}
  top.forEach((g, i) => { names[MARKERS[i]] = label(g.refs[0]) })
  return marked(refs, r => { const k = key(r); return k === null ? null : markerOf.get(k) ?? null }, names)
}
export const playerMarkers = (refs: PlayRef[]): Marked => rankedMarkers(refs, personOf, playerLabel)

// A marker per rotation, the marker's number the rotation's (a scene's six markers hold its six
// rotations), played in the order a team rotates. `skipped` counts plays whose rotation isn't in
// the file: they are left out.
export function byRotation(refs: PlayRef[]): Marked & { order: Marker[]; skipped: number } {
  const known = refs.filter(r => { const rot = rotationOf(r); return rot !== null && rot >= 1 && rot <= 6 })
  const m = marked(known, r => rotationOf(r) as Marker)
  const names: Partial<Record<Marker, string>> = {}
  for (const rot of ROTATION_ORDER) if (m.counts[rot as Marker]) names[rot as Marker] = t('ローテ {0}', rot)
  return { ...m, names, order: ROTATION_ORDER as Marker[], skipped: refs.length - known.length }
}
