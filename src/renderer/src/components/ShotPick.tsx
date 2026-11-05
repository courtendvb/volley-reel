// A click on the heatmap: the shots that landed nearest to it, to go to one, and the zone it is in,
// to list everything that landed there.
import type { Play } from '../../../shared/types'
import { t } from '../../../shared/i18n'

export interface ShotRow { play: Play; label: string }

export function ShotPick({ x, y, size, rows, zone, onPick, onZone, onClose }: {
  x: number; y: number; size: { w: number; h: number } // where in the picture, in pixels
  rows: ShotRow[]
  zone: number | null // the zone clicked, if on the court
  onPick: (p: Play) => void
  onZone: () => void
  onClose: () => void
}) {
  const WIDTH = 230, TALL = 190
  return (
    <div className="shot-pick" style={{ left: Math.min(x + 8, size.w - WIDTH), top: Math.min(y + 8, size.h - TALL), width: WIDTH }}>
      <div className="shot-pick-head"><b>{t('近い {0} 本', rows.length)}</b>
        <button className="link" aria-label={t('閉じる')} onClick={onClose}>×</button></div>
      {rows.map(r => <button key={`${r.label}-${r.play.id}`} onClick={() => onPick(r.play)}>{r.label}</button>)}
      {zone !== null && <button className="link" onClick={onZone}>{t('ゾーン {0} に落ちたプレーを一覧に出す', zone)}</button>}
    </div>
  )
}
