import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { playLabel } from '../../../shared/labels'
import {
  MARKERS, MARKER_COLORS, chronological, groupRows, markerCardOn, moveClip, placeGroup, putSlides, rangeDefaults, removeClip, removeSlide, renameMarker, setTag, sortByTag, spotAt, TAG_MAX,
  type Clip, type Group, type Marker, type RangeDefaults, type Reel, type Row, type Slide, type SlideSpot,
} from '../../../shared/reel'
import type { PlayRef } from '../../../shared/filter'
import { pad2 } from '../format'
import { InlineTitle } from './InlineTitle'
import { t } from '../../../shared/i18n'

export interface ClipInfo {
  ref: PlayRef | undefined
  range: { in: number; out: number } | null
  def: { in: number; out: number } | null
  matchLabel: string
  matchKey: string // the match's place in the play list's order (old or new matches first)
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
  onPlayMax: () => void // the same, maximized
  onStop: () => void
  orderCount: number
  orderSec: number
  overlaps: Map<string, string[]>
  usedIn: number // videos that include this scene
  videoSceneIds: string[] | null // the open video's scenes (null: no video): the scene list is split by them
  onAddToVideo: (sceneId: string) => void
  markerCardDefault: boolean // the video's "card before each marker" setting, for markers the scene leaves unset
  onEditCard: (m: Marker) => void // the gear: edit how marker title cards look, in the video window
  onSlide: (spot: SlideSpot, how: SlideHow) => void // the ＋ between rows: put slides there
  onEditSlide: (id: string) => void
  editingSlideId: string | null
  canFrame: boolean // a match's video is on screen (a slide can be made from its picture)
}

// blank: an empty page to draw on. file: PDF pages or pictures. frame: the picture on screen.
export type SlideHow = 'blank' | 'file' | 'frame'

const DT_CLIP = 'application/x-vr-clip'
const DT_GROUP = 'application/x-vr-group'
const DT_SLIDE = 'application/x-vr-slide'

