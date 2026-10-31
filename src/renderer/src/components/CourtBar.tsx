import { useState } from 'react'
import { DEFAULT_CORNERS, type CourtFit, type GridStyle, type SubZones } from '../../../shared/court'
import type { Match } from '../../../shared/types'
import { t } from '../../../shared/i18n'

interface Props {
  match: Match
  style: GridStyle
  onStyle: (s: GridStyle) => void
  fitting: boolean
  onFitting: (on: boolean) => void
  onFit: (fit: CourtFit | null) => void
}

const SUBS: [SubZones, string][] = [['off', t('なし')], ['lines', t('線')], ['labels', t('線と文字')]]

// The court grid for the match on screen: fit its corners, what to show, which team is near.
export function CourtBar({ match, style: s, onStyle, fitting, onFitting, onFit }: Props) {
  const [gear, setGear] = useState(false)
  const fit = match.court
  const [home, away] = match.teams

  if (!fit) {
    return (
      <div className="ann-row court-bar">
        <span className="field-label">{t('コート')}</span>
        <button onClick={() => { onFit({ corners: DEFAULT_CORNERS, nearSet1: '*' }); onFitting(true) }}
          title={t('動画のコートにゾーンのグリッドを重ねます。四隅を一度合わせると、この試合では保存されます')}>{t('グリッドを合わせる')}</button>
      </div>
    )
  }

  return (
    <div className="ann-row court-bar">
      <span className="field-label">{t('コート')}</span>
      <button className={fitting ? 'primary' : ''} onClick={() => onFitting(!fitting)}
        title={t('四隅の丸をドラッグして、コートのエンドラインとサイドラインの交点に合わせます')}>{fitting ? t('完了') : t('四隅を合わせる')}</button>
      <label className="check"><input type="checkbox" checked={s.grid} onChange={e => onStyle({ ...s, grid: e.target.checked })} /> {t('グリッド')}</label>
      <label className="check" title={t('選んだプレーの開始ゾーン（緑）と終了ゾーン（赤）')}>
        <input type="checkbox" checked={s.playZones} onChange={e => onStyle({ ...s, playZones: e.target.checked })} /> {t('プレーのゾーン')}</label>
      <label className="check"><input type="checkbox" checked={s.zoneNumbers} onChange={e => onStyle({ ...s, zoneNumbers: e.target.checked })} /> {t('ゾーン番号')}</label>
      <label className="check">{t('サブゾーン')}
        <select value={s.subZones} aria-label={t('サブゾーン')} onChange={e => onStyle({ ...s, subZones: e.target.value as SubZones })}>
          {SUBS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="check" title={t('第1セットで手前（カメラ側）にいるチーム。セットごとに入れ替わり、第5セットは8点で入れ替わります')}>{t('手前（第1セット）')}
        <select value={fit.nearSet1} aria-label={t('手前（第1セット）')} onChange={e => onFit({ ...fit, nearSet1: e.target.value as CourtFit['nearSet1'] })}>
          <option value="*">{home.name || home.code}</option>
          <option value="a">{away.name || away.code}</option>
        </select></label>
      <span className="spacer" />
      <span className="ov-gear-wrap">
        <button className="ov-gear" aria-label={t('グリッドの見た目')} aria-expanded={gear} onClick={() => setGear(g => !g)}>⚙</button>
        {gear && (
          <div className="ov-gear-pop" role="dialog" aria-label={t('グリッドの見た目')}>
            <label className="check">{t('色')} <input type="color" value={s.color} onChange={e => onStyle({ ...s, color: e.target.value.toUpperCase() })} /></label>
            <label className="check">{t('濃さ')}
              <input type="range" min={0.1} max={1} step={0.05} value={s.opacity} onChange={e => onStyle({ ...s, opacity: +e.target.value })} /> {Math.round(s.opacity * 100)}%</label>
            <label className="check">{t('線の太さ')}
              <input type="number" min={1} max={8} step={1} value={s.lineWidth} onChange={e => { const n = +e.target.value; if (n >= 1 && n <= 8) onStyle({ ...s, lineWidth: n }) }} /> px</label>
            <button onClick={() => { setGear(false); onFitting(false); onFit(null) }}>{t('この試合のグリッドを消す')}</button>
          </div>
        )}
      </span>
    </div>
  )
}
