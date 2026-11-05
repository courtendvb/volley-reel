import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, type Person, type PlayRef } from './filter'
import { filterTitle, playStats, statAnnotations } from './stats'

const ref = (skill: string, effect: string) => ({ play: { skill, effect } }) as PlayRef
const many = (skill: string, effects: string) => [...effects].map(e => ref(skill, e))

describe('playStats', () => {
  it('attack: kills over attacks, efficiency takes off errors and blocks', () => {
    const [l] = playStats(many('A', '####+-=/!!'))
    expect(l.value).toBe('40%')
    expect(l.detail).toContain('4 / 10')
    expect(l.detail).toContain('20%') // (4 − 1 − 1) / 10
  })

  it('serve, reception, block, dig; attack first and sets left out', () => {
    const lines = playStats([...many('E', '##'), ...many('D', '#=+'), ...many('B', '#-'), ...many('R', '#+-='), ...many('S', '#==+'), ...many('A', '#')])
    expect(lines.map(l => l.skill)).toEqual(['A', 'S', 'R', 'B', 'D'])
    expect(lines[1].value).toBe('-25%') // serve: (1 − 2) / 4
    expect(lines[2].value).toBe('50%') // reception: # and +
    expect(lines[3].value).toBe('1') // block: a count
    expect(lines[4].value).toBe('67%') // dig: all but errors
  })

  it('is empty with no plays that count', () => {
    expect(playStats([])).toEqual([])
    expect(playStats(many('E', '#'))).toEqual([])
  })
})

describe('filterTitle', () => {
  const people = [{ key: 'K', name: 'ARAI', jerseys: [7] }] as Person[]
  it('says the search in words, leaving evaluations out', () => {
    expect(filterTitle(EMPTY_FILTER, [], 'HTH')).toBe('すべてのプレー')
    expect(filterTitle({ ...EMPTY_FILTER, team: 'our', effects: ['#'] }, [], 'HTH')).toBe('HTH')
    expect(filterTitle({ ...EMPTY_FILTER, persons: ['K'], team: 'our', rots: [3, 1], sets: [2] }, people, 'HTH')).toBe('#7 ARAI・第 2 セット・ローテ 1・3')
  })
})

describe('statAnnotations', () => {
  it('makes editable text, at most three lines', () => {
    const lines = playStats([...many('A', '#'), ...many('S', '#'), ...many('R', '#'), ...many('D', '#')])
    let n = 0
    const list = statAnnotations('T', lines, () => String(n++))
    expect(list).toHaveLength(1 + 3 * 3)
    expect(list.every(a => a.kind === 'text')).toBe(true)
    expect(new Set(list.map(a => a.id)).size).toBe(list.length)
  })
})
