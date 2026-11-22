import { describe, expect, it } from 'vitest'
import type { Annotation } from './annotation'
import { editableInPptx, slideShapes, type ShapeImage } from './pptxShapes'

// Enough of a 2D context to measure text: width = 0.5 * font px per character.
const fake = { font: '', measureText: (t: string) => ({ width: t.length * 0.5 * parseFloat(/(\d+(\.\d+)?)px/.exec(fake.font)![1]) }) }
const pic: ShapeImage = { data: new Uint8Array([1]), type: 'png', width: 400, height: 200 }
const opts = { cx: 12192000, cy: 6858000, ctx: fake as unknown as CanvasRenderingContext2D, W: 1920, H: 1080, image: (id: string) => (id === 'have' ? pic : null), firstRid: 3 }
const shapes = (list: Annotation[]) => slideShapes(list, opts)

const arrow: Annotation = { id: 'a', kind: 'arrow', color: '#EF4444', x1: 0.5, y1: 0.5, x2: 0.25, y2: 0.75, width: 6 }

describe('slideShapes', () => {
  it('makes a straight arrow a connector, flipped the way it points, with its head at the end', () => {
    const { xml } = shapes([arrow])
    expect(xml).toContain('<p:cxnSp>')
    expect(xml).toContain('<a:xfrm flipH="1"><a:off x="3048000" y="3429000"/><a:ext cx="3048000" cy="1714500"/></a:xfrm>')
    expect(xml).toContain('<a:tailEnd type="triangle"')
    expect(xml).not.toContain('<a:headEnd')
    expect(xml).toContain('<a:ln w="57150"') // 6 px at 720p of a 7.5 in slide
    expect(xml).toContain('<a:srgbClr val="EF4444">')
  })
  it('gives a two-headed arrow both heads, and none to a plain line', () => {
    expect(shapes([{ ...arrow, heads: 'both' }]).xml).toMatch(/headEnd.*tailEnd/)
    expect(shapes([{ ...arrow, heads: 'none' }]).xml).not.toMatch(/headEnd|tailEnd/)
  })
  it('makes a curved arrow a freeform Bézier, and a polygon a closed filled freeform', () => {
    const curve = shapes([{ ...arrow, c1: [0.4, 0.4], c2: [0.3, 0.9] }]).xml
    expect(curve).toContain('<a:cubicBezTo>')
    expect(curve).toContain('fill="none"')
    const poly = shapes([{ id: 'p', kind: 'polygon', color: '#22C55E', points: [[0.1, 0.1], [0.3, 0.1], [0.2, 0.3]], width: 4, fill: '#22C55E', fillOpacity: 0.5 }]).xml
    expect(poly).toContain('<a:close/>')
    expect(poly).toContain('<a:alpha val="50000"/>')
    expect(poly).not.toContain('fill="none"')
  })
  it('keeps a box or circle with its fill, its opacity and no line when it has none', () => {
    const xml = shapes([{ id: 'c', kind: 'circle', color: '#3B82F6', x: 0.1, y: 0.2, w: 0.3, h: 0.4, width: 0, fill: '#3B82F6', opacity: 0.5 }]).xml
    expect(xml).toContain('prst="ellipse"')
    expect(xml).toContain('<a:ln><a:noFill/></a:ln>')
    expect(xml).toContain('<a:alpha val="50000"/>')
  })
  it('writes text as a text box: escaped, its size in points, its lines, bold, its box', () => {
    const xml = shapes([{ id: 't', kind: 'text', color: '#FFFFFF', x: 0.5, y: 0.1, text: 'A & B\n<2>', size: 40, align: 'center',
      box: { fill: '#0F172A', fillOpacity: 0.7, stroke: null, strokeWidth: 2, padding: 8 } }]).xml
    expect(xml).toContain('txBox="1"')
    expect(xml).toContain('<a:t>A &amp; B</a:t>')
    expect(xml).toContain('<a:t>&lt;2&gt;</a:t>')
    expect(xml).toContain('sz="3000"') // 40 px at 720p = 30 pt on a 7.5 in slide
    expect(xml).toContain('b="1"')
    expect(xml).toContain('algn="ctr"')
    expect(xml).toContain('<a:srgbClr val="0F172A"><a:alpha val="70000"/>')
  })
  it('puts a picture in with its own media id, cropped', () => {
    const { xml, media } = shapes([
      { id: 'i', kind: 'image', color: '#FFF', x: 0, y: 0, w: 0.2, h: 0.2, assetId: 'have', crop: { x: 0.1, y: 0, w: 0.5, h: 1 } },
      { id: 'j', kind: 'image', color: '#FFF', x: 0.5, y: 0, w: 0.2, h: 0.2, assetId: 'have' },
    ])
    expect(media).toHaveLength(2)
    expect(xml).toContain('r:embed="rId3"')
    expect(xml).toContain('r:embed="rId4"')
    expect(xml).toContain('<a:srcRect l="10000" t="0" r="40000" b="0"/>')
  })
  it('groups the objects of a group together, where the first one is', () => {
    const xml = shapes([{ ...arrow, id: '1', groupId: 'g' }, { ...arrow, id: '2' }, { ...arrow, id: '3', groupId: 'g' }]).xml
    expect(xml.match(/<p:grpSp>/g)).toHaveLength(1)
    expect(xml.indexOf('<p:grpSp>')).toBe(0)
    expect(xml.split('</p:grpSp>')[0].match(/<p:cxnSp>/g)).toHaveLength(2)
  })
  it('gives every shape its own id', () => {
    const ids = [...shapes([arrow, { ...arrow, id: 'b' }, { ...arrow, id: 'c' }]).xml.matchAll(/cNvPr id="(\d+)"/g)].map(m => m[1])
    expect(new Set(ids).size).toBe(3)
    expect(ids).not.toContain('2') // the slide's picture
  })
})

