// This computer's SyncScout sign-in (shared/account.ts has the design and the server's endpoints).
// Kept in account.json in the user data folder: the device id, the last lease, the teams, and the
// device token, which is encrypted by the OS when it can be (Electron's safeStorage).
//
// The lease is checked here, in the main process, at every export: the renderer only shows the state.
// Without the network nothing changes: the lease in hand counts until it runs out.
//
// No Electron imports, so the tests can drive it: index.ts passes in the folder, the OS encryption
// and the browser opener.
import { createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostname } from 'node:os'
import {
  EDITOR_APP, gate, leaseState, refreshDue, splitLease, type Gate, type GateRefusal,
  type AccountError, type AccountState, type LeasePayload, type PlanPrices, type LeaseResponse, type LeaseTeam, type TeamAction, type WebAccess,
} from '../shared/account'

export const SUPABASE_URL = 'https://ciokifeakrkigonhwbyf.supabase.co'
// The project's public key for anonymous calls; it is in every SyncScout web page as well.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpb2tpZmVha3JraWdvbmh3YnlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODQxNjgsImV4cCI6MjA5MDU2MDE2OH0.NYqH52Rl7Gn9SKeF3mnDioEphpoKpCDrxv6NifU69Po'
// The Ed25519 public key that leases are signed with (32 bytes, base64url); its private half is the
// server's secret APP_LEASE_PRIVATE_KEY (syncscout scripts/generate-lease-key.mjs). Changing it signs
// every computer out, since the leases they hold stop verifying.
export const LEASE_PUBLIC_KEY = 'tcNHvwLDqypi-uIzt1ED9qXNcRRyQsJbrdyD4WS1LEo'
// On: the app asks for an account, and the limits in shared/account.ts `gate` apply (no sign-in: one
// match, no exports; trial or plan over: no imports, new projects or exports).
// VR_LEASE_KEY stands in for the key above, for a test server.
export const ENFORCED = true

interface Saved {
  deviceId: string
  lease?: string
  teams?: LeaseTeam[]
  token?: string // the device token, as stored: encrypted (enc: true) or plain
  enc?: boolean
  seen?: number // the latest time seen here, in seconds (shared/account.ts: CLOCK_SLACK_SEC)
  serverError?: AccountError // what the server said on the last refresh, if it refused
  suggested?: LeaseTeam[] // teams with this address as their contact or payer email, not joined
  needsTeam?: string // signed in but in no team yet: the account's email (then there is no lease)
}

export interface AccountDeps {
  dir: string
  appVersion: string
  enabled: boolean
  publicKey: string // base64url, 32 bytes
  encrypt?: (s: string) => string // the OS keeps the key; null when the OS has none (then stored plain)
  decrypt?: (s: string) => string
  fetch?: typeof fetch
  now?: () => number // milliseconds
  internalEmails?: readonly string[] // the internal edition: whom its features open for (lower case)
}

export class AccountFailure extends Error {
  constructor(readonly code: AccountError | 'network' | 'server', message?: string) { super(message ?? code) }
}

export class Account {
  private saved: Saved
  private key: KeyObject | null
  private refreshing: Promise<void> | null = null

