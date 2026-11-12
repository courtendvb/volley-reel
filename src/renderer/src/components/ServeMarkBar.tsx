import type { ServeMark } from '../../../shared/types'
import { playback } from '../playback'
import { t } from '../../../shared/i18n'

// A serve picked in the list, with no clip of it open: its hit and its reception's touch set at the
// playhead, and the speed they give. The same marks show as the red and blue lines on its clips.
export function ServeMarkBar({ keyTime, mark, measured, onMark }: {
  keyTime: number // the serve's DVW time on the video
  mark: ServeMark | undefined
  measured: number | null // km/h, from both marks
  onMark: (patch: { hit?: number | null; touch?: number | null }) => void
}) {
  const now = () => Math.round(playback.current.time * 1000) / 1000
  const rel = (v: number | undefined) => (v === undefined ? t('未設定') : `${v >= keyTime ? '+' : ''}${(v - keyTime).toFixed(3)}`)
  const order = mark?.hit !== undefined && mark.touch !== undefined && mark.touch <= mark.hit
  return (
    <div className="serve-mark" title={t('Shift+← → で 1 コマずつ送り、サーブを打ったコマで「◎ ヒット」、レシーブが触れたコマで「◎ タッチ」')}>
      <span className="field-label">{t('サーブ速度')}</span>
      <button onClick={() => onMark({ hit: now() })} title={t('再生位置をサーブのヒットにする')}>◎ {t('ヒット')}</button>
      <span className="serve-mark-time">{rel(mark?.hit)}</span>
      <button onClick={() => onMark({ touch: now() })} title={t('再生位置をレシーブのタッチにする')}>◎ {t('タッチ')}</button>
      <span className="serve-mark-time">{rel(mark?.touch)}</span>
      {measured ? <b className="serve-mark-speed">{measured} km/h</b>
        : <span className="muted small">{order ? t('タッチがヒットより前です') : t('タッチを打つと速度が出ます')}</span>}
      {measured && mark?.hit === undefined && <span className="overlap" title={t('ヒットが DVW の秒のままです。サーブを打ったコマで「◎ ヒット」を押してください')}>⚠ {t('ヒット未設定')}</span>}
      {mark && <button className="link" onClick={() => onMark({ hit: null, touch: null })}>{t('外す')}</button>}
    </div>
  )
}
