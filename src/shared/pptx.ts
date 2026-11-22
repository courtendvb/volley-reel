// A PowerPoint file (.pptx) with one picture filling each slide: the cards and slides as they look
// in the video, to drop into a deck; on top of it, if given, the slide's objects as shapes of their
// own (pptxShapes.ts), so they can still be moved and edited there. Only the parts PowerPoint needs: a blank master and layout, a
// plain theme, and the slides; the slide is the pictures' shape (16:9 for the cards).
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { SlideShapes } from './pptxShapes'

export interface PptxPicture {
  data: Uint8Array
  type: 'png' | 'jpeg'
  width: number // px, for the slide's shape (the first picture's)
  height: number
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument'
const SLIDE_W = 12192000 // EMU: 13.33 in, PowerPoint's widescreen width

const rels = (list: [string, string, string][]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`
const emptyTree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface PptxSlide {
  picture: PptxPicture // fills the slide, under everything
  shapes?: SlideShapes // made with firstRid SHAPES_FIRST_RID
}
export const SHAPES_FIRST_RID = 3 // a slide's rId1 is its layout, rId2 its picture

export function pptxFromPictures(pictures: PptxPicture[], title = ''): Uint8Array {
  return pptxFromSlides(pictures.map(picture => ({ picture })), title)
}

export function pptxFromSlides(slides: PptxSlide[], title = ''): Uint8Array {
  if (!slides.length) throw new Error('no slides')
  const pictures = slides.map(s => s.picture)
  const cx = SLIDE_W, cy = Math.round((SLIDE_W * pictures[0].height) / pictures[0].width)
  const n = pictures.length
  const ext = (p: PptxPicture) => (p.type === 'png' ? 'png' : 'jpeg')
  const files: Zippable = {}
  const put = (path: string, xml: string) => { files[path] = strToU8(xml) }

  put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
    + `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>`
    + `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presentationml.presProps+xml"/>`
    + `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.presentationml.viewProps+xml"/>`
    + `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.presentationml.tableStyles+xml"/>`
    + Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}.presentationml.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + `<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/></Types>`)

  put('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'extended-properties', 'docProps/app.xml']]))
  put('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>`)
  put('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SyncScout Video Editor</Application><Slides>${n}</Slides></Properties>`)

  // The presentation: rId1 the master, rId2… the slides, then its other parts.
  const after = n + 2
  put('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  put('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ...Array.from({ length: n }, (_, i): [string, string, string] => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`]),
    [`rId${after}`, 'presProps', 'presProps.xml'], [`rId${after + 1}`, 'viewProps', 'viewProps.xml'],
    [`rId${after + 2}`, 'theme', 'theme/theme1.xml'], [`rId${after + 3}`, 'tableStyles', 'tableStyles.xml']]))
  put('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`)
  put('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  put('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)

  put('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${emptyTree}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>')
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]))
  put('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  put('ppt/theme/theme1.xml', THEME)

  pictures.forEach((p, i) => {
    const k = i + 1, media = `image${k}.${ext(p)}`, shapes = slides[i].shapes
    files[`ppt/media/${media}`] = [p.data, { level: 0 }] // already compressed
    const extra = (shapes?.media ?? []).map((m, j) => {
      const name = `image${k}_${j + 1}.${ext(m)}`
      files[`ppt/media/${name}`] = [m.data, { level: 0 }]
      return [`rId${SHAPES_FIRST_RID + j}`, 'image', `../media/${name}`] as [string, string, string]
    })
    put(`ppt/slides/slide${k}.xml`, `${XML}<p:sld ${NS}><p:cSld><p:spTree>${emptyTree}`
      + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide ${k}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
      + '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
      + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
      + (shapes?.xml ?? '') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')
    put(`ppt/slides/_rels/slide${k}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/${media}`], ...extra]))
  })
  return zipSync(files, { level: 6 })
}

// Office's plain theme, cut to what a theme must hold.
const solid = (c: string) => `<a:solidFill><a:schemeClr val="${c}"/></a:solidFill>`
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>`
  + '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
  + '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>'
  + '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>'
  + '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + `<a:fmtScheme name="Office"><a:fillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:fillStyleLst>`
  + `<a:lnStyleLst>${[6350, 12700, 19050].map(w => `<a:ln w="${w}">${solid('phClr')}</a:ln>`).join('')}</a:lnStyleLst>`
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + `<a:bgFillStyleLst>${solid('phClr')}${solid('phClr')}${solid('phClr')}</a:bgFillStyleLst></a:fmtScheme>`
  + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