  constructor(private deps: AccountDeps) {
    this.saved = this.load()
    this.key = deps.publicKey ? createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: deps.publicKey }, format: 'jwk' }) : null
  }

  get enabled(): boolean { return this.deps.enabled && !!this.key }

  private file(): string { return join(this.deps.dir, 'account.json') }
  private now(): number { return Math.floor((this.deps.now ?? Date.now)() / 1000) }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.file(), 'utf8')) as Saved
      if (typeof s.deviceId === 'string' && s.deviceId) return s
    } catch { /* first start, or unreadable: a new device id */ }
    return { deviceId: randomUUID() }
  }

  private save(): void {
    // Keep the latest time seen, so a clock turned back doesn't stretch the lease.
    this.saved.seen = Math.max(this.saved.seen ?? 0, this.now())
    writeFileSync(this.file(), JSON.stringify(this.saved, null, 2))
  }

  // The verified lease in hand, or null.
  private lease(): LeasePayload | null {
    if (!this.saved.lease || !this.key) return null
    const l = splitLease(this.saved.lease)
    if (!l || l.payload.device !== this.saved.deviceId) return null
    const ok = verify(null, Buffer.from(l.signed), this.key, Buffer.from(l.sig))
    return ok ? l.payload : null
  }

  state(): AccountState {
    const p = this.lease()
    if (!p) {
      return this.saved.needsTeam && this.deviceToken()
        ? { kind: 'needs_team', email: this.saved.needsTeam, suggested: this.saved.suggested ?? [] }
        : { kind: 'signed_out' }
    }
    return leaseState(p, this.saved.teams ?? [], this.now(), this.saved.seen ?? 0, this.saved.serverError, this.saved.suggested ?? [], this.deps.internalEmails)
  }

  // Why an export, an import or a new project isn't allowed now, or null (shared/account.ts: gate).
  // Always null until accounts are turned on.
  refusal(what: Gate, matches = 0, adding = 1): GateRefusal | null { return gate(this.enabled, this.state(), what, matches, adding) }
  canExport(): boolean { return this.refusal('export') === null }

  private deviceToken(): string | null {
    const t = this.saved.token
    if (!t) return null
    try { return this.saved.enc && this.deps.decrypt ? this.deps.decrypt(t) : t } catch { return null }
  }

  private async call<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    let res: Response
    try {
      res = await (this.deps.fetch ?? fetch)(`${SUPABASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer ?? SUPABASE_ANON_KEY}` },
        body: JSON.stringify(body),
      })
    } catch {
      throw new AccountFailure('network')
    }
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (res.ok) return data as T
    // Supabase Auth answers a wrong or old code with 4xx and its own wording.
    if (path.startsWith('/auth/v1/verify')) throw new AccountFailure('invalid_code')
    if (res.status === 429) throw new AccountFailure('too_many_attempts')
    const code = typeof data.error === 'string' ? data.error : ''
    const known: AccountError[] = ['invalid_code', 'invalid_device', 'licence_expired', 'payment_required', 'no_access', 'too_many_attempts', 'already_subscribed', 'invalid_credentials', 'trial_used']
    throw new AccountFailure(known.includes(code as AccountError) ? code as AccountError : 'server', code || `HTTP ${res.status}`)
  }

  private keep(r: LeaseResponse): void {
    const enc = !!this.deps.encrypt
    const token = { token: enc ? this.deps.encrypt!(r.device_token) : r.device_token, enc }
    if ('needs_team' in r) {
      this.saved = { deviceId: this.saved.deviceId, seen: this.saved.seen, ...token, needsTeam: r.email, suggested: r.suggested }
      this.save()
      return
    }
    const l = splitLease(r.lease)
    if (!l || !this.key || !verify(null, Buffer.from(l.signed), this.key, Buffer.from(l.sig)) || l.payload.device !== this.saved.deviceId) {
      throw new AccountFailure('server', 'bad lease')
    }
    this.saved = { deviceId: this.saved.deviceId, seen: this.saved.seen, lease: r.lease, teams: r.teams, suggested: r.suggested ?? [], ...token }
    this.save()
  }

  private who() { return { device_id: this.saved.deviceId, device_name: hostname(), app: EDITOR_APP, app_version: this.deps.appVersion } }

  // Step 1 of signing in: the server mails a one-time code to the address.
  async sendCode(email: string): Promise<void> {
    await this.call('/auth/v1/otp', { email: email.trim(), create_user: true })
  }

  // Step 2: the code from the mail. Leaves this computer signed in; an account in no team yet comes
  // back as needs_team, and the person picks with teamAction.
  async signIn(email: string, code: string): Promise<AccountState> {
    const s = await this.call<{ access_token?: string }>('/auth/v1/verify', { type: 'email', email: email.trim(), token: code.trim() })
    if (!s.access_token) throw new AccountFailure('invalid_code')
    this.keep(await this.call<LeaseResponse>('/functions/v1/account-lease', this.who(), s.access_token))
    return this.state()
  }

  // A fresh lease with the device token: on a timer, after paying, or to switch to another team.
  // A refusal that means "this account can't use the app now" is remembered, so the state shows it;
  // a revoked token signs this computer out. Without the network it does nothing.
  async refresh(teamId?: number): Promise<AccountState> {
    const token = this.deviceToken()
    if (!token) return this.state()
    try {
      const team_id = teamId ?? this.lease()?.team.id
      this.keep(await this.call<LeaseResponse>('/functions/v1/account-lease', { ...this.who(), device_token: token, team_id }))
    } catch (e) {
      if (!(e instanceof AccountFailure)) throw e
      if (e.code === 'invalid_device') this.forget()
      else if (e.code === 'licence_expired' || e.code === 'payment_required' || e.code === 'no_access') { this.saved.serverError = e.code; this.save() }
      else if (teamId !== undefined) throw e // asked for by the user: say why it failed
    }
    return this.state()
  }

  // Joins a team (its ID and passcode, or one of the suggested teams), starts the trial, or leaves a
  // team. The answer is a lease for that team, or needs_team when none is left.
  async teamAction(a: TeamAction): Promise<AccountState> {
    const token = this.deviceToken()
    if (!token) throw new AccountFailure('invalid_device')
    try {
      this.keep(await this.call<LeaseResponse>('/functions/v1/account-lease', { ...this.who(), device_token: token, ...a }))
    } catch (e) {
      if (e instanceof AccountFailure && e.code === 'invalid_device') this.forget()
      throw e
    }
    return this.state()
  }

  // Refreshes when the lease is half used or the server refused last time; once at a time.
  refreshIfDue(): Promise<void> {
    const p = this.lease()
    if (!p || !(this.saved.serverError || refreshDue(p, this.now()))) return Promise.resolve()
    this.refreshing ??= this.refresh().then(() => {}, () => {}).finally(() => { this.refreshing = null })
    return this.refreshing
  }

  // The Stripe page for this computer's team, to pay or resume the contract.
  async checkoutUrl(plan: 'monthly' | 'annual' = 'annual'): Promise<string> {
    const token = this.deviceToken(), p = this.lease()
    if (!token || !p) throw new AccountFailure('invalid_device')
    const r = await this.call<{ url?: string }>('/functions/v1/account-checkout', { device_token: token, device_id: this.saved.deviceId, team_id: p.team.id, plan })
    if (!r.url?.startsWith('https://')) throw new AccountFailure('server', 'no checkout url')
    return r.url
  }

  // What the plan buttons say: the prices from Stripe and this team's annual free days. null when it
  // can't be known now (offline, signed out, the server can't read Stripe): the buttons go without.
  async prices(): Promise<PlanPrices | null> {
    const token = this.deviceToken(), p = this.lease()
    if (!token || !p) return null
    try {
      const r = await this.call<PlanPrices>('/functions/v1/account-prices', { device_token: token, device_id: this.saved.deviceId, team_id: p.team.id, app: EDITOR_APP })
      return r && (r.monthly || r.annual) ? { monthly: r.monthly ?? null, annual: r.annual ?? null, annual_trial_days: Number(r.annual_trial_days) || 0 } : null
    } catch { return null }
  }

  // The team ID and, for an admin, both passcodes of this computer's team, to get into SyncScout Web.
  // Asked when the person opens it, never kept: a passcode changed on the web shows here at once.
  async webAccess(): Promise<WebAccess> {
    const token = this.deviceToken(), p = this.lease()
    if (!token || !p) throw new AccountFailure('invalid_device')
    const r = await this.call<Partial<WebAccess> & { passcode?: unknown; admin_passcode?: unknown }>('/functions/v1/account-team', { device_token: token, device_id: this.saved.deviceId, team_id: p.team.id })
    if (typeof r.slug !== 'string' || !r.slug) throw new AccountFailure('server', 'no team id')
    if (r.role === 'admin' && typeof r.passcode === 'string' && typeof r.admin_passcode === 'string') {
      return { slug: r.slug, role: 'admin', passcode: r.passcode, admin_passcode: r.admin_passcode }
    }
    return { slug: r.slug, role: 'member' }
  }

  // Signs this computer out. The device id stays: it is this computer, not the account.
  forget(): void {
    this.saved = { deviceId: this.saved.deviceId, seen: this.saved.seen }
    this.save()
  }
}
