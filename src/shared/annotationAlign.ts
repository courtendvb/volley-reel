// Lining objects up, as in Office: align the picked objects' edges or middles, space three or more
// evenly, put them in the middle of the picture, and smart guides — while an object is dragged it
// sticks to the edges and middles of the others and of the picture, and a line shows what it met.
// A group moves as one object. Pure functions on normalized coordinates; how big an object is comes
// from boxOf (text needs a canvas to be measured), so they are unit-tested without one.
import { translate, type Annotation, type Rect } from './annotation'

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type Axis = 'x' | 'y'
type BoxOf = (a: Annotation) => Rect

// One thing being lined up: a group, or an object on its own, with its bounds.
interface Unit { ids: string[]; box: Rect }

export function unionBox(boxes: Rect[]): Rect {
  const l = Math.min(...boxes.map(b => b.x)), t = Math.min(...boxes.map(b => b.y))
  const r = Math.max(...boxes.map(b => b.x + b.w)), btm = Math.max(...boxes.map(b => b.y + b.h))
  return { x: l, y: t, w: r - l, h: btm - t }
}

// The picked objects as units: the members of a group together, in the order they come in the list.
function unitsOf(list: Annotation[], ids: string[], boxOf: BoxOf): Unit[] {
  const picked = list.filter(a => ids.includes(a.id) || (a.groupId && list.some(b => ids.includes(b.id) && b.groupId === a.groupId)))
  const keys = new Map<string, Annotation[]>()
  for (const a of picked) {
    const k = a.groupId ? `g:${a.groupId}` : `o:${a.id}`
    keys.set(k, [...(keys.get(k) ?? []), a])
  }
  return [...keys.values()].map(m => ({ ids: m.map(a => a.id), box: unionBox(m.map(boxOf)) }))
}

const moveUnits = (list: Annotation[], moves: Map<string, [number, number]>): Annotation[] =>
  list.map(a => { const d = moves.get(a.id); return d && (d[0] || d[1]) ? translate(a, d[0], d[1]) : a })

// Where a box's edge or middle is on its axis.
const edgeOf = (b: Rect, how: AlignHow): number =>
  how === 'left' ? b.x : how === 'hcenter' ? b.x + b.w / 2 : how === 'right' ? b.x + b.w
    : how === 'top' ? b.y : how === 'vcenter' ? b.y + b.h / 2 : b.y + b.h
const isX = (how: AlignHow) => how === 'left' || how === 'hcenter' || how === 'right'

// The picked objects lined up on one edge or middle of all of them together. One object (or one
// group) on its own lines up with the picture instead: left goes to its left edge, and so on.
export function alignObjects(list: Annotation[], ids: string[], how: AlignHow, boxOf: BoxOf): Annotation[] {
  const units = unitsOf(list, ids, boxOf)
  if (!units.length) return list
  const target = edgeOf(units.length > 1 ? unionBox(units.map(u => u.box)) : { x: 0, y: 0, w: 1, h: 1 }, how)
  const moves = new Map<string, [number, number]>()
  for (const u of units) {
    const d = target - edgeOf(u.box, how)
    for (const id of u.ids) moves.set(id, isX(how) ? [d, 0] : [0, d])
  }
  return moveUnits(list, moves)
}

// Three or more spaced evenly across (x) or down (y): the first and last stay, and the gaps between
// neighbors become the same.
export function distributeObjects(list: Annotation[], ids: string[], axis: Axis, boxOf: BoxOf): Annotation[] {
  const units = unitsOf(list, ids, boxOf)
  if (units.length < 3) return list
  const start = (b: Rect) => (axis === 'x' ? b.x : b.y), size = (b: Rect) => (axis === 'x' ? b.w : b.h)
  const sorted = [...units].sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2))
  const first = sorted[0].box, last = sorted[sorted.length - 1].box
  const span = start(last) + size(last) - start(first)
  const gap = (span - sorted.reduce((s, u) => s + size(u.box), 0)) / (sorted.length - 1)
  const moves = new Map<string, [number, number]>()
  let at = start(first)
  for (const u of sorted) {
    const d = at - start(u.box)
    for (const id of u.ids) moves.set(id, axis === 'x' ? [d, 0] : [0, d])
    at += size(u.box) + gap
  }
  return moveUnits(list, moves)
}

// The picked objects, together as they are, moved to the middle of the picture across or down.
export function centerInFrame(list: Annotation[], ids: string[], axis: Axis, boxOf: BoxOf): Annotation[] {
  const units = unitsOf(list, ids, boxOf)
  if (!units.length) return list
  const b = unionBox(units.map(u => u.box))
  const d = axis === 'x' ? 0.5 - (b.x + b.w / 2) : 0.5 - (b.y + b.h / 2)
  const moves = new Map<string, [number, number]>()
  for (const u of units) for (const id of u.ids) moves.set(id, axis === 'x' ? [d, 0] : [0, d])
  return moveUnits(list, moves)
}

// How many of the picked are lined up as separate things (a group counts once).
export const unitCount = (list: Annotation[], ids: string[]): number =>
  new Set(list.filter(a => ids.includes(a.id) || (a.groupId && list.some(b => ids.includes(b.id) && b.groupId === a.groupId)))
    .map(a => (a.groupId ? `g:${a.groupId}` : `o:${a.id}`))).size

// ---- smart guides

// A guide line: vertical (axis x) at x = at, from y = from to y = to; horizontal (axis y) likewise.
export interface Guide { axis: Axis; at: number; from: number; to: number }
export const SNAP_PX = 6 // how near, on screen, an edge or middle must come to stick

// The box being dragged (where it was when the drag began), moved by dx, dy, sticks to the nearest
// edge or middle of the other boxes and of the picture (its edges and its middle) when one of its
// own comes within tolPx on screen. Each axis sticks on its own. Returns the move to make and the
// lines to show.
export function snapMove(box: Rect, dx: number, dy: number, others: Rect[], W: number, H: number, tolPx = SNAP_PX): { dx: number; dy: number; guides: Guide[] } {
  const frame: Rect = { x: 0, y: 0, w: 1, h: 1 }
  const lines = (b: Rect, axis: Axis) => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h])
  const stick = (axis: Axis, d: number): number => {
    const px = axis === 'x' ? W : H, own = lines(box, axis).map(v => v + d)
    let best: number | null = null
    for (const b of [frame, ...others]) for (const t of lines(b, axis)) for (const o of own) {
      const diff = t - o
      if (Math.abs(diff) * px <= tolPx && (best === null || Math.abs(diff) < Math.abs(best))) best = diff
    }
    return best === null ? d : d + best
  }
  const sx = stick('x', dx), sy = stick('y', dy)
  const moved: Rect = { ...box, x: box.x + sx, y: box.y + sy }
  // Every line the moved box now sits on, drawn across it and what it met (the picture's: all the way).
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as Axis[]) {
    const px = axis === 'x' ? W : H, own = lines(moved, axis)
    const span = (b: Rect): [number, number] => (axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w])
    for (const b of [frame, ...others]) for (const t of lines(b, axis)) {
      if (!own.some(o => Math.abs(o - t) * px < 0.5)) continue
      const [m0, m1] = span(moved), [b0, b1] = span(b)
      const g: Guide = { axis, at: t, from: Math.min(m0, b0), to: Math.max(m1, b1) }
      const same = guides.find(x => x.axis === axis && Math.abs(x.at - t) * px < 0.5)
      if (same) { same.from = Math.min(same.from, g.from); same.to = Math.max(same.to, g.to) } else guides.push(g)
    }
  }
  return { dx: sx, dy: sy, guides }
}
