// Clip annotations (design §3.6). Coordinates are normalized to the video frame (0..1), so the same
// data redraws sharp at any size; line widths and text sizes are px at 720p and scale with height.
// showFrom / showTo are absolute video times (not clip-relative), so trimming IN doesn't shift them.
// drawAnnotation is the single renderer for the preview and the export.
//
// v3 step 3 adds Office-like formatting (fill and its transparency, dash, arrow heads, bold, a box
// behind text) and polyline / polygon shapes. Every new field is optional and its default is the
// old look, so annotations saved before draw exactly as they did.
//
// An image annotation shows a picture (or page 1 of a PDF, rendered to PNG) stored in the project's
// assets/ folder. Drawing it needs the decoded image, so drawAnnotation takes a lookup for it.
// With a quad its four corners are placed one by one, so the picture (a heatmap from analysis
// software, say) lies on the court with the camera's perspective; x, y, w, h are then its bounds.
import { floorQuad, halfFloorQuad, homography, moveOnFloor, project, refloorQuad, restandQuad, standQuad, type CourtFit, type Ctx, type ZoneCell } from './court'
import type { DiscPart } from './disc'

export type AnnotationKind = 'text' | 'arrow' | 'circle' | 'rect' | 'freehand' | 'polyline' | 'polygon' | 'image'
export type Dash = 'solid' | 'dash' | 'dot'
export type Heads = 'end' | 'both' | 'none'
export type Emphasis = 'pulse' | 'blink' | 'ripple'

interface Base {
  id: string
  color: string // line color; for text, the text color
  showFrom?: number
  showTo?: number
  dash?: Dash // default solid
  opacity?: number // whole object, 0..1; default 1
  lineOpacity?: number // the line (an outline, an arrow with its heads), 0..1; default 1. Fills keep their own
  groupId?: string // objects with the same group id are selected and moved together
  fadeIn?: number // seconds it fades in from when it appears (show time, else the clip's IN)
  fadeOut?: number // seconds it fades out before it leaves (hide time, else the clip's OUT)
  drawIn?: number // seconds it takes to be drawn when it appears: a line grows from its start, an outline goes round (fade-in is then not used)
  // Once drawn, while it shows, again and again: pulse swells and settles, blink goes out and back,
  // ripple sends a ring out from it (from an arrow's tip) that fades as it spreads.
  emphasis?: Emphasis
  pulse?: boolean // older files: emphasis 'pulse'
  locked?: boolean // part of the background (a data slide's court): drawn, but not picked by a click
}

interface Fillable {
  fill?: string | null // none when missing or null
  fillOpacity?: number // 0..1; default 1
  shade?: 'ball' // the fill lit as a ball: a highlight up left, darker toward the bottom
}

export interface TextBox {
  fill: string | null
  fillOpacity: number
  stroke: string | null
  strokeWidth: number // px at 720p
  padding: number // px at 720p
  radius?: number // corners, px at 720p
  width?: number // the box's width as a share of the picture, however short the text; missing: the text's
  height?: number // a cell of fixed height (share of the picture): the text sits in its middle and is made
  // smaller when it would not fit (with a width, across too), so the box keeps its shape whatever is written
  circle?: boolean // a round box around centred text: a numbered circle
}

// A numbered circle at a point (x and y its middle), and the next number for a set of objects.
export function numberCircle(id: string, x: number, y: number, n: number, color: string, size: number): Annotation {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  const light = !!m && 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) > 170
  return { id, kind: 'text', color: light ? '#0F172A' : '#FFFFFF', x, y: y - (size * 1.2) / 2 / REF_HEIGHT, text: String(n), size, bold: true, outline: false, align: 'center',
    box: { fill: color, fillOpacity: 1, stroke: '#FFFFFF', strokeWidth: 2, padding: Math.round(size * 0.22), circle: true } }
}
export function nextNumber(list: Annotation[]): number {
  return 1 + Math.max(0, ...list.map(a => (a.kind === 'text' && a.box?.circle ? parseInt(a.text) || 0 : 0)))
}

export type Annotation = Base & (
  // align center: x is the middle of the text. quick: the clip's headline from the text field in the tools.
  // quad: the text lies on the court's floor, drawn onto these corners (x, y stay where it stood flat);
  // stand: it stands upright on the floor instead, a board with its foot on the floor.
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; outline?: boolean; box?: TextBox | null; align?: 'center'; quick?: boolean; font?: string; quad?: Quad; stand?: true }
  // c1 / c2: a curved arrow, a cubic Bézier from (x1, y1) to (x2, y2) pulled toward these two points.
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; width: number; heads?: Heads; c1?: [number, number]; c2?: [number, number] }
  | ({ kind: 'circle' | 'rect'; x: number; y: number; w: number; h: number; width: number } & Fillable)
  | { kind: 'freehand' | 'polyline'; points: [number, number][]; width: number }
  | ({ kind: 'polygon'; points: [number, number][]; width: number; cell?: ZoneCell; disc?: DiscPart } & Fillable) // cell: a court zone painted from the zone panel; disc: part of a disc on the court
  // crop: the part of the picture shown (fractions of its width / height); missing = all of it.
  // floor: laid flat on the court's floor (lay) or stood on it (stand), so it moves over the floor;
  // flat: where it was on the picture before, to go back to and to know its shape.
  | { kind: 'image'; x: number; y: number; w: number; h: number; assetId: string; crop?: Crop; quad?: Quad
      floor?: 'lay' | 'stand'; flat?: Rect
      frame?: 'top' // a photo frame on a title card: filled with the photo of the card's player with the most clips (cardPeople.ts)
      fit?: 'cover' } // the picture fills the box, cut to its shape (else stretched to it)
)

// Corners of a picture laid with perspective: top-left, top-right, bottom-left, bottom-right of the picture.
export type Quad = [[number, number], [number, number], [number, number], [number, number]]
export type ImageAnnotation = Extract<Annotation, { kind: 'image' }>
export type ArrowAnnotation = Extract<Annotation, { kind: 'arrow' }>
type Pt = [number, number]
type Cubic = [Pt, Pt, Pt, Pt]

// A curve's two control points when it is first drawn from one point to another: a gentle arc
// bulging to the left of the way it goes, so it can be seen to be a curve and its handles grabbed.
export function curveControls(x1: number, y1: number, x2: number, y2: number, bend = 0.25): { c1: Pt; c2: Pt } {
  const dx = x2 - x1, dy = y2 - y1, nx = dy * bend, ny = -dx * bend
  return { c1: [x1 + dx / 3 + nx, y1 + dy / 3 + ny], c2: [x1 + (dx * 2) / 3 + nx, y1 + (dy * 2) / 3 + ny] }
}

// A point on a cubic Bézier at t (0..1).
export function cubicAt(p: Cubic, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]]
}

// The arrow's line as points: its two ends, or a curve cut into n straight pieces.
export function arrowPath(a: ArrowAnnotation, n = 32): Pt[] {
  if (!a.c1 || !a.c2) return [[a.x1, a.y1], [a.x2, a.y2]]
  const q: Cubic = [[a.x1, a.y1], a.c1, a.c2, [a.x2, a.y2]]
  return Array.from({ length: n + 1 }, (_, i) => cubicAt(q, i / n))
}

// The part of a cubic Bézier between t0 and t1, as its own four points (de Casteljau).
export function subCubic(p: Cubic, t0: number, t1: number): Cubic {
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const left = (q: Cubic, t: number): Cubic => { // the first part, up to t
    const a = lerp(q[0], q[1], t), b = lerp(q[1], q[2], t), c = lerp(q[2], q[3], t), d = lerp(a, b, t), e = lerp(b, c, t)
    return [q[0], a, d, lerp(d, e, t)]
  }
  const head = left(p, t1)
  if (t0 <= 0 || t1 <= 0) return head
  const rev = left([head[3], head[2], head[1], head[0]], 1 - t0 / t1) // the last part of head, from t0
  return [rev[3], rev[2], rev[1], rev[0]]
}

