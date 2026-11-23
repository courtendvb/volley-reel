// SyncScout accounts: who may use the app, checked offline (design: "SyncScout パッケージ 認証・課金設計").
//
// One SyncScout account (an email address) for every app in the package. A team holds the contract
// (Stripe, or a free trial, or free for good), and the contract says which apps it covers. The app never
// keeps a password: it signs in with a one-time code mailed to the address, and the server answers with
//   - a lease: "this account may use these apps until <exp>", signed with the server's Ed25519 key. The
//     app checks it with the public key, offline, at every export.
//   - a device token: lets this computer ask for a fresh lease later without a new code. Stored encrypted
//     by the OS (main/account.ts), revoked on the server.
//
// The server side lives in the syncscout repository (Supabase). What the app calls there:
//   POST {SUPABASE_URL}/auth/v1/otp            { email, create_user: true }        → mails the code
//   POST {SUPABASE_URL}/auth/v1/verify         { type: 'email', email, token }     → { access_token }
//   POST {SUPABASE_URL}/functions/v1/account-lease
//        Authorization: Bearer <access_token>  { device_id, device_name, app, app_version, team_id? }
//     or no Authorization                      { device_token, device_id, app, app_version, team_id? }
//     → 200 LeaseResponse, also when the team can't use the app now (the lease says why: `denied`).
//       Before answering it asks Stripe directly when the team's last checkout isn't reflected yet, so a
//       payment counts at once, without waiting for the webhook.
//     → 200 { needs_team: true, … } when the account belongs to no team yet. The server never picks one
//       on its own (an old test team, or a trial of their own for a coach whose team already pays): the
//       person chooses, and the app calls again with the device token and an `action`:
//         join  { slug, passcode }  the team ID and passcode of a SyncScout team
//         claim { team_id }         one of `suggested`: a team whose contact or payer email is this address
//         trial {}                  a team of their own with the 14-day trial, once per account
//         leave { team_id }
//     → 4xx { error: AccountError }
//   POST {SUPABASE_URL}/functions/v1/account-prices  { device_token, device_id, team_id }
//     → PlanPrices: what the plan buttons say, read from Stripe's prices; the annual free days are the
//       ones account-checkout will give this team (only a team that never paid gets them)
//   POST {SUPABASE_URL}/functions/v1/account-team  { device_token, device_id, team_id }
//     → WebAccess: how to get into SyncScout Web (WEB_URL) with the team. A trial started in the app gets
//       its team ID and both passcodes made up by the server, so the person never saw them: they are
//       mailed once when the trial starts, and an admin of the team can read them here at any time
//       (the latest, after a change on the web). A member gets the team ID alone. Not kept on disk.
//   POST {SUPABASE_URL}/functions/v1/account-checkout  { device_token, device_id, team_id, plan }
//     → { url }: a Stripe Checkout page for the team, opened in the browser. For a team whose renewal
//       didn't go through, the page of its unpaid invoice instead ({ url, kind: 'invoice' }); paying it
//       counts at the next refresh, which reads the subscription from Stripe.
// This file holds the parts both sides agree on and the checks that need no network or key.

import { INTERNAL_APP } from './edition'

export const EDITOR_APP = 'editor'

export interface LeaseTeam { id: number; name: string }

// What the server signs. Times are Unix seconds; licence_end is the contract's end date (null = no end).
export interface LeasePayload {
  v: 1
  sub: string // the account (Supabase user id)
  email: string
  device: string // the device_id the lease was issued to
  team: LeaseTeam
  apps: string[] // what the contract covers: 'editor', 'viewer', 'live'…
  status: 'trialing' | 'active' | 'free'
  licence_end: string | null // YYYY-MM-DD
  iat: number
  exp: number
  // Set when the team can't use the app now (exp is then the time of issue). The server still answers
  // with a lease, so the app stays signed in and can show why and lead to the payment page.
  denied?: 'licence_expired' | 'payment_required' | 'no_access'
}

export type LeaseResponse = {
  lease: string // base64url(payload JSON) + '.' + base64url(Ed25519 signature over the first part)
  device_token: string
  teams: LeaseTeam[] // every team the account belongs to; the lease is for one of them
  suggested?: LeaseTeam[] // teams with this address as their contact or payer email, not joined yet
} | {
  needs_team: true
  email: string
  device_token: string
  suggested: LeaseTeam[]
}

export type TeamAction = { action: 'join'; slug: string; passcode: string } | { action: 'claim'; team_id: number } | { action: 'trial' } | { action: 'leave'; team_id: number }

// SyncScout Web: the matches for players and staff (team ID + passcode), and the admin page (team ID +
// admin passcode), where the team ID and both passcodes can be changed.
export const WEB_URL = 'https://app.syncscout.courtend.net'
export const WEB_ADMIN_URL = `${WEB_URL}/team-admin.html`

export type WebAccess =
  | { slug: string; role: 'admin'; passcode: string; admin_passcode: string }
  | { slug: string; role: 'member' } // the passcodes are the admin's to hand out

export type AccountError =
  | 'invalid_code' // the mailed code is wrong or expired
  | 'invalid_device' // the device token was revoked or is unknown: sign in again
  | 'licence_expired' // trial over, or the contract ended
  | 'payment_required' // a renewal failed and the grace days are over
  | 'no_access' // the team's plan doesn't include this app
  | 'too_many_attempts'
  | 'already_subscribed' // account-checkout: the team's paid plan is still running
  | 'invalid_credentials' // join: no team with that ID, or the wrong passcode
  | 'trial_used' // trial: this account had its free trial already

