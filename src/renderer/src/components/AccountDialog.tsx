import { useCallback, useEffect, useState } from 'react'
import { FREE_MATCHES, gate, type AccountState, type Gate, type LeaseTeam } from '../../../shared/account'
import { t } from '../../../shared/i18n'
import { errorText } from '../format'
import { setAccountState, useAccount } from '../account'

// The SyncScout account on the home screen (main/account.ts). Shown only once accounts are turned on.
// Signing in is an email address and the code mailed to it: no password. Which team the account uses is
// the person's choice, never guessed: a team whose contact email is this address, a team joined with its
// ID and passcode (people already on SyncScout know them), or a free trial of their own. Paying opens
// Stripe in the browser, and coming back to the app picks the payment up at once (the server asks
// Stripe, it doesn't wait for the webhook).
export function AccountButton() {
  const info = useAccount()
  const [open, setOpen] = useState(false)
  if (!info?.enabled) return null
  const s = info.state
  const label = s.kind === 'signed_out' ? t('ログイン') : s.kind === 'needs_team' ? t('チームを選ぶ') : s.kind === 'ok' ? s.email : t('契約を確認')
  return (
    <>
      <button className={s.kind === 'ok' || s.kind === 'signed_out' ? '' : 'warn'} onClick={() => setOpen(true)} title={t('SyncScout アカウント')}>{label}</button>
      {open && <AccountDialog state={s} onState={setAccountState} onClose={() => setOpen(false)} />}
    </>
  )
}

// Beside an export, an import or "new project": says plainly why it isn't allowed now (the same rule
// the main process enforces: shared/account.ts gate) and opens the account dialog. Nothing while
// accounts are off or the action is allowed. `matches`: how many the library holds (for imports).
export function AccountNote({ what, matches = 0 }: { what: Gate; matches?: number }) {
  const info = useAccount()
  const [open, setOpen] = useState(false)
  if (!info) return null
  const refused = gate(info.enabled, info.state, what, matches, 1)
  if (!refused) return null
  const s = info.state
  const text = refused === 'plan'
    ? what === 'export' ? t('お試し期間か契約が終わっているため、書き出せません。編集はこれまでどおりできます。')
      : what === 'import' ? t('お試し期間か契約が終わっているため、試合を追加できません。作ったプロジェクトはこれまでどおり開いて編集できます。')
      : t('お試し期間か契約が終わっているため、新しいプロジェクトは作れません。作ったプロジェクトはこれまでどおり開いて編集できます。')
    : s.kind === 'needs_team' ? (what === 'export' ? t('書き出すには、使うチームを選んでください。') : t('2試合目からは、使うチームを選ぶと取り込めます。'))
    : what === 'export' ? t('書き出すには SyncScout へのログインが必要です。初めての方は30日間無料で使えます。')
    : t('ログインしていない間は、倉庫に入れられる試合は {0} 試合までです。ログインすると（初めての方は30日間無料）制限なく取り込めます。', FREE_MATCHES)
  const button = refused === 'plan' ? t('契約を確認') : s.kind === 'needs_team' ? t('チームを選ぶ') : t('ログイン')
  return (
    <div className="export-account-note" role="note">
      <span>{text}</span>
      <button className="primary" onClick={() => setOpen(true)}>{button}</button>
      {open && <AccountDialog state={s} onState={setAccountState} onClose={() => setOpen(false)} />}
    </div>
  )
}

