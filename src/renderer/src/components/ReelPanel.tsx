import { useState, type DragEvent } from 'react'
import { playLabel } from '../../../shared/labels'
import {
  MARKERS, MARKER_COLORS, chronological, markerCardOn, moveClip, placeGroup, rangeDefaults, removeClip, renameMarker, shiftClip, shiftGroup,
  type Clip, type Group, type Marker, type RangeDefaults, type Reel,
} from '../../../shared/reel'
import type { PlayRef } from '../../../shared/filter'
import { pad2 } from '../format'

export interface ClipInfo {
  ref: PlayRef | undefined
  range: { in: number; out: number } | null
  def: { in: number; out: number } | null
  matchLabel: string
  date: string
}

interface Props {
  reels: Reel[]
  reel: Reel | null
  onSelectReel: (id: string) => void
  onNewReel: () => void
  onDeleteReel: (id: string) => void
  onChange: (r: Reel) => void
  info: (c: Clip) => ClipInfo
  missing: Set<string>
  activeClipId: string | null
  playingClipId: string | null
  onActivate: (c: Clip) => void
  playing: boolean
  onPlayThrough: () => void
  onStop: () => void
  orderCount: number
  orderSec: number
  overlaps: Map<string, string[]>
  usedIn: number // videos that include this scene
  markerCardDefault: boolean // the video's "card before each marker" setting, for markers the scene leaves unset
}

const DT_CLIP = 'application/x-vr-clip'
const DT_GROUP = 'application/x-vr-group'

