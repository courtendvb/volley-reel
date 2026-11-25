import { useEffect, useRef, useState } from 'react'
import { cellOf, codeWithClickZones, pointOf } from '../../../shared/codeEdit'
import { CourtPicker, type Clicks } from './CourtPicker'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

// The selected play's clicks on a court seen from above, corrected play after play beside the video: drag the line,
// Enter saves it (when changed) and goes on to the next play in the list; ↑ ↓ go to the play before / after (saving
// a change first); Esc closes; Space and the other keys stay the video's. The code stays as it is unless "zones too"
// is on (serves and attacks only).
export function CourtFixPanel({ cells, code, label, near, far, zonesToo, onZonesToo, onSave, onMove, onClose }: {
  cells: { start?: string; end?: string } | undefined
  code: string
  label: string // which play: set, score, player, skill
  near: string; far: string // the play's own team (bottom) and the other (top)
  zonesToo: boolean; onZonesToo: (on: boolean) => void
  onSave: (start: string, end: string, code: string, then: 1 | -1) => void
  onMove: (dir: 1 | -1) => void
  onClose: () => void
}) {
  const first: Clicks = { start: pointOf(cells?.start), end: pointOf(cells?.end) }
  const [clicks, setClicks] = useState<Clicks>(first)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = box.current; if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }) } }, [])
  const cell = (p: Clicks['start']) => (p ? cellOf(p) : '')
  const start = cell(clicks.start), end = cell(clicks.end)
  const changed = start !== (cells?.start ?? '') || end !== (cells?.end ?? '')
  const zoned = codeWithClickZones(code, start || undefined, end || undefined)
  const go = (dir: 1 | -1) => { if (changed || (zonesToo && zoned)) onSave(start, end, zonesToo && zoned ? zoned : code, dir); else onMove(dir) }
  return (
    <div ref={box} className="court-fix" tabIndex={-1} aria-label={t('サブコートで座標を直す')}
      onPointerDown={e => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)) box.current?.focus({ preventScroll: true }) }}
      onKeyDown={e => {
        if (composing(e) || e.target instanceof HTMLInputElement) return
        const k = e.key
        if (k !== 'Enter' && k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Escape') return // the rest: the video's keys
        e.preventDefault(); e.stopPropagation()
        if (k === 'Escape') onClose()
        else go(k === 'ArrowUp' ? -1 : 1)
      }}>
      <div className="court-fix-court">
        <div className="court-fix-team">{far}</div>
        <CourtPicker value={clicks} onChange={setClicks} />
        <div className="court-fix-team">{near}</div>
      </div>
      <div className="code-court-side">
        <b className="court-fix-label">{label}</b>
        <p className="hint">{t('始まりから終わりへ線を引いて、Enter で保存して次のプレーへ。↑↓ 前後のプレー · Space 再生 / 一時停止 · Esc 閉じる')}</p>
        {zoned && !zonesToo && <p className="hint warning">{t('点の位置のゾーンとコードのゾーンが違います')}</p>}
        <label className="check"><input type="checkbox" checked={zonesToo} onChange={e => onZonesToo(e.target.checked)} />
          {t('ゾーンも点の位置に合わせる（サーブ・アタック）')}</label>
        <div className="court-fix-actions">
          <button className="small" onClick={() => setClicks({ start: null, end: null })}>{t('座標を消す')}</button>
          {changed && <button className="small" onClick={() => setClicks(first)}>{t('座標を戻す')}</button>}
          <button className="small primary" onClick={() => go(1)}>{changed ? t('保存して次へ') : t('次へ')}</button>
          <button className="small" onClick={onClose}>{t('閉じる')}</button>
        </div>
      </div>
    </div>
  )
}
