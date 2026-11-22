import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { pptxFromPictures, type PptxPicture } from './pptx'

const pic = (b: number, type: PptxPicture['type'] = 'jpeg'): PptxPicture => ({ data: new Uint8Array([b, b, b]), type, width: 1920, height: 1080 })
const open = (pics: PptxPicture[], title?: string) => {
  const z = unzipSync(pptxFromPictures(pics, title))
  return { z, text: (p: string) => strFromU8(z[p]) }
}

describe('pptxFromPictures', () => {
  it('holds the parts PowerPoint needs, one slide per picture', () => {
    const { z } = open([pic(1), pic(2), pic(3, 'png')])
    expect(Object.keys(z).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
      'ppt/_rels/presentation.xml.rels', 'ppt/media/image1.jpeg', 'ppt/media/image2.jpeg', 'ppt/media/image3.png',
      'ppt/presProps.xml', 'ppt/presentation.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideMasters/slideMaster1.xml',
      'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/slides/_rels/slide3.xml.rels',
      'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml',
      'ppt/tableStyles.xml', 'ppt/theme/theme1.xml', 'ppt/viewProps.xml',
    ].sort())
  })
  it('keeps the pictures as they are, in order', () => {
    const { z, text } = open([pic(7), pic(9, 'png')])
    expect([...z['ppt/media/image1.jpeg']]).toEqual([7, 7, 7])
    expect([...z['ppt/media/image2.png']]).toEqual([9, 9, 9])
    expect(text('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../media/image2.png"')
  })
  it('lists every slide in the presentation, linked to its part', () => {
    const { text } = open([pic(1), pic(2)])
    const pres = text('ppt/presentation.xml'), rels = text('ppt/_rels/presentation.xml.rels')
    expect(pres.match(/<p:sldId /g)).toHaveLength(2)
    expect(pres).toContain('<p:sldId id="257" r:id="rId3"/>')
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"')
    // Every id the presentation uses is defined once.
    const ids = [...rels.matchAll(/Id="(rId\d+)"/g)].map(m => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of pres.matchAll(/r:id="(rId\d+)"/g)) expect(ids).toContain(m[1])
  })
  it('shapes the slide like the pictures, the picture filling it', () => {
    const { text } = open([pic(1)])
    expect(text('ppt/presentation.xml')).toContain('<p:sldSz cx="12192000" cy="6858000"/>')
    expect(text('ppt/slides/slide1.xml')).toContain('<a:ext cx="12192000" cy="6858000"/>')
  })
  it('names the file inside, escaped', () => {
    expect(open([pic(1)], 'A & B <1>').text('docProps/core.xml')).toContain('<dc:title>A &amp; B &lt;1&gt;</dc:title>')
  })
  it('needs at least one picture', () => {
    expect(() => pptxFromPictures([])).toThrow()
  })
})
