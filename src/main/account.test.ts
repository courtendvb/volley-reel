import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Account } from './account'
import { setLang } from '../shared/i18n'
import type { LeasePayload } from '../shared/account'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'jwk' }).x as string
const b64u = (b: Uint8Array | string) => Buffer.from(b).toString('base64url')
const DAY = 86400
const T0 = 1_800_000_000 // seconds

function makeLease(p: Partial<LeasePayload> & { device: string }, key = privateKey): string {
  const payload: LeasePayload = { v: 1, sub: 'u1', email: 'a@example.com', team: { id: 7, name: 'Team' }, apps: ['editor', 'viewer'], status: 'trialing', licence_end: '2027-01-14', iat: T0, exp: T0 + 30 * DAY, ...p }
  const signed = b64u(JSON.stringify(payload))
  return `${signed}.${b64u(sign(null, Buffer.from(signed), key))}`
}

// A fake Supabase: records the calls, answers from `routes`.
function server(routes: Record<string, (body: Record<string, unknown>) => [number, unknown]>) {
  const calls: { path: string; body: Record<string, unknown>; auth: string }[] = []
  const f = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, body = JSON.parse(String(init.body))
    calls.push({ path, body, auth: (init.headers as Record<string, string>).Authorization })
    const route = routes[path]
    if (!route) throw new Error('offline')
    const [status, data] = route(body)
    return new Response(JSON.stringify(data), { status })
  }) as unknown as typeof fetch
  return { f, calls }
}

function account(opts: { now?: number; fetch?: typeof fetch; dir?: string; enabled?: boolean; internalEmails?: string[] } = {}) {
  let now = (opts.now ?? T0) * 1000
  const a = new Account({
    dir: opts.dir ?? mkdtempSync(join(tmpdir(), 'acct-')), appVersion: '0.3.0', enabled: opts.enabled ?? true, publicKey: pub,
    encrypt: s => `enc:${s}`, decrypt: s => s.replace(/^enc:/, ''), fetch: opts.fetch, now: () => now,
    ...(opts.internalEmails ? { internalEmail: (e: string) => opts.internalEmails!.includes(e) } : {}),
  })
  return { a, at: (sec: number) => { now = sec * 1000 } }
}

function signedIn(extra: Record<string, (body: Record<string, unknown>) => [number, unknown]> = {}, p: Partial<LeasePayload> = {}) {
  const s = server({
    '/auth/v1/otp': () => [200, {}],
    '/auth/v1/verify': b => (b.token === '123456' ? [200, { access_token: 'jwt' }] : [403, { error_code: 'otp_expired' }]),
    '/functions/v1/account-lease': b => [200, { lease: makeLease({ device: String(b.device_id), ...p }), device_token: 'dev-1', teams: [{ id: 7, name: 'Team' }] }],
    ...extra,
  })
  return s
}

