import { useEffect, useState, type DragEvent } from 'react'
import { playLabel } from '../../../shared/labels'
import {
  MARKERS, MARKER_COLORS, chronological, markerCardOn, moveClip, placeGroup, rangeDefaults, removeClip, renameMarker,
  type Clip, type Group, type Marker, type RangeDefaults, type Reel,
} from '../../../shared/reel'
import type { PlayRef } from '../../../shared/filter'
import { pad2 } from '../format'
import { InlineTitle } from './InlineTitle'

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
  onActivate: (c: Clip, g: Group) => void // g: the group row it was clicked in
  playing: boolean
  onPlayThrough: () => void
  onStop: () => void
  orderCount: number
  orderSec: number
  overlaps: Map<string, string[]>
  usedIn: number // videos that include this scene
  videoSceneIds: string[] | null // the open video's scenes (null: no video): the scene list is split by them
  onAddToVideo: (sceneId: string) => void
  markerCardDefault: boolean // the video's "card before each marker" setting, for markers the scene leaves unset
  onEditCard: (m: Marker) => void // the gear: edit how marker title cards look, in the video window
}

const DT_CLIP = 'application/x-vr-clip'
const DT_GROUP = 'application/x-vr-group'

export function ReelPanel(p: Props) {
  const { reel } = p
  const [dragOver, setDragOver] = useState<{ key: string; after: boolean } | null>(null)
  // The open clip stays in view (it can change with the Up / Down keys).
  useEffect(() => { document.querySelector('.reel-groups .clip-row.active')?.scrollIntoView({ block: 'nearest' }) }, [p.activeClipId])
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

  // Dragging shows a line where the item will land: above or below the row under the pointer.
  const lower = (e: DragEvent) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY > b.top + b.height / 2 }
  const dragging = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type)
  const lineClass = (key: string) => (dragOver?.key === key ? (dragOver.after ? ' drop-after' : ' drop-before') : '')

  // A clip dropped on a row of a marker group lands before or after it; on a group, at its end.
  // The drag carries the clip and the group it was dragged from ("id|group"): a clip with two
  // markers leaves only that group.
  const onDropClip = (e: DragEvent, to: Group, slot?: number) => {
    const [id, fromGroup] = e.dataTransfer.getData(DT_CLIP).split('|')
    setDragOver(null)
    if (!id) return
    e.preventDefault(); e.stopPropagation()
    const src = (fromGroup === 'none' ? 'none' : Number(fromGroup)) as Group
    const from = to === 'none' ? -1 : reel.groups[to].indexOf(id)
    // slot counts the rows as they are; moveClip counts them without the moved clip.
    change(moveClip(reel, id, to, slot === undefined ? undefined : from >= 0 && from < slot ? slot - 1 : slot, src))
  }
  // A group dropped on another goes above or below it.
  const onDropGroup = (e: DragEvent, at: Marker) => {
    const g = Number(e.dataTransfer.getData(DT_GROUP)) as Marker
    if (!g) { onDropClip(e, at); return }
    e.preventDefault()
    const after = dragOver?.key === `h${at}` && dragOver.after
    setDragOver(null)
    const i = reel.groupOrder.indexOf(at)
    const before = after ? reel.groupOrder[i + 1] ?? null : at
    if (g !== at && before !== g) change(placeGroup(reel, g, before))
  }
  const overGroup = (m: Marker) => (e: DragEvent) => {
    e.preventDefault()
    setDragOver(dragging(e, DT_GROUP) ? { key: `h${m}`, after: lower(e) } : { key: `g${m}`, after: false })
  }

  const clipRow = (c: Clip, g: Group, i: number) => {
    const inf = p.info(c), r = inf.ref
    const dur = inf.range ? inf.range.out - inf.range.in : 0
    const trimmed = c.inSec !== null || c.outSec !== null
    return (
      <div
        key={c.id} role="listitem" draggable
        className={`clip-row${c.id === p.activeClipId ? ' active' : ''}${c.id === p.playingClipId ? ' playing' : ''}${lineClass(c.id)}`}
        onDragStart={e => { e.dataTransfer.setData(DT_CLIP, `${c.id}|${g}`); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={g === 'none' ? undefined : e => {
          if (!dragging(e, DT_CLIP)) return
          e.preventDefault(); e.stopPropagation()
          setDragOver({ key: c.id, after: lower(e) })
        }}
        onDrop={g === 'none' ? undefined : e => onDropClip(e, g, i + (dragOver?.key === c.id && dragOver.after ? 1 : 0))}
        onClick={() => p.onActivate(c, g)}
      >
        <span className="grip" aria-hidden title="ドラッグで並べ替え・マーカーのグループへ移動">⠿</span>
        {p.missing.has(c.id) || !r ? (
          <span className="clip-main missing">プレーが見つかりません（DVW が変更された可能性）</span>
        ) : (
          <span className="clip-main">
            {multiMatch && <span className="muted">{inf.matchLabel} </span>}
            <span className="muted">S{r.play.setNum} {pad2(r.play.score.home)}-{pad2(r.play.score.away)} </span>
            <b>{r.play.jersey}</b> {r.name} <span className={`skill-${r.play.skill}`}>{playLabel(r.play.skill, r.play.effect)}</span>
            {r.play.skill === 'A' && r.combo && <span className="combo" title={r.comboName ?? undefined}> {r.combo}</span>}
          </span>
        )}
        {p.overlaps.has(c.id) && <span className="overlap" title="同じ試合の別のクリップと範囲が重なっています">⚠</span>}
        <span className={`clip-dur${trimmed ? ' trimmed' : ''}`} title={trimmed ? '長さを個別に調整済み' : '初期値の長さ'}>{dur.toFixed(1)}s</span>
        <span className="clip-actions" onClick={e => e.stopPropagation()}>
          <button title="シーンから外す" onClick={() => change(removeClip(reel, c.id))}>×</button>
        </span>
      </div>
    )
  }

  const none = chronological(reel, reel.groups.none, when)
  const marked = new Set(MARKERS.flatMap(m => reel.groups[m])).size // clips with any marker

  return (
    <aside className="reel-panel">
      <div className="reel-head">
        <span className="panel-kicker">シーン</span>
        <select value={reel.id} onChange={e => p.onSelectReel(e.target.value)} aria-label="シーン">
          {p.videoSceneIds ? (
            <>
              <optgroup label="この動画のシーン">
                {p.reels.filter(r => p.videoSceneIds!.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
              <optgroup label="ほかのシーン（この動画には入っていない）">
                {p.reels.filter(r => !p.videoSceneIds!.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
            </>
          ) : p.reels.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button onClick={p.onNewReel} title="新しいシーン（今の動画にも入れる）">＋</button>
        <button onClick={() => { if (confirm(`シーン「${reel.name}」を削除しますか？${p.usedIn ? `
${p.usedIn} 本の動画から外れます。` : ''}（reels/deleted/ に移動します）`)) p.onDeleteReel(reel.id) }} title="シーンを削除">削除</button>
      </div>
      {p.videoSceneIds && !p.videoSceneIds.includes(reel.id) && (
        <p className="hint pad-x">このシーンは今の動画に入っていません <button className="link" onClick={() => p.onAddToVideo(reel.id)}>動画に追加</button></p>
      )}
      <label className="reel-name-row"><span className="field-label">名前</span>
        <input className="reel-name" value={reel.name} onChange={e => change({ ...reel, name: e.target.value })} aria-label="シーンの名前"
          title="シーンの名前。シーンのタイトルカードに出ます" /></label>

      <div className="reel-controls">
        <span className="field-label">再生・書き出し</span>
        <div className="segmented" role="radiogroup" aria-label="再生・書き出しに使うクリップ">
          <button role="radio" aria-checked={reel.scope === 'marked'} className={reel.scope === 'marked' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'marked' })}
            title="マーカーの付いたクリップだけを使う（マーカーなしは使わない）">マーカー付きだけ</button>
          <button role="radio" aria-checked={reel.scope === 'all'} className={reel.scope === 'all' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'all' })}
            title="マーカーなしのクリップも、マーカーのあとに時系列で使う">全部</button>
        </div>
        {p.playing
          ? <button onClick={p.onStop}>■ 停止</button>
          : <button className="primary" onClick={p.onPlayThrough} disabled={!p.orderCount} title="このシーンだけを再生">▶ シーンを再生</button>}
      </div>
      <Defaults d={rangeDefaults(reel)} legacy={Object.values(reel.clips).some(c => !c.mode)} onChange={d => change({ ...reel, rangeDefaults: d, updatedAt: new Date().toISOString() })} />
      <p className="count">{p.orderCount} クリップ・{formatDur(p.orderSec)}（マーカー付き {marked} / 全 {Object.keys(reel.clips).length}）</p>

      <div className="reel-groups" role="list" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
        onDragEnd={() => setDragOver(null)}>
        {reel.groupOrder.map(m => (
          <section key={m} className={`group${reel.markerOff?.[m] ? ' off' : ''}${dragOver?.key === `g${m}` ? ' drop-into' : ''}${lineClass(`h${m}`)}`}
            onDragOver={overGroup(m)} onDrop={e => onDropGroup(e, m)}>
            <header className="group-head" draggable onDragStart={e => e.dataTransfer.setData(DT_GROUP, String(m))}>
              <span className="grip" aria-hidden title="ドラッグでグループの順番を変える">⠿</span>
              {/* The number itself switches the group on (its color) or off (grey: not played or exported). */}
              <button className="swatch swatch-toggle" style={reel.markerOff?.[m] ? undefined : { background: MARKER_COLORS[m] }}
                aria-pressed={!reel.markerOff?.[m]} aria-label={`マーカー ${m} を使う`}
                title={reel.markerOff?.[m] ? 'オフ: 再生・書き出しに使わない（クリックでオン）' : 'オン: 再生・書き出しに使う（クリックでオフ）'}
                onClick={() => change({ ...reel, markerOff: { ...reel.markerOff, [m]: !reel.markerOff?.[m] }, updatedAt: new Date().toISOString() })}>{m}</button>
              <InlineTitle className="group-title" value={reel.markerNames[m]} placeholder={`マーカー ${m}`} label={`マーカー ${m} の名前`}
                onChange={v => change(renameMarker(reel, m, v))} />
              {reel.markerOff?.[m] && <span className="excluded-note" title="番号をクリックするとオンに戻ります">オフ（使わない）</span>}
              <span className="muted">{reel.groups[m].length}</span>
              {(() => {
                const on = markerCardOn(reel, m, p.markerCardDefault)
                return (
                  <button className={`card-toggle${on ? ' on' : ''}`} aria-pressed={on}
                    title={on ? 'このマーカーの前にタイトルカードを出す（クリックで出さない）' : 'このマーカーの前にタイトルカードを出さない（クリックで出す）'}
                    onClick={() => change({ ...reel, markerCards: { ...reel.markerCards, [m]: !on }, updatedAt: new Date().toISOString() })}>カード</button>
                )
              })()}
              <button className="gear" aria-label={`マーカー ${m} のタイトルカードの見た目`} title="マーカーのタイトルカードの見た目（位置・大きさ）を動画の画面で編集"
                onClick={() => p.onEditCard(m)}>⚙</button>
            </header>
            {reel.groups[m].map((id, i) => clipRow(reel.clips[id], m, i))}
          </section>
        ))}
        <section className={`group none${reel.scope === 'marked' ? ' excluded' : ''}${dragOver?.key === 'gnone' ? ' drop-into' : ''}`}
          onDragOver={e => { if (dragging(e, DT_CLIP)) { e.preventDefault(); setDragOver({ key: 'gnone', after: false }) } }}
          onDrop={e => onDropClip(e, 'none')}>
          <header className="group-head">
            <span className="swatch none">–</span>
            <span className="none-title">マーカーなし（時系列）{reel.scope === 'marked' && <span className="excluded-note" title="上の「再生・書き出し」を「全部」にすると使われます"> 使わない（「マーカー付きだけ」のため）</span>}</span>
            <span className="muted">{none.length}</span>
          </header>
          {none.map((c, i) => clipRow(c, 'none', i))}
        </section>
      </div>
      <p className="hint pad-x">数字キー 1〜5 で選択中のクリップにマーカー（複数付けられる。同じ数字で外す、0 ですべて外す）。左の ⠿ をドラッグして並べ替え。名前はクリックで編集、⚙ でタイトルカードの見た目を編集。</p>
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