export type ImageLookup = (assetId: string) => CanvasImageSource | null
export interface Crop { x: number; y: number; w: number; h: number }

export type PointsAnnotation = Extract<Annotation, { points: [number, number][] }>
export const isPoints = (a: Annotation): a is PointsAnnotation => a.kind === 'freehand' || a.kind === 'polyline' || a.kind === 'polygon'

const REF_HEIGHT = 720
const FONT_FAMILY = '"Segoe UI", "Yu Gothic UI", "Helvetica Neue", "Hiragino Sans", sans-serif'
export const COLORS = ['#EF4444', '#FFFFFF', '#3B82F6', '#22C55E', '#0F172A']
export const DEFAULT_TEXT_BOX: TextBox = { fill: '#0F172A', fillOpacity: 0.7, stroke: null, strokeWidth: 2, padding: 8 }

// How a new headline looks, set for the project; anything missing stays as it always was.
export interface HeadlineStyle {
  font?: string // a font's name; a computer without it uses the usual ones
  size?: number // px at 720p
  color?: string
  bold?: boolean
  outline?: boolean
  box?: string // the plate's color behind the text; missing: no plate
}
export const HEADLINE_SIZE = 48

// As read back from project.json: what isn't usable is dropped. Undefined when nothing is left.
export function cleanHeadline(x: unknown): HeadlineStyle | undefined {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
  const out: HeadlineStyle = {
    ...(typeof o.font === 'string' && /^[\p{L}\p{N} _-]{1,60}$/u.test(o.font) ? { font: o.font } : {}), // it goes into a canvas font string
    ...(typeof o.size === 'number' && o.size >= 12 && o.size <= 200 ? { size: o.size } : {}),
    ...(hex(o.color) ? { color: o.color } : {}),
    ...(typeof o.bold === 'boolean' ? { bold: o.bold } : {}),
    ...(typeof o.outline === 'boolean' ? { outline: o.outline } : {}),
    ...(hex(o.box) ? { box: o.box } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

export interface Rect { x: number; y: number; w: number; h: number } // normalized


// The objects that move together with these: the ids themselves and every member of their groups.
export function withGroups(list: Annotation[], ids: string[]): string[] {
  const groups = new Set(list.filter(a => ids.includes(a.id) && a.groupId).map(a => a.groupId))
  return list.filter(a => ids.includes(a.id) || (a.groupId && groups.has(a.groupId))).map(a => a.id)
}

// Zone paint (cells painted from the zone panel) is one object: its cells share a group, and what is set
// on one of them (when it shows, its fades, its format, where it lives) is set on all. The ids that
// go with this one: the whole zone paint for a painted cell, else just itself.
export const isZonePaint = (a: Annotation | undefined): boolean => a?.kind === 'polygon' && !!a.cell
export function asOneObject(list: Annotation[], id: string): string[] {
  const a = list.find(x => x.id === id)
  return a && isZonePaint(a) && a.groupId ? list.filter(x => x.groupId === a.groupId && isZonePaint(x)).map(x => x.id) : [id]
}
// The same change made on one object on the others: the keys it changed, set or removed (never its
// id, place or shape).
const OWN_KEYS = new Set(['id', 'kind', 'points', 'cell', 'groupId', 'x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'])
export function sameChange(before: Annotation, after: Annotation, on: Annotation): Annotation {
  const b = before as unknown as Record<string, unknown>, a = after as unknown as Record<string, unknown>
  const next = { ...on } as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (OWN_KEYS.has(k) || JSON.stringify(b[k]) === JSON.stringify(a[k])) continue
    if (k in a) next[k] = a[k]; else delete next[k]
  }
  return next as unknown as Annotation
}

// How opaque an object is at time t from its own fades (1 when it has none or is past them).
// Drawing it in replaces the fade-in.
export function fadeAlpha(a: Annotation, t: number, clip: { in: number; out: number }): number {
  const fadeIn = a.drawIn ? 0 : a.fadeIn
  if (!fadeIn && !a.fadeOut) return 1
  const from = a.showFrom ?? clip.in, to = a.showTo ?? clip.out
  const fin = fadeIn ? Math.min(1, Math.max(0, (t - from) / fadeIn)) : 1
  const fout = a.fadeOut ? Math.min(1, Math.max(0, (to - t) / a.fadeOut)) : 1
  return Math.min(fin, fout)
}

// How an object moves at a moment. reveal: how much of it is drawn (0..1), while it is being drawn
// in; pulse / ripple: where it is in a swell or a ring's spread (0..1), once drawn; hidden: off for
// a moment of its blinking. Undefined: still, as it is.
export interface Anim { reveal?: number; pulse?: number; ripple?: number; hidden?: boolean }
export const PULSE_SEC = 1.2 // one swell and settle
export const BLINK_SEC = 1.0 // one blink: on, then off
export const BLINK_ON = 0.6 // the share of a blink it shows
export const RIPPLE_SEC = 1.5 // one ring, from the object out until it has faded
const PULSE_GROW = 0.12 // at the top of a swell, this much larger
const RIPPLE_GROW = 0.5 // a ring spreads this share of the object's size (at least RIPPLE_MIN px at 720p)
const RIPPLE_MIN = 36
export const emphasisOf = (a: Annotation): Emphasis | undefined => a.emphasis ?? (a.pulse ? 'pulse' : undefined)
export const emphasisSec = (e: Emphasis): number => (e === 'pulse' ? PULSE_SEC : e === 'blink' ? BLINK_SEC : RIPPLE_SEC)
export const isAnimated = (a: Annotation): boolean => !!(a.drawIn || emphasisOf(a))

// An object with its emphasis set (none: undefined), the older pulse flag dropped.
export function withEmphasis(a: Annotation, e: Emphasis | undefined): Annotation {
  const { emphasis: _e, pulse: _p, ...rest } = a
  return (e ? { ...rest, emphasis: e } : rest) as Annotation
}

// The motion at time t, seconds into the object's showing (from its show time, else the clip's IN).
export function animAt(a: Annotation, t: number, clip: { in: number; out: number }): Anim | undefined {
  return animAfter(a, t - (a.showFrom ?? clip.in))
}
export function animAfter(a: Annotation, since: number): Anim | undefined {
  const d = a.drawIn ?? 0
  if (d > 0 && since < d) return { reveal: Math.max(0, since / d) }
  const e = emphasisOf(a)
  if (!e) return undefined
  const k = Math.max(0, since - d) / emphasisSec(e), phase = k - Math.floor(k)
  if (e === 'pulse') return { pulse: phase }
  if (e === 'ripple') return { ripple: phase }
  return phase < BLINK_ON ? undefined : { hidden: true }
}

export function visibleAt(a: Annotation, t: number, clip: { in: number; out: number }): boolean {
  return t >= (a.showFrom ?? clip.in) - 1e-3 && t <= (a.showTo ?? clip.out) + 1e-3
}

// The part of a picture iw × ih that fills a box bw × bh (same units as each other), centred: a crop as shares.
export function coverCrop(iw: number, ih: number, bw: number, bh: number): Crop | undefined {
  if (!(iw > 0 && ih > 0 && bw > 0 && bh > 0)) return undefined
  const k = (bw / bh) / (iw / ih) // > 1: the box is wider than the picture, so its top and bottom go
  return k >= 1 ? { x: 0, y: (1 - 1 / k) / 2, w: 1, h: 1 / k } : { x: (1 - k) / 2, y: 0, w: k, h: 1 }
}

// floor: the court fitted to the picture (W × H pixels): a text on the floor moves over it, drawn
// again as the floor shows it where it goes (without it, or off the floor, it just shifts).
export function translate(a: Annotation, dx: number, dy: number, floor?: { corners: CourtFit['corners']; W: number; H: number } | null): Annotation {
  if (floor && a.kind === 'text' && a.quad) {
    const q = moveOnFloor(floor.corners, floor.W, floor.H, a.quad, !!a.stand, dx, dy)
    if (q) return { ...a, x: a.x + dx, y: a.y + dy, quad: q }
  }
  const flat = a.kind === 'image' && a.flat ? { flat: { ...a.flat, x: a.flat.x + dx, y: a.flat.y + dy } } : {}
  if (floor && a.kind === 'image' && a.quad && a.floor) {
    const q = moveOnFloor(floor.corners, floor.W, floor.H, a.quad, a.floor === 'stand', dx, dy)
    if (q) return { ...withQuad(a, q), ...flat }
  }
  switch (a.kind) {
    case 'text': return { ...a, x: a.x + dx, y: a.y + dy, ...(a.quad ? { quad: a.quad.map(([x, y]) => [x + dx, y + dy]) as Quad } : {}) }
    case 'arrow': return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy,
      ...(a.c1 && a.c2 ? { c1: [a.c1[0] + dx, a.c1[1] + dy] as Pt, c2: [a.c2[0] + dx, a.c2[1] + dy] as Pt } : {}) }
    case 'image': return a.quad ? { ...withQuad(a, a.quad.map(([x, y]) => [x + dx, y + dy]) as Quad), ...flat } : { ...a, x: a.x + dx, y: a.y + dy }
    case 'circle': case 'rect': return { ...a, x: a.x + dx, y: a.y + dy }
    default: return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
  }
}

// A picture laid on these corners (null: flat again, where it was before it was laid on the floor,
// or else in its bounds).
export function withQuad(a: ImageAnnotation, quad: Quad | null): ImageAnnotation {
  const { quad: _q, ...rest } = a
  if (!quad) { const { floor: _f, flat, ...plain } = rest; return flat ? { ...plain, ...flat } : plain }
  const xs = quad.map(p => p[0]), ys = quad.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { ...rest, quad, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// A picture laid flat on the court's floor where it is (lay), stood up on it with its foot where its
// bottom edge is (stand), or laid big in the middle of the near or far half (a team's logo): its
// shape kept (W × H: the picture, to know it). Null when it is not over the floor.
export type ImageFloorMode = 'lay' | 'stand' | 'near' | 'far'
export function imageOnFloor(a: ImageAnnotation, mode: ImageFloorMode, corners: CourtFit['corners'], W: number, H: number): ImageAnnotation | null {
  const b = a.flat ?? { x: a.x, y: a.y, w: a.w, h: a.h }
  if (!(b.w > 0 && b.h > 0)) return null
  const aspect = (b.w * W) / (b.h * H), y = mode === 'stand' ? b.y + b.h : b.y + b.h / 2
  const left = { x: b.x, y }, right = { x: b.x + b.w, y }
  const q = mode === 'lay' ? floorQuad(corners, left, right, aspect)
    : mode === 'stand' ? standQuad(corners, W, H, left, right, aspect)
    : halfFloorQuad(corners, mode, aspect)
  if (!q) return null
  return { ...withQuad(a, q), flat: b, floor: mode === 'stand' ? 'stand' : 'lay' }
}

// A text laid on the floor on these corners, or stood on it (null: flat on the picture again where it was).
export function withTextQuad(a: TextAnnotation, quad: Quad | null, stand = !!a.stand): TextAnnotation {
  const { quad: _q, stand: _s, ...rest } = a
  return quad ? { ...rest, quad, ...(stand ? { stand: true as const } : {}) } : rest
}
export type TextAnnotation = Extract<Annotation, { kind: 'text' }>

// A text laid on the court's floor where it stands (W × H: the picture, to measure it): as wide on
// the floor as it shows, its height foreshortened. Null when it is not over the floor.
export function layTextOnFloor(ctx: Ctx, a: TextAnnotation, corners: CourtFit['corners'], W: number, H: number): TextAnnotation | null {
  const b = bounds(ctx, withTextQuad(a, null), W, H), y = b.y + b.h / 2
  const q = floorQuad(corners, { x: b.x, y }, { x: b.x + b.w, y }, (b.w * W) / (b.h * H))
  return q ? withTextQuad(a, q, false) : null
}

// A text stood upright on the floor, its foot where its bottom edge is, as wide as it shows.
export function standTextOnFloor(ctx: Ctx, a: TextAnnotation, corners: CourtFit['corners'], W: number, H: number): TextAnnotation | null {
  const b = bounds(ctx, withTextQuad(a, null), W, H), y = b.y + b.h
  const q = standQuad(corners, W, H, { x: b.x, y }, { x: b.x + b.w, y }, (b.w * W) / (b.h * H))
  return q ? withTextQuad(a, q, true) : null
}

// Texts on the floor whose words or look changed from `before` laid again for their new shape (same
// place on the floor; the same height, or as much larger or smaller as the font size), so they are
// not squeezed or stretched onto their old corners.
export function refloorTexts(ctx: Ctx, before: Annotation[], after: Annotation[], corners: CourtFit['corners'], W: number, H: number): Annotation[] {
  const shape = (a: TextAnnotation) => JSON.stringify([a.text, a.size, a.bold, a.font, a.box, a.align])
  return after.map(a => {
    if (a.kind !== 'text' || !a.quad) return a
    const old = before.find(x => x.id === a.id)
    if (!old || old.kind !== 'text' || shape(old) === shape(a)) return a
    const b = bounds(ctx, withTextQuad(a, null), W, H), aspect = (b.w * W) / (b.h * H)
    const scale = old.size > 0 && a.size > 0 ? a.size / old.size : 1
    const q = a.stand ? restandQuad(corners, W, H, a.quad, aspect, scale) : refloorQuad(corners, a.quad, aspect, scale)
    return q ? withTextQuad(a, q) : a
  })
}

// The corners of the picture's box, to start laying it with perspective from where it is.
export const boxQuad = (b: Rect): Quad => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]

// The quad's outline in drawing order.
const quadRing = (q: Quad): [number, number][] => [q[0], q[1], q[3], q[2]]

// Moves show / hide times by delta seconds; null drops them (the object shows the whole time).
export function shiftTimes(a: Annotation, delta: number | null): Annotation {
  const { showFrom, showTo, ...rest } = a
  if (delta === null) return rest as Annotation
  return { ...rest, ...(showFrom !== undefined ? { showFrom: Math.round((showFrom + delta) * 100) / 100 } : {}),
    ...(showTo !== undefined ? { showTo: Math.round((showTo + delta) * 100) / 100 } : {}) } as Annotation
}

// The same objects with new ids, and one new group id per group, so they can sit next to the originals.
export function freshIds(list: Annotation[], newId: () => string = () => crypto.randomUUID()): Annotation[] {
  const groups = new Map<string, string>()
  return list.map(a => {
    const g = a.groupId ? groups.get(a.groupId) ?? (groups.set(a.groupId, newId()), groups.get(a.groupId)!) : undefined
    return { ...a, id: newId(), ...(g ? { groupId: g } : {}) }
  })
}

// Copies to paste into list: moved down-right a step at a time while the first one would land exactly
// on an object already there (pasting where the originals are), else left in place (another clip).
export function pasteCopies(copies: Annotation[], list: Annotation[], step = 0.02): Annotation[] {
  const shape = (a: Annotation) => { const { id: _i, groupId: _g, showFrom: _f, showTo: _t, ...rest } = a; return JSON.stringify(roundCoords(rest as Annotation)) }
  const taken = new Set(list.map(shape))
  let out = copies
  for (let n = 0; n < 20 && out.length && taken.has(shape(out[0])); n++) out = out.map(a => translate(a, step, step))
  return out
}

// Shapes drawn by dragging may go either way; store them with positive w/h.
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(a: T): T {
  return { ...a, x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) }
}

export interface StylePatch {
  color?: string
  width?: number
  size?: number
  dash?: Dash
  opacity?: number
  lineOpacity?: number
  fill?: string | null
  fillOpacity?: number
  heads?: Heads
  bold?: boolean
  outline?: boolean
  box?: TextBox | null
  font?: string | null // a text's font; null: back to the usual
}

// Applies the parts of a style that make sense for the annotation's kind.
export function applyStyle(a: Annotation, s: StylePatch): Annotation {
  const common = { ...a, color: s.color ?? a.color, ...(s.opacity !== undefined ? { opacity: s.opacity } : {}) }
  if (common.kind === 'image') return common
  if (common.kind === 'text') {
    const text = { ...common, size: s.size ?? common.size, ...(s.bold !== undefined ? { bold: s.bold } : {}),
      ...(s.outline !== undefined ? { outline: s.outline } : {}), ...(s.box !== undefined ? { box: s.box } : {}) }
    if (s.font === undefined) return text
    const { font: _f, ...rest } = text
    return s.font ? { ...rest, font: s.font } : rest
  }
  const lined = { ...common, width: s.width ?? common.width, ...(s.dash !== undefined ? { dash: s.dash } : {}),
    ...(s.lineOpacity !== undefined ? { lineOpacity: s.lineOpacity } : {}) }
  if (lined.kind === 'arrow') return s.heads !== undefined ? { ...lined, heads: s.heads } : lined
  if (lined.kind === 'rect' || lined.kind === 'circle' || lined.kind === 'polygon') {
    return { ...lined, ...(s.fill !== undefined ? { fill: s.fill } : {}), ...(s.fillOpacity !== undefined ? { fillOpacity: s.fillOpacity } : {}) }
  }
  return lined
}

// A style set on several objects at once (the selected one and those Shift+clicked, with their
// groups): each takes the parts that suit its kind. `on` limits it to some of them (a line colour
// does not recolour text, nor a text colour lines).
export function styleMany(list: Annotation[], ids: string[], s: StylePatch, on: (a: Annotation) => boolean = () => true): Annotation[] {
  const set = new Set(ids)
  return list.map(a => (set.has(a.id) && on(a) ? applyStyle(a, s) : a))
}

export const hasFill = (a: Annotation): boolean => a.kind === 'rect' || a.kind === 'circle' || a.kind === 'polygon'

// Normalized bounding box, for selection and hit testing. Text needs the context to measure.
export function bounds(ctx: Ctx, a: Annotation, W: number, H: number): Rect {
  switch (a.kind) {
    case 'text': {
      if (a.quad) return pointsBox(a.quad)
      const s = H / REF_HEIGHT
      setTextFont(ctx, a.size * s, a.bold !== false, a.font)
      const lines = textLines(a.text)
      const pad = a.box ? a.box.padding / REF_HEIGHT : 0
      const w = Math.max(...lines.map(l => ctx.measureText(l || ' ').width), a.box?.width ? (a.box.width - pad * 2 * (H / W)) * W : 0) / W
      const left = a.align === 'center' ? a.x - w / 2 : a.x
      if (a.box?.circle) {
        const tall = (a.size * 1.2 * lines.length) / REF_HEIGHT, side = Math.max(w * (W / H), tall) + 2 * pad
        return { x: a.x - (side * (H / W)) / 2, y: a.y + tall / 2 - side / 2, w: side * (H / W), h: side }
      }
      return { x: left - pad * (H / W), y: a.y - pad, w: w + 2 * pad * (H / W), h: a.box?.height ?? (a.size * 1.2 * lines.length) / REF_HEIGHT + 2 * pad }
    }
    case 'arrow': return pointsBox(arrowPath(a))
    case 'circle': case 'rect': case 'image': return { x: a.x, y: a.y, w: a.w, h: a.h }
    default: return pointsBox(a.points)
  }
}

// Topmost annotation within `tolPx` of the point (normalized x/y), or null. Lines are hit near the
// stroke; filled polygons also inside.
export function hitTest(ctx: Ctx, list: Annotation[], x: number, y: number, W: number, H: number, tolPx = 8): Annotation | null {
  const tx = tolPx / W, ty = tolPx / H
  const nearPath = (pts: [number, number][], closed: boolean, width: number) => {
    const n = closed ? pts.length : pts.length - 1
    for (let j = 0; j < n; j++) {
      const p = pts[j], q = pts[(j + 1) % pts.length]
      if (segDist(x * W, y * H, p[0] * W, p[1] * H, q[0] * W, q[1] * H) <= tolPx + width) return true
    }
    return false
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]
    if (a.locked) continue
    if (a.kind === 'arrow') { if (nearPath(arrowPath(a), false, a.width)) return a; continue }
    if (a.kind === 'freehand' || a.kind === 'polyline') { if (nearPath(a.points, false, a.width)) return a; continue }
    if (a.kind === 'polygon') { if (nearPath(a.points, true, a.width) || (a.fill && pointInPolygon(x, y, a.points))) return a; continue }
    if ((a.kind === 'image' || a.kind === 'text') && a.quad) { if (nearPath(quadRing(a.quad), true, 0) || pointInPolygon(x, y, quadRing(a.quad))) return a; continue }
    const b = bounds(ctx, a, W, H)
    if (x >= b.x - tx && x <= b.x + b.w + tx && y >= b.y - ty && y <= b.y + b.h + ty) return a
  }
  return null
}

