import { useState } from 'react'
import { DEFAULT_CHART, type ChartCorner, type ChartResult, type ChartScope } from '../../../shared/chart'
import { CONE_COLOR, DEFAULT_CORNERS, HEAT_OPACITY, type CourtFit, type GridStyle } from '../../../shared/court'
import type { Match } from '../../../shared/types'
import { t } from '../../../shared/i18n'

interface Props {
  match: Match
  style: GridStyle
  onStyle: (s: GridStyle) => void
  fitting: boolean
  onFitting: (on: boolean) => void
  onFit: (fit: CourtFit | null) => void
  onAuto: () => Promise<void>
}

function ChartRow({ chart: c, onChange }: { chart: NonNullable<GridStyle['chart']>; onChange: (c: NonNullable<GridStyle['chart']>) => void }) {
  const results: [ChartResult, string][] = [['kill', t('決定')], ['error', t('ミス')], ['blocked', t('被ブロック')], ['pos', t('Pos')], ['neg', t('Neg')]]
  return (
    <div className="ann-row">
      <span className="court-row-label">{t('チャート')}</span>
      <select value={c.scope} aria-label={t('チャートの対象')} title={t('チャートに入れるアタック')} onChange={e => onChange({ ...c, scope: e.target.value as ChartScope })}>
        <option value="player">{t('全アタック')}</option>
        <option value="code">{t('同じアタックコード')}</option>
        <option value="filter">{t('絞り込みの結果')}</option>
      </select>
      <label className="check"><input type="checkbox" checked={c.lines} onChange={e => onChange({ ...c, lines: e.target.checked })} /> {t('線')}</label>
      <label className="check"><input type="checkbox" checked={c.stats} onChange={e => onChange({ ...c, stats: e.target.checked })} /> {t('数字')}</label>
      <select value={c.corner} aria-label={t('チャートの位置')} onChange={e => onChange({ ...c, corner: e.target.value as ChartCorner })}>
        <option value="tl">{t('左上')}</option><option value="tr">{t('右上')}</option><option value="bl">{t('左下')}</option><option value="br">{t('右下')}</option>
      </select>
      <label className="check">{t('大きさ')} <input type="range" min={0.5} max={1.5} step={0.05} value={c.scale} aria-label={t('チャートの大きさ')} onChange={e => onChange({ ...c, scale: +e.target.value })} /></label>
      {results.map(([k, label]) => (
        <label key={k} className="check" title={t('{0} の色', label)}>{label} <input type="color" value={c.colors[k]} aria-label={t('{0} の色', label)} onChange={e => onChange({ ...c, colors: { ...c.colors, [k]: e.target.value.toUpperCase() } })} /></label>
      ))}
    </div>
  )
}

