import { PaletteColor } from './PaletteColor'
import { Help, Placement } from './CourtControls'
import { useEffect, useState } from 'react'
import { DEFAULT_CHART, type ChartScope } from '../../../shared/chart'
import { CONE_COLOR, DEFAULT_CORNERS, HEAT_OPACITY, RIPPLE_COLOR, RIPPLE_LEAD_MAX, markSkill, type CourtFit, type GridStyle, type MarkSkill, type PlayerMarkStyle } from '../../../shared/court'
import type { Match } from '../../../shared/types'
import { DEFAULT_SET_CHART, DEFAULT_SET_COURT, REC_EFFECTS, SCORE_BANDS, setFilterCount, type SetChartView, type SetCourtLayer, type SetFilter, type SetPhase } from '../../../shared/setChart'
import { effectName } from '../../../shared/labels'
import type { MarkRange } from '../../../shared/markRange'
import { t } from '../../../shared/i18n'

interface Props {
  match: Match
  style: GridStyle
  onStyle: (s: GridStyle) => void
  fitting: boolean
  onFitting: (on: boolean) => void
  onFit: (fit: CourtFit | null) => void
  onAuto: () => Promise<void>
  playSkill: string | null // the selected play's skill: its tab of the player marks opens
  setterCalls: { code: string; name?: string }[] // the setter calls in the matches, for the set filter
}

function ChartRow({ chart: c, skill, onChange }: { chart: NonNullable<GridStyle['chart']>; skill: 'A' | 'S'; onChange: (c: NonNullable<GridStyle['chart']>) => void }) {
  return (
    <div className="ann-row court-sub">
      <span className="court-sub-label">{t('チャート')}</span>
      <select value={c.scope} aria-label={t('チャートの対象')} title={t('チャートに入れるプレー。サーブにアタックコードはないので、同じアタックコードでは全本を出す')} onChange={e => onChange({ ...c, scope: e.target.value as ChartScope })}>
        <option value="code">{t('同じアタックコード')}</option>
        <option value="zone">{t('同じ開始ゾーン')}</option>
        <option value="player">{t('全本')}</option>
        <option value="filter">{t('絞り込みの結果')}</option>
      </select>
      <label className="check"><input type="checkbox" checked={c.points !== false} onChange={e => onChange({ ...c, points: e.target.checked })} /> {t('点')}</label>
      <label className="check"><input type="checkbox" checked={c.lines} onChange={e => onChange({ ...c, lines: e.target.checked })} /> {t('線')}</label>
      <label className="check"><input type="checkbox" checked={!!c.heat} onChange={e => onChange({ ...c, heat: e.target.checked })} /> {t('ヒートマップ')}</label>
      {c.lines && <label className="check">{t('線の濃さ')} <input type="range" min={0.1} max={1} step={0.05} value={c.lineOpacity ?? 0.7} aria-label={t('線の濃さ')} onChange={e => onChange({ ...c, lineOpacity: +e.target.value })} /></label>}
      <label className="check"><input type="checkbox" checked={c.stats} onChange={e => onChange({ ...c, stats: e.target.checked })} /> {t('データ')}</label>
      <label className="check"><input type="checkbox" checked={c.name} onChange={e => onChange({ ...c, name: e.target.checked })} /> {t('名前')}</label>
      <Placement corner={c.corner} scale={c.scale} cornerLabel={t('チャートの位置')} scaleLabel={t('チャートの大きさ')} onCorner={corner => onChange({ ...c, corner })} onScale={scale => onChange({ ...c, scale })} />
    </div>
  )
}

const MARK_TABS: [MarkSkill, string][] = [['S', t('サーブ')], ['A', t('アタック')], ['E', t('セット')]]
const tabName = (k: MarkSkill) => MARK_TABS.find(([x]) => x === k)![1]