export function drawAnnotation(ctx: Ctx, a: Annotation, W: number, H: number, images?: ImageLookup, anim?: Anim): void {
  if (anim?.hidden) return
  const s = H / REF_HEIGHT
  if (anim?.ripple !== undefined) drawRipple(ctx, a, W, H, s, anim.ripple)
  ctx.save()
  ctx.globalAlpha *= a.opacity ?? 1
  if (anim?.pulse !== undefined) {
    // A swell about the object's middle: up and back down, eased at both ends.
    const k = 1 + (PULSE_GROW * (1 - Math.cos(2 * Math.PI * anim.pulse))) / 2
    const b = bounds(ctx, a, W, H), cx = (b.x + b.w / 2) * W, cy = (b.y + b.h / 2) * H
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy)
  }
  const reveal = anim?.reveal
  if (reveal !== undefined && reveal < 1) {
    if (reveal <= 0) { ctx.restore(); return }
    if (a.kind === 'arrow' || a.kind === 'freehand' || a.kind === 'polyline') a = partOf(a, reveal, W, H)
    else if (a.kind === 'polygon' && a.points.length === 3) {
      // A triangle is almost always a direction cone: it opens out from its tip (the hit point; the
      // triangle tool's first point) as it fades in, rather than having its outline traced.
      const e = 1 - (1 - reveal) ** 3, [tx, ty] = a.points[0]
      a = { ...a, points: a.points.map(([x, y]) => [tx + (x - tx) * e, ty + (y - ty) * e] as Pt) }
      ctx.globalAlpha *= Math.min(1, reveal * 1.5)
    } else if (a.kind === 'rect' || a.kind === 'circle' || a.kind === 'polygon') {
      drawOutlineIn(ctx, a, reveal, W, H, s)
      ctx.restore()
      return
    } else ctx.globalAlpha *= reveal // text and pictures have no line to draw along: they fade in
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  // One object that can't be drawn is skipped: a canvas error here would otherwise take down the
  // whole screen (it runs inside React effects) or the export.
  try { drawKind(ctx, a, W, H, s, images) } catch (e) { console.error(`オブジェクト（${a.kind}）を描けませんでした`, e) }
  ctx.restore()
}

