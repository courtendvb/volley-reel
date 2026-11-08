import type { Annotation } from './annotation'
import { courtCamera, floorAt, homography, project, type CourtFit, type Pt } from './court'
import { mix } from './overlayDraw'

// A round disc standing on the court, with a thickness (a cylinder), drawn in the court's
// perspective: its centre in court units (u across, v from the far end line, 0..1), its radius and
// height in metres. Seen through the camera recovered from the fitted court, so the top sits higher
// in the picture the thicker it is.
export interface FloorDisc { u: number; v: number; r: number; z: number }
export type DiscPart = FloorDisc & { part: 'top' | 'side' }

const COURT_W = 9, COURT_L = 18, STEPS = 48
const PW = 1600, PH = 900 // a 16:9 picture in pixels, for the camera; the result is 0..1

// The disc's top (an ellipse in perspective) and the outline of the whole solid (its side, seen as
// the hull of the bottom and top rims), as points of the picture (0..1). Without a camera to tell
// heights, or no thickness, both are the floor's ring.
export function discOutline(corners: CourtFit['corners'], d: FloorDisc): { top: [number, number][]; side: [number, number][] } {
  const ring = (at: (u: number, v: number) => Pt) => Array.from({ length: STEPS }, (_, i) => {
    const a = (i / STEPS) * Math.PI * 2
    return at(d.u + (d.r / COURT_W) * Math.cos(a), d.v + (d.r / COURT_L) * Math.sin(a))
  })
  const cam = d.z > 0 ? courtCamera(corners.map(c => ({ x: c.x * PW, y: c.y * PH })) as [Pt, Pt, Pt, Pt], PW, PH) : null
  const out = (ps: Pt[]) => ps.map(p => [round(p.x), round(p.y)] as [number, number])
  if (!cam) {
    const H = homography(corners), floor = out(ring((u, v) => project(H, u, v)))
    return { top: floor, side: floor }
  }
  const norm = (p: Pt) => ({ x: p.x / PW, y: p.y / PH })
  const bottom = ring((u, v) => norm(cam(u, v, 0))), top = ring((u, v) => norm(cam(u, v, d.z)))
  return { top: out(top), side: out(hull([...bottom, ...top])) }
}

// The disc as two filled polygons in one group: the side in a darker shade, then the top over it;
// both take the outline, so it goes round the whole solid and the top's rim. Each keeps the disc, so its thickness can be changed later.
export function discShapes(corners: CourtFit['corners'], d: FloorDisc, s: { color: string; fill: string; fillOpacity: number; width: number; dash?: Annotation['dash'] },
  ids: { side: string; top: string; group: string }): [Annotation, Annotation] {
  const o = discOutline(corners, d)
  const common = { kind: 'polygon' as const, groupId: ids.group, fillOpacity: s.fillOpacity, ...(s.dash ? { dash: s.dash } : {}) }
  return [
    { ...common, id: ids.side, color: s.color, width: s.width, fill: mix(s.fill, '#000000', 0.35), points: o.side, disc: { ...d, part: 'side' } }, // the outline round the whole solid
    { ...common, id: ids.top, color: s.color, width: s.width, fill: s.fill, points: o.top, disc: { ...d, part: 'top' } },
  ]
}

// The disc again with a new size or thickness, each part keeping its own look. Where it stands is
// taken from the picture: a disc dragged since it was drawn keeps its new place (its centre moved on
// the floor as far as its top was moved in the picture).
export function reshapeDisc(list: Annotation[], groupId: string, corners: CourtFit['corners'], patch: Partial<FloorDisc>): Annotation[] {
  const top = list.find(a => a.kind === 'polygon' && a.groupId === groupId && a.disc?.part === 'top')
  let at: Pick<FloorDisc, 'u' | 'v'> | null = null
  if (top?.kind === 'polygon' && top.disc && top.points.length) {
    const was = discOutline(corners, top.disc).top[0], now = top.points[0], dx = now[0] - was[0], dy = now[1] - was[1]
    if (Math.hypot(dx, dy) > 1e-4) {
      const c = project(homography(corners), top.disc.u, top.disc.v), f = floorAt({ corners }, { x: c.x + dx, y: c.y + dy })
      if (f) at = { u: f.x, v: f.y }
    }
  }
  return list.map(a => {
    if (a.kind !== 'polygon' || !a.disc || a.groupId !== groupId) return a
    const d = { ...a.disc, ...(at ?? {}), ...patch }, o = discOutline(corners, d)
    return { ...a, points: d.part === 'top' ? o.top : o.side, disc: d }
  })
}

// Discs' sides follow their tops: a darker shade of the top's fill at its opacity, and the same
// outline (after the top's look was changed).
export function syncDiscSides(list: Annotation[]): Annotation[] {
  const tops = new Map(list.flatMap(a => (a.kind === 'polygon' && a.disc?.part === 'top' && a.groupId ? [[a.groupId, a] as const] : [])))
  return list.map(a => {
    const top = a.kind === 'polygon' && a.disc?.part === 'side' && a.groupId ? tops.get(a.groupId) : undefined
    if (!top || a.kind !== 'polygon' || top.kind !== 'polygon') return a
    const fill = top.fill ?? top.color
    const { dash: _d, lineOpacity: _l, ...rest } = a
    return { ...rest, fill: mix(fill, '#000000', 0.35), color: top.color, width: top.width, fillOpacity: top.fillOpacity ?? 1, ...(top.dash ? { dash: top.dash } : {}),
      ...(top.lineOpacity !== undefined ? { lineOpacity: top.lineOpacity } : {}), ...(top.opacity !== undefined ? { opacity: top.opacity } : {}) }
  })
}

const round = (v: number) => Math.round(v * 10000) / 10000

// Convex hull (monotone chain).
function hull(ps: Pt[]): Pt[] {
  const p = [...ps].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = [], upper: Pt[] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q) }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}
