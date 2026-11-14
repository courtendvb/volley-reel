// A slide's objects as PowerPoint shapes (DrawingML), so they can still be moved and edited in the
// deck: text as text boxes, boxes and circles as shapes, straight arrows as connectors, curves and
// lines as freeforms, pictures as pictures. What PowerPoint cannot show as a shape (a picture laid
// with perspective, the locked court of a data slide) stays in the slide's picture underneath.
//
// Sizes in an annotation are px at 720p of the picture's height, so one of them is cy / 720 EMU.
import { bounds, coverCrop, type Annotation, type ArrowAnnotation, type Dash } from './annotation'
import type { Ctx } from './court'

export interface ShapeImage { data: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number }

export interface ShapeOptions {
  cx: number // the slide in EMU
  cy: number
  ctx: Ctx // to measure text, at W × H px
  W: number
  H: number
  image: (assetId: string) => ShapeImage | null
  firstRid: number // relationship ids for the pictures start here (the slide's own come before)
}

export interface SlideShapes { xml: string; media: ShapeImage[] }

// Whether the object goes into the deck as a shape of its own (else it is drawn into the picture).
export function editableInPptx(a: Annotation, image: (assetId: string) => ShapeImage | null): boolean {
  if (a.locked) return false
  if (a.kind === 'image') return !a.quad && !!image(a.assetId)
  return true
}

interface Box { x: number; y: number; w: number; h: number } // EMU
interface Built { xml: string; box: Box }

const FONT = 'Segoe UI', EA_FONT = 'Yu Gothic UI'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const hex = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : '000000')
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100000)
const clr = (c: string, alpha = 1) => `<a:srgbClr val="${hex(c)}">${alpha < 1 ? `<a:alpha val="${pct(alpha)}"/>` : ''}</a:srgbClr>`
const solid = (c: string, alpha = 1) => `<a:solidFill>${clr(c, alpha)}</a:solidFill>`
const int = (n: number) => Math.round(n)

export function slideShapes(list: Annotation[], o: ShapeOptions): SlideShapes {
  const media: ShapeImage[] = []
  let nextId = 3 // 1: the tree, 2: the slide's picture
  const unit = o.cy / 720 // EMU for a px at 720p
  const ctx = { ...o, unit, id: () => nextId++, media: (m: ShapeImage) => { media.push(m); return `rId${o.firstRid + media.length - 1}` } }
  const kept = list.filter(a => editableInPptx(a, o.image))
  // A group goes in where its first object is, its objects together.
  const out: string[] = [], done = new Set<string>()
  for (const a of kept) {
    if (done.has(a.id)) continue
    const members = a.groupId ? kept.filter(b => b.groupId === a.groupId) : [a]
    members.forEach(b => done.add(b.id))
    const built = members.map(b => shape(b, ctx)).filter((b): b is Built => !!b)
    if (!built.length) continue
    out.push(built.length === 1 ? built[0].xml : group(built, ctx.id()))
  }
  return { xml: out.join(''), media }
}

type Ctx2 = ShapeOptions & { unit: number; id: () => number; media: (m: ShapeImage) => string }

function shape(a: Annotation, o: Ctx2): Built | null {
  switch (a.kind) {
    case 'text': return textShape(a, o)
    case 'image': return pictureShape(a, o)
    case 'arrow': return a.c1 && a.c2 ? pathShape(a, [[a.x1, a.y1], a.c1, a.c2, [a.x2, a.y2]], true, false, o) : lineShape(a, o)
    case 'rect': case 'circle': return boxShape(a, o)
    default: return a.points.length < 2 ? null : pathShape(a, a.points, false, a.kind === 'polygon', o)
  }
}

const xfrm = (b: Box, flipH = false, flipV = false) =>
  `<a:xfrm${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}><a:off x="${int(b.x)}" y="${int(b.y)}"/><a:ext cx="${int(Math.max(1, b.w))}" cy="${int(Math.max(1, b.h))}"/></a:xfrm>`
const nv = (id: number, name: string, txBox = false) => `<p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr${txBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>`

function line(o: Ctx2, a: { color: string; width: number; dash?: Dash; opacity?: number; lineOpacity?: number }, heads?: { start: boolean; end: boolean }): string {
  if (!(a.width > 0)) return '<a:ln><a:noFill/></a:ln>'
  const dash = a.dash === 'dash' ? '<a:prstDash val="dash"/>' : a.dash === 'dot' ? '<a:prstDash val="sysDot"/>' : ''
  // PowerPoint's heads are sized against the line: ours are 3.2 times its width, more on thin lines.
  const big = Math.max(3.2, 10 / a.width) >= 4 ? 'lg' : 'med'
  const head = (tag: string) => `<a:${tag} type="triangle" w="${big}" len="${big}"/>`
  return `<a:ln w="${int(a.width * o.unit)}" cap="${a.dash === 'dash' ? 'flat' : 'rnd'}">${solid(a.color, (a.opacity ?? 1) * (a.lineOpacity ?? 1))}${dash}<a:round/>`
    + `${heads?.start ? head('headEnd') : ''}${heads?.end ? head('tailEnd') : ''}</a:ln>`
}

