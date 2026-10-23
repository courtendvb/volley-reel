import { useEffect, useRef, useState } from 'react'
import { forgetLogo, logoImage, subscribeAssets } from '../assets'

const api = window.api

// Team logos for title cards: one per team code, kept in the library so every project shares them.
// Changes are saved at once (not with the dialog's save button).
export function TeamLogos({ teams }: { teams: { code: string; name: string }[] }) {
  const [have, setHave] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { void api.listLogos().then(setHave) }, [])

  const run = async (code: string, fn: () => Promise<Record<string, string>>) => {
    setBusy(code)
    try { setHave(await fn()); forgetLogo(code) } finally { setBusy(null) }
  }

  return (
    <div className="logo-table">
      {teams.map(t => (
        <div key={t.code} className="logo-row">
          <LogoThumb code={have[t.code] ? t.code : null} />
          <b>{t.code}</b>
          <span className="muted logo-name">{t.name}</span>
          <button disabled={busy === t.code} onClick={() => void run(t.code, () => api.pickLogo(t.code))}>{have[t.code] ? '変える…' : 'ロゴを選ぶ…'}</button>
          {have[t.code] && <button className="link" disabled={busy === t.code} onClick={() => void run(t.code, () => api.removeLogo(t.code))}>外す</button>}
        </div>
      ))}
      {!teams.length && <p className="muted">プロジェクトに試合がありません</p>}
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