export function ReelPanel(p: Props) {
  const [more, setMore] = useState(false) // the scene's settings shown
  const { reel } = p
  const [dragOver, setDragOver] = useState<{ key: string; after: boolean } | null>(null)
  const [menu, setMenu] = useState<{ spot: SlideSpot; where: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])
  // The open clip stays in view (it can change with the Up / Down keys).
  useEffect(() => { document.querySelector('.reel-groups .clip-row.active')?.scrollIntoView({ block: 'nearest' }) }, [p.activeClipId])
  if (!reel) {
    return (
      <aside className="reel-panel">
        <div className="reel-head"><button className="primary" onClick={p.onNewReel}>{t('シーンを作成')}</button></div>
        <p className="muted pad">{t('プレー一覧の 1〜5 ボタンか数字キー 1〜5 で、プレーをシーンに入れられます。')}</p>
      </aside>
    )
  }

  const change = (r: Reel) => p.onChange(r)
  const multiMatch = new Set(Object.values(reel.clips).map(c => c.matchId)).size > 1
  const when = (c: Clip): [string, number] => { const i = p.info(c); return [i.matchKey, i.range?.in ?? 0] }

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
    if (dragging(e, DT_SLIDE)) { const rows = groupRows(reel, at); onDropSlide(e, at, rows, rows.length); return }
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

  // A slide dropped at row k of a group's rows lands there, after the clip above it.
  const onDropSlide = (e: DragEvent, g: Group, rows: Row[], k: number) => {
    const id = e.dataTransfer.getData(DT_SLIDE)
    const s = reel.slides?.find(x => x.id === id)
    setDragOver(null)
    if (!s) return
    e.preventDefault(); e.stopPropagation()
    const from = rows.findIndex(r => r.kind === 'slide' && r.slide.id === id)
    const rest = rows.filter((_, i) => i !== from)
    change(putSlides(reel, [s], spotAt(rest, g, from >= 0 && from < k ? k - 1 : k)))
  }
  // Rows take slides in any group, and clips in a marker group ('none' is in time order).
  const takes = (e: DragEvent, g: Group) => dragging(e, DT_SLIDE) || (dragging(e, DT_CLIP) && g !== 'none')
  const dropOnRow = (e: DragEvent, g: Group, rows: Row[], k: number) => {
    const at = k + (dragOver?.after ? 1 : 0)
    if (dragging(e, DT_SLIDE)) { onDropSlide(e, g, rows, at); return }
    if (g !== 'none') onDropClip(e, g, rows.slice(0, at).filter(r => r.kind === 'clip').length)
  }
  // Slides go in by right-click: on a row, below it; on a group's header, at the top of the group.
  const openMenu = (e: MouseEvent, spot: SlideSpot, where: string) => {
    e.preventDefault(); e.stopPropagation()
    setMenu({ spot, where, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 130) })
  }
  const BELOW = t('この行の下にスライドを入れる'), AT_TOP = t('グループの先頭にスライドを入れる')
  const rowsOf = (g: Group, ids: string[]) => {
    const rows = groupRows(reel, g, ids)
    let clipNo = 0
    return rows.map((r, k) => (r.kind === 'clip' ? clipRow(reel.clips[r.id], g, clipNo++, rows, k) : slideRow(r.slide, g, rows, k)))
  }

  const slideRow = (s: Slide, g: Group, rows: Row[], k: number) => (
    <div
      key={s.id} role="listitem" draggable
      className={`clip-row slide-row${s.id === p.editingSlideId ? ' active' : ''}${lineClass(`s${s.id}`)}`}
      onDragStart={e => { e.dataTransfer.setData(DT_SLIDE, s.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { if (!takes(e, g)) return; e.preventDefault(); e.stopPropagation(); setDragOver({ key: `s${s.id}`, after: lower(e) }) }}
      onDrop={e => dropOnRow(e, g, rows, k)}
      onContextMenu={e => openMenu(e, spotAt(rows, g, k + 1), BELOW)}
      onClick={() => p.onEditSlide(s.id)}
      title={t('クリックで動画の画面に出して編集（文字・図形を置く・秒数）')}
    >
      <span className="grip" aria-hidden title={t('ドラッグで並べ替え')}>⠿</span>
      <span className="slide-icon" aria-hidden>▣</span>
      <span className="clip-main">{slideLabel(s)}</span>
      {s.annotations.length > 0 && <span className="muted" title={t('置いた図形・文字の数')}>✎{s.annotations.length}</span>}
      <span className="clip-dur">{s.durationSec.toFixed(1)}s</span>
      <span className="clip-actions" onClick={e => e.stopPropagation()}>
        <button title={t('スライドを外す')} onClick={() => change(removeSlide(reel, s.id))}>×</button>
      </span>
    </div>
  )

  const clipRow = (c: Clip, g: Group, i: number, rows: Row[], k: number) => {
    const inf = p.info(c), r = inf.ref
    const dur = inf.range ? inf.range.out - inf.range.in : 0
    const trimmed = c.inSec !== null || c.outSec !== null
    return (
      <div
        key={c.id} role="listitem" draggable
        className={`clip-row${c.id === p.activeClipId ? ' active' : ''}${c.id === p.playingClipId ? ' playing' : ''}${lineClass(c.id)}`}
        onDragStart={e => { e.dataTransfer.setData(DT_CLIP, `${c.id}|${g}`); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={e => {
          if (!takes(e, g)) return
          e.preventDefault(); e.stopPropagation()
          setDragOver({ key: c.id, after: lower(e) })
        }}
        onDrop={e => {
          if (dragging(e, DT_SLIDE)) { dropOnRow(e, g, rows, k); return }
          if (g !== 'none') onDropClip(e, g, i + (dragOver?.key === c.id && dragOver.after ? 1 : 0))
        }}
        onContextMenu={e => openMenu(e, spotAt(rows, g, k + 1), BELOW)}
        onClick={() => p.onActivate(c, g)}
      >
        <span className="grip" aria-hidden title={t('ドラッグで並べ替え・グループへ移動')}>⠿</span>
        {p.missing.has(c.id) || !r ? (
          <span className="clip-main missing">{t('プレーが見つかりません（DVW が変更された可能性）')}</span>
        ) : (
          <span className="clip-main">
            {multiMatch && <span className="muted">{inf.matchLabel} </span>}
            <span className="muted">S{r.play.setNum} {pad2(r.play.score.home)}-{pad2(r.play.score.away)} </span>
            {/* The skill letter and evaluation sign (A#) to keep rows short; the full name on hover. */}
            <b>{r.play.jersey}</b> {r.name} <span className={`skill-${r.play.skill} skill-short`} title={playLabel(r.play.skill, r.play.effect)}>{r.play.skill}{r.play.effect}</span>
            {r.play.skill === 'A' && r.combo && <span className="combo" title={r.comboName ?? undefined}> {r.combo}</span>}
          </span>
        )}
        {p.overlaps.has(c.id) && <span className="overlap" title={t('同じ試合の別のクリップと範囲が重なっています')}>⚠</span>}
        <TagChip tag={c.tag} onChange={t => change(setTag(reel, c.id, t))} />
        <span className={`clip-dur${trimmed ? ' trimmed' : ''}`} title={trimmed ? t('長さを個別に調整済み') : t('初期値の長さ')}>{dur.toFixed(1)}s</span>
        <span className="clip-actions" onClick={e => e.stopPropagation()}>
          <button title={t('シーンから外す')} onClick={() => change(removeClip(reel, c.id))}>×</button>
        </span>
      </div>
    )
  }

  const none = chronological(reel, reel.groups.none, when)
  const marked = new Set(MARKERS.flatMap(m => reel.groups[m])).size // clips with any marker

  return (
    <aside className="reel-panel">
      <div className="reel-head">
        <span className="panel-kicker">{t('シーン')}</span>
        <select value={reel.id} onChange={e => p.onSelectReel(e.target.value)} aria-label={t('シーン')}>
          {p.videoSceneIds ? (
            <>
              <optgroup label={t('この動画のシーン')}>
                {p.reels.filter(r => p.videoSceneIds!.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
              <optgroup label={t('ほかのシーン（この動画には入っていない）')}>
                {p.reels.filter(r => !p.videoSceneIds!.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
            </>
          ) : p.reels.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className={more ? 'on' : ''} aria-expanded={more} aria-label={t('シーンの設定')} title={t('シーンの名前、再生・書き出しに使うクリップ')} onClick={() => setMore(m => !m)}>⚙</button>
        <button onClick={() => { if (confirm(t('シーン「{0}」を削除しますか？{1}（reels/deleted/ に移動します）', reel.name, p.usedIn ? t('\n{0} 本の動画から外れます。', p.usedIn) : ''))) p.onDeleteReel(reel.id) }} title={t('シーンを削除')}>{t('削除')}</button>
      </div>
      {p.videoSceneIds && !p.videoSceneIds.includes(reel.id) && (
        <p className="hint pad-x">{t('このシーンは今の動画に入っていません')} <button className="link" onClick={() => p.onAddToVideo(reel.id)}>{t('動画に追加')}</button></p>
      )}
      <div className="reel-more" hidden={!more}>
      <label className="reel-name-row"><span className="field-label">{t('名前')}</span>
        <input className="reel-name" value={reel.name} onChange={e => change({ ...reel, name: e.target.value })} aria-label={t('シーンの名前')}
          title={t('シーンの名前。シーンのタイトルカードに出ます')} /></label>

      <div className="reel-controls">
        <span className="field-label">{t('再生・書き出し')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('再生・書き出しに使うクリップ')}>
          <button role="radio" aria-checked={reel.scope === 'marked'} className={reel.scope === 'marked' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'marked' })}
            title={t('グループに入れたクリップだけを使う（未分類は使わない）')}>{t('グループのみ')}</button>
          <button role="radio" aria-checked={reel.scope === 'all'} className={reel.scope === 'all' ? 'on' : ''} onClick={() => change({ ...reel, scope: 'all' })}
            title={t('未分類のクリップも、グループのあとにプレー一覧の順（試合の並び・試合の中は時間順）で使う')}>{t('全部')}</button>
        </div>
      </div>
      {Object.values(reel.clips).some(c => !c.mode) && <Legacy d={rangeDefaults(reel)} onChange={d => change({ ...reel, rangeDefaults: d, updatedAt: new Date().toISOString() })} />}
      </div>
      <div className="reel-controls end">
        {p.playing
          ? <button onClick={p.onStop}>{t('■ 停止')}</button>
          : <><button className="primary" onClick={p.onPlayThrough} disabled={!p.orderCount && !reel.slides?.length} title={t('このシーンだけを再生')}>{t('▶ シーンを再生')}</button>
            <button onClick={p.onPlayMax} disabled={!p.orderCount && !reel.slides?.length} title={t('最大化して再生（終わると元に戻る）')} aria-label={t('最大化して再生')}>⛶</button></>}
      </div>
      <p className="count">{p.orderCount} {t('クリップ')}{reel.slides?.length ? t('・スライド {0}', reel.slides.length) : ''}{t('・')}{formatDur(p.orderSec)}{t('（グループ入り {0} / 全 {1}）', marked, Object.keys(reel.clips).length)}</p>

      <div className="reel-groups" role="list" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
        onDragEnd={() => setDragOver(null)}>
        {reel.groupOrder.map(m => (
          <section key={m} className={`group${reel.markerOff?.[m] ? ' off' : ''}${dragOver?.key === `g${m}` ? ' drop-into' : ''}${lineClass(`h${m}`)}`}
            onDragOver={overGroup(m)} onDrop={e => onDropGroup(e, m)}>
            <header className="group-head" draggable onDragStart={e => e.dataTransfer.setData(DT_GROUP, String(m))}
              onContextMenu={e => openMenu(e, spotAt(groupRows(reel, m), m, 0), AT_TOP)}>
              <span className="grip" aria-hidden title={t('ドラッグでグループの順番を変える')}>⠿</span>
              {/* The number itself switches the group on (its color) or off (grey: not played or exported). */}
              <button className="swatch swatch-toggle" style={reel.markerOff?.[m] ? undefined : { background: MARKER_COLORS[m] }}
                aria-pressed={!reel.markerOff?.[m]} aria-label={t('グループ {0} を使う', m)}
                title={reel.markerOff?.[m] ? t('オフ: 再生・書き出しに使わない（クリックでオン）') : t('オン: 再生・書き出しに使う（クリックでオフ）')}
                onClick={() => change({ ...reel, markerOff: { ...reel.markerOff, [m]: !reel.markerOff?.[m] }, updatedAt: new Date().toISOString() })}>{m}</button>
              <InlineTitle className="group-title" value={reel.markerNames[m]} placeholder={t('グループ {0}', m)} label={t('グループ {0} の名前', m)}
                onChange={v => change(renameMarker(reel, m, v))} />
              {reel.markerOff?.[m] && <span className="excluded-note" title={t('番号をクリックするとオンに戻ります')}>{t('オフ（使わない）')}</span>}
              <span className="muted">{reel.groups[m].length}</span>
              {reel.groups[m].some(id => reel.clips[id]?.tag) && (
                <button className="tag-sort" title={t('このグループのクリップをメモの順に並べる（メモなしは最後。Ctrl+Z で戻せる）')}
                  onClick={() => change(sortByTag(reel, m))}>{t('メモ順')}</button>
              )}
              {(() => {
                const on = markerCardOn(reel, m, p.markerCardDefault)
                return (
                  <button className={`card-toggle${on ? ' on' : ''}`} aria-pressed={on}
                    title={`${on ? t('このグループの前にタイトルカードを出す（クリックで出さない）') : t('このグループの前にタイトルカードを出さない（クリックで出す）')}${reel.markerCards?.[m] === undefined ? t('。今は動画の設定どおり') : ''}`}
                    onClick={() => change({ ...reel, markerCards: { ...reel.markerCards, [m]: !on }, updatedAt: new Date().toISOString() })}>{t('カード')}</button>
                )
              })()}
              <button className="gear" aria-label={t('グループ {0} のタイトルカードの見た目', m)} title={t('グループのタイトルカードの見た目（位置・大きさ）を動画の画面で編集')}
                onClick={() => p.onEditCard(m)}>⚙</button>
            </header>
            {rowsOf(m, reel.groups[m])}
          </section>
        ))}
        <section className={`group none${reel.scope === 'marked' ? ' excluded' : ''}${dragOver?.key === 'gnone' ? ' drop-into' : ''}`}
          onDragOver={e => { if (dragging(e, DT_CLIP) || dragging(e, DT_SLIDE)) { e.preventDefault(); setDragOver({ key: 'gnone', after: false }) } }}
          onDrop={e => {
            if (dragging(e, DT_SLIDE)) { const rows = groupRows(reel, 'none', none.map(c => c.id)); onDropSlide(e, 'none', rows, rows.length); return }
            onDropClip(e, 'none')
          }}>
          <header className="group-head" onContextMenu={e => openMenu(e, spotAt(groupRows(reel, 'none', none.map(c => c.id)), 'none', 0), AT_TOP)}>
            <span className="swatch none">–</span>
            <span className="none-title">{t('未分類（一覧の順）')}{reel.scope === 'marked' && <span className="excluded-note" title={t('上の「再生・書き出し」を「全部」にすると使われます')}> {t('使わない（「グループのみ」のため）')}</span>}</span>
            <span className="muted">{none.length}</span>
          </header>
          {rowsOf('none', none.map(c => c.id))}
        </section>
      </div>
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
          <div className="slide-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <div className="slide-menu-title">{menu.where}</div>
            {([['blank', t('無地のスライド'), t('タイトルカードと同じ色の無地。文字や図形を置いて説明に使う')],
              ['file', t('PDF・画像を読み込む…'), t('PowerPoint から PDF で書き出したもの。全ページが 1 枚ずつ入る')],
              ['frame', t('今の画面を静止画に'), t('動画の今のコマを背景にして、矢印などを描く')]] as const).map(([how, label, hint]) => (
              <button key={how} role="menuitem" title={hint} disabled={how === 'frame' && !p.canFrame}
                onClick={() => { setMenu(null); p.onSlide(menu.spot, how) }}>{label}</button>
            ))}
          </div>
        </>
      )}
      {!Object.keys(reel.clips).length && <p className="hint pad-x">{t('数字キー 1〜5 で選択中のクリップをグループに入れる（複数入れられる。同じ数字で外す、0 ですべて外す）。Shift+1〜5 でメモ（並べ替え用）、「メモ順」でグループをメモの順に。左の ⠿ をドラッグして並べ替え。名前はクリックで編集、⚙ でタイトルカードの見た目を編集。行を右クリックでその下に、グループの見出しを右クリックで先頭にスライドを入れる。')}</p>}
    </aside>
  )
}

// A clip's tag: a small colored chip, or a faint ＋ shown on hover; a click edits it in place.
function TagChip({ tag, onChange }: { tag: string | undefined; onChange: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input className="tag-input" autoFocus defaultValue={tag ?? ''} maxLength={TAG_MAX} aria-label={t('メモ')}
        onClick={e => e.stopPropagation()} onFocus={e => e.currentTarget.select()}
        onBlur={e => { setEditing(false); onChange(e.currentTarget.value) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = tag ?? ''; e.currentTarget.blur() } }} />
    )
  }
  return (
    <button className={`tag-chip${tag ? '' : ' empty'}`} style={tag ? tagColor(tag) : undefined}
      title={tag ? t('メモ「{0}」（クリックで編集、Shift+数字でも付け外し）。並べ替え用のメモで、動画には出ません', tag) : t('メモを付ける（並べ替え用のメモ。Shift+1〜5 でも付けられる）')}
      onClick={e => { e.stopPropagation(); setEditing(true) }}>{tag || '＋'}</button>
  )
}

// The same tag always gets the same color, so clips that belong together are seen at a glance.
const TAG_HUES = [210, 25, 140, 280, 350, 50, 180, 320]
function tagColor(tag: string) {
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const n = /^[1-9]$/.test(tag) ? Number(tag) - 1 : h
  const hue = TAG_HUES[n % TAG_HUES.length]
  return { background: `hsl(${hue} 80% 92%)`, color: `hsl(${hue} 60% 30%)`, borderColor: `hsl(${hue} 55% 70%)` }
}

function slideLabel(s: Slide): string {
  if (s.bg.kind === 'blank') return t('スライド（無地）')
  const src = s.bg.source
  if (!src) return t('スライド（静止画）')
  return t('スライド {0}{1}', src.name, src.page ? ` p.${src.page}` : '')
}

// Clips added before each clip carried its own cut (design §3.5) follow the scene's mode select.
// The seconds themselves are set next to 切り出し in the search panel.
function Legacy({ d, onChange }: { d: RangeDefaults; onChange: (d: RangeDefaults) => void }) {
  return (
    <div className="reel-defaults">
      <span title={t('切り出しの指定がない（以前に入れた）クリップの長さ')}>
        {t('以前のクリップ')} <select value={d.mode} onChange={e => onChange({ ...d, mode: e.target.value as RangeDefaults['mode'] })} aria-label={t('長さの初期値')}>
          <option value="rally">{t('ラリー全体')}</option>
          <option value="keyplay">{t('キープレー中心')}</option>
        </select>
        {d.mode === 'rally' && <> {t('サーブ −')}<SecInput v={d.rallyLead} label={t('サーブの何秒前から')} onChange={n => onChange({ ...d, rallyLead: n })} />{t('秒')}</>}
      </span>
    </div>
  )
}

export function SecInput({ v, label, onChange, disabled }: { v: number; label: string; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <input type="number" min={0} max={30} step={0.5} value={v} aria-label={label} disabled={disabled}
      onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 0) onChange(n) }} />
  )
}

function formatDur(sec: number): string {
  const s = Math.round(sec)
  return t('{0}分{1}秒', Math.floor(s / 60), String(s % 60).padStart(2, '0'))
}
