import { useEffect, useRef, useState } from 'react'
import { forgetLogo, logoImage, subscribeAssets } from '../assets'
import { t } from '../../../shared/i18n'

const api = window.api

// Team logos for title cards: one per team code, kept in the library so every project shares them.
// Changes are saved at once (not with the dialog's save button).
export function TeamLogos({ teams, colors, onColors }: { teams: { code: string; name: string }[]; colors: Record<string, string>; onColors: (c: Record<string, string>) => void }) {
  const [have, setHave] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { void api.listLogos().then(setHave) }, [])

  const run = async (code: string, fn: () => Promise<Record<string, string>>) => {
    setBusy(code)
    try { setHave(await fn()); forgetLogo(code) } finally { setBusy(null) }
  }

  return (
    <div className="logo-table">
      {teams.map(tm => (
        <div key={tm.code} className="logo-row">
          <LogoThumb code={have[tm.code] ? tm.code : null} />
          <b>{tm.code}</b>
          <span className="muted logo-name">{tm.name}</span>
          <button disabled={busy === tm.code} onClick={() => void run(tm.code, () => api.pickLogo(tm.code))}>{have[tm.code] ? t('変える…') : t('ロゴを選ぶ…')}</button>
          {have[tm.code] && <button className="link" disabled={busy === tm.code} onClick={() => void run(tm.code, () => api.removeLogo(tm.code))}>{t('外す')}</button>}
          <span className="spacer" />
          <input type="color" className="team-color" aria-label={t('{0} のチームカラー', tm.code)} title={t('チームカラー（ローテーション表示の丸の色）')} value={colors[tm.code.toUpperCase()] ?? '#888888'}
            style={colors[tm.code.toUpperCase()] ? undefined : { opacity: 0.35 }}
            onChange={e => void api.setTeamColor(tm.code, e.target.value).then(onColors)} />
          {colors[tm.code.toUpperCase()] ? <button className="link" onClick={() => void api.setTeamColor(tm.code, null).then(onColors)}>{t('色を外す')}</button> : <span className="muted small">{t('色なし')}</span>}
        </div>
      ))}
      {!teams.length && <p className="muted">{t('プロジェクトに試合がありません')}</p>}
    </div>
  )
}

function LogoThumb({ code }: { code: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const img = code ? logoImage(code) : null
    if (!img) return
    const s = Math.min(c.width / img.width, c.height / img.height)
    ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s)
  }, [code, tick])
  return <canvas ref={canvas} className="logo-thumb" width={64} height={40} aria-hidden />
}
