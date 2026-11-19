import { describe, expect, it } from 'vitest'
import { gate, type AccountState } from './account'

const team = { id: 1, name: 'T' }
const ok: AccountState = { kind: 'ok', email: 'a', team, teams: [team], suggested: [], status: 'trialing', until: null, daysLeft: 3 }
const out: AccountState = { kind: 'signed_out' }
const pick: AccountState = { kind: 'needs_team', email: 'a', suggested: [] }
const over: AccountState = { kind: 'expired', email: 'a', team, teams: [team], suggested: [], reason: 'licence_expired' }
const noApp: AccountState = { kind: 'no_access', email: 'a', team, teams: [team], suggested: [] }

describe('gate', () => {
  it('allows everything while accounts are off, and with a trial or plan', () => {
    for (const s of [out, over]) for (const w of ['export', 'import', 'newProject'] as const) expect(gate(false, s, w, 99)).toBeNull()
    for (const w of ['export', 'import', 'newProject'] as const) expect(gate(true, ok, w, 99, 50)).toBeNull()
  })

  it('lets a person not signed in try one match, without exports', () => {
    for (const s of [out, pick]) {
      expect(gate(true, s, 'import', 0, 1)).toBeNull()
      expect(gate(true, s, 'import', 1, 1)).toBe('sign_in')
      expect(gate(true, s, 'import', 0, 2)).toBe('sign_in') // a folder import of two at once
      expect(gate(true, s, 'newProject', 5)).toBeNull()
      expect(gate(true, s, 'export')).toBe('sign_in')
    }
  })

  it('allows nothing new once the trial or plan is over', () => {
    for (const s of [over, noApp]) {
      expect(gate(true, s, 'import', 0, 1)).toBe('plan')
      expect(gate(true, s, 'newProject')).toBe('plan')
      expect(gate(true, s, 'export')).toBe('plan')
    }
  })
})
