import { describe, expect, it } from 'vitest'
import { cleanRoles } from './roles'

describe('project positions', () => {
  it('keeps only known positions under player keys', () => {
    expect(cleanRoles({ A: 'MB', B: 'XX', '': 'OH', C: 3, D: 'L' })).toEqual({ A: 'MB', D: 'L' })
  })
  it('reads nothing usable as missing', () => {
    expect(cleanRoles(undefined)).toBeUndefined()
    expect(cleanRoles('MB')).toBeUndefined()
    expect(cleanRoles({ A: 'XX' })).toBeUndefined()
  })
})
