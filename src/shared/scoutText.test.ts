import { describe, expect, it } from 'vitest'
import { parseScout } from './vsm'
import { decodeScout } from './scoutText'

// Made-up names; one Danish letter (Æ) and one German (Ü), which UTF-8 and latin1 write differently.
const DVW = `[3DATAVOLLEYSCOUT]
FILEFORMAT: 2.0
[3TEAMS]
HTH;HOME TEAM;0;Coach;Assistant;;;;;
OPP;AWAY TEAM;0;Coach;Assistant;;;;;
[3PLAYERS-H]
0;13;1;;;;;;;KJÆR;Søren;
[3PLAYERS-V]
1;4;2;;;;;;;MÜLLER;Jan;
[3SCOUT]
`

const names = (bytes: Uint8Array) => {
  const d = parseScout(decodeScout(bytes).text)
  return [d.players['*13'], d.players['a4']].map(p => `${p.lastName} ${p.firstName}`)
}

describe('decodeScout', () => {
  it('reads a UTF-8 DVW as UTF-8', () => {
    const bytes = Buffer.from(DVW, 'utf8')
    expect(decodeScout(bytes).encoding).toBe('utf8')
    expect(names(bytes)).toEqual(['KJÆR Søren', 'MÜLLER Jan'])
  })

  it('drops a UTF-8 BOM', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(DVW, 'utf8')])
    const { text, encoding } = decodeScout(bytes)
    expect(encoding).toBe('utf8')
    expect(text.startsWith('[3DATAVOLLEYSCOUT]')).toBe(true)
    expect(names(bytes)).toEqual(['KJÆR Søren', 'MÜLLER Jan'])
  })

  it('reads a latin1 DVW as latin1, as before', () => {
    const bytes = Buffer.from(DVW, 'latin1')
    expect(decodeScout(bytes)).toEqual({ text: bytes.toString('latin1'), encoding: 'latin1' })
    expect(names(bytes)).toEqual(['KJÆR Søren', 'MÜLLER Jan'])
  })

  it('reads plain ASCII the same either way', () => {
    const bytes = Buffer.from('[3SCOUT]\r\n*01SQ-;', 'latin1')
    expect(decodeScout(bytes).text).toBe(bytes.toString('latin1'))
  })

  it('handles a file larger than one chunk', () => {
    const bytes = Buffer.from('é'.repeat(100_000), 'latin1')
    expect(decodeScout(bytes).text).toBe(bytes.toString('latin1'))
  })
})