function drawKind(ctx: Ctx, a: Annotation, W: number, H: number, s: number, images?: ImageLookup): void {
  switch (a.kind) {
    case 'text': if (!a.quad || !drawTextOnFloor(ctx, a, W, H, s)) drawText(ctx, a, W, H, s); break
    case 'image': {
      const img = images?.(a.assetId) ?? null
      if (img) {
        const iw = (img as { width: number }).width, ih = (img as { height: number }).height
        const c = a.crop ?? (a.fit === 'cover' && !a.quad ? coverCrop(iw, ih, a.w * W, a.h * H) : undefined)
        const src = c ? { x: c.x * iw, y: c.y * ih, w: c.w * iw, h: c.h * ih } : { x: 0, y: 0, w: iw, h: ih }
        if (a.quad) {
          const q = a.quad.map(([x, y]) => [x * W, y * H]) as Quad, key = `i|${imageId(img)}|${JSON.stringify(src)}`
          if (!drawWarpedSmooth(ctx, key, q, src.w, src.h, (c, k) => c.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, src.w * k, src.h * k)))
            drawWarped(ctx, img, src, q)
        }
        else if (c) ctx.drawImage(img, c.x * iw, c.y * ih, c.w * iw, c.h * ih, a.x * W, a.y * H, a.w * W, a.h * H)
        else ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H)
        break
      }
      // Not loaded (yet): a placeholder, so the object can still be seen and picked. A photo frame
      // with no photo says what it is for.
      if (a.frame) {
        ctx.fillStyle = 'rgba(148,163,184,0.25)'; ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H)
        ctx.fillStyle = 'rgba(226,232,240,0.95)'; ctx.font = `bold ${Math.max(10, Math.round(14 * s))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('PHOTO', (a.x + a.w / 2) * W, (a.y + a.h / 2) * H, a.w * W * 0.9)
      }
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(148,163,184,0.9)'
      if (a.quad) { ctx.beginPath(); for (const [x, y] of quadRing(a.quad)) ctx.lineTo(x * W, y * H); ctx.closePath(); ctx.stroke() }
      else ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H)
      break
    }
    case 'arrow': {
      if (a.c1 && a.c2) { drawCurve(ctx, a, W, H, s); break }
      const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H, lw = a.width * s
      const ang = Math.atan2(y2 - y1, x2 - x1), head = Math.max(lw * 3.2, 10 * s)
      const heads = a.heads ?? 'end'
      const pull = head * 0.8
      const sx = heads === 'both' ? x1 + Math.cos(ang) * pull : x1, sy = heads === 'both' ? y1 + Math.sin(ang) * pull : y1
      const ex = heads === 'none' ? x2 : x2 - Math.cos(ang) * pull, ey = heads === 'none' ? y2 : y2 - Math.sin(ang) * pull
      ctx.globalAlpha *= a.lineOpacity ?? 1
      ctx.lineWidth = lw
      setDash(ctx, a.dash, lw)
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
      ctx.setLineDash([])
      if (heads !== 'none') arrowHead(ctx, x2, y2, ang, head)
      if (heads === 'both') arrowHead(ctx, x1, y1, ang + Math.PI, head)
      break
    }
    case 'circle': case 'rect': {
      ctx.beginPath()
      if (a.kind === 'rect') ctx.rect(a.x * W, a.y * H, a.w * W, a.h * H)
      // A circle being drawn up or to the left has a negative w / h until it is let go, and
      // ellipse() throws on a negative radius.
      else ctx.ellipse((a.x + a.w / 2) * W, (a.y + a.h / 2) * H, Math.abs(a.w / 2) * W, Math.abs(a.h / 2) * H, 0, 0, Math.PI * 2)
      fillAndStroke(ctx, a, a.width * s, { x: a.x * W, y: a.y * H, w: a.w * W, h: a.h * H })
      break
    }
    default: {
      if (a.points.length < 2) break
      ctx.beginPath()
      ctx.moveTo(a.points[0][0] * W, a.points[0][1] * H)
      for (const [x, y] of a.points.slice(1)) ctx.lineTo(x * W, y * H)
      if (a.kind === 'polygon') { ctx.closePath(); fillAndStroke(ctx, a, a.width * s) }
      else { ctx.globalAlpha *= a.lineOpacity ?? 1; ctx.lineWidth = a.width * s; setDash(ctx, a.dash, a.width * s); ctx.stroke() }
    }
  }
}

// A ring going out from the object, t of the way (0..1): from just outside it, larger and fainter as
// it goes. Round around a circle or a numbered circle, a rounded box around the rest, a circle out
// from an arrow's tip. In the object's colour (a boxed text's box colour), under the object.
function drawRipple(ctx: Ctx, a: Annotation, W: number, H: number, s: number, t: number): void {
  ctx.save()
  ctx.globalAlpha *= (a.opacity ?? 1) * 0.95 * (1 - t)
  ctx.strokeStyle = a.kind === 'text' ? a.box?.fill ?? a.color : a.color
  ctx.lineWidth = Math.max(4, 'width' in a && a.width > 0 ? a.width : 4) * s
  ctx.beginPath()
  if (a.kind === 'arrow') {
    const r0 = Math.max(a.width * 3.2, 14) * s
    ctx.arc(a.x2 * W, a.y2 * H, r0 + Math.max(r0 * 2, RIPPLE_MIN * s) * t, 0, Math.PI * 2)
  } else {
    // The same distance out all round, so a thin box's ring stays a ring around it.
    const b = bounds(ctx, a, W, H), pad = 6 * s, hw = (b.w * W) / 2 + pad, hh = (b.h * H) / 2 + pad
    const out = Math.max(RIPPLE_GROW * Math.max(hw, hh), RIPPLE_MIN * s) * t
    const cx = (b.x + b.w / 2) * W, cy = (b.y + b.h / 2) * H, rx = hw + out, ry = hh + out
    if (a.kind === 'circle' || (a.kind === 'text' && a.box?.circle)) ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    else ctx.roundRect(cx - rx, cy - ry, rx * 2, ry * 2, Math.min(rx, ry) * 0.3)
  }
  ctx.stroke()
  ctx.restore()
}

// The first share of a line's length (0..1): an arrow up to a tip that has come that far along it,
// head and all; a freehand line or polyline cut there.
function partOf<T extends ArrowAnnotation | PointsAnnotation>(a: T, share: number, W: number, H: number): T {
  if (a.kind === 'arrow') {
    if (!(a.c1 && a.c2)) return { ...a, x2: a.x1 + (a.x2 - a.x1) * share, y2: a.y1 + (a.y2 - a.y1) * share }
    // The curve's t at that share of its length, found on the curve cut into small pieces.
    const q: Cubic = [[a.x1, a.y1], a.c1, a.c2, [a.x2, a.y2]], n = 64
    const pts = Array.from({ length: n + 1 }, (_, i) => cubicAt(q, i / n))
    const at = cutAt(pts, share, W, H), t = (at.i + at.f) / n
    const p = subCubic(q, 0, t)
    return { ...a, c1: p[1], c2: p[2], x2: p[3][0], y2: p[3][1] }
  }
  const pa = a as PointsAnnotation
  return { ...pa, points: cutPoints(pa.points, share, W, H) } as T
}

// Where a share of a polyline's length falls: in piece i (from point i to i + 1), f of the way along it.
function cutAt(pts: Pt[], share: number, W: number, H: number): { i: number; f: number } {
  const lens = pts.slice(1).map((q, i) => Math.hypot((q[0] - pts[i][0]) * W, (q[1] - pts[i][1]) * H))
  let left = lens.reduce((x, y) => x + y, 0) * Math.min(1, share)
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) return { i, f: lens[i] ? Math.min(1, left / lens[i]) : 1 }
    left -= lens[i]
  }
  return { i: 0, f: 0 }
}

export function cutPoints(pts: Pt[], share: number, W: number, H: number): Pt[] {
  if (pts.length < 2) return pts
  const { i, f } = cutAt(pts, share, W, H), p = pts[i], q = pts[i + 1]
  return [...pts.slice(0, i + 1), [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]]
}

// A closed shape's outline as points, back to where it starts: a box from its top left, an ellipse
// from its top, both clockwise.
function ringOf(a: Extract<Annotation, { kind: 'rect' | 'circle' | 'polygon' }>): Pt[] {
  if (a.kind === 'polygon') return a.points.length ? [...a.points, a.points[0]] : []
  if (a.kind === 'rect') return [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h], [a.x, a.y]]
  return Array.from({ length: 73 }, (_, i) => {
    const ang = -Math.PI / 2 + (i / 72) * Math.PI * 2
    return [a.x + a.w / 2 + (a.w / 2) * Math.cos(ang), a.y + a.h / 2 + (a.h / 2) * Math.sin(ang)] as Pt
  })
}

// A closed shape being drawn in: its outline goes round from the top (clockwise), and its fill comes
// up as the outline does.
function drawOutlineIn(ctx: Ctx, a: Extract<Annotation, { kind: 'rect' | 'circle' | 'polygon' }>, share: number, W: number, H: number, s: number): void {
  const ring = ringOf(a)
  if (ring.length < 2) return
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.strokeStyle = a.color
  if (a.fill) {
    ctx.save(); ctx.globalAlpha *= share
    ctx.beginPath()
    if (a.kind === 'circle') ctx.ellipse((a.x + a.w / 2) * W, (a.y + a.h / 2) * H, (a.w / 2) * W, (a.h / 2) * H, 0, 0, Math.PI * 2)
    else { for (const [x, y] of ring) ctx.lineTo(x * W, y * H); ctx.closePath() }
    fillAndStroke(ctx, a, 0, a.kind === 'polygon' ? undefined : { x: a.x * W, y: a.y * H, w: a.w * W, h: a.h * H })
    ctx.restore()
  }
  const lw = a.width * s
  if (lw <= 0) return
  const part = cutPoints(ring, share, W, H)
  ctx.beginPath()
  for (const [x, y] of part) ctx.lineTo(x * W, y * H)
  ctx.globalAlpha *= a.lineOpacity ?? 1; ctx.lineWidth = lw; setDash(ctx, a.dash, lw); ctx.stroke()
}

// Canvas has no perspective transform, so the picture is cut into a mesh of small triangles, each
// drawn with the affine transform that puts it where the perspective map sends its corners. Each
// triangle is clipped a little larger than itself so no seams show between them.
export const WARP_STEPS = 16

function drawWarped(ctx: Ctx, img: CanvasImageSource, src: { x: number; y: number; w: number; h: number }, quad: Quad, n = WARP_STEPS, grow = 0.7): void {
  const pt = ([x, y]: [number, number]) => ({ x, y })
  const hm = homography([pt(quad[0]), pt(quad[1]), pt(quad[2]), pt(quad[3])])
  const dst: { x: number; y: number }[][] = []
  for (let i = 0; i <= n; i++) { dst.push([]); for (let j = 0; j <= n; j++) dst[i].push(project(hm, j / n, i / n)) }
  const sp = (i: number, j: number) => ({ x: src.x + (j / n) * src.w, y: src.y + (i / n) * src.h })
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = { x: src.x + (j / n) * src.w, y: src.y + (i / n) * src.h, w: src.w / n, h: src.h / n }
      drawTriangle(ctx, img, cell, [sp(i, j), sp(i, j + 1), sp(i + 1, j)], [dst[i][j], dst[i][j + 1], dst[i + 1][j]], grow)
      drawTriangle(ctx, img, cell, [sp(i + 1, j + 1), sp(i + 1, j), sp(i, j + 1)], [dst[i + 1][j + 1], dst[i + 1][j], dst[i][j + 1]], grow)
    }
  }
}

type P = { x: number; y: number }
function drawTriangle(ctx: Ctx, img: CanvasImageSource, cell: { x: number; y: number; w: number; h: number }, s: [P, P, P], d: [P, P, P], grow: number): void {
  const m = affine(s, d)
  if (!m) return
  const cx = (d[0].x + d[1].x + d[2].x) / 3, cy = (d[0].y + d[1].y + d[2].y) / 3
  ctx.save()
  ctx.beginPath()
  for (const p of d) {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1
    ctx.lineTo(p.x + (dx / len) * grow, p.y + (dy / len) * grow)
  }
  ctx.closePath()
  ctx.clip()
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  // A pixel of margin around the cell, so the edges of each triangle have picture under them.
  const iw = (img as { width: number }).width, ih = (img as { height: number }).height
  const x0 = Math.max(0, Math.floor(cell.x - 1)), y0 = Math.max(0, Math.floor(cell.y - 1))
  const w = Math.min(iw - x0, Math.ceil(cell.w + 2)), h = Math.min(ih - y0, Math.ceil(cell.h + 2))
  if (w > 0 && h > 0) ctx.drawImage(img, x0, y0, w, h, x0, y0, w, h)
  ctx.restore()
}

// The affine map (canvas transform order a, b, c, d, e, f) taking triangle s onto triangle d.
export function affine(s: [P, P, P], d: [P, P, P]): [number, number, number, number, number, number] | null {
  const dx1 = s[1].x - s[0].x, dy1 = s[1].y - s[0].y, dx2 = s[2].x - s[0].x, dy2 = s[2].y - s[0].y
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-12) return null
  const du1 = d[1].x - d[0].x, dv1 = d[1].y - d[0].y, du2 = d[2].x - d[0].x, dv2 = d[2].y - d[0].y
  const a = (du1 * dy2 - du2 * dy1) / det, c = (du2 * dx1 - du1 * dx2) / det
  const b = (dv1 * dy2 - dv2 * dy1) / det, dd = (dv2 * dx1 - dv1 * dx2) / det
  return [a, b, c, dd, d[0].x - a * s[0].x - c * s[0].y, d[0].y - b * s[0].x - dd * s[0].y]
}

// A text on the floor: drawn flat on a canvas of its own (a little larger than its box, for the
// outline), then warped onto its corners, which stand for its box. False when it can't be (no
// OffscreenCanvas: tests), and it is then drawn flat.
function drawTextOnFloor(ctx: Ctx, a: TextAnnotation, W: number, H: number, s: number): boolean {
  if (typeof OffscreenCanvas === 'undefined' || !a.quad) return false
  const flat = withTextQuad(a, null), b = bounds(ctx, flat, W, H)
  const bw = b.w * W, bh = b.h * H, m = Math.ceil(a.size * s * 0.2) + 2
  if (!(bw > 0 && bh > 0)) return false
  const hm = homography(a.quad.map(([x, y]) => ({ x: x * W, y: y * H })) as [P, P, P, P])
  const ex = m / bw, ey = m / bh, at = (u: number, v: number): Pt => { const p = project(hm, u, v); return [p.x, p.y] }
  // The corners stand for the box: the margin goes on beyond them, the same way.
  const dst: Quad = [at(-ex, -ey), at(1 + ex, -ey), at(-ex, 1 + ey), at(1 + ex, 1 + ey)]
  const key = `t|${W}|${H}|${s}|${JSON.stringify([a.text, a.size, a.bold, a.outline, a.font, a.box, a.align, a.color])}`
  return drawWarpedSmooth(ctx, key, dst, bw + 2 * m, bh + 2 * m, (c, k) => {
    c.scale(k, k); c.translate(m - b.x * W, m - b.y * H)
    c.lineJoin = 'round'; c.lineCap = 'round'
    drawText(c, flat, W, H, s)
  })
}

// A picture or text warped with perspective, drawn smooth. Straight onto the picture, its far end
// (where the floor shrinks it a lot) and the edges of the mesh came out jagged, worse with thin
// fonts. So the flat thing is drawn as fine as the warp shows it at its largest, the mesh is drawn
// onto a canvas SUPERSAMPLE times finer than the picture, and that is drawn down onto the picture
// with high-quality smoothing. The result is kept for the next frames while nothing about it
// changes. sw × sh: the flat thing's size in picture pixels; paint draws it flat, k times that size.
// False without OffscreenCanvas.
const SUPERSAMPLE = 3
const MAX_PIXELS = 16_000_000
interface Warped { canvas: OffscreenCanvas; x: number; y: number; w: number; h: number }
const warpCache = new Map<string, Warped>()
function drawWarpedSmooth(ctx: Ctx, key: string, dst: Quad, sw: number, sh: number, paint: (c: OffscreenCanvasRenderingContext2D, k: number) => void): boolean {
  if (typeof OffscreenCanvas === 'undefined' || !(sw > 0 && sh > 0)) return false
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const dpr = t ? Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) || 1 : 1
  const cvs = (ctx as { canvas?: { width: number; height: number } }).canvas
  const full = `${key}|${dpr.toFixed(3)}|${t ? `${t.e.toFixed(1)},${t.f.toFixed(1)}` : ''}|${JSON.stringify(dst)}`
  let hit = warpCache.get(full)
  if (hit) { warpCache.delete(full); warpCache.set(full, hit) } // the most recent last
  else {
    hit = warpSmooth(dst, sw, sh, paint, dpr, t && cvs && !t.b && !t.c ? { x0: -t.e / t.a, y0: -t.f / t.d, x1: (cvs.width - t.e) / t.a, y1: (cvs.height - t.f) / t.d } : null) ?? undefined
    if (!hit) return false
    warpCache.set(full, hit)
    while (warpCache.size > 24) warpCache.delete(warpCache.keys().next().value!)
  }
  if (hit.w > 0 && hit.h > 0) {
    ctx.save()
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(hit.canvas, hit.x, hit.y, hit.w, hit.h)
    ctx.restore()
  }
  return true
}

function warpSmooth(dst: Quad, sw: number, sh: number, paint: (c: OffscreenCanvasRenderingContext2D, k: number) => void, dpr: number,
  view: { x0: number; y0: number; x1: number; y1: number } | null): Warped | null {
  // Only the part that can show: the quad's bounds, cut to the canvas.
  const xs = dst.map(p => p[0]), ys = dst.map(p => p[1])
  const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b)
  const x0 = Math.floor(Math.max(Math.min(...xs), view ? lo(view.x0, view.x1) : -Infinity)) - 1
  const y0 = Math.floor(Math.max(Math.min(...ys), view ? lo(view.y0, view.y1) : -Infinity)) - 1
  const x1 = Math.ceil(Math.min(Math.max(...xs), view ? hi(view.x0, view.x1) : Infinity)) + 1
  const y1 = Math.ceil(Math.min(Math.max(...ys), view ? hi(view.y0, view.y1) : Infinity)) + 1
  const dummy = new OffscreenCanvas(1, 1)
  if (!(x1 > x0 && y1 > y0) || !isFinite(x0 + y0 + x1 + y1)) return { canvas: dummy, x: 0, y: 0, w: 0, h: 0 } // all of it off the picture
  let k = SUPERSAMPLE * dpr
  if ((x1 - x0) * (y1 - y0) * k * k > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / ((x1 - x0) * (y1 - y0)))
  const len = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1])
  const most = Math.max(len(dst[0], dst[1]) / sw, len(dst[2], dst[3]) / sw, len(dst[0], dst[2]) / sh, len(dst[1], dst[3]) / sh)
  const ks = Math.max(0.25, Math.min(Math.min(most, 6) * k, 8192 / sw, 8192 / sh, Math.sqrt(MAX_PIXELS / (sw * sh))))
  const src = new OffscreenCanvas(Math.max(1, Math.ceil(sw * ks)), Math.max(1, Math.ceil(sh * ks))), sc = src.getContext('2d')
  const out = new OffscreenCanvas(Math.max(1, Math.ceil((x1 - x0) * k)), Math.max(1, Math.ceil((y1 - y0) * k))), oc = out.getContext('2d')
  if (!sc || !oc) return null
  sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high'
  paint(sc, ks)
  oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high'
  oc.scale(k, k); oc.translate(-x0, -y0)
  drawWarped(oc, src, { x: 0, y: 0, w: sw * ks, h: sh * ks }, dst, WARP_STEPS, 1.2 / k)
  return { canvas: out, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// An id for each picture drawn, so the cache can tell a picture from one loaded in its place.
const imageIds = new WeakMap<object, number>()
let nextImageId = 1
const imageId = (img: CanvasImageSource): number => {
  let id = imageIds.get(img as object)
  if (!id) { id = nextImageId++; imageIds.set(img as object, id) }
  return id
}

// Text can have several lines ("\n"); each is 1.2× the size apart, and centered text centers each line.
const textLines = (t: string): string[] => t.split('\n')

function drawText(ctx: Ctx, a: Extract<Annotation, { kind: 'text' }>, W: number, H: number, s: number): void {
  let px = a.size * s, lh = px * 1.2
  setTextFont(ctx, px, a.bold !== false, a.font)
  const lines = textLines(a.text)
  let widths = lines.map(l => ctx.measureText(l).width), wMax = Math.max(...widths)
  const cell = a.box?.height ? a.box : null
  if (cell) {
    const pad = cell.padding * s, roomW = cell.width ? cell.width * W - 2 * pad : Infinity, roomH = cell.height! * H - 2 * pad
    const k = Math.min(1, roomW / Math.max(wMax, 1), roomH / (lh * lines.length))
    if (k < 1) {
      px *= k; lh = px * 1.2
      setTextFont(ctx, px, a.bold !== false, a.font)
      widths = lines.map(l => ctx.measureText(l).width); wMax = Math.max(...widths)
    }
  }
  const x = a.align === 'center' ? a.x * W - wMax / 2 : a.x * W, y = a.y * H
  const lineX = (i: number) => (a.align === 'center' ? a.x * W - widths[i] / 2 : x)
  if (a.box) {
    const pad = a.box.padding * s, h = cell ? cell.height! * H - 2 * pad : lh * lines.length, w = Math.max(wMax, a.box.width ? a.box.width * W - 2 * pad : 0)
    const x = a.align === 'center' ? a.x * W - w / 2 : a.x * W // a wide box stays centred on the text
    if (a.box.circle) {
      // The number sits in the middle of the circle by the ink of its digits, not the font's line box,
      // which puts it off centre in some fonts. Ring, fill and number each have their own colour.
      const cx = a.x * W, cy = y + h / 2, radius = Math.max(wMax, h) / 2 + pad
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      if (a.box.fill) { ctx.save(); ctx.globalAlpha *= a.box.fillOpacity; ctx.fillStyle = a.box.fill; ctx.fill(); ctx.restore() }
      if (a.box.stroke && a.box.strokeWidth > 0) { ctx.save(); ctx.strokeStyle = a.box.stroke; ctx.lineWidth = a.box.strokeWidth * s; ctx.stroke(); ctx.restore() }
      ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = a.color // measured on this baseline too
      const text = lines.join(' '), m = ctx.measureText(text)
      ctx.fillText(text, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
      ctx.restore()
      return
    }
    if (a.box.fill) {
      ctx.save(); ctx.globalAlpha *= a.box.fillOpacity; ctx.fillStyle = a.box.fill
      if (a.box.radius) { ctx.beginPath(); ctx.roundRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, a.box.radius * s); ctx.fill() }
      else ctx.fillRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad)
      ctx.restore()
    }
    if (a.box.stroke && a.box.strokeWidth > 0) {
      ctx.save(); ctx.strokeStyle = a.box.stroke; ctx.lineWidth = a.box.strokeWidth * s
      ctx.strokeRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad); ctx.restore()
    }
  }
  // Each line sits in the middle of its line box by the ink of capitals and kanji ('H漢'), drawn on
  // the alphabetic baseline: where a font puts its glyphs in its own box differs a lot from font to
  // font, and drawing from the top of that box left the text high (like a superscript) in some.
  // A number alone in a box (a jersey number) goes by the ink of its own digits.
  ctx.textBaseline = 'alphabetic'
  const top = cell ? y + (cell.height! * H - 2 * cell.padding * s - lh * lines.length) / 2 : y
  const ink = ctx.measureText(a.box && !cell && lines.length === 1 && /^\d+$/.test(lines[0]) ? lines[0] : 'H漢')
  const base = top + lh / 2 + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2
  // A black outline keeps light text readable on a bright court (on by default).
  if (a.outline !== false && a.color.toUpperCase() !== '#0F172A') {
    ctx.save(); ctx.lineWidth = Math.max(3, px * 0.18); ctx.strokeStyle = '#000000'; ctx.lineJoin = 'round'
    lines.forEach((l, i) => ctx.strokeText(l, lineX(i), base + i * lh)); ctx.restore()
  }
  ctx.fillStyle = a.color
  lines.forEach((l, i) => ctx.fillText(l, lineX(i), base + i * lh))
}

function fillAndStroke(ctx: Ctx, a: Fillable & { color: string; dash?: Dash; lineOpacity?: number }, lw: number, box?: { x: number; y: number; w: number; h: number }): void {
  if (a.fill) {
    ctx.save(); ctx.globalAlpha *= a.fillOpacity ?? 1
    if (a.shade === 'ball' && box && /^#[0-9a-f]{6}$/i.test(a.fill)) {
      const r = Math.max(box.w, box.h) / 2, cx = box.x + box.w / 2, cy = box.y + box.h / 2
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r)
      g.addColorStop(0, tint(a.fill, '#FFFFFF', 0.42)); g.addColorStop(0.35, tint(a.fill, '#FFFFFF', 0.08))
      g.addColorStop(0.75, a.fill); g.addColorStop(1, tint(a.fill, '#000000', 0.38))
      ctx.fillStyle = g
    } else ctx.fillStyle = a.fill
    ctx.fill(); ctx.restore()
  }
  if (lw > 0) { ctx.save(); ctx.globalAlpha *= a.lineOpacity ?? 1; ctx.lineWidth = lw; setDash(ctx, a.dash, lw); ctx.stroke(); ctx.restore() }
}

// A colour toward another (#rrggbb), t of the way.
function tint(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

// A curved arrow: the curve stops short of each head (so the line's end doesn't poke out past its
// tip), and each head points the way the curve runs into its end.
function drawCurve(ctx: Ctx, a: ArrowAnnotation, W: number, H: number, s: number): void {
  const px = (q: Pt): Pt => [q[0] * W, q[1] * H]
  const pts: Cubic = [px([a.x1, a.y1]), px(a.c1!), px(a.c2!), px([a.x2, a.y2])]
  const lw = a.width * s, head = Math.max(lw * 3.2, 10 * s), pull = head * 0.8, heads = a.heads ?? 'end'
  // How far along the curve it is pull away from an end, found on the curve cut into small pieces.
  const n = 64
  const tFrom = (fromEnd: boolean) => {
    const end = fromEnd ? pts[3] : pts[0]
    for (let i = 1; i <= n; i++) {
      const t = fromEnd ? 1 - i / n : i / n, q = cubicAt(pts, t)
      if (Math.hypot(q[0] - end[0], q[1] - end[1]) >= pull) return t
    }
    return fromEnd ? 0 : 1
  }
  const t1 = heads === 'none' ? 1 : tFrom(true), t0 = heads === 'both' ? tFrom(false) : 0
  ctx.globalAlpha *= a.lineOpacity ?? 1
  ctx.lineWidth = lw
  setDash(ctx, a.dash, lw)
  if (t1 > t0) {
    const q = subCubic(pts, t0, t1)
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.bezierCurveTo(q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]); ctx.stroke()
  }
  ctx.setLineDash([])
  // A head points from where the curve was cut toward its end: steady however the handles sit.
  const angTo = (end: Pt, from: Pt) => Math.atan2(end[1] - from[1], end[0] - from[0])
  if (heads !== 'none') arrowHead(ctx, pts[3][0], pts[3][1], angTo(pts[3], cubicAt(pts, t1)), head)
  if (heads === 'both') arrowHead(ctx, pts[0][0], pts[0][1], angTo(pts[0], cubicAt(pts, t0)), head)
}

function arrowHead(ctx: Ctx, x: number, y: number, ang: number, head: number): void {
  ctx.beginPath(); ctx.moveTo(x, y)
  ctx.lineTo(x - head * Math.cos(ang - 0.45), y - head * Math.sin(ang - 0.45))
  ctx.lineTo(x - head * Math.cos(ang + 0.45), y - head * Math.sin(ang + 0.45))
  ctx.closePath(); ctx.fill()
}

function setDash(ctx: Ctx, d: Dash | undefined, lw: number): void {
  if (d === 'dash') { ctx.setLineDash([lw * 3, lw * 2]); ctx.lineCap = 'butt' }
  else if (d === 'dot') { ctx.setLineDash([0.01, lw * 2]); ctx.lineCap = 'round' }
  else ctx.setLineDash([])
}

function setTextFont(ctx: Ctx, px: number, bold = true, font?: string): void {
  ctx.font = `${bold ? 'bold' : 'normal'} ${px}px ${font ? `"${font}", ` : ''}${FONT_FAMILY}`
}

// Keeps saved JSON readable (0.65, not 0.6499999999999998); 4 places is finer than a pixel at 1080p.
export function roundCoords(a: Annotation): Annotation {
  const r = (v: number) => Math.round(v * 10000) / 10000
  switch (a.kind) {
    case 'text': return { ...a, x: r(a.x), y: r(a.y), ...(a.quad ? { quad: a.quad.map(([x, y]) => [r(x), r(y)]) as Quad } : {}) }
    case 'arrow': return { ...a, x1: r(a.x1), y1: r(a.y1), x2: r(a.x2), y2: r(a.y2), ...(a.c1 && a.c2 ? { c1: [r(a.c1[0]), r(a.c1[1])] as Pt, c2: [r(a.c2[0]), r(a.c2[1])] as Pt } : {}) }
    case 'image': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h), ...(a.quad ? { quad: a.quad.map(([x, y]) => [r(x), r(y)]) as Quad } : {}),
      ...(a.flat ? { flat: { x: r(a.flat.x), y: r(a.flat.y), w: r(a.flat.w), h: r(a.flat.h) } } : {}) }
    case 'circle': case 'rect': return { ...a, x: r(a.x), y: r(a.y), w: r(a.w), h: r(a.h) }
    default: return { ...a, points: a.points.map(([x, y]) => [r(x), r(y)] as [number, number]) }
  }
}

export function pointInPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function pointsBox(points: [number, number][]): Rect {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
