import { describe, expect, it } from 'vitest'
import { effectName, shortEffectName, shortSkillName, skillName } from './labels'

describe('the play list short names', () => {
  it('shortens Reception, Positive, Negative and Recovered, and leaves the rest', () => {
    expect(shortSkillName('R')).toBe('Rec')
    expect(shortSkillName('A')).toBe('Attack')
    expect(shortEffectName('S', '+')).toBe('Pos')
    expect(shortEffectName('R', '-')).toBe('Neg')
    expect(shortEffectName('A', '!')).toBe('Recov')
    expect(shortEffectName('A', '#')).toBe('Kill')
    expect(skillName('R')).toBe('Reception') // the full names elsewhere stay
    expect(effectName('A', '!')).toBe('Recovered')
  })
})