describe('editableInPptx', () => {
  it('leaves the locked court and pictures laid with perspective (or missing) to the picture', () => {
    const img: Annotation = { id: 'i', kind: 'image', color: '#FFF', x: 0, y: 0, w: 0.2, h: 0.2, assetId: 'have' }
    expect(editableInPptx(arrow, opts.image)).toBe(true)
    expect(editableInPptx({ ...arrow, locked: true }, opts.image)).toBe(false)
    expect(editableInPptx(img, opts.image)).toBe(true)
    expect(editableInPptx({ ...img, assetId: 'gone' }, opts.image)).toBe(false)
    expect(editableInPptx({ ...img, quad: [[0, 0], [1, 0], [0, 1], [1, 1]] }, opts.image)).toBe(false)
    expect(shapes([{ ...arrow, locked: true }]).xml).toBe('')
  })
})

describe('text details', () => {
  it('outlines light text with a glow behind the letters, not a line over them', () => {
    const xml = slideShapes([{ id: 't', kind: 'text', color: '#FFFFFF', x: 0.1, y: 0.1, text: 'Hi', size: 40 }], opts).xml
    expect(xml).toContain('<a:glow rad="68580">')
    expect(xml).not.toMatch(/<a:rPr[^>]*>(?:(?!<\/a:rPr>).)*<a:ln/)
    expect(slideShapes([{ id: 't', kind: 'text', color: '#FFFFFF', x: 0.1, y: 0.1, text: 'Hi', size: 40, outline: false }], opts).xml).not.toContain('glow')
  })
  it('keeps a cell its own width, centred on its point, however long the text', () => {
    const xml = slideShapes([{ id: 't', kind: 'text', color: '#0F172A', x: 0.5, y: 0.5, text: 'A very long line of text here', size: 40, align: 'center',
      box: { fill: '#FFFFFF', fillOpacity: 1, stroke: null, strokeWidth: 2, padding: 6, width: 0.2, height: 0.08 } }], opts).xml
    expect(xml).toContain('<a:off x="4876800" ')
    expect(xml).toContain('<a:ext cx="2438400" ')
  })
})
