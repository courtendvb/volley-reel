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
//       A new account gets a team of its own with the 30-day trial; an address that is a team's
//       contact or payer email is joined to that team as its admin.
//       Before answering it asks Stripe directly when the team's last checkout isn't reflected yet, so a
//       payment counts at once, without waiting for the webhook.
//     → 4xx { error: AccountError }
//   POST {SUPABASE_URL}/functions/v1/account-checkout  { device_token, device_id, team_id }
//     → { url }: a Stripe Checkout page for the team, opened in the browser.
// This file holds the parts both sides agree on and the checks that need no network or key.

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

export interface LeaseResponse {
  lease: string // base64url(payload JSON) + '.' + base64url(Ed25519 signature over the first part)
  device_token: string
  teams: LeaseTeam[] // every team the account belongs to; the lease is for one of them
}

export type AccountError =
  | 'invalid_code' // the mailed code is wrong or expired
  | 'invalid_device' // the device token was revoked or is unknown: sign in again
  | 'licence_expired' // trial over, or the contract ended
  | 'payment_required' // a renewal failed and the grace days are over
  | 'no_access' // the team's plan doesn't include this app
  | 'too_many_attempts'
  | 'already_subscribed' // account-checkout: the team's paid plan is still running

// What the app shows and allows.
export type AccountState =
  | { kind: 'signed_out' }
  | { kind: 'ok'; email: string; team: LeaseTeam; teams: LeaseTeam[]; status: LeasePayload['status']; until: string | null; daysLeft: number | null }
  | { kind: 'expired'; email: string; team: LeaseTeam; teams: LeaseTeam[]; reason: 'lease' | AccountError }
  | { kind: 'no_access'; email: string; team: LeaseTeam; teams: LeaseTeam[] }

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
export function leaseState(p: LeasePayload, teams: LeaseTeam[], now: number, seen: number, serverError?: AccountError): AccountState {
  const at = Math.max(now, seen - CLOCK_SLACK_SEC)
  const base = { email: p.email, team: p.team, teams: teams.length ? teams : [p.team] }
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