// The court grid for the match on screen: fit its corners, what to show, which team is near. What
// is laid over the selected play from the player's other plays is set for each kind of play on its
// own tab (a serve, an attack, a set), with only what applies to it; the selected play's tab opens.
export function CourtBar({ match, style: s, onStyle, fitting, onFitting, onFit, onAuto, playSkill, setterCalls }: Props) {
  const selected = markSkill(playSkill)
  const [tab, setTab] = useState<MarkSkill>(selected ?? 'A')
  useEffect(() => { if (selected) setTab(selected) }, [selected])
  const m: PlayerMarkStyle = s.bySkill?.[tab] ?? {}
  const put = <K extends keyof PlayerMarkStyle>(key: K, value: PlayerMarkStyle[K] | undefined) => {
    const { [key]: _old, ...rest } = m
    onStyle({ ...s, bySkill: { ...s.bySkill, [tab]: value === undefined ? rest : { ...rest, [key]: value } } })
  }
  const [gear, setGear] = useState(false)
  const [finding, setFinding] = useState(false)
  const autoButton = (after?: () => void) => (
    <button disabled={finding} title={t('動画の中のコートの線を探して、四隅の候補を置きます。少し時間がかかります。最後は線に合っているか確かめてください')}
      onClick={() => { if (match.court && !confirm(t('今の四隅を置き換えますか？'))) return; after?.(); setFinding(true); void onAuto().finally(() => setFinding(false)) }}>{finding ? t('探しています…') : t('自動で合わせる')}</button>
  )
  const fit = match.court
  const [home, away] = match.teams

  if (!fit) {
    return (
      <div className="ann-row court-bar">
        <span className="field-label">{t('コート')}</span>
        <button onClick={() => { onFit({ corners: DEFAULT_CORNERS, nearSet1: '*' }); onFitting(true) }}
          title={t('動画のコートにゾーンのグリッドを重ねます。四隅を一度合わせると、この試合では保存されます')}>{t('グリッドを合わせる')}</button>
        {autoButton()}
      </div>
    )
  }

  const points = s.playZones && s.detail === 'point' // the 座標 view: clicks, flights, heights
  const animate = (
    <label className="check" title={t('オン: プレーに合わせて放物線が伸びる。オフ: クリップの間、放物線の全体を出したままにする')}>
      <input type="checkbox" checked={!s.flightStill} onChange={e => onStyle({ ...s, flightStill: !e.target.checked })} /> {t('アニメーション')}</label>
  )
  const forecast = (
    <label className="check" title={t('サーブ・アタックの前に、放物線の予告線、着弾点とゾーン、打つ直前のカウントを出す。クリップの頭から、次に何が起こるかが分かる（書き出しも同じ）')}>
      <input type="checkbox" checked={s.forecast !== false} onChange={e => { const { forecast: _f, ...rest } = s; onStyle(e.target.checked ? rest : { ...rest, forecast: false }) }} /> {t('先読み')}</label>
  )
  return (
    <div className="court-bar">
      {/* Set up once per match: the corners, whether the grid shows, which team is near. */}
      <div className="court-group">
        <div className="ann-row">
          <span className="court-row-label">{t('コート')}</span>
          <button className={fitting ? 'primary' : ''} onClick={() => onFitting(!fitting)}
            title={t('四隅の丸をドラッグして、コートのエンドラインとサイドラインの交点に合わせます')}>{fitting ? t('完了') : t('四隅を合わせる')}</button>
          {fitting && <button onClick={() => onFit({ ...fit, corners: DEFAULT_CORNERS })} title={t('四隅を画面の中の初めの位置に戻します')}>{t('四隅をリセット')}</button>}
          <label className="check"><input type="checkbox" checked={s.grid} onChange={e => onStyle({ ...s, grid: e.target.checked })} /> {t('グリッド')}</label>
          {s.grid && (
            <select aria-label={t('グリッドを出す範囲')} title={t('グリッドを出す範囲。上半分は奥側（画面の上）、下半分は手前側（画面の下）だけ（書き出しも同じ）')} value={s.gridSide ?? ''}
              onChange={e => { const { gridSide: _g, ...rest } = s; onStyle(e.target.value ? { ...rest, gridSide: e.target.value as 'top' | 'bottom' } : rest) }}>
              <option value="">{t('コート全体')}</option><option value="top">{t('上半分')}</option><option value="bottom">{t('下半分')}</option>
            </select>
          )}
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
                <label className="check">{t('色')} <PaletteColor value={s.color} label={t('グリッドの色')} onChange={c => onStyle({ ...s, color: c })} /></label>
                <label className="check">{t('濃さ')}
                  <input type="range" min={0.1} max={1} step={0.05} value={s.opacity} onChange={e => onStyle({ ...s, opacity: +e.target.value })} /> {Math.round(s.opacity * 100)}%</label>
                <label className="check">{t('線の太さ')}
                  <input type="number" min={1} max={8} step={1} value={s.lineWidth} onChange={e => { const n = +e.target.value; if (n >= 1 && n <= 8) onStyle({ ...s, lineWidth: n }) }} /> px</label>
                {autoButton(() => setGear(false))}
                <button onClick={() => { setGear(false); onFitting(false); onFit(null) }}>{t('この試合のグリッドを消す')}</button>
              </div>
            )}
          </span>
        </div>
      </div>

      {/* What the one selected play shows. What only applies to a choice above sits under it. */}
      <div className="court-group">
        <div className="ann-row">
          <span className="court-row-label" title={t('一覧やシーンで選んだプレー 1 本の表示')}>{t('選んだプレー')}</span>
          <label className="check" title={t('選んだプレーの開始ゾーン（緑）と終了ゾーン（赤）')}>
            <input type="checkbox" checked={s.playZones} onChange={e => onStyle({ ...s, playZones: e.target.checked })} /> {t('表示する')}</label>
          <select value={s.detail} aria-label={t('ゾーンの細かさ')} hidden={!s.playZones} title={t('ゾーンの細かさ')}
            onChange={e => onStyle({ ...s, detail: e.target.value as GridStyle['detail'] })}>
            <option value="zone">{t('ゾーン')}</option>
            <option value="sub">{t('サブゾーン')}</option>
            <option value="point">{t('座標（点）')}</option>
          </select>
          {s.playZones && (
            <Help text={[t('サブゾーン: ゾーンを4分割した A〜D で塗り、矢印もその中心から中心へ。DVW にサブゾーンがないところはゾーン全体。座標: スカウトがクリックした位置を点で出す（レセプション・ディグはボールが来た位置）。サーブ・アタックは打点の高さ（ジャンプサーブ 3.1 m、フローター 3 m、アタック 3.15 m）の空中から矢印が出る。セットは 2.4 m からアタッカーの打点（3.15 m）まで（セットの開始座標がない DVW はセットのゾーンの中央、ゾーンもなければネット際のセッター位置から）。座標がないプレーはゾーンを塗り、ゾーンの中央を近似の位置として白抜きの点で出す（軌道は破線）')]} />
          )}
          <label className="check" title={t('選んだサーブ・アタックの着弾点に演出を出す（書き出しも同じ）')}>
            <input type="checkbox" checked={!!s.ripple} onChange={e => { const { ripple: _r, ...rest } = s; onStyle(e.target.checked ? { ...rest, ripple: true } : rest) }} /> {t('着弾の演出')}</label>
          {s.ripple && (
            <Help text={[t('選んだサーブ・アタックの着弾点から光の波紋が床に広がり（0.8 秒）、着弾の印を残して 3 秒で消える。ヒートマップとは別に動き、ヒートマップはいつもどおり出たまま（書き出しも同じ）'), t('波紋を着弾の何秒前に出すか。着弾の時刻は DVW の秒単位からの推定なので、映像に合わせて調整する。0 で推定の着弾と同時、マイナスにすると着弾のあと（書き出しも同じ）')]} />
          )}
        </div>
        {points && (
          <div className="ann-row court-sub">
            <label className="check" title={t('矢印の代わりに打点から着地までの軌道を放物線で描き、プレーに合わせて伸ばす。DVW の時刻は秒単位なので、実際のボールとは重なりません')}>
              <input type="checkbox" checked={!!s.flight} onChange={e => onStyle({ ...s, flight: e.target.checked })} /> {t('軌道（放物線）')}</label>
            {s.flight && animate}
            {s.flight && !s.flightStill && forecast}
            <label className="check" title={t('サーブ・アタックの打点は空中にあるので、真下の床からそこまで点線を引き、床に輪を出す（書き出しも同じ）')}>
              <input type="checkbox" checked={!s.noLift} onChange={e => onStyle({ ...s, noLift: !e.target.checked })} /> {t('打点の高さの線')}</label>
          </div>
        )}
        {s.ripple && (
          <div className="ann-row court-sub">
            <span className="court-sub-label">{t('着弾の演出')}</span>
            <select aria-label={t('着弾の演出の種類')} value={s.rippleKind ?? 'ripple'} onChange={e => { const { rippleKind: _k, ...rest } = s; onStyle(e.target.value === 'ripple' ? rest : { ...rest, rippleKind: e.target.value as GridStyle['rippleKind'] }) }}>
              <option value="ripple">{t('波紋')}</option><option value="lock">{t('ロックオン')}</option><option value="flash">{t('閃光')}</option><option value="trail">{t('軌跡の残光')}</option>
            </select>
            <PaletteColor label={t('波紋の色')} value={s.rippleColor ?? RIPPLE_COLOR} onChange={c => onStyle({ ...s, rippleColor: c })} />
            <label className="check" title={t('波紋を着弾の何秒前に出すか')}>{t('着弾の')}
              <input type="number" className="num-short" min={-RIPPLE_LEAD_MAX} max={RIPPLE_LEAD_MAX} step={0.1} value={s.rippleLead ?? 0} aria-label={t('波紋を着弾の何秒前に出すか')}
                onChange={e => { const n = parseFloat(e.target.value); if (!Number.isFinite(n)) return; const { rippleLead: _l, ...rest } = s; const v = Math.round(Math.max(-RIPPLE_LEAD_MAX, Math.min(RIPPLE_LEAD_MAX, n)) * 10) / 10; onStyle(v ? { ...rest, rippleLead: v } : rest) }} />
              {t('秒前に出す')}</label>
          </div>
        )}
        <div className="ann-row court-sub">
          <span className="court-sub-label" title={t('選んだサーブ・アタックが着弾したあとに、DVW の評価から結果を出す（書き出しも同じ）')}>{t('着弾のあと')}</span>
          {([
            ['resultMark', '結果アイコン', '着弾点の上に結果を出す。エース・決定は星、ミスは×、ブロックされたは盾、続行は評価記号（+ ! − /）そのもの'],
            ['resultTint', '色分け', '着弾の瞬間から、軌跡と着弾点を結果の色にする（エース・決定は緑、ミス・ブロックされたは赤。続行は変えない）'],
          ] as const).map(([key, label, tip]) => (
            <label key={key} className="check" title={t(tip)}>
              <input type="checkbox" checked={s[key] !== false} onChange={e => { const { [key]: _k, ...rest } = s; onStyle(e.target.checked ? rest : { ...rest, [key]: false }) }} /> {t(label)}</label>
          ))}
        </div>
      </div>

      {/* The selected play's player, over all their matches: per kind of play, and from which plays. */}
      <div className="court-group">
        <div className="ann-row mark-tabs-row">
          <span className="court-row-label" title={t('選んだプレーの選手の、全試合の分を重ねる。サーブ・アタック・セットで別々に決める')}>{t('選手の全本数')}</span>
          <div className="segmented" role="tablist" aria-label={t('プレーの種類')}>
            {MARK_TABS.map(([k, label]) => {
              const n = Object.entries(s.bySkill?.[k] ?? {}).filter(([key, v]) => key !== 'range' && v).length
              return (
                <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? 'on' : ''}${selected === k ? ' current' : ''}`} onClick={() => setTab(k)}
                  title={selected === k ? t('いま選んでいるプレー') : t('{0}を選んだときに出すもの', label)}>
                  {label}{n > 0 && <span className="mark-count">{n}</span>}
                </button>
              )
            })}
          </div>
          <label className="check" title={t('下の表示に使うプレーの範囲。ふだんは選手の全試合の全本')}>{t('範囲')}
            <select value={m.range ?? 'all'} aria-label={t('表示に使うプレーの範囲')} className={m.range ? 'on' : ''}
              title={t('ヒートマップ・落下点・軌道・コーン・チャート・トスのチャートを、どのプレーから作るか。シーン・マーカーは、いま開いているクリップのシーンやマーカーの中のプレーだけ（書き出しも同じ）')}
              onChange={e => put('range', e.target.value === 'all' ? undefined : e.target.value as MarkRange)}>
              <option value="all">{t('全試合の全本')}</option>
              <option value="match">{t('この試合だけ')}</option>
              <option value="scene">{t('このシーンだけ')}</option>
              <option value="marker">{t('このマーカーだけ')}</option>
              <option value="rally">{t('このラリーだけ')}</option>
            </select>
          </label>
          {selected !== tab && <span className="muted small">{selected ? t('いま選んでいるのは{0}。この設定は{1}を選んだときに出ます', tabName(selected), tabName(tab)) : t('この設定は{0}を選んだときに出ます', tabName(tab))}</span>}
        </div>
        <div className="ann-row">
          <span className="court-row-label" />
          {tab !== 'E' && (
            <label className="check" title={tab === 'S' ? t('その選手のサーブの落下点の多さを、同じスタートゾーンのものから色で出す。コートをクリックすると近い 5 本を出す（書き出しも同じ）') : t('その選手のアタックの落下点の多さを、同じアタックコードのものから色で出す。コートをクリックすると近い 5 本を出す（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.heat} onChange={e => put('heat', e.target.checked || undefined)} /> {t('ヒートマップ')}</label>
          )}
          {tab === 'S' && (
            <label className="check" title={t('その選手のサーブの軌道をすべて、そのサーブと一緒に飛ばす（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.serveFlights} onChange={e => put('serveFlights', e.target.checked || undefined)} /> {t('サーブ軌道')}</label>
          )}
          {tab !== 'E' && (
            <label className="check" title={tab === 'S' ? t('その選手のサーブの落下点を点で出す。点をクリックするとそのプレーへ飛ぶ（書き出しも同じ）') : t('その選手の同じアタックコードのアタックの落下点を点で出す。点をクリックするとそのプレーへ飛ぶ（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.landings} onChange={e => put('landings', e.target.checked || undefined)} /> {t('落下点')}</label>
          )}
          {tab === 'A' && (
            <label className="check" title={t('その選手の同じアタックコードのアタックが、打った位置から相手コートのどの方向へ行ったかを 5 つのコーンと割合で出す。多いコーンほど濃い（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.cones} onChange={e => put('cones', e.target.checked || undefined)} /> {t('コーン')}</label>
          )}
          {tab !== 'E' && (
            <label className="check" title={t('その選手のディレクションチャートを動画に重ねる。落ちた位置を結果ごとの色で出し、本数・決定率なども出す（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.chart} onChange={e => put('chart', e.target.checked ? DEFAULT_CHART : undefined)} /> {t('チャート')}</label>
          )}
          {tab !== 'S' && (
            <label className="check" title={tab === 'E' ? t('そのセッターのそのローテーションのトスを、動画の隅にチャートで出す（全試合の分。書き出しも同じ）') : t('アタックの前にトスを上げたセッターの、そのローテーションのトスのチャートを出す（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.setChart} onChange={e => put('setChart', e.target.checked ? DEFAULT_SET_CHART : undefined)} /> {tab === 'E' ? t('チャート') : t('トスのチャート')}</label>
          )}
          {tab === 'E' && (
            <label className="check" title={t('そのセッターのそのローテーションのトス配分を、動画のコートにそのまま重ねる（書き出しも同じ）')}>
              <input type="checkbox" checked={!!m.setCourt} onChange={e => put('setCourt', e.target.checked ? DEFAULT_SET_COURT : undefined)} /> {t('トス配分')}</label>
          )}
          {tab === 'E' && (m.setChart || m.setCourt) && (
            <Help text={[
              ...(m.setChart ? [t('そのセッターのそのローテーションのトスを、動画の隅にチャートで出す。点はトスを上げた位置、色は上げた先（Zone4 青・Zone3 緑・Zone2 赤・Zone1 濃い赤・Pipe 紫・SD 黄）、塗りは決定、白抜きは決まらず、×は失点。コートの上に配分（いちばん多い先は赤枠、少ない先は青枠）（全試合の分。書き出しも同じ）')] : []),
              ...(m.setCourt ? [t('そのセッターのそのローテーションのトス配分を、動画のコートにそのまま重ねる。「配分」は上げた先のエリアを割合の濃さで塗り、いちばん多い先を赤枠、少ない先を青枠で囲む。「トスの位置」はトスを上げた位置を点で出す（DVW にセットの座標が要る。書き出しも同じ）')] : []),
            ]} />
          )}
          {tab !== 'S' && (m.setChart || m.setCourt) && (
            <SetFilterButton value={m.setFilter ?? {}} calls={setterCalls} onChange={f => put('setFilter', setFilterCount(f) ? f : undefined)} />
          )}
        </div>
        {tab !== 'E' && m.heat && (
          <div className="ann-row court-sub">
            <span className="court-sub-label">{t('ヒートマップ')}</span>
            <label className="check" title={t('ヒートマップの濃さ。下げると透けて床や選手が見えます。スライドのヒートマップも同じ（書き出しも同じ）')}>{t('濃さ')}
              <input type="range" min={0.1} max={1} step={0.05} value={s.heatOpacity ?? HEAT_OPACITY} aria-label={t('ヒートマップの濃さ')} onChange={e => onStyle({ ...s, heatOpacity: +e.target.value })} /> {Math.round((s.heatOpacity ?? HEAT_OPACITY) * 100)}%</label>
          </div>
        )}
        {tab === 'S' && m.serveFlights && !(points && s.flight) && (
          <div className="ann-row court-sub"><span className="court-sub-label">{t('サーブ軌道')}</span>{animate}</div>
        )}
        {tab === 'A' && m.cones && (
          <div className="ann-row court-sub">
            <span className="court-sub-label">{t('コーン')}</span>
            <PaletteColor label={t('コーンの色')} value={s.coneColor ?? CONE_COLOR} onChange={c => onStyle({ ...s, coneColor: c })} />
          </div>
        )}
        {tab !== 'E' && m.chart && <ChartRow chart={m.chart} skill={tab} onChange={chart => put('chart', chart)} />}
        {tab !== 'S' && m.setChart && (
          <div className="ann-row court-sub">
            <span className="court-sub-label">{tab === 'E' ? t('チャート') : t('トスのチャート')}</span>
            <select value={m.setChart.view ?? 'auto'} aria-label={t('トス配分の見せ方')} title={t('点はトスを上げた位置（DVW にセットの座標が要る）。ゾーンはアタックのゾーンだけで、行き先ごとの割合を塗る。自動は、座標のあるセットが半分以上なら点')}
              onChange={e => { const { view: _v, ...rest } = m.setChart!; const v = e.target.value as SetChartView; put('setChart', v === 'auto' ? rest : { ...rest, view: v }) }}>
              <option value="auto">{t('自動')}</option><option value="points">{t('トスの位置（点）')}</option><option value="zones">{t('ゾーンだけ（簡略）')}</option>
            </select>
            <label className="check" title={t('オン: ネットを上にして、セッターの側から見る。オフ: ネットを下にして、相手の側から見る')}><input type="checkbox" checked={!!m.setChart.flip} onChange={e => { const { flip: _f, ...rest } = m.setChart!; put('setChart', e.target.checked ? { ...rest, flip: true } : rest) }} /> {t('上下反転')}</label>
            <Placement corner={m.setChart.corner} scale={m.setChart.scale} cornerLabel={t('トス配分の位置')} scaleLabel={t('トス配分の大きさ')}
              onCorner={corner => put('setChart', { ...m.setChart!, corner })} onScale={scale => put('setChart', { ...m.setChart!, scale })} />
          </div>
        )}
        {tab === 'E' && m.setCourt && (
          <div className="ann-row court-sub">
            <span className="court-sub-label">{t('トス配分')}</span>
            <select value={m.setCourt.layer} aria-label={t('コートに重ねるもの')} onChange={e => put('setCourt', { layer: e.target.value as SetCourtLayer })}>
              <option value="shares">{t('配分')}</option><option value="spots">{t('トスの位置')}</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

// What the setter's sets are kept to, in a dialog so the row stays short and every choice has room:
// their rotation (the selected play's, all, or some), the other team's rotation, the phase, the
// reception the set came from, the score, and setter calls. The button shows how many are set.
function SetFilterButton({ value: f, calls, onChange }: { value: SetFilter; calls: { code: string; name?: string }[]; onChange: (f: SetFilter) => void }) {
  const [open, setOpen] = useState(false)
  const n = setFilterCount(f)
  const set = (patch: Partial<SetFilter>) => {
    const next = { ...f, ...patch } as SetFilter
    for (const k of Object.keys(next) as (keyof SetFilter)[]) { const v = next[k]; if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k] }
    onChange(next)
  }
  const flip = <T,>(list: T[] | undefined, v: T): T[] => { const l = list ?? []; return l.includes(v) ? l.filter(x => x !== v) : [...l, v] }
  const rots = Array.isArray(f.rot) ? f.rot : []
  const ROTS = [1, 2, 3, 4, 5, 6]
  const chip = (key: string, on: boolean, label: string, toggle: () => void, title?: string) => (
    <label key={key} className={`filter-chip${on ? ' on' : ''}`} title={title}><input type="checkbox" checked={on} onChange={toggle} /> {label}</label>
  )
  return (
    <>
      <button className={n ? 'on' : ''} aria-expanded={open} onClick={() => setOpen(true)} title={t('トスを、ローテ・相手ローテ・フェイズ・レセプション・得点域・セッターコールで絞る')}>{t('絞り込み')}{n ? ` (${n})` : ''}</button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal set-filter-dialog" role="dialog" aria-label={t('トスの絞り込み')} onClick={e => e.stopPropagation()}>
            <h2>{t('トスの絞り込み')}</h2>
            <div className="set-filter-grid">
              <span className="field-label">{t('ローテ')}</span>
              <div className="set-filter-chips">
                <div className="segmented" role="radiogroup">
                  <button role="radio" aria-checked={!f.rot} className={!f.rot ? 'on' : ''} onClick={() => set({ rot: undefined })}>{t('選んだプレーと同じ')}</button>
                  <button role="radio" aria-checked={f.rot === 'all'} className={f.rot === 'all' ? 'on' : ''} onClick={() => set({ rot: 'all' })}>{t('すべて')}</button>
                </div>
                {ROTS.map(r => chip(`s${r}`, rots.includes(r), `S${r}`, () => set({ rot: flip(rots, r).sort() })))}
              </div>
              <span className="field-label">{t('相手ローテ')}</span>
              <div className="set-filter-chips">{ROTS.map(r => chip(`r${r}`, !!f.oppRots?.includes(r), `R${r}`, () => set({ oppRots: flip(f.oppRots, r).sort() })))}</div>
              <span className="field-label">{t('フェイズ')}</span>
              <div className="set-filter-chips">
                {chip('pr', !!f.phases?.includes('r'), t('レセプション'), () => set({ phases: flip(f.phases, 'r' as SetPhase) }), t('自チームのレセプションからの攻撃'))}
                {chip('pt', !!f.phases?.includes('t'), t('トランジション'), () => set({ phases: flip(f.phases, 't' as SetPhase) }), t('ディグなどからの攻撃'))}
              </div>
              <span className="field-label">{t('レセプション')}</span>
              <div className="set-filter-chips">
                {REC_EFFECTS.map(e => chip(`q${e}`, !!f.recs?.includes(e), `${e} ${effectName('R', e)}`, () => set({ recs: REC_EFFECTS.filter(x => x === e ? !f.recs?.includes(e) : f.recs?.includes(x)) })))}
              </div>
              <span className="field-label">{t('得点域')}</span>
              <div className="set-filter-chips">
                {SCORE_BANDS.map(b => chip(b.band, !!f.scores?.includes(b.band), t('{0} 点', b.label), () => set({ scores: SCORE_BANDS.map(x => x.band).filter(x => (x === b.band ? !f.scores?.includes(x) : f.scores?.includes(x))) }), t('セッターのチームのラリー前の得点')))}
              </div>
              <span className="field-label">{t('セッターコール')}</span>
              <div className="set-filter-chips">
                {calls.length ? calls.map(c => chip(c.code, !!f.calls?.includes(c.code), `${c.code}${c.name ? ` ${c.name}` : ''}`, () => set({ calls: flip(f.calls, c.code) }))) : <span className="muted small">{t('DVW にセッターコールがありません')}</span>}
              </div>
            </div>
            <p className="hint">{t('どの段も、何も選ばなければすべて。レセプションで絞るとレセプションからの攻撃だけ、セッターコールで絞るとコールのないツー（SD）は入りません')}</p>
            <div className="modal-actions">
              {n > 0 && <button className="link" onClick={() => onChange({})}>{t('絞り込みを外す')}</button>}
              <span className="spacer" />
              <button className="primary" onClick={() => setOpen(false)}>{t('閉じる')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