function lineShape(a: ArrowAnnotation, o: Ctx2): Built {
  const x1 = a.x1 * o.cx, y1 = a.y1 * o.cy, x2 = a.x2 * o.cx, y2 = a.y2 * o.cy
  const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
  const heads = a.heads ?? 'end', id = o.id()
  return { box, xml: `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Arrow ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`
    + `<p:spPr>${xfrm(box, x2 < x1, y2 < y1)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${line(o, a, { start: heads === 'both', end: heads !== 'none' })}</p:spPr></p:cxnSp>` }
}

// A freeform through points (normalized): a polyline, a polygon (closed), or a curved arrow (the
// four points of its Bézier).
function pathShape(a: Annotation & { color: string; width: number }, pts: [number, number][], curve: boolean, closed: boolean, o: Ctx2): Built {
  const xs = pts.map(p => p[0] * o.cx), ys = pts.map(p => p[1] * o.cy)
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  const w = int(Math.max(1, box.w)), h = int(Math.max(1, box.h))
  const pt = (i: number) => `<a:pt x="${int(xs[i] - box.x)}" y="${int(ys[i] - box.y)}"/>`
  const segs = curve ? `<a:cubicBezTo>${pt(1)}${pt(2)}${pt(3)}</a:cubicBezTo>` : pts.slice(1).map((_, i) => `<a:lnTo>${pt(i + 1)}</a:lnTo>`).join('')
  const filled = closed && a.kind === 'polygon' && !!a.fill
  const heads = a.kind === 'arrow' ? { start: (a.heads ?? 'end') === 'both', end: (a.heads ?? 'end') !== 'none' } : undefined
  const id = o.id()
  return { box, xml: `<p:sp>${nv(id, `${a.kind === 'arrow' ? 'Arrow' : 'Freeform'} ${id}`)}<p:spPr>${xfrm(box)}`
    + `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${w}" h="${h}"${filled ? '' : ' fill="none"'}>`
    + `<a:moveTo>${pt(0)}</a:moveTo>${segs}${closed ? '<a:close/>' : ''}</a:path></a:pathLst></a:custGeom>`
    + `${filled && a.kind === 'polygon' ? fill(a, a.opacity ?? 1) : '<a:noFill/>'}${line(o, a, heads)}</p:spPr></p:sp>` }
}

