import { describe, expect, it } from 'vitest'
import { newestFirst } from './matchOrder'

describe('newestFirst', () => {
  it('lists the latest date first, a day\'s later match above its earlier one, undated ones last', () => {
    const ms = [
      { id: 'a', date: '2026-09-22' }, { id: 'none', date: null }, { id: 'b1', date: '2026-10-24' },
      { id: 'b2', date: '2026-10-24' }, { id: 'c', date: '2026-10-10' },
    ]
    expect(newestFirst(ms).map(m => m.id)).toEqual(['b2', 'b1', 'c', 'a', 'none'])
    expect(ms[0].id).toBe('a') // the list given is left as it was
  })
})
