import { useState } from 'react'
import { LOCAL_PACK } from '../../../shared/pack'
import { importPack, removePack, usePacks } from '../packs'
import { t } from '../../../shared/i18n'
import { errorText } from '../format'
import { PackMaker } from './PackMaker'

// Add-on packs (.vrpack) in the library: read one in, or take one out. Saved at once, like the logos.
export function AddonPacks() {
  const packs = usePacks()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="logo-table">
      {packs.map(p => (
        <div key={p.id} className="logo-row">
          <b>{p.id === LOCAL_PACK ? t('自分で足した写真') : p.name}</b>
          <span className="muted logo-name">{t('選手写真 {0} 人', p.players.length)}</span>
          {p.bundled
            ? <span className="muted small">{t('アプリに同梱')}</span>
            : <button className="link" disabled={busy} onClick={() => void run(() => removePack(p.id))}>{t('外す')}</button>}
        </div>
      ))}
      {!packs.length && <p className="muted small">{t('アドオンは入っていません')}</p>}
      <div><button disabled={busy} onClick={() => void run(importPack)}>{t('パックを読み込む…')}</button>
        {' '}<button disabled={busy} onClick={() => setMaking(true)} title={t('倉庫の試合の選手に写真を割り当てて、パックを作ります')}>{t('パックを作る…')}</button></div>
      {error && <p className="pack-error small">{error}</p>}
      {making && <PackMaker onClose={() => setMaking(false)} />}
    </div>
  )
}
