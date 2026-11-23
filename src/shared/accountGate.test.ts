import { describe, expect, it } from 'vitest'
import { gate, priceText, type AccountState, type PlanPrice } from './account'
import { setLang, t, type Lang } from './i18n'

const team = { id: 1, name: 'T' }
const ok: AccountState = { kind: 'ok', email: 'a', team, teams: [team], suggested: [], internal: false, status: 'trialing', until: null, daysLeft: 3 }
const out: AccountState = { kind: 'signed_out' }
const pick: AccountState = { kind: 'needs_team', email: 'a', suggested: [] }
const over: AccountState = { kind: 'expired', email: 'a', team, teams: [team], suggested: [], internal: false, reason: 'licence_expired' }
const noApp: AccountState = { kind: 'no_access', email: 'a', team, teams: [team], suggested: [], internal: false }

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

describe('priceText', () => {
  const p = (x: Partial<PlanPrice> = {}): PlanPrice => ({ amount: 39600, currency: 'jpy', interval: 'year', interval_count: 1, tax: 'inclusive', ...x })
  const run = (l: Lang, x: PlanPrice | null) => { setLang(l); try { return priceText(x, l, t) } finally { setLang('ja') } }

  it('says the yen price per year, tax included, in each language', () => {
    expect(run('ja', p())).toBe('￥39,600／年（税込）')
    expect(run('en', p())).toBe('¥39,600 / year (tax incl.)')
    expect(run('es', p({ interval: 'month', amount: 3980, tax: 'exclusive' }))).toBe('3980 JPY / mes (más impuestos)') // Spanish groups from 5 digits
  })

  it('turns cents into dollars and says a longer period', () => {
    expect(run('en', p({ currency: 'usd', amount: 2999, interval: 'month', interval_count: 3, tax: 'unspecified' }))).toBe('$29.99 / 3 months')
  })

  it('says nothing it cannot say', () => {
    expect(run('ja', null)).toBeNull()
    expect(run('ja', p({ currency: 'not-a-currency' }))).toBeNull()
  })
})
