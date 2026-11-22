// A PDF of whole-page pictures: enough for a printable or shareable set of cards. Pure: bytes in, bytes out.
export interface PdfPage { jpeg: Uint8Array; width: number; height: number } // pixels

const text = (s: string) => new TextEncoder().encode(s)

export function pdfFromJpegs(pages: PdfPage[]): Uint8Array {
  const PAGE_W = 960 // points; the height follows the picture
  const objects: (Uint8Array | string)[][] = []
  // 1 catalog, 2 page list, then three for each page: the page, its drawing, its picture.
  const pageId = (i: number) => 3 + i * 3
  objects.push(['<< /Type /Catalog /Pages 2 0 R >>'])
  objects.push([`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`])
  pages.forEach((p, i) => {
    const id = pageId(i), h = Math.round((PAGE_W * p.height) / p.width)
    const draw = `q ${PAGE_W} 0 0 ${h} 0 0 cm /Im0 Do Q`
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`])
    objects.push([`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`])
    objects.push([`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream'])
  })
  const parts: Uint8Array[] = [text('%PDF-1.4\n')]
  let at = parts[0].length
  const put = (b: Uint8Array) => { parts.push(b); at += b.length }
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(at)
    put(text(`${i + 1} 0 obj\n`))
    for (const piece of o) put(typeof piece === 'string' ? text(piece) : piece)
    put(text('\nendobj\n'))
  })
  const xref = at
  const rows = offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  put(text(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  const out = new Uint8Array(at)
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}
