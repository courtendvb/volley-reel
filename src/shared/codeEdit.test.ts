import { describe, expect, it } from 'vitest'
import { codeParts, partsCode, validCode, withCodeEdit } from './codeEdit'
import { parseDVW } from './dvw'

const LF = String.fromCharCode(10)
const FILE = ['[3TEAMS]', 'HTH;HOME;0;;', 'OPP;AWAY;0;;', '[3SCOUT]',
  '*01SQ-~~~16A;;;;;;;10.00.00;1;1;1;1;100;;', // line 0
  'a09RQ+~~~16AR;;;;;;;10.00.02;1;;;1;102;;', // line 1
  'a01AQ#PA~36BH1;;;;;;;10.00.04;1;;;1;104;;', // line 2
  'ap00:01;;;;;;;10.00.14;1;1;1;1;114;;', ''].join(LF)

describe('code parts', () => {
  it('reads a code into its places and writes it back the same', () => {
    for (const c of ['*01SQ-~~~16A', 'a09RQ+~~~16AR', 'a01AQ#PA~36BH1', '*12SM#']) expect(partsCode(codeParts(c))).toBe(c)
    expect(codeParts('a01AQ#PA~36BH1')).toMatchObject({ side: 'a', jersey: 1, skill: 'A', type: 'Q', effect: '#', combo: 'PA', startZone: '3', endZone: '6', endSub: 'B', rest: 'H1' })
  })
  it('changes one place and keeps the rest', () => {
    expect(partsCode({ ...codeParts('a01AQ#PA~36BH1'), effect: '=', jersey: 7 })).toBe('a07AQ=PA~36BH1')
  })
  it('tells a code that can stand for a play', () => {
    expect(validCode('*01SQ-')).toBe(true)
    expect(validCode('x01SQ-')).toBe(false)
    expect(validCode('*1SQ-')).toBe(false)
    expect(validCode('*01SQ-;x')).toBe(false)
  })
})

describe('edits', () => {
  it('keeps one per line and drops one set back to the file code', () => {
    const a = withCodeEdit(undefined, 2, 'a01AQ#PA~36BH1', 'a01AQ=PA~36BH1')
    expect(a).toEqual([{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ=PA~36BH1' }])
    expect(withCodeEdit(a, 2, 'a01AQ#PA~36BH1', 'a01AQ/PA~36BH1')).toEqual([{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ/PA~36BH1' }])
    expect(withCodeEdit(a, 2, 'a01AQ#PA~36BH1', 'a01AQ#PA~36BH1')).toEqual([])
  })
  it('lays a correction over the file, the fingerprint kept from the file code', () => {
    const plain = parseDVW(FILE)
    const d = parseDVW(FILE, [{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ=PA~36BH1' }])
    const atk = d.plays.find(p => p.line === 2)!
    expect(atk.effect).toBe('=')
    expect(atk.original).toBe('a01AQ#PA~36BH1')
    expect(atk.fingerprint).toBe(plain.plays.find(p => p.line === 2)!.fingerprint)
    expect(d.staleEdits).toBeUndefined()
  })
  it('leaves out a correction whose line now holds another code', () => {
    const d = parseDVW(FILE, [{ line: 1, from: 'a09RQ#~~~16AR', to: 'a09RQ=~~~16AR' }])
    expect(d.plays.find(p => p.line === 1)!.effect).toBe('+')
    expect(d.staleEdits).toHaveLength(1)
  })
})