// What each account state allows (shared/account.ts gate). Shown until the account can do everything.
function WhatNeedsSignIn({ state }: { state: AccountState }) {
  if (state.kind === 'expired' || state.kind === 'no_access') {
    return (
      <div className="account-scope">
        <div>
          <h3>{t('お試し・契約が終わってもできること')}</h3>
          <ul>
            <li>{t('作ったプロジェクトを開いて、見る・編集する')}</li>
          </ul>
        </div>
        <div>
          <h3>{t('契約すると再びできること')}</h3>
          <ul>
            <li>{t('試合の追加')}</li>
            <li>{t('新しいプロジェクトの作成')}</li>
            <li>{t('動画・スライド・マッチレポートの書き出し')}</li>
          </ul>
        </div>
      </div>
    )
  }
  return (
    <div className="account-scope">
      <div>
        <h3>{t('ログインしなくてもできること')}</h3>
        <ul>
          <li>{t('{0} 試合の取り込み', FREE_MATCHES)}</li>
          <li>{t('その試合でのプロジェクト・シーン・動画の作成と編集')}</li>
          <li>{t('注釈・スライド・ボードの作成とプレビュー')}</li>
        </ul>
      </div>
      <div>
        <h3>{t('ログイン（お試し中・契約中）が必要なこと')}</h3>
        <ul>
          <li>{t('{0} 試合目からの取り込み', FREE_MATCHES + 1)}</li>
          <li>{t('動画（MP4）の書き出し')}</li>
          <li>{t('スライドの書き出し（PNG・PDF・PowerPoint）')}</li>
          <li>{t('マッチレポートの PDF 書き出し')}</li>
        </ul>
      </div>
    </div>
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
    const back = () => void run(() => window.api.accountRefresh('team' in state ? state.team.id : undefined))
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [paying, run, state])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal account-modal" role="dialog" aria-label={t('SyncScout アカウント')} onClick={e => e.stopPropagation()}>
        <h2>{t('SyncScout アカウント')}</h2>
        {state.kind !== 'ok' && <WhatNeedsSignIn state={state} />}
        {state.kind === 'signed_out' ? <SignIn busy={busy} run={run} />
          : state.kind === 'needs_team' ? <ChooseTeam email={state.email} suggested={state.suggested} busy={busy} run={run} />
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
      <p className="muted">{t('メールアドレスに届く確認コードでログインします。パスワードはいりません。')}</p>
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

// Signed in, in no team yet: the three ways in.
function ChooseTeam({ email, suggested, busy, run }: { email: string; suggested: LeaseTeam[]; busy: boolean; run: Run }) {
  return (
    <div className="account-form">
      <p>{t('{0} でログインしました。使うチームを選んでください。', email)}</p>
      <Suggested suggested={suggested} busy={busy} run={run} />
      <section className="account-choice">
        <h3>{t('SyncScout をすでに使っている')}</h3>
        <p className="muted">{t('チームの管理者から聞いたチームID と合言葉で参加します。')}</p>
        <JoinForm busy={busy} run={run} />
      </section>
      <section className="account-choice">
        <h3>{t('初めて使う')}</h3>
        <p className="muted">{t('あなたのチームを作り、30日間の無料お試しを始めます。カードの登録はいりません。')}</p>
        <div><button className="primary" onClick={() => void run(() => window.api.accountTeam({ action: 'trial' }))} disabled={busy}>{t('無料お試しを始める')}</button></div>
      </section>
    </div>
  )
}

// Teams whose contact or payer email is this address: one press to use them.
function Suggested({ suggested, busy, run }: { suggested: LeaseTeam[]; busy: boolean; run: Run }) {
  if (!suggested.length) return null
  return (
    <section className="account-choice">
      <h3>{t('このメールアドレスで登録されたチーム')}</h3>
      {suggested.map(tm => (
        <div className="row" key={tm.id}>
          <span className="account-team-name">{tm.name}</span>
          <button onClick={() => void run(() => window.api.accountTeam({ action: 'claim', team_id: tm.id }))} disabled={busy}>{t('このチームを使う')}</button>
        </div>
      ))}
    </section>
  )
}

function JoinForm({ busy, run }: { busy: boolean; run: Run }) {
  const [slug, setSlug] = useState('')
  const [passcode, setPasscode] = useState('')
  return (
    <form className="account-join" onSubmit={e => { e.preventDefault(); void run(() => window.api.accountTeam({ action: 'join', slug, passcode })) }}>
      <label>{t('チームID')}<input value={slug} onChange={e => setSlug(e.target.value)} autoComplete="off" disabled={busy} required /></label>
      <label>{t('合言葉')}<input type="password" value={passcode} onChange={e => setPasscode(e.target.value)} autoComplete="off" disabled={busy} required /></label>
      <button type="submit" disabled={busy || !slug || !passcode}>{t('参加する')}</button>
    </form>
  )
}

function Signed({ state, busy, run, onPay }: { state: Extract<AccountState, { team: LeaseTeam }>; busy: boolean; run: Run; onPay: (plan: 'monthly' | 'annual') => void }) {
  const [teamsOpen, setTeamsOpen] = useState(false)
  const status = state.kind === 'ok'
    ? state.status === 'trialing' ? t('お試し中（あと {0} 日）', state.daysLeft ?? '') : state.status === 'free' ? t('無料でご利用いただけます') : state.until ? t('契約中（{0} まで）', state.until) : t('契約中')
    : state.kind === 'no_access' ? t('このチームの契約には Video Editor が含まれていません')
    : state.reason === 'payment_required' ? t('お支払いが確認できていません。カードの情報を確かめてください')
    : state.reason === 'licence_expired' ? t('お試し期間か契約が終わっています')
    : t('ログインの確認が切れています。インターネットにつないで「状態を更新」を押してください')
  const canPay = state.kind !== 'ok' || state.status === 'trialing'
  const leave = () => {
    if (!confirm(t('「{0}」から抜けますか？ もう一度入るには、チームID と合言葉が必要です。', state.team.name))) return
    void run(() => window.api.accountTeam({ action: 'leave', team_id: state.team.id }))
  }
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
      <button type="button" className="link account-teams-toggle" onClick={() => setTeamsOpen(!teamsOpen)} aria-expanded={teamsOpen}>
        {teamsOpen ? t('チームの参加・退出を閉じる') : t('ほかのチームに参加する・このチームから抜ける')}
      </button>
      {teamsOpen && (
        <>
          <Suggested suggested={state.suggested} busy={busy} run={run} />
          <section className="account-choice">
            <h3>{t('ほかのチームに参加する')}</h3>
            <JoinForm busy={busy} run={run} />
          </section>
          <div><button onClick={leave} disabled={busy}>{t('「{0}」から抜ける', state.team.name)}</button></div>
        </>
      )}
    </div>
  )
}