describe('Account', () => {
  it('lets every export through until accounts are turned on', () => {
    expect(account({ enabled: false }).a.canExport()).toBe(true)
    expect(account().a.canExport()).toBe(false)
  })

  it('signs in with the mailed code and keeps a verified lease', async () => {
    const s = signedIn()
    const { a } = account({ fetch: s.f })
    await a.sendCode(' a@example.com ')
    await expect(a.signIn('a@example.com', '000000')).rejects.toMatchObject({ code: 'invalid_code' })
    const st = await a.signIn('a@example.com', '123456')
    expect(st).toMatchObject({ kind: 'ok', email: 'a@example.com', status: 'trialing', until: '2027-01-14' })
    expect(a.canExport()).toBe(true)
    expect(s.calls.map(c => c.path)).toEqual(['/auth/v1/otp', '/auth/v1/verify', '/auth/v1/verify', '/functions/v1/account-lease'])
    expect(s.calls[0].body).toEqual({ email: 'a@example.com', create_user: true })
    expect(s.calls[3].auth).toBe('Bearer jwt')
  })

  it('stores the device token encrypted and reads it back after a restart', async () => {
    const s = signedIn(), dir = mkdtempSync(join(tmpdir(), 'acct-'))
    await account({ fetch: s.f, dir }).a.signIn('a@example.com', '123456')
    expect(JSON.parse(readFileSync(join(dir, 'account.json'), 'utf8')).token).toBe('enc:dev-1')
    const again = account({ fetch: s.f, dir }).a
    expect(again.state().kind).toBe('ok')
    await again.refresh()
    expect(s.calls.at(-1)!.body).toMatchObject({ device_token: 'dev-1', team_id: 7 })
  })

  it('stops exports when the lease runs out, and a clock turned back does not bring it back', async () => {
    const { a, at } = account({ fetch: signedIn().f })
    await a.signIn('a@example.com', '123456')
    at(T0 + 29 * DAY)
    expect(a.state()).toMatchObject({ kind: 'ok', daysLeft: expect.any(Number) })
    at(T0 + 31 * DAY)
    expect(a.state()).toMatchObject({ kind: 'expired', reason: 'lease' })
    // Seen at day 31 (every save records the time), then the clock is turned back a month.
    const { a: b, at: at2 } = account({ fetch: signedIn().f, now: T0 + 31 * DAY })
    await b.signIn('a@example.com', '123456')
    at2(T0)
    expect(b.state().kind).toBe('expired')
    // A clock a few hours behind the last time seen is still believed.
    const { a: c, at: at3 } = account({ fetch: signedIn().f, now: T0 + 10 * DAY })
    await c.signIn('a@example.com', '123456')
    at3(T0 + 10 * DAY - 3600)
    expect(c.state().kind).toBe('ok')
  })

  it('refuses a lease signed with another key, or issued to another computer', async () => {
    const other = generateKeyPairSync('ed25519').privateKey
    const forged = server({ '/auth/v1/verify': () => [200, { access_token: 'jwt' }], '/functions/v1/account-lease': b => [200, { lease: makeLease({ device: String(b.device_id) }, other), device_token: 'x', teams: [] }] })
    await expect(account({ fetch: forged.f }).a.signIn('a@example.com', '1')).rejects.toMatchObject({ code: 'server' })
    const dir = mkdtempSync(join(tmpdir(), 'acct-'))
    const { a } = account({ fetch: signedIn().f, dir })
    await a.signIn('a@example.com', '123456')
    const saved = JSON.parse(readFileSync(join(dir, 'account.json'), 'utf8'))
    writeFileSync(join(dir, 'account.json'), JSON.stringify({ ...saved, deviceId: 'copied-to-another-pc' }))
    expect(account({ dir }).a.state().kind).toBe('signed_out')
  })

  it('remembers a refusal from the server and signs out on a revoked device', async () => {
    let answer: [number, unknown] | null = null
    const s = signedIn({ '/functions/v1/account-lease': b => answer ?? [200, { lease: makeLease({ device: String(b.device_id) }), device_token: 'dev-1', teams: [{ id: 7, name: 'Team' }] }] })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    answer = [403, { error: 'payment_required' }]
    expect(await a.refresh()).toMatchObject({ kind: 'expired', reason: 'payment_required' })
    expect(a.canExport()).toBe(false)
    answer = null // paid: the next refresh brings it back
    expect((await a.refresh()).kind).toBe('ok')
    answer = [401, { error: 'invalid_device' }]
    expect((await a.refresh()).kind).toBe('signed_out')
  })

  it('keeps the lease in hand when offline', async () => {
    let online = true
    const s = signedIn({ '/functions/v1/account-lease': b => {
      if (!online) throw new Error('offline')
      return [200, { lease: makeLease({ device: String(b.device_id) }), device_token: 'dev-1', teams: [{ id: 7, name: 'Team' }] }]
    } })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    online = false
    expect((await a.refresh()).kind).toBe('ok')
    await expect(a.refresh(7)).rejects.toMatchObject({ code: 'network' }) // asked for by the user: say so
  })

  it('stays signed in with a refused lease, so the payment page can be reached', async () => {
    const s = signedIn({ '/functions/v1/account-checkout': b => [200, { url: `https://checkout.stripe.com/c/${String(b.team_id)}` }] }, { denied: 'licence_expired', exp: T0 })
    const { a } = account({ fetch: s.f })
    expect(await a.signIn('a@example.com', '123456')).toMatchObject({ kind: 'expired', reason: 'licence_expired' })
    expect(a.canExport()).toBe(false)
    expect(await a.checkoutUrl('monthly')).toBe('https://checkout.stripe.com/c/7')
    expect(s.calls.at(-1)!.body).toMatchObject({ device_token: 'dev-1', team_id: 7, plan: 'monthly' })
  })

  it('asks for the plan prices for its team, and goes without them offline or signed out', async () => {
    const prices = { monthly: { amount: 3980, currency: 'jpy', interval: 'month', interval_count: 1, tax: 'inclusive' }, annual: null, annual_trial_days: 14 }
    expect(await account().a.prices()).toBeNull() // signed out: nothing to ask with
    const s = signedIn({ '/functions/v1/account-prices': () => [200, prices] }, { denied: 'licence_expired', exp: T0 })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    expect(await a.prices()).toEqual(prices)
    expect(s.calls.at(-1)!.body).toMatchObject({ device_token: 'dev-1', team_id: 7 })
    const off = signedIn({}, { denied: 'licence_expired', exp: T0 }) // no account-prices route: offline
    const b = account({ fetch: off.f }).a
    await b.signIn('a@example.com', '123456')
    expect(await b.prices()).toBeNull()
  })

  it('opens the Customer Portal for an admin or the payer, and asks a member for the admin passcode', async () => {
    await expect(account().a.portalUrl()).rejects.toMatchObject({ code: 'invalid_device' }) // signed out
    const ADMIN = 'mnpqrs'
    let admin = false // the server's view: an admin, or the person who pays
    const s = signedIn({ '/functions/v1/account-portal': b => {
      if (b.admin_passcode !== undefined) {
        if (b.admin_passcode !== ADMIN) return [401, { error: 'invalid_credentials' }]
        admin = true
      }
      return admin ? [200, { url: 'https://billing.stripe.com/p/session/7' }] : [403, { error: 'not_admin' }]
    } }, { status: 'active' })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    expect(await a.portalUrl()).toBeNull() // a member who doesn't pay: the app asks for the admin passcode
    expect(s.calls.at(-1)).toMatchObject({ path: '/functions/v1/account-portal', body: { device_token: 'dev-1', team_id: 7 } })
    expect(s.calls.at(-1)!.body).not.toHaveProperty('admin_passcode')
    await expect(a.portalUrl(' wrong ')).rejects.toMatchObject({ code: 'wrong_admin_passcode' })
    expect(s.calls.at(-1)!.body).toMatchObject({ admin_passcode: 'wrong' })
    expect(await a.portalUrl(` ${ADMIN} `)).toBe('https://billing.stripe.com/p/session/7')
    expect(await a.portalUrl()).toBe('https://billing.stripe.com/p/session/7') // now the team's admin
    expect(a.state().kind).toBe('ok') // none of these sign out or change the state
  })

  it('says why the Customer Portal did not open', async () => {
    let answer: [number, unknown] = [409, { error: 'no_customer' }]
    const s = signedIn({ '/functions/v1/account-portal': () => answer }, { status: 'active' })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    await expect(a.portalUrl()).rejects.toMatchObject({ code: 'no_customer' })
    answer = [429, { error: 'too_many_attempts' }]
    await expect(a.portalUrl('x')).rejects.toMatchObject({ code: 'too_many_attempts' })
    answer = [200, { url: 'http://example.com/not-stripe' }]
    await expect(a.portalUrl()).rejects.toMatchObject({ code: 'server' })
  })

  it('asks for the SyncScout Web details of its team: the passcodes for an admin, the team ID alone for a member', async () => {
    await expect(account().a.webAccess()).rejects.toMatchObject({ code: 'invalid_device' }) // signed out
    let role = 'admin'
    const s = signedIn({ '/functions/v1/account-team': () => [200, role === 'admin'
      ? { slug: 'u-0123456789', role, passcode: 'abc-def-ghk', admin_passcode: 'mnpqrs' }
      : { slug: 'u-0123456789', role, passcode: 'should-not-pass' }] })
    const { a } = account({ fetch: s.f })
    await a.signIn('a@example.com', '123456')
    expect(await a.webAccess()).toEqual({ slug: 'u-0123456789', role: 'admin', passcode: 'abc-def-ghk', admin_passcode: 'mnpqrs' })
    expect(s.calls.at(-1)).toMatchObject({ path: '/functions/v1/account-team', body: { device_token: 'dev-1', team_id: 7 } })
    role = 'member'
    expect(await a.webAccess()).toEqual({ slug: 'u-0123456789', role: 'member' })
    // never kept on disk
    expect(readFileSync(join((a as unknown as { deps: { dir: string } }).deps.dir, 'account.json'), 'utf8')).not.toContain('mnpqrs')
  })

  it('lets an account in no team pick one: a suggested team, a team ID and passcode, or the trial', async () => {
    const member = new Set<number>()
    const lease = (b: Record<string, unknown>, id: number) => [200, { lease: makeLease({ device: String(b.device_id), team: { id, name: `T${id}` } }), device_token: 'dev-1', teams: [...member].map(i => ({ id: i, name: `T${i}` })), suggested: member.has(30) ? [] : [{ id: 30, name: 'Old' }] }] as [number, unknown]
    const s = signedIn({ '/functions/v1/account-lease': b => {
      if (b.action === 'join') {
        if (b.passcode !== 'abcd') return [401, { error: 'invalid_credentials' }]
        member.add(41); return lease(b, 41)
      }
      if (b.action === 'claim') { member.add(Number(b.team_id)); return lease(b, Number(b.team_id)) }
      if (b.action === 'trial') { if (member.has(50)) return [409, { error: 'trial_used' }]; member.add(50); return lease(b, 50) }
      if (b.action === 'leave') member.delete(Number(b.team_id))
      if (!member.size) return [200, { needs_team: true, email: 'a@example.com', device_token: 'dev-1', suggested: [{ id: 30, name: 'Old' }] }]
      return lease(b, [...member][0])
    } })
    const { a } = account({ fetch: s.f })
    expect(await a.signIn('a@example.com', '123456')).toEqual({ kind: 'needs_team', email: 'a@example.com', suggested: [{ id: 30, name: 'Old' }] })
    expect(a.canExport()).toBe(false)
    expect(await a.refresh()).toMatchObject({ kind: 'needs_team' }) // still none after a restart's refresh

    await expect(a.teamAction({ action: 'join', slug: 'hth', passcode: 'nope' })).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(await a.teamAction({ action: 'join', slug: 'hth', passcode: 'abcd' })).toMatchObject({ kind: 'ok', team: { id: 41 } })
    expect(s.calls.at(-1)!.body).toMatchObject({ action: 'join', slug: 'hth', passcode: 'abcd', device_token: 'dev-1' })
    expect(a.state()).toMatchObject({ suggested: [{ id: 30, name: 'Old' }] })

    expect(await a.teamAction({ action: 'claim', team_id: 30 })).toMatchObject({ kind: 'ok', team: { id: 30 }, suggested: [] })
    expect(await a.teamAction({ action: 'leave', team_id: 30 })).toMatchObject({ kind: 'ok', team: { id: 41 } })
    expect(await a.teamAction({ action: 'leave', team_id: 41 })).toMatchObject({ kind: 'needs_team' })
    setLang('es')
    expect(await a.teamAction({ action: 'trial' })).toMatchObject({ kind: 'ok', status: 'trialing', team: { id: 50 } })
    expect(s.calls.at(-1)!.body).toMatchObject({ action: 'trial', lang: 'es' }) // the trial mail is written in it
    setLang('ja')
    await expect(a.teamAction({ action: 'trial' })).rejects.toMatchObject({ code: 'trial_used' })
  })

  // The team's own features (src/internal/README.md): for a lease whose apps carry them (shared/edition.ts
  // INTERNAL_APP), or an address the app was built with.
  it('opens the team\'s own features only for a lease that carries them', async () => {
    expect(await account({ fetch: signedIn().f }).a.signIn('a@example.com', '123456')).toMatchObject({ kind: 'ok', internal: false })
    const allowed = account({ fetch: signedIn({}, { apps: ['editor', 'editor-internal'] }).f }).a
    expect(await allowed.signIn('a@example.com', '123456')).toMatchObject({ kind: 'ok', internal: true })
  })

  it('opens them for the addresses the app was built with', async () => {
    const make = (emails: string[]) => account({ fetch: signedIn().f, internalEmails: emails }).a
    expect(await make(['a@example.com']).signIn('a@example.com', '123456')).toMatchObject({ kind: 'ok', internal: true })
    expect(await make(['b@example.com']).signIn('a@example.com', '123456')).toMatchObject({ kind: 'ok', internal: false })
  })

  it('says no for an app the plan does not cover', async () => {
    const { a } = account({ fetch: signedIn({}, { apps: ['viewer'] }).f })
    expect(await a.signIn('a@example.com', '123456')).toMatchObject({ kind: 'no_access' })
  })
})
