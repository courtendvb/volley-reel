// Where an object lives (表示範囲): on one clip, on every clip of its marker group, on every clip of
// its scene, or on every clip of the video. The editor works on one merged list — video objects at
// the bottom, then the scene's, the marker group's, and the clip's on top, the order they are drawn
// in — and splits it back by which list each id came from.
import type { Annotation } from './annotation'

export type AnnScope = 'clip' | 'marker' | 'scene' | 'video'
export interface ScopedAnnotations { video: Annotation[]; scene: Annotation[]; marker: Annotation[]; clip: Annotation[] }

export function mergeScoped(l: ScopedAnnotations): Annotation[] {
  return [...l.video, ...l.scene, ...l.marker, ...l.clip]
}

export function scopeOf(l: ScopedAnnotations, id: string): AnnScope | null {
  if (l.clip.some(a => a.id === id)) return 'clip'
  if (l.marker.some(a => a.id === id)) return 'marker'
  if (l.scene.some(a => a.id === id)) return 'scene'
  if (l.video.some(a => a.id === id)) return 'video'
  return null
}

// An edited merged list back into its lists. New objects (ids in none) go to the clip.
export function splitScoped(prev: ScopedAnnotations, list: Annotation[]): ScopedAnnotations {
  const inVideo = new Set(prev.video.map(a => a.id)), inScene = new Set(prev.scene.map(a => a.id)), inMarker = new Set(prev.marker.map(a => a.id))
  return {
    video: list.filter(a => inVideo.has(a.id)),
    scene: list.filter(a => inScene.has(a.id)),
    marker: list.filter(a => inMarker.has(a.id)),
    clip: list.filter(a => !inVideo.has(a.id) && !inScene.has(a.id) && !inMarker.has(a.id)),
  }
}

// Moves one object to another scope (on top of that list). Show/hide times are clip times, so an
// object leaving the clip shows for the whole of every clip.
export function moveToScope(l: ScopedAnnotations, id: string, to: AnnScope): ScopedAnnotations {
  const from = scopeOf(l, id)
  if (!from || from === to) return l
  const a = l[from].find(x => x.id === id)!
  const { showFrom: _f, showTo: _t, ...rest } = a
  const moved = (to === 'clip' ? a : rest) as Annotation
  return { ...l, [from]: l[from].filter(x => x.id !== id), [to]: [...l[to], moved] }
}

// True when a list was edited (an element was added, removed, replaced or moved).
export function changed(a: Annotation[], b: Annotation[]): boolean {
  return a.length !== b.length || a.some((x, i) => x !== b[i])
}
