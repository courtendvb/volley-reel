// English skill / evaluation names (design §3.7). The same effect means different things per skill.
// Will move to project.json so it can be edited by hand.

export const SKILLS: Record<string, string> = {
  S: 'Serve', R: 'Reception', A: 'Attack', B: 'Block', D: 'Dig', E: 'Set',
}

export const EFFECTS: Record<string, Record<string, string>> = {
  S: { '#': 'Ace', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  R: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  A: { '#': 'Kill', '+': 'Positive', '!': 'Recovered', '-': 'Negative', '/': 'Blocked', '=': 'Error' },
  B: { '#': 'Kill block', '+': 'Positive', '!': 'Poor', '-': 'Negative', '/': 'Invasion', '=': 'Error' },
  D: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Overpass', '=': 'Error' },
  E: { '#': 'Perfect', '+': 'Positive', '!': 'OK', '-': 'Negative', '/': 'Poor', '=': 'Error' },
}

// The "type" letter after the skill: the tempo of the ball.
export const TEMPOS: Record<string, string> = {
  H: 'High', M: 'Half', Q: 'Quick', T: 'Tense', U: 'Super', N: 'Fast', O: 'Other',
}
// Attacks: how the ball was hit (the letter after the zones).
export const HITS: Record<string, string> = { H: 'Hard', P: 'Soft', T: 'Tip' }

export const skillName = (skill: string): string => SKILLS[skill] ?? skill
export const effectName = (skill: string, effect: string): string => EFFECTS[skill]?.[effect] ?? effect

export function playLabel(skill: string, effect: string): string {
  return `${skillName(skill)} · ${effectName(skill, effect)}`
}
