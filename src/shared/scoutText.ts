// A scout file's bytes as text. DataVolley writes .dvw as Windows-1252, but other tools (VolleyMetrics,
// for one) export UTF-8; a .vsm is JSON, UTF-8. Bytes that are valid UTF-8 (a BOM, if any, is dropped)
// are read as UTF-8, any others as latin1 — a cp1252 file with accented letters is never valid UTF-8,
// and a plain-ASCII one reads the same either way. Pure: no file access.
export type ScoutEncoding = 'utf8' | 'latin1'

const utf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeScout(bytes: Uint8Array): { text: string; encoding: ScoutEncoding } {
  try {
    return { text: utf8.decode(bytes), encoding: 'utf8' }
  } catch {
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { text, encoding: 'latin1' }
  }
}
