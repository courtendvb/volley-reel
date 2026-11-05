import { describe, expect, it } from 'vitest'
import { keyName } from './keys'

describe('keyName', () => {
  it('says ⌘ for Ctrl on a Mac and leaves the name elsewhere', () => {
    expect(keyName('Ctrl + C / Ctrl + V', true)).toBe('⌘C / ⌘V')
    expect(keyName('（Ctrl+Z で戻せる）', true)).toBe('（⌘Z で戻せる）')
    expect(keyName('Ctrl + Z', false)).toBe('Ctrl + Z')
  })
})
