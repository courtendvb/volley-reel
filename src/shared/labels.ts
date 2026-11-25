// Skill / evaluation names (design §3.7). The same effect means different things per skill.
// The Japanese and English screens use the English scout words; the Spanish screens use Spanish ones.
// Will move to project.json so it can be edited by hand.
import { getLang } from './i18n'

export const SKILL_CODES = ['S', 'R', 'A', 'B', 'D', 'E'] as const

const SKILLS: Record<string, string> = {
  S: 'Serve', R: 'Reception', A: 'Attack', B: 'Block', D: 'Dig', E: 'Set',
}
const SKILLS_ES: Record<string, string> = {
  S: 'Saque', R: 'Recepción', A: 'Ataque', B: 'Bloqueo', D: 'Defensa', E: 'Armado',
}

const EFFECTS: Record<string, Record<string, string>> = {
  S: { '#': 'Ace', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  R: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  A: { '#': 'Kill', '+': 'Positive', '!': 'Recovered', '-': 'Negative', '/': 'Blocked', '=': 'Error' },
  B: { '#': 'Kill block', '+': 'Positive', '!': 'Poor', '-': 'Negative', '/': 'Invasion', '=': 'Error' },
  D: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  E: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Poor', '=': 'Error' },
}
// Agreeing with the skill: la recepción / la defensa are feminine, the rest masculine.
const EFFECTS_ES: Record<string, Record<string, string>> = {
  S: { '#': 'Ace', '+': 'Positivo', '!': 'OK', '-': 'Negativo', '/': 'Devuelta', '=': 'Error' },
  R: { '#': 'Perfecta', '+': 'Positiva', '!': 'OK', '-': 'Negativa', '/': 'Devuelta', '=': 'Error' },
  A: { '#': 'Punto', '+': 'Positivo', '!': 'Recuperado', '-': 'Negativo', '/': 'Bloqueado', '=': 'Error' },
  B: { '#': 'Punto', '+': 'Positivo', '!': 'Malo', '-': 'Negativo', '/': 'Invasión', '=': 'Error' },
  D: { '#': 'Perfecta', '+': 'Positiva', '!': 'OK', '-': 'Negativa', '/': 'Devuelta', '=': 'Error' },
  E: { '#': 'Perfecto', '+': 'Positivo', '!': 'OK', '-': 'Negativo', '/': 'Malo', '=': 'Error' },
}

// The "type" letter after the skill: the tempo of the ball.
export const TEMPO_CODES = ['H', 'M', 'Q', 'T', 'U', 'N', 'O']
const TEMPOS: Record<string, string> = {
  H: 'High', M: 'Half', Q: 'Quick', T: 'Tense', U: 'Super', N: 'Fast', O: 'Other',
}
const TEMPOS_ES: Record<string, string> = {
  H: 'Alta', M: 'Media', Q: 'Rápida', T: 'Tensa', U: 'Súper', N: 'Veloz', O: 'Otra',
}
// Attacks: how the ball was hit (the letter after the zones).
export const HIT_CODES = ['H', 'P', 'T']
const HITS: Record<string, string> = { H: 'Hard', P: 'Soft', T: 'Tip' }
const HITS_ES: Record<string, string> = { H: 'Potente', P: 'Suave', T: 'Finta' }

const es = (): boolean => getLang() === 'es'

export const skillName = (skill: string): string => (es() ? SKILLS_ES : SKILLS)[skill] ?? skill
// All six evaluations of a skill by their code, or undefined for an unknown skill.
export const effectNames = (skill: string): Record<string, string> | undefined => (es() ? EFFECTS_ES : EFFECTS)[skill]
export const effectName = (skill: string, effect: string): string => effectNames(skill)?.[effect] ?? effect
export const tempoName = (tempo: string): string => (es() ? TEMPOS_ES : TEMPOS)[tempo] ?? tempo
export const hitName = (hit: string): string => (es() ? HITS_ES : HITS)[hit] ?? hit
// The free ball, a skill of its own only in the "plays around" search.
export const freeballName = (): string => (es() ? 'Pelota fácil' : 'Freeball')

// The play list's narrower words, where the full ones crowd the row.
const SHORT: Record<string, string> = {
  Reception: 'Rec', Positive: 'Pos', Negative: 'Neg', Recovered: 'Recov',
  Recepción: 'Rec', Positivo: 'Pos', Positiva: 'Pos', Negativo: 'Neg', Negativa: 'Neg', Recuperado: 'Recup',
  Perfecto: 'Perf', Perfecta: 'Perf', // "Armado · Perfecto" pushed the combination (KM…) out of the row
}
const short = (name: string): string => SHORT[name] ?? name
export const shortSkillName = (skill: string): string => short(skillName(skill))
export const shortEffectName = (skill: string, effect: string): string => short(effectName(skill, effect))

export function playLabel(skill: string, effect: string): string {
  return `${skillName(skill)} · ${effectName(skill, effect)}`
}
