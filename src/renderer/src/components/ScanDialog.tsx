import { useMemo, useState } from 'react'
import { dateFromName } from '../../../shared/pairing'
import type { ScanResult } from '../../../shared/types'
import { t } from '../../../shared/i18n'

interface Props {
  result: ScanResult
  onImport: (pairs: { dvwPath: string; video: string }[]) => void
  onClose: () => void
}

const name = (p: string) => p.split(/[\\/]/).pop() ?? p

// Bulk import, step 2: confirm the proposed DVW ↔ video pairs. Sure pairs (date and a team code)
// start ticked; date-only guesses start unticked; any row's video can be changed by hand.
export function ScanDialog({ result, onImport, onClose }: Props) {
  const [rows, setRows] = useState(() => result.pairs.map(p => ({ ...p, checked: !!p.video && !p.inLibrary && p.score >= 3 })))
  const [showUnpaired, setShowUnpaired] = useState(false)
  const unpaired = result.pairs.filter(p => !p.video).length
  const sorted = useMemo(() => [...result.videos].sort((a, b) => name(a).localeCompare(name(b))), [result.videos])
  const chosen = rows.filter(r => r.checked && r.video && !r.inLibrary)
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scan-modal" role="dialog" aria-label={t('一括取り込み')} onClick={e => e.stopPropagation()}>
        <h2>{t('一括取り込み')}</h2>
        <p className="hint">DVW {result.pairs.length} {t('件・動画')} {result.videos.length} {t('件が見つかりました。日付とチームコードで組にしています。違っていれば動画を選び直してください。')}</p>
        <div className="scan-table" role="table">
          <div className="scan-row head" role="row"><span /><span>{t('日付')}</span><span>{t('チーム')}</span><span>DVW</span><span>{t('動画')}</span><span>{t('判定')}</span></div>
          {rows.map((r, i) => {
            if (!showUnpaired && !result.pairs[i].video) return null
            const day = r.date ?? dateFromName(r.dvwPath)
            const options = [...sorted.filter(v => dateFromName(v) === day), ...sorted.filter(v => dateFromName(v) !== day)]
            return (
              <div key={r.dvwPath} className={`scan-row${r.inLibrary ? ' done' : ''}`} role="row">
                <input type="checkbox" checked={r.checked && !r.inLibrary} disabled={r.inLibrary || !r.video} aria-label={t('取り込む')}
                  onChange={e => set(i, { checked: e.target.checked })} />
                <span>{day ?? '—'}</span>
                <span><b>{r.home}</b>–<b>{r.away}</b></span>
                <span className="ellipsis" title={r.dvwPath}>{name(r.dvwPath)}</span>
                <select value={r.video ?? ''} disabled={r.inLibrary} aria-label={t('動画')}
                  onChange={e => set(i, { video: e.target.value || null, checked: !!e.target.value, note: e.target.value ? t('手動で選択') : t('対応する動画が見つかりません') })}>
                  <option value="">{t('（動画なし）')}</option>
                  {options.map(v => <option key={v} value={v}>{name(v)}</option>)}
                </select>
                <span className={`note${r.score >= 3 || r.note === t('手動で選択') ? '' : ' weak'}`}>{r.inLibrary ? t('倉庫にあります') : r.note}</span>
              </div>
            )
          })}
        </div>
        {unpaired > 0 && (
          <button className="link" onClick={() => setShowUnpaired(s => !s)}>
            {showUnpaired ? t('動画のない DVW を隠す') : t('動画のない DVW を表示（{0}）— 手で動画を選べます', unpaired)}
          </button>
        )}
        {result.unreadable.length > 0 && <p className="hint">{t('読めなかった DVW:')} {result.unreadable.map(name).join(', ')}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!chosen.length} onClick={() => onImport(chosen.map(r => ({ dvwPath: r.dvwPath, video: r.video! })))}>
            {chosen.length} {t('試合を取り込む')}
          </button>
        </div>
      </div>
    </div>
  )
}
