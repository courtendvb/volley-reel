import { describe, expect, it } from 'vitest'
import { pdfFromJpegs } from './pdf'

const read = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

describe('pdfFromJpegs', () => {
  const page = { jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), width: 1920, height: 1080 }
  const out = read(pdfFromJpegs([page, page]))
  it('has a page for each picture, the picture\'s shape', () => {
    expect(out.startsWith('%PDF-1.4')).toBe(true)
    expect(out).toContain('/Count 2')
    expect(out).toContain('/MediaBox [0 0 960 540]')
    expect(out.match(/\/Subtype \/Image/g)).toHaveLength(2)
  })
  it('points the index at each object', () => {
    const start = Number(out.match(/startxref\n(\d+)/)![1])
    expect(out.slice(start, start + 4)).toBe('xref')
    const rows = out.slice(start).match(/^\d{10} 00000 n /gm)!
    rows.forEach((r, i) => expect(out.slice(Number(r.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true))
  })
})