// The court grid for the match on screen: fit its corners, what to show, which team is near.
export function CourtBar({ match, style: s, onStyle, fitting, onFitting, onFit, onAuto }: Props) {
  const [gear, setGear] = useState(false)
  const [finding, setFinding] = useState(false)
  const auto = (
    <button disabled={finding} title={t('動画の中のコートの線を探して、四隅の候補を置きます。少し時間がかかります。最後は線に合っているか確かめてください')}
      onClick={() => { if (match.court && !confirm(t('今の四隅を置き換えますか？'))) return; setFinding(true); void onAuto().finally(() => setFinding(false)) }}>{finding ? t('探しています…') : t('自動で合わせる')}</button>
  )
  const fit = match.court
  const [home, away] = match.teams

  if (!fit) {
    return (
      <div className="ann-row court-bar">
        <span className="field-label">{t('コート')}</span>
        <button onClick={() => { onFit({ corners: DEFAULT_CORNERS, nearSet1: '*' }); onFitting(true) }}
          title={t('動画のコートにゾーンのグリッドを重ねます。四隅を一度合わせると、この試合では保存されます')}>{t('グリッドを合わせる')}</button>
        {auto}
      </div>
    )
  }

  const points = s.playZones && s.detail === 'point' // the 座標 view: clicks, flights, heights
  const animate = (
    <label className="check" title={t('オン: プレーに合わせて放物線が伸びる。オフ: クリップの間、放物線の全体を出したままにする')}>
      <input type="checkbox" checked={!s.flightStill} onChange={e => onStyle({ ...s, flightStill: !e.target.checked })} /> {t('アニメーション')}</label>
  )
  return (
    <div className="court-bar">
      <div className="ann-row">
        <span className="court-row-label">{t('コート')}</span>
        <button className={fitting ? 'primary' : ''} onClick={() => onFitting(!fitting)}
          title={t('四隅の丸をドラッグして、コートのエンドラインとサイドラインの交点に合わせます')}>{fitting ? t('完了') : t('四隅を合わせる')}</button>
        {auto}
        {fitting && <button onClick={() => onFit({ ...fit, corners: DEFAULT_CORNERS })} title={t('四隅を画面の中の初めの位置に戻します')}>{t('四隅をリセット')}</button>}
        <label className="check"><input type="checkbox" checked={s.grid} onChange={e => onStyle({ ...s, grid: e.target.checked })} /> {t('グリッド')}</label>
        <label className="check" title={t('第1セットで手前（カメラ側）にいるチーム。セットごとに入れ替わり、第5セットは8点で入れ替わります')}>{t('手前')}
        <select className="near-team" value={fit.nearSet1} aria-label={t('手前（第1セット）')} onChange={e => onFit({ ...fit, nearSet1: e.target.value as CourtFit['nearSet1'] })}>
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
      <div className="ann-row">
        <span className="court-row-label" title={t('一覧やシーンで選んだプレー 1 本の表示')}>{t('選んだプレー')}</span>
        <label className="check" title={t('選んだプレーの開始ゾーン（緑）と終了ゾーン（赤）')}>
          <input type="checkbox" checked={s.playZones} onChange={e => onStyle({ ...s, playZones: e.target.checked })} /> {t('表示する')}</label>
      <select value={s.detail} aria-label={t('ゾーンの細かさ')} hidden={!s.playZones}
        title={t('サブゾーン: ゾーンを4分割した A〜D で塗り、矢印もその中心から中心へ。DVW にサブゾーンがないところはゾーン全体。座標: スカウトがクリックした位置を点で出す（レセプション・ディグはボールが来た位置）。サーブ・アタックは打点の高さ（ジャンプサーブ 3.1 m、フローター 3 m、アタック 3.15 m）の空中から矢印が出る。セットは 2.4 m からアタッカーの打点（3.15 m）まで（セットの開始座標がない DVW はセットのゾーンの中央、ゾーンもなければネット際のセッター位置から）。座標がないプレーはゾーンを塗り、ゾーンの中央を近似の位置として白抜きの点で出す（軌道は破線）')}
        onChange={e => onStyle({ ...s, detail: e.target.value as GridStyle['detail'] })}>
        <option value="zone">{t('ゾーン')}</option>
        <option value="sub">{t('サブゾーン')}</option>
        <option value="point">{t('座標（点）')}</option>
      </select>
        {points && (
          <>
            <label className="check" title={t('矢印の代わりに打点から着地までの軌道を放物線で描き、プレーに合わせて伸ばす。DVW の時刻は秒単位なので、実際のボールとは重なりません')}>
              <input type="checkbox" checked={!!s.flight} onChange={e => onStyle({ ...s, flight: e.target.checked })} /> {t('軌道（放物線）')}</label>
            {s.flight && animate}
            <label className="check" title={t('サーブ・アタックの打点は空中にあるので、真下の床からそこまで点線を引き、床に輪を出す（書き出しも同じ）')}>
              <input type="checkbox" checked={!s.noLift} onChange={e => onStyle({ ...s, noLift: !e.target.checked })} /> {t('打点の高さの線')}</label>
          </>
        )}
      </div>
      <div className="ann-row">
        <span className="court-row-label" title={t('サーブかアタックを選んだとき、その選手の全試合の分を重ねる')}>{t('選手の全本数')}</span>
        <label className="check" title={t('サーブかアタックを選ぶと、その選手の落下点の多さをプロジェクトの全試合からコートに色で出す。サーブはスタートゾーンが同じもの、アタックはアタックコードが同じものだけ。コートをクリックすると近い 5 本を出す（書き出しも同じ）')}>
          <input type="checkbox" checked={!!s.heat} onChange={e => onStyle({ ...s, heat: e.target.checked })} /> {t('ヒートマップ')}</label>
        {s.heat && (
          <label className="check" title={t('ヒートマップの濃さ。下げると透けて床や選手が見えます。スライドのヒートマップも同じ（書き出しも同じ）')}>{t('濃さ')}
            <input type="range" min={0.1} max={1} step={0.05} value={s.heatOpacity ?? HEAT_OPACITY} aria-label={t('ヒートマップの濃さ')} onChange={e => onStyle({ ...s, heatOpacity: +e.target.value })} /> {Math.round((s.heatOpacity ?? HEAT_OPACITY) * 100)}%</label>
        )}
        <label className="check" title={t('サーブを選ぶと、その選手のサーブの軌道をプロジェクトの全試合からすべて、そのサーブと一緒に飛ばす（書き出しも同じ）')}>
          <input type="checkbox" checked={!!s.serveFlights} onChange={e => onStyle({ ...s, serveFlights: e.target.checked })} /> {t('サーブ軌道')}</label>
        <label className="check" title={t('サーブかアタックを選ぶと、その選手の落下点をプロジェクトの全試合から点で出す。軌道を出さず点だけ見るときは「サーブ軌道」を外す。アタックはアタックコードが同じものだけ。点をクリックするとそのプレーへ飛ぶ（書き出しも同じ）')}>
          <input type="checkbox" checked={!!s.landings} onChange={e => onStyle({ ...s, landings: e.target.checked })} /> {t('落下点')}</label>
        <label className="check" title={t('アタックを選ぶと、その選手の同じアタックコードのアタックが、打った位置から相手コートのどの方向へ行ったかを 5 つのコーンと割合で出す。多いコーンほど濃い（全試合の分。書き出しも同じ）')}>
          <input type="checkbox" checked={!!s.cones} onChange={e => onStyle({ ...s, cones: e.target.checked })} /> {t('コーン')}</label>
        {s.cones && <input type="color" aria-label={t('コーンの色')} title={t('コーンの色')} value={s.coneColor ?? CONE_COLOR} onChange={e => onStyle({ ...s, coneColor: e.target.value.toUpperCase() })} />}
        <label className="check" title={t('アタックを選ぶと、その選手のディレクションチャートを動画に重ねる。落ちた位置を結果ごとの色で出し、本数・決定率なども出す（書き出しも同じ）')}>
          <input type="checkbox" checked={!!s.chart} onChange={e => { const { chart: _c, ...rest } = s; onStyle(e.target.checked ? { ...s, chart: DEFAULT_CHART } : rest) }} /> {t('チャート')}</label>
        {s.serveFlights && !(points && s.flight) && animate}
      </div>
      {s.chart && <ChartRow chart={s.chart} onChange={chart => onStyle({ ...s, chart })} />}
    </div>
  )
}
