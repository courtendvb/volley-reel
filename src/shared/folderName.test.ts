import { describe, expect, it } from 'vitest'
import { folderName, uniqueName } from './folderName'

describe('project folder names', () => {
  it('keeps Japanese and replaces what Windows forbids', () => {
    expect(folderName('2026-27 前半ハイライト')).toBe('2026-27 前半ハイライト')
    expect(folderName('HTH: vs SMT/JT?')).toBe('HTH_ vs SMT_JT_')
  })
  it('drops trailing dots and spaces, and falls back when nothing is left', () => {
    expect(folderName('ハイライト... ')).toBe('ハイライト')
    expect(folderName('  ')).toBe('プロジェクト')
    expect(folderName('...', 'HTH プロジェクト')).toBe('HTH プロジェクト')
  })
  it('avoids reserved device names', () => {
    expect(folderName('con')).toBe('_con')
  })
  it('numbers a name already taken', () => {
    const taken = new Set(['A', 'A (2)'])
    expect(uniqueName('A', n => taken.has(n))).toBe('A (3)')
    expect(uniqueName('B', n => taken.has(n))).toBe('B')
  })
})
