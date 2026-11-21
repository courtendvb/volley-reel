// Video comparison: two videos side by side, each with its own timeline and zoom. It is a work of its
// own, apart from projects: a side is a match of the library (its video) or any video file (no DVW).
// Pure functions, so the screen can treat a session as immutable state and every change is testable.

export type CompareSource =
  | { kind: 'match'; matchId: string }
  | { kind: 'file'; path: string; name: string }

// zoom 1 = the picture fits its box. x, y: where the picture's centre sits, in box widths / heights
// from the box centre (so a view means the same in a box of any size).
export interface PaneView { zoom: number; x: number; y: number }

export interface ComparePane {
  source: CompareSource | null
  view: PaneView
  time: number // where it was left, in video seconds
}

// overlay: the right video laid over the left one, see-through (overlayAlpha of it shows)
export type CompareLayout = 'side' | 'stack' | 'overlay'

export interface CompareSession {
  id: string
  name: string
  left: ComparePane
  right: ComparePane
  offsetSec: number // right time = left time + offset, while the sides are synced
  synced: boolean
  zoomLocked: boolean // zooming or panning one side does the same to the other
  layout: CompareLayout
  overlayAlpha: number // 0..1: how much of the right video shows over the left, in the overlay layout
  updatedAt: string
}

export type Side = 'left' | 'right'
export const other = (s: Side): Side => (s === 'left' ? 'right' : 'left')

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8
export const DEFAULT_VIEW: PaneView = { zoom: 1, x: 0, y: 0 }
export const DEFAULT_ALPHA = 0.5

const uid = () => globalThis.crypto.randomUUID()
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const emptyPane = (): ComparePane => ({ source: null, view: { ...DEFAULT_VIEW }, time: 0 })

// The name a comparison takes from its two videos, "2026-10-10 RSH-HCF × 2026-10-24 RSH-LKW" (one side alone
// while the other is empty). label: a side's video as people know it (the match's name, the file's).
export function autoCompareName(left: string | null, right: string | null): string | null {
  return left && right ? `${left} × ${right}` : left || right || null
}

// The name after a side's video changes: it follows the videos while it is the default name, empty, or the one
// the videos gave it; a name typed by hand stays.
export function nameAfterSource(s: Pick<CompareSession, 'name' | 'left' | 'right'>, side: Side, source: CompareSource | null,
  label: (src: CompareSource | null) => string | null, defaultName: string): string {
  const name = s.name.trim()
  const was = autoCompareName(label(s.left.source), label(s.right.source))
  if (name && name !== defaultName && name !== was) return s.name
  const next = { left: s.left.source, right: s.right.source, [side]: source }
  return autoCompareName(label(next.left), label(next.right)) ?? defaultName
}

export function newCompare(name: string): CompareSession {
  return { id: uid(), name, left: emptyPane(), right: emptyPane(), offsetSec: 0, synced: false, zoomLocked: false, layout: 'side', overlayAlpha: DEFAULT_ALPHA, updatedAt: new Date().toISOString() }
}

// The picture can't leave the box: at zoom z it overhangs each edge by (z - 1) / 2 box lengths.
export function clampView(v: PaneView): PaneView {
  const zoom = clamp(finite(v.zoom, 1), MIN_ZOOM, MAX_ZOOM)
  const reach = (zoom - 1) / 2
  return { zoom, x: clamp(finite(v.x, 0), -reach, reach) + 0, y: clamp(finite(v.y, 0), -reach, reach) + 0 } // + 0: no -0
}

// Zoom by a factor around a point of the box (cx, cy: from the box centre, in box lengths), so the
// spot under the pointer stays under it.
export function zoomAt(v: PaneView, factor: number, cx: number, cy: number): PaneView {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const k = zoom / v.zoom
  return clampView({ zoom, x: cx - k * (cx - v.x), y: cy - k * (cy - v.y) })
}

// Drag the picture by (dx, dy) box lengths.
export const panBy = (v: PaneView, dx: number, dy: number): PaneView => clampView({ ...v, x: v.x + dx, y: v.y + dy })

// What the pointer (or a zoom button) does to a picture, so one gesture can be applied to one side or both.
export type PaneGesture = { kind: 'zoom'; factor: number; cx: number; cy: number } | { kind: 'pan'; dx: number; dy: number } | { kind: 'reset' }
export function applyGesture(v: PaneView, g: PaneGesture): PaneView {
  return g.kind === 'zoom' ? zoomAt(v, g.factor, g.cx, g.cy) : g.kind === 'pan' ? panBy(v, g.dx, g.dy) : { ...DEFAULT_VIEW }
}

// The same zoom on the other side, keeping its own position as far as the zoom allows.
export const withZoom = (v: PaneView, zoom: number): PaneView => clampView({ ...v, zoom })

// The other side's time for this side's, while synced; null when it falls outside that video.
export function partnerTime(side: Side, time: number, offsetSec: number, partnerDuration: number): number | null {
  const t = side === 'left' ? time + offsetSec : time - offsetSec
  return t < 0 || (partnerDuration > 0 && t > partnerDuration) ? null : t
}

// The offset that makes these two positions the same moment.
export const offsetFor = (leftTime: number, rightTime: number): number => rightTime - leftTime

// A time moved by a number of frames (stepping), never before the start or past the end.
export function stepTime(time: number, frames: number, fps: number, duration: number): number {
  const t = time + frames / (fps || 30)
  return clamp(t, 0, duration > 0 ? duration : t)
}

// A saved session, as read back: anything missing or wrong is put right, and an unknown shape is null.
export function cleanCompare(raw: unknown): CompareSession | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(r.id)) return null
  const pane = (p: unknown): ComparePane => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const s = o.source as Record<string, unknown> | null | undefined
    const source: CompareSource | null = s && s.kind === 'match' && typeof s.matchId === 'string' ? { kind: 'match', matchId: s.matchId }
      : s && s.kind === 'file' && typeof s.path === 'string' ? { kind: 'file', path: s.path, name: typeof s.name === 'string' ? s.name : s.path }
      : null
    const v = (o.view && typeof o.view === 'object' ? o.view : {}) as Record<string, unknown>
    return { source, view: clampView({ zoom: finite(v.zoom, 1), x: finite(v.x, 0), y: finite(v.y, 0) }), time: Math.max(0, finite(o.time, 0)) }
  }
  return {
    id: r.id, name: typeof r.name === 'string' && r.name.trim() ? r.name : r.id,
    left: pane(r.left), right: pane(r.right),
    offsetSec: finite(r.offsetSec, 0), synced: r.synced === true, zoomLocked: r.zoomLocked === true,
    layout: r.layout === 'stack' || r.layout === 'overlay' ? r.layout : 'side',
    overlayAlpha: clamp(finite(r.overlayAlpha, DEFAULT_ALPHA), 0, 1),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  }
}

// A video file chosen for a side, as the main process made it playable: `token` is its media:// host.
export interface CompareFile {
  token: string
  path: string
  name: string
  width: number
  height: number
  fps: number
  durationSec: number
}
