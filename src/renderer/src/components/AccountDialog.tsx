import { useCallback, useEffect, useState } from 'react'
import type { AccountState } from '../../../shared/account'
import { t } from '../../../shared/i18n'
import { errorText } from '../format'

// The SyncScout account on the home screen (main/account.ts). Shown only once accounts are turned on.
// Signing in is an email address and the code mailed to it: no password, no team passcode. A new
// address starts the free trial; paying opens Stripe in the browser, and coming back to the app picks
// the payment up at once (the server asks Stripe, it doesn't wait for the webhook).
export function AccountButton() {
  const [info, setInfo] = useState<{ enabled: boolean; state: AccountState } | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { void window.api.account().then(setInfo) }, [])
  if (!info?.enabled) return null
  const s = info.state
  const label = s.kind === 'signed_out' ? t('ログイン') : s.kind === 'ok' ? s.email : t('契約を確認')
  return (
    <>
      <button className={s.kind === 'ok' || s.kind === 'signed_out' ? '' : 'warn'} onClick={() => setOpen(true)} title={t('SyncScout アカウント')}>{label}</button>
      {open && <AccountDialog state={s} onState={state => setInfo({ enabled: true, state })} onClose={() => setOpen(false)} />}
    </>
  )
}

interface Props {
  state: AccountState
  onState: (s: AccountState) => void
  onClose: () => void
}

export function AccountDialog({ state, onState, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false) // the payment page is open in the browser
  const run = useCallback(async (f: () => Promise<AccountState | void>) => {
    setBusy(true); setError('')
    try { const s = await f(); if (s) onState(s) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }, [onState])

  // Back from the browser after paying: ask the server again, which asks Stripe.
  useEffect(() => {
    if (!paying) return
    const back = () => void run(() => window.api.accountRefresh(state.kind === 'signed_out' ? undefined : state.team.id))
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [paying, run, state])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal account-modal" role="dialog" aria-label={t('SyncScout アカウント')} onClick={e => e.stopPropagation()}>
        <h2>{t('SyncScout アカウント')}</h2>
        {state.kind === 'signed_out'
          ? <SignIn busy={busy} run={run} />
          : <Signed state={state} busy={busy} run={run} onPay={plan => { setPaying(true); void run(() => window.api.accountCheckout(plan)) }} />}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          {state.kind !== 'signed_out' && <button onClick={() => void run(() => window.api.accountSignOut())} disabled={busy}>{t('このパソコンからログアウト')}</button>}
          <span className="spacer" />
          <button className="primary" onClick={onClose}>{t('閉じる')}</button>
        </div>
      </div>
    </div>
  )
}

type Run = (f: () => Promise<AccountState | void>) => Promise<void>

function SignIn({ busy, run }: { busy: boolean; run: Run }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const send = () => void run(async () => { await window.api.accountSendCode(email); setSent(true) })
  return (
    <form className="account-form" onSubmit={e => { e.preventDefault(); if (sent) void run(() => window.api.accountSignIn(email, code)); else send() }}>
      <p className="muted">{t('メールアドレスに届く確認コードでログインします。初めての方は、そのまま30日間の無料お試しが始まります。')}</p>
      <label>{t('メールアドレス')}
        <input type="email" required autoFocus value={email} onChange={e => { setEmail(e.target.value); setSent(false) }} disabled={busy} />
      </label>
      {sent && (
        <label>{t('確認コード')}
          <input inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={e => setCode(e.target.value)} disabled={busy} />
        </label>
      )}
      {sent && <p className="muted">{t('{0} にコードを送りました。届かないときは迷惑メールのフォルダも確かめてください。', email)} <button type="button" className="link" onClick={send} disabled={busy}>{t('もう一度送る')}</button></p>}
      <div><button className="primary" type="submit" disabled={busy || !email || (sent && !code)}>{sent ? t('ログイン') : t('コードを送る')}</button></div>
    </form>
  )
}

function Signed({ state, busy, run, onPay }: { state: Exclude<AccountState, { kind: 'signed_out' }>; busy: boolean; run: Run; onPay: (plan: 'monthly' | 'annual') => void }) {
  const status = state.kind === 'ok'
    ? state.status === 'trialing' ? t('お試し中（あと {0} 日）', state.daysLeft ?? '') : state.status === 'free' ? t('無料でご利用いただけます') : state.until ? t('契約中（{0} まで）', state.until) : t('契約中')
    : state.kind === 'no_access' ? t('このチームの契約には Video Editor が含まれていません')
    : state.reason === 'payment_required' ? t('お支払いが確認できていません。カードの情報を確かめてください')
    : state.reason === 'licence_expired' ? t('お試し期間か契約が終わっています')
    : t('ログインの確認が切れています。インターネットにつないで「状態を更新」を押してください')
  const canPay = state.kind !== 'ok' || state.status === 'trialing'
  return (
    <div className="account-form">
      <dl className="account-facts">
        <dt>{t('アカウント')}</dt><dd>{state.email}</dd>
        <dt>{t('チーム')}</dt>
        <dd>{state.teams.length > 1
          ? <select value={state.team.id} disabled={busy} onChange={e => void run(() => window.api.accountRefresh(Number(e.target.value)))} aria-label={t('チーム')}>
              {state.teams.map(tm => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          : state.team.name}</dd>
        <dt>{t('状態')}</dt><dd className={state.kind === 'ok' ? '' : 'error'}>{status}</dd>
      </dl>
      {state.kind !== 'ok' && <p className="muted">{t('書き出し以外はこれまでどおり使えます。プロジェクトや書き出した動画はこのパソコンに残っています。')}</p>}
      <div className="row">
        {canPay && <button className="primary" onClick={() => onPay('annual')} disabled={busy}>{t('年額プランに申し込む')}</button>}
        {canPay && <button onClick={() => onPay('monthly')} disabled={busy}>{t('月額プランに申し込む')}</button>}
        <button onClick={() => void run(() => window.api.accountRefresh(state.team.id))} disabled={busy}>{t('状態を更新')}</button>
      </div>
    </div>
  )
}