function fill(a: { fill?: string | null; fillOpacity?: number; shade?: 'ball' }, opacity: number): string {
  if (!a.fill) return '<a:noFill/>'
  const alpha = (a.fillOpacity ?? 1) * opacity
  if (a.shade !== 'ball') return solid(a.fill, alpha)
  // Lit as a ball: light up left, the colour, darker toward the bottom (as drawn on the canvas).
  const gs = (pos: number, c: string) => `<a:gs pos="${pos}">${clr(c, alpha)}</a:gs>`
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs(0, mix(a.fill, '#FFFFFF', 0.42))}${gs(35000, mix(a.fill, '#FFFFFF', 0.08))}${gs(75000, a.fill)}${gs(100000, mix(a.fill, '#000000', 0.38))}</a:gsLst>`
    + '<a:path path="circle"><a:fillToRect l="15000" t="10000" r="85000" b="90000"/></a:path></a:gradFill>'
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(hex(h).slice(i * 2, i * 2 + 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

function boxShape(a: Extract<Annotation, { kind: 'rect' | 'circle' }>, o: Ctx2): Built {
  const box = { x: a.x * o.cx, y: a.y * o.cy, w: a.w * o.cx, h: a.h * o.cy }, id = o.id()
  return { box, xml: `<p:sp>${nv(id, `${a.kind === 'rect' ? 'Rectangle' : 'Oval'} ${id}`)}<p:spPr>${xfrm(box)}<a:prstGeom prst="${a.kind === 'rect' ? 'rect' : 'ellipse'}"><a:avLst/></a:prstGeom>`
    + `${fill(a, a.opacity ?? 1)}${line(o, a)}</p:spPr></p:sp>` }
}

function textShape(a: Extract<Annotation, { kind: 'text' }>, o: Ctx2): Built {
  // A cell of fixed size is that size whatever the text (which shrinks to fit it, below).
  const b = bounds(o.ctx, a, o.W, o.H), cell = a.box?.height ? a.box : null
  const box = { x: b.x * o.cx, y: b.y * o.cy, w: b.w * o.cx, h: b.h * o.cy }
  if (cell?.width) {
    box.w = cell.width * o.cx
    box.x = a.align === 'center' ? a.x * o.cx - box.w / 2 : (a.x * o.cx) - cell.padding * o.unit
  }
  const op = a.opacity ?? 1, lines = a.text.split('\n')
  // A cell of fixed size shrinks its text to fit, as on the canvas.
  let size = a.size
  if (a.box?.height) {
    const s = o.H / 720, pad = a.box.padding * s
    o.ctx.font = `${a.bold !== false ? 'bold' : 'normal'} ${a.size * s}px ${a.font ? `"${a.font}", ` : ''}"${FONT}", "${EA_FONT}", sans-serif`
    const wMax = Math.max(1, ...lines.map(l => o.ctx.measureText(l).width))
    const roomW = a.box.width ? a.box.width * o.W - 2 * pad : Infinity, roomH = a.box.height * o.H - 2 * pad
    size *= Math.min(1, roomW / wMax, roomH / (a.size * s * 1.2 * lines.length))
  }
  const tb = a.box
  const geom = tb?.circle ? 'ellipse' : tb?.radius ? 'roundRect' : 'rect'
  const adj = geom === 'roundRect' ? `<a:gd name="adj" fmla="val ${int(Math.min(50000, ((tb!.radius! * o.unit) / Math.max(1, Math.min(box.w, box.h))) * 100000))}"/>` : ''
  const boxFill = tb?.fill ? solid(tb.fill, tb.fillOpacity * op) : '<a:noFill/>'
  const boxLine = tb?.stroke && tb.strokeWidth > 0 ? `<a:ln w="${int(tb.strokeWidth * o.unit)}">${solid(tb.stroke, op)}</a:ln>` : '<a:ln><a:noFill/></a:ln>'
  const ins = int((tb?.padding ?? 0) * o.unit)
  const centred = a.align === 'center' || !!tb?.circle
  // The black outline that keeps light text readable, as a tight glow: PowerPoint draws a text
  // outline over the letters, which thins them, where the canvas draws it behind.
  const outline = a.outline !== false && a.color.toUpperCase() !== '#0F172A'
    ? `<a:effectLst><a:glow rad="${int(Math.max(2, size * 0.18) * o.unit)}"><a:srgbClr val="000000"/></a:glow></a:effectLst>` : ''
  const font = `<a:latin typeface="${esc(a.font ?? FONT)}"/><a:ea typeface="${esc(a.font ?? EA_FONT)}"/>`
  const rPr = `<a:rPr lang="ja-JP" sz="${Math.max(100, Math.round(size * 0.75 * (o.cy / 6858000) * 100))}" b="${a.bold !== false ? 1 : 0}" dirty="0">${solid(a.color, op)}${outline}${font}</a:rPr>`
  const paras = (tb?.circle ? [lines.join(' ')] : lines).map(l => `<a:p><a:pPr algn="${centred ? 'ctr' : 'l'}"/>${l ? `<a:r>${rPr}<a:t>${esc(l)}</a:t></a:r>` : ''}<a:endParaRPr lang="ja-JP" sz="${Math.max(100, Math.round(size * 0.75 * (o.cy / 6858000) * 100))}" dirty="0"/></a:p>`).join('')
  const id = o.id()
  return { box, xml: `<p:sp>${nv(id, `Text ${id}`, true)}<p:spPr>${xfrm(box)}<a:prstGeom prst="${geom}"><a:avLst>${adj}</a:avLst></a:prstGeom>${boxFill}${boxLine}</p:spPr>`
    + `<p:txBody><a:bodyPr wrap="none" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="ctr" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>` }
}

function pictureShape(a: Extract<Annotation, { kind: 'image' }>, o: Ctx2): Built | null {
  const img = o.image(a.assetId)
  if (!img) return null
  const box = { x: a.x * o.cx, y: a.y * o.cy, w: a.w * o.cx, h: a.h * o.cy }
  const c = a.crop ?? (a.fit === 'cover' ? coverCrop(img.width, img.height, a.w * o.W, a.h * o.H) : undefined)
  const src = c ? `<a:srcRect l="${pct(c.x)}" t="${pct(c.y)}" r="${pct(1 - c.x - c.w)}" b="${pct(1 - c.y - c.h)}"/>` : ''
  const op = a.opacity ?? 1, rid = o.media(img), id = o.id()
  return { box, xml: `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rid}">${op < 1 ? `<a:alphaModFix amt="${pct(op)}"/>` : ''}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` }
}

function group(parts: Built[], id: number): string {
  const x = Math.min(...parts.map(p => p.box.x)), y = Math.min(...parts.map(p => p.box.y))
  const w = Math.max(...parts.map(p => p.box.x + p.box.w)) - x, h = Math.max(...parts.map(p => p.box.y + p.box.h)) - y
  const r = (n: number) => int(n), e = (n: number) => int(Math.max(1, n))
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="${r(x)}" y="${r(y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/><a:chOff x="${r(x)}" y="${r(y)}"/><a:chExt cx="${e(w)}" cy="${e(h)}"/></a:xfrm></p:grpSpPr>`
    + `${parts.map(p => p.xml).join('')}</p:grpSp>`
}