export function ReelPanel(p: Props) {
  const { reel } = p
  const [dragOver, setDragOver] = useState<string | null>(null)
  if (!reel) {
    return (
      <aside className="reel-panel">
        <div className="reel-head"><button className="primary" onClick={p.onNewReel}>シーンを作成</button></div>
        <p className="muted pad">プレー一覧の 1〜5 ボタンか数字キー 1〜5 で、プレーをシーンに入れられます。</p>
      </aside>
    )
  }

  const change = (r: Reel) => p.onChange(r)
  const multiMatch = new Set(Object.values(reel.clips).map(c => c.matchId)).size > 1
  const when = (c: Clip): [string, number] => { const i = p.info(c); return [i.date, i.range?.in ?? 0] }

  const onDropClip = (e: DragEvent, to: Group, index?: number) => {
    const id = e.dataTransfer.getData(DT_CLIP)
    if (id) { e.preventDefault(); change(moveClip(reel, id, to, index)) }
    setDragOver(null)
  }
  const onDropGroup = (e: DragEvent, before: Marker) => {
    const g = Number(e.dataTransfer.getData(DT_GROUP)) as Marker
    if (g && g !== before) { e.preventDefault(); change(placeGroup(reel, g, before)) }
    else onDropClip(e, before)
    setDragOver(null)
  }
  const allow = (key: string) => (e: DragEvent) => { e.preventDefault(); setDragOver(key) }

  const clipRow = (c: Clip, g: Group, i: number) => {
    const inf = p.info(c), r = inf.ref
    const dur = inf.range ? inf.range.out - inf.range.in : 0
    const trimmed = c.inSec !== null || c.outSec !== null
    return (
      <div
        key={c.id} role="listitem" draggable
        className={`clip-row${c.id === p.activeClipId ? ' active' : ''}${c.id === p.playingClipId ? ' playing' : ''}${dragOver === c.id ? ' drop-before' : ''}`}
        onDragStart={e => { e.dataTransfer.setData(DT_CLIP, c.id); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={g === 'none' ? undefined : allow(c.id)} onDragLeave={() => setDragOver(null)}
        onDrop={g === 'none' ? undefined : e => onDropClip(e, g, i)}
        onClick={() => p.onActivate(c)}
      >
        {p.missing.has(c.id) || !r ? (
          <span className="clip-main missing">プレーが見つかりません（DVW が変更された可能性）</span>
        ) : (
          <span className="clip-main">
            {multiMatch && <span className="muted">{inf.matchLabel} </span>}
            <span className="muted">S{r.play.setNum} {pad2(r.play.score.home)}-{pad2(r.play.score.away)} </span>
            <b>{r.play.jersey}</b> {r.name} <span className={`skill-${r.play.skill}`}>{playLabel(r.play.skill, r.play.effect)}</span>
          </span>
        )}
        {p.overlaps.has(c.id) && <span className="overlap" title="同じ試合の別のクリップと範囲が重なっています">⚠</span>}
        <span className={`clip-dur${trimmed ? ' trimmed' : ''}`} title={trimmed ? '長さを個別に調整済み' : '初期値の長さ'}>{dur.toFixed(1)}s</span>
        <span className="clip-actions" onClick={e => e.stopPropagation()}>
          {g !== 'none' && <button title="上へ" onClick={() => change(shiftClip(reel, c.id, -1))}>↑</button>}
          {g !== 'none' && <button title="下へ" onClick={() => change(shiftClip(reel, c.id, 1))}>↓</button>}
          <button title="シーンから外す" onClick={() => change(removeClip(reel, c.id))}>×</button>
        </span>
      </div>
    )
  }

  const none = chronological(reel, reel.groups.none, when)
  const marked = MARKERS.reduce((n, m) => n + reel.groups[m].length, 0)

  return (
    <aside className="reel-panel">
      <div className="reel-head">
        <span className="panel-kicker">シーン</span>
        <select value={reel.id} onChange={e => p.onSelectReel(e.target.value)} aria-label="シーン">
          {p.reels.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button onClick={p.onNewReel} title="新しいシーン（今の動画にも入れる）">＋</button>
        <button onClick={() => { if (confirm(`シーン「${reel.name}」を削除しますか？${p.usedIn ? `
${p.usedIn} 本の動画から外れます。` : ''}（reels/deleted/ に移動します）`)) p.onDeleteReel(reel.id) }} title="シーンを削除">削除</button>
      </div>
      <label className="reel-name-row"><span className="field-label">名前</span>
        <input className="reel-name" value={reel.name} onChange={e => change({ ...reel, name: e.target.value })} aria-label="シーンの名前"
          title="シーンの名前。シーンのタイトルカードに出ます" /></label>

      <div className="reel-controls">
        <div className="segmented" role="radiogroup" aria-label="書き出し範囲">
          <button role="radio" aria-checked={reel.scope === 'marked'} className={reel.scope === 'marked' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'marked' })}>マーカー付き</button>
          <button role="radio" aria-checked={reel.scope === 'all'} className={reel.scope === 'all' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'all' })}>全部</button>
        </div>
        {p.playing
          ? <button onClick={p.onStop}>■ 停止</button>
          : <button className="primary" onClick={p.onPlayThrough} disabled={!p.orderCount} title="このシーンだけを再生">▶ シーンを再生</button>}
      </div>
      <Defaults d={rangeDefaults(reel)} legacy={Object.values(reel.clips).some(c => !c.mode)} onChange={d => change({ ...reel, rangeDefaults: d, updatedAt: new Date().toISOString() })} />
      <p className="count">{p.orderCount} クリップ・{formatDur(p.orderSec)}（マーカー付き {marked} / 全 {Object.keys(reel.clips).length}）</p>

      <div className="reel-groups" role="list">
        {reel.groupOrder.map((m, gi) => (
          <section key={m} className={`group${reel.markerOff?.[m] ? ' off' : ''}${dragOver === `g${m}` ? ' drop-into' : ''}`}
            onDragOver={allow(`g${m}`)} onDragLeave={() => setDragOver(null)} onDrop={e => onDropGroup(e, m)}>
            <header className="group-head" draggable onDragStart={e => e.dataTransfer.setData(DT_GROUP, String(m))}>
              <button className={`group-switch${reel.markerOff?.[m] ? '' : ' on'}`} role="switch" aria-checked={!reel.markerOff?.[m]}
                aria-label={`マーカー ${m} を使う`}
                title={reel.markerOff?.[m] ? 'オフ: 再生・書き出しに使わない（クリックでオン）' : 'オン: 再生・書き出しに使う（クリックでオフ）'}
                onClick={() => change({ ...reel, markerOff: { ...reel.markerOff, [m]: !reel.markerOff?.[m] }, updatedAt: new Date().toISOString() })}>
                <span /></button>
              <span className="swatch" style={{ background: MARKER_COLORS[m] }}>{m}</span>
              <input value={reel.markerNames[m]} placeholder={`マーカー ${m} の名前`} aria-label={`マーカー ${m} の名前`}
                onChange={e => change(renameMarker(reel, m, e.target.value))} />
              <span className="muted">{reel.groups[m].length}</span>
              {(() => {
                const on = markerCardOn(reel, m, p.markerCardDefault)
                return (
                  <button className={`card-toggle${on ? ' on' : ''}`} aria-pressed={on}
                    title={on ? 'このマーカーの前にタイトルカードを出す（クリックで出さない）' : 'このマーカーの前にタイトルカードを出さない（クリックで出す）'}
                    onClick={() => change({ ...reel, markerCards: { ...reel.markerCards, [m]: !on }, updatedAt: new Date().toISOString() })}>カード</button>
                )
              })()}
              <button title="グループを上へ" disabled={gi === 0} onClick={() => change(shiftGroup(reel, m, -1))}>↑</button>
              <button title="グループを下へ" disabled={gi === reel.groupOrder.length - 1} onClick={() => change(shiftGroup(reel, m, 1))}>↓</button>
            </header>
            {reel.groups[m].map((id, i) => clipRow(reel.clips[id], m, i))}
          </section>
        ))}
        <section className={`group none${reel.scope === 'marked' ? ' excluded' : ''}${dragOver === 'gnone' ? ' drop-into' : ''}`}
          onDragOver={allow('gnone')} onDragLeave={() => setDragOver(null)} onDrop={e => onDropClip(e, 'none')}>
          <header className="group-head">
            <span className="swatch none">–</span>
            <span className="none-title">マーカーなし（時系列）{reel.scope === 'marked' && <span className="muted"> — 書き出し対象外</span>}</span>
            <span className="muted">{none.length}</span>
          </header>
          {none.map((c, i) => clipRow(c, 'none', i))}
        </section>
      </div>
      <p className="hint pad-x">数字キー 1〜5 で選択中のクリップにマーカー（同じ数字か 0 で解除）。ドラッグでも並べ替えられます。</p>
    </aside>
  )
}

