import { useState } from 'react'
import { Accordion } from './Accordion'

export interface ExportTarget {
  key: string // 'video', 'scene', 'marker:<n>'
  label: string
  detail: string // what it holds, e.g. "3 シーン・12 クリップ・2分10秒"
  empty: boolean // nothing to export
}

interface Props {
  targets: ExportTarget[]
  info: string // the output: size, frame rate, fade, cards
  state: { status: string; ratio: number; message: string; outPath?: string } | null
  onExport: (key: string) => void
  onCancel: () => void
  onShowFile: (path: string) => void
  onOpenOverlay: () => void
}

// Export, as the last section of the right column: pick what to export (the whole video, the open
// scene, or one marker group), see what comes out, then one large button. Progress stays here too.
export function ExportPanel({ targets, info, state, onExport, onCancel, onShowFile, onOpenOverlay }: Props) {
  const [pick, setPick] = useState('video')
  const chosen = targets.find(t => t.key === pick) ?? targets[0]
  const busy = state?.status === 'running' || state?.status === 'preparing'
  const badge = busy ? `書き出し中 ${Math.round((state?.ratio ?? 0) * 100)}%` : state?.status === 'done' ? '✓ 書き出し済み' : undefined
  return (
    <Accordion id="export" icon="⤓" title="書き出し" badge={badge}>
      <div className="export-body">
        <div className="export-targets" role="radiogroup" aria-label="書き出す範囲">
          {targets.map(t => (
            <label key={t.key} className={`export-target${t.key === chosen?.key ? ' on' : ''}${t.empty ? ' empty' : ''}`}>
              <input type="radio" name="export-target" checked={t.key === chosen?.key} disabled={t.empty || busy} onChange={() => setPick(t.key)} />
              <span className="export-label">{t.label}</span>
              <span className="export-detail">{t.detail}</span>
            </label>
          ))}
        </div>
        <p className="export-info">{info} <button className="link" onClick={onOpenOverlay}>動画の設定</button></p>
        {busy ? (
          <div className="export-progress">
            <progress value={state!.ratio} max={1} />
            <span>{Math.round(state!.ratio * 100)}%</span>
            <button onClick={onCancel}>キャンセル</button>
          </div>
        ) : (
          <button className="primary export-go" disabled={!chosen || chosen.empty} onClick={() => chosen && onExport(chosen.key)}>
            ⤓ MP4 に書き出す
          </button>
        )}
        {state && !busy && (
          <p className={`export-result ${state.status}`}>{state.message}
            {state.status === 'done' && state.outPath && <button className="link" onClick={() => onShowFile(state.outPath!)}>フォルダを開く</button>}
          </p>
        )}
      </div>
    </Accordion>
  )
}
