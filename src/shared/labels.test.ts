import { describe, expect, it } from 'vitest'
import { setLang } from './i18n'
import { effectName, freeballName, hitName, playLabel, shortEffectName, shortSkillName, skillName, tempoName } from './labels'
import { setTargetName } from './setChart'

describe('names on the Spanish screens', () => {
  it('uses Spanish skills and evaluations that agree with the skill, and keeps English elsewhere', () => {
    try {
      setLang('es')
      expect(playLabel('S', '-')).toBe('Saque · Negativo')
      expect(playLabel('R', '#')).toBe('Recepción · Perfecta')
      expect(playLabel('A', '#')).toBe('Ataque · Punto')
      expect(playLabel('E', '#')).toBe('Armado · Perfecto')
      expect(shortSkillName('R')).toBe('Rec')
      expect(shortEffectName('D', '+')).toBe('Pos')
      expect(shortEffectName('A', '!')).toBe('Recup')
      expect(shortEffectName('E', '#')).toBe('Perf')
      expect(tempoName('Q')).toBe('Rápida')
      expect(hitName('T')).toBe('Finta')
      expect(freeballName()).toBe('Pelota fácil')
      expect(setTargetName('left')).toBe('Zona 4')
      expect(setTargetName('dump')).toBe('Segunda')
    } finally { setLang('ja') }
    expect(playLabel('A', '#')).toBe('Attack · Kill') // the Japanese screens keep the scout's English
    expect(setTargetName('left')).toBe('Zone4')
  })
})

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