// What the app shows and allows.
// internal: the lease lets this account use the internal edition's features (shared/edition.ts INTERNAL_APP);
// always false in the sold edition.
type Signed = { email: string; team: LeaseTeam; teams: LeaseTeam[]; suggested: LeaseTeam[]; internal: boolean }
export type AccountState =
  | { kind: 'signed_out' }
  | { kind: 'needs_team'; email: string; suggested: LeaseTeam[] } // signed in, no team yet: join one or start the trial
  | ({ kind: 'ok'; status: LeasePayload['status']; until: string | null; daysLeft: number | null } & Signed)
  | ({ kind: 'expired'; reason: 'lease' | AccountError } & Signed)
  | ({ kind: 'no_access' } & Signed)

// A plan's price as Stripe holds it: amount in the currency's smallest unit (yen as is, cents for dollars).
export interface PlanPrice {
  amount: number
  currency: string // ISO 4217, lower case as Stripe gives it: 'jpy'
  interval: 'month' | 'year'
  interval_count: number
  tax: 'inclusive' | 'exclusive' | 'unspecified'
}
export interface PlanPrices { monthly: PlanPrice | null; annual: PlanPrice | null; annual_trial_days: number }

// "¥39,600 / year (tax incl.)" in the interface language; null when it can't be said.
export function priceText(p: PlanPrice | null, lang: string, t: (ja: string, ...a: (string | number)[]) => string): string | null {
  if (!p || !Number.isFinite(p.amount) || p.amount < 0) return null
  let money: string
  try {
    const f = new Intl.NumberFormat(lang, { style: 'currency', currency: p.currency.toUpperCase() })
    money = f.format(p.amount / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 0))
  } catch { return null } // a currency this runtime doesn't know
  const n = p.interval_count > 1 ? p.interval_count : 0
  const per = p.interval === 'year' ? (n ? t('{0}年', n) : t('年')) : (n ? t('{0}か月', n) : t('月'))
  const tax = p.tax === 'inclusive' ? t('（税込）') : p.tax === 'exclusive' ? t('（税別）') : ''
  return t('{0}／{1}', money, per) + tax
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

// Splits a lease into the signed part, the signature and the payload; null when it isn't one.
// The signature is checked by the caller (main/account.ts), which holds the public key.
export function splitLease(lease: string): { signed: string; sig: Uint8Array; payload: LeasePayload } | null {
  const [signed, sig, extra] = lease.split('.')
  if (!signed || !sig || extra !== undefined) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(signed))) as LeasePayload
    if (p?.v !== 1 || typeof p.exp !== 'number' || typeof p.device !== 'string' || !Array.isArray(p.apps) || !p.team) return null
    return { signed, sig: b64urlDecode(sig), payload: p }
  } catch {
    return null
  }
}

// How long a clock may have been set back before the app stops believing it. Within this, a lease is
// judged by the latest time the app has seen instead of the clock, so turning the clock back doesn't
// stretch a lease, and a clock a little off doesn't cut one short.
export const CLOCK_SLACK_SEC = 24 * 3600

// The state a verified lease gives, at `now` (seconds). `seen` = the latest time this computer has seen
// (main/account.ts keeps it); `serverError` = what the server said on the last refresh, when it refused.
export function leaseState(p: LeasePayload, teams: LeaseTeam[], now: number, seen: number, serverError?: AccountError, suggested: LeaseTeam[] = []): AccountState {
  const at = Math.max(now, seen - CLOCK_SLACK_SEC)
  const base = { email: p.email, team: p.team, teams: teams.length ? teams : [p.team], suggested, internal: __INTERNAL__ && p.apps.includes(INTERNAL_APP) }
  const refused = serverError ?? p.denied
  if (refused === 'licence_expired' || refused === 'payment_required') return { kind: 'expired', ...base, reason: refused }
  if (!p.apps.includes(EDITOR_APP) || refused === 'no_access') return { kind: 'no_access', ...base }
  if (at >= p.exp) return { kind: 'expired', ...base, reason: 'lease' }
  return { kind: 'ok', ...base, status: p.status, until: p.licence_end, daysLeft: p.licence_end ? daysUntil(p.licence_end, at) : null }
}

// Whole days from `at` (seconds) to the end of the given date (UTC), never below 0.
export function daysUntil(date: string, at: number): number {
  const end = Date.parse(`${date}T23:59:59Z`) / 1000
  return Math.max(0, Math.ceil((end - at) / 86400))
}

// When the app should ask for a fresh lease: once half of it has run, or a day before it ends,
// whichever comes first. Leases run about 30 days, so this is around day 15.
export function refreshDue(p: LeasePayload, now: number): boolean {
  return now >= Math.min(p.iat + (p.exp - p.iat) / 2, p.exp - 86400)
}

// What the app allows by account state, decided in one place: the main process enforces it, the
// screens explain it.
//   signed in, trial or plan running: everything
//   not signed in (or no team chosen): a "try it" mode — one match in the library, every editing and
//     analysis feature on it, no exports. Signing in (free for 14 days) lifts the limit.
//   trial or plan over: nothing new — no matches added, no new projects, no exports. What was made
//     stays: existing projects open and edit as before.
export const FREE_MATCHES = 1

export type Gate = 'export' | 'import' | 'newProject'
export type GateRefusal = 'sign_in' | 'plan'

// null = allowed. `matches` = how many the library holds now; `adding` = how many this import adds.
export function gate(enabled: boolean, s: AccountState, what: Gate, matches = 0, adding = 1): GateRefusal | null {
  if (!enabled || s.kind === 'ok') return null
  if (s.kind === 'signed_out' || s.kind === 'needs_team') {
    if (what === 'export') return 'sign_in'
    if (what === 'import') return matches + adding > FREE_MATCHES ? 'sign_in' : null
    return null
  }
  return 'plan'
}