// Default clip length for clips without their own IN/OUT (design §3.5).
// The seconds clips are cut with. Clips added from the search carry their own cut (around the key
// play, or to the end of the rally); clips added before that follow the scene's mode select.
function Defaults({ d, legacy, onChange }: { d: RangeDefaults; legacy: boolean; onChange: (d: RangeDefaults) => void }) {
  const num = (v: number, set: (n: number) => RangeDefaults, label: string) => (
    <input type="number" min={0} max={30} step={0.5} value={v} aria-label={label}
      onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 0) onChange(set(n)) }} />
  )
  return (
    <div className="reel-defaults">
      <span>キープレー −{num(d.keyBefore, n => ({ ...d, keyBefore: n }), 'キープレーの何秒前から')}秒 〜 +{num(d.keyAfter, n => ({ ...d, keyAfter: n }), 'キープレーの何秒後まで')}秒</span>
      <span>ラリー終わり +{num(d.rallyTail, n => ({ ...d, rallyTail: n }), '最後のプレーの何秒後まで')}秒</span>
      {legacy && (
        <span title="切り出しの指定がない（以前に入れた）クリップの長さ">
          以前のクリップ <select value={d.mode} onChange={e => onChange({ ...d, mode: e.target.value as RangeDefaults['mode'] })} aria-label="長さの初期値">
            <option value="rally">ラリー全体</option>
            <option value="keyplay">キープレー中心</option>
          </select>
          {d.mode === 'rally' && <> サーブ −{num(d.rallyLead, n => ({ ...d, rallyLead: n }), 'サーブの何秒前から')}秒</>}
        </span>
      )}
    </div>
  )
}

function formatDur(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}
