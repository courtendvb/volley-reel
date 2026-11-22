import { describe, expect, it } from 'vitest'
import { applyScoutEdits, cellOf, codeParts, partsCode, pointOf, validCode, withCodeEdit, withInsert, withLineEdit } from './codeEdit'
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
    const r = applyScoutEdits(FILE, { edits: [{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ=PA~36BH1' }] })
    const d = parseDVW(r.text, r.sources)
    const atk = d.plays.find(p => p.line === 2)!
    expect(atk.effect).toBe('=')
    expect(atk.original).toBe('a01AQ#PA~36BH1')
    expect(atk.fingerprint).toBe(plain.plays.find(p => p.line === 2)!.fingerprint)
    expect(r.stale.edits).toEqual([])
  })
  it('takes a play out, and later plays keep their fingerprints', () => {
    const plain = parseDVW(FILE)
    const r = applyScoutEdits(FILE, { edits: [{ line: 1, from: 'a09RQ+~~~16AR', to: '' }] })
    const d = parseDVW(r.text, r.sources)
    expect(d.plays.map(p => p.line)).toEqual([0, 2])
    expect(d.plays[1].fingerprint).toBe(plain.plays[2].fingerprint)
    expect(r.text).not.toContain('a09RQ+')
  })
  it('puts a play in after a line, at its own time and with no clicks', () => {
    const r = applyScoutEdits(FILE, { inserts: [{ id: 'x1', after: 1, from: 'a09RQ+~~~16AR', code: 'a09EQ+~~~~3C', time: 103 }] })
    const d = parseDVW(r.text, r.sources)
    const put = d.plays.find(p => p.inserted === 'x1')!
    expect(put).toMatchObject({ skill: 'E', time: 103, line: 1 })
    expect(d.plays.map(p => p.skill)).toEqual(['S', 'R', 'E', 'A'])
    expect(put.fingerprint).toContain('+x1')
  })
  it('leaves out corrections whose line now holds another code', () => {
    const r = applyScoutEdits(FILE, { edits: [{ line: 1, from: 'a09RQ#~~~16AR', to: 'a09RQ=~~~16AR' }], inserts: [{ id: 'y', after: 2, from: 'nope', code: '*01DQ+', time: 105 }] })
    expect(parseDVW(r.text, r.sources).plays.find(p => p.line === 1)!.effect).toBe('+')
    expect(r.stale.edits).toHaveLength(1)
    expect(r.stale.inserts).toHaveLength(1)
  })
  it('keeps the file as it is with no corrections, line ends too', () => {
    const crlf = FILE.split(LF).join(String.fromCharCode(13, 10))
    expect(applyScoutEdits(crlf, {}).text).toBe(crlf)
  })
  it('changes, adds and takes off inserts by id', () => {
    const a = withInsert(undefined, { id: 'a', after: 1, from: 'x', code: '*01DQ+', time: 1 })
    expect(withInsert(a, { id: 'a', after: 1, from: 'x', code: '*01DQ#', time: 1 })[0].code).toBe('*01DQ#')
    expect(withInsert(a, { id: 'a', after: 1, from: 'x', code: '', time: 1 })).toEqual([])
  })
})

describe('clicks', () => {
  it('turns a cell into a point and back', () => {
    for (const c of ['0001', '4784', '8613', '2550', '9999']) expect(cellOf(pointOf(c)!)).toBe(c)
    expect(pointOf('')).toBeNull()
  })
  it('keeps the code and the clicks in one edit, gone when both are as the file has them', () => {
    const a = withLineEdit(undefined, 2, 'a01AQ#PA~36BH1', { start: '4784', end: '8613' })
    expect(a).toEqual([{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ#PA~36BH1', start: '4784', end: '8613' }])
    const b = withLineEdit(a, 2, 'a01AQ#PA~36BH1', { to: 'a01AQ=PA~36BH1' })
    expect(b[0]).toMatchObject({ to: 'a01AQ=PA~36BH1', start: '4784', end: '8613' })
    expect(withLineEdit(a, 2, 'a01AQ#PA~36BH1', { start: null, end: null })).toEqual([])
  })
  it('writes corrected clicks into the line and reads them back', () => {
    const r = applyScoutEdits(FILE, { edits: [{ line: 2, from: 'a01AQ#PA~36BH1', to: 'a01AQ#PA~36BH1', start: '4784', end: '8613' }] })
    const atk = parseDVW(r.text, r.sources).plays.find(p => p.line === 2)!
    expect(atk.cells).toEqual({ start: '4784', end: '8613' })
    expect(atk.startClick).toEqual(pointOf('4784'))
    expect(atk.fingerprint).toBe(parseDVW(FILE).plays.find(p => p.line === 2)!.fingerprint)
  })
  it('gives an added play its own clicks', () => {
    const r = applyScoutEdits(FILE, { inserts: [{ id: 'c', after: 2, from: 'a01AQ#PA~36BH1', code: '*01DQ+', time: 105, start: '2550', end: '1234' }] })
    expect(parseDVW(r.text, r.sources).plays.find(p => p.inserted === 'c')!.cells).toEqual({ start: '2550', end: '1234' })
  })
})
