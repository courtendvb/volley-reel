import type { Play } from '../../../shared/types'
import { playback } from '../playback'
import { t } from '../../../shared/i18n'

// The match's time offset (Match.offsetSec: DVW time + offset = video time), for a scout file whose times
// are off for this video. Put the video on the moment of the selected play (a serve's hit is the easiest to
// see) and press: the offset becomes the gap, and every play of the match moves by it.
export function OffsetBar({ play, offsetSec, onOffset }: {
  play: Pick<Play, 'time'>
  offsetSec: number
  onOffset: (sec: number) => void
}) {
  const gap = (s: number) => `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(2)} ${t('秒')}`
  const here = () => Math.round((playback.current.time - play.time) * 1000) / 1000
  return (
    <div className="serve-mark offset-bar" title={t('スカウトファイルの時刻が動画とずれているときに使います。動画をこのプレーの瞬間（サーブなら打った瞬間）に合わせて押すと、この試合のすべてのプレーが同じだけ動きます')}>
      <span className="field-label">{t('時刻合わせ')}</span>
      <span className="serve-mark-time">{offsetSec ? t('ずれ {0}', gap(offsetSec)) : t('ずれなし')}</span>
      <button onClick={() => onOffset(here())} title={t('再生位置を、選んでいるプレーの時刻にします（この試合のすべてのプレーに効きます）')}>◎ {t('ここをこのプレーの時刻にする')}</button>
      <button className="small" onClick={() => onOffset(Math.round((offsetSec - 0.5) * 1000) / 1000)} title={t('この試合のプレーを 0.5 秒早める')}>−0.5{t('秒')}</button>
      <button className="small" onClick={() => onOffset(Math.round((offsetSec + 0.5) * 1000) / 1000)} title={t('この試合のプレーを 0.5 秒遅らせる')}>+0.5{t('秒')}</button>
      {offsetSec !== 0 && <button className="link" onClick={() => onOffset(0)}>{t('ずれを 0 に戻す')}</button>}
    </div>
  )
}
