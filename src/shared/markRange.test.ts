import { describe, expect, it } from 'vitest'
import { cleanGridStyle } from './courtStyle'
import { rangePlays } from './markRange'
import type { Play } from './types'

const p = (id: number, rallyId: number | null) => ({ id, rallyId }) as Play

describe('rangePlays', () => {
  const all = [p(1, 1), p(2, 1), p(3, 2), p(4, 3)], match = [p(1, 1), p(2, 1), p(3, 2)], scene = [p(2, 1)]
  const src = { match: () => match, scene: () => scene, marker: () => [p(3, 2)] }
  it('keeps every shot without a range or for all', () => {
    expect(rangePlays(undefined, p(1, 1), () => all, src)).toBe(all)
    expect(rangePlays('all', p(1, 1), () => all, src)).toBe(all)
  })
  it('takes the match, scene and marker from their sources', () => {
    expect(rangePlays('match', p(1, 1), () => all, src)).toBe(match)
    expect(rangePlays('scene', p(1, 1), () => all, src)).toBe(scene)
    expect(rangePlays('marker', p(1, 1), () => all, src).map(x => x.id)).toEqual([3])
  })
  it('takes the rally from the match', () => {
    expect(rangePlays('rally', p(1, 1), () => all, src).map(x => x.id)).toEqual([1, 2])
  })
  it('takes the search results', () => {
    expect(rangePlays('filter', p(1, 1), () => all, { ...src, filter: () => [p(4, 3)] }).map(x => x.id)).toEqual([4])
  })
  it('falls back to every shot where there is no source', () => {
    expect(rangePlays('filter', p(1, 1), () => all, src)).toBe(all)
    expect(rangePlays('scene', p(1, 1), () => all)).toBe(all)
    expect(rangePlays('rally', p(1, null), () => all, src)).toBe(all)
  })
})

describe('cleanGridStyle range', () => {
  it('keeps a valid range per skill and drops the rest', () => {
    const g = cleanGridStyle({ bySkill: { S: { heat: true, range: 'rally' }, A: { range: 'all' }, E: { range: 'nope' } } })
    expect(g.bySkill?.S?.range).toBe('rally')
    expect(g.bySkill?.A?.range).toBeUndefined()
    expect(g.bySkill?.E?.range).toBeUndefined()
  })
})
