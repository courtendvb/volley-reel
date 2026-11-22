import { describe, expect, it } from 'vitest'
import { cleanRoles, withRoles } from './roles'
import type { ParsedDVW } from './types'

describe('project positions', () => {
  it('keeps only known positions under player keys', () => {
    expect(cleanRoles({ A: 'MB', B: 'XX', '': 'OH', C: 3, D: 'L' })).toEqual({ A: 'MB', D: 'L' })
  })
  it('reads nothing usable as missing', () => {
    expect(cleanRoles(undefined)).toBeUndefined()
    expect(cleanRoles('MB')).toBeUndefined()
    expect(cleanRoles({ A: 'XX' })).toBeUndefined()
  })
  it('puts the project positions on the players, and leaves the match alone when nothing changes', () => {
    const d = { players: { '*5': { key: 'K5', role: 'OH' }, '*7': { key: 'K7' } } } as unknown as ParsedDVW
    const out = withRoles(d, { K7: 'MB' })
    expect(out.players['*7'].role).toBe('MB')
    expect(out.players['*5']).toBe(d.players['*5'])
    expect(withRoles(d, { K5: 'OH' })).toBe(d)
    expect(withRoles(d, undefined)).toBe(d)
  })
})
