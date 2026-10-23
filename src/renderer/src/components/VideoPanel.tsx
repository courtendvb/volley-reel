import { useState } from 'react'
import type { Reel } from '../../../shared/reel'
import { addScene, moveSceneAt, removeSceneAt, type Video } from '../../../shared/video'
import { InlineTitle } from './InlineTitle'

interface Props {
  videos: Video[]
  video: Video | null
  scenes: Reel[]
  sceneStats: (s: Reel) => { clips: number; sec: number }
  currentSceneId: string | null
  onSelectVideo: (id: string) => void
  onNewVideo: () => void
  onDeleteVideo: (id: string) => void
  onChange: (v: Video) => void
  onSelectScene: (id: string) => void
  onRenameScene: (id: string, name: string) => void
  onEditCard: (sceneId: string) => void // the gear: edit how scene title cards look, in the video window
  onNewScene: () => void
  onOpenOverlay: () => void
  playing: boolean
  onPlay: () => void
  onStop: () => void
  exporting: boolean
  onExport: () => void
}

const DT_SCENE = 'application/x-vr-scene-index'

// A video is a list of scenes (v3, design §0). Scenes are shared: the same scene can be in several
// videos, and editing it changes all of them. The overlay look, through-play and export are per video.
export function VideoPanel(p: Props) {
  const v = p.video
  // Where a dragged scene will land: above or below the row under the pointer (shown as a line).
  const [dragOver, setDragOver] = useState<{ i: number; after: boolean } | null>(null)
  const byId = Object.fromEntries(p.scenes.map(s => [s.id, s]))
  const usedIn = (id: string) => p.videos.filter(x => x.sceneIds.includes(id)).length
  const total = v ? v.sceneIds.reduce((acc, id) => { const s = byId[id]; if (!s) return acc; const st = p.sceneStats(s); return { clips: acc.clips + st.clips, sec: acc.sec + st.sec } }, { clips: 0, sec: 0 }) : { clips: 0, sec: 0 }

  if (!v) {
    return (
      <section className="video-panel">
        <div className="reel-head"><button className="primary" onClick={p.onNewVideo}>動画を作成</button></div>
        <p className="muted pad-x">動画はシーンを並べたものです。シーン（マーカーで分けたクリップの集まり）を作って、動画に入れます。</p>
      </section>
    )
  }

  return (
    <section className="video-panel">
      <div className="reel-head">
        <span className="panel-kicker">動画</span>
        <select value={v.id} onChange={e => p.onSelectVideo(e.target.value)} aria-label="動画">
          {p.videos.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button onClick={p.onNewVideo} title="新しい動画">＋</button>
        <button onClick={() => { if (confirm(`動画「${v.name}」を削除しますか？（シーンは残ります。videos/deleted/ に移動します）`)) p.onDeleteVideo(v.id) }} title="動画を削除">削除</button>
      </div>
      <input className="reel-name" value={v.name} onChange={e => p.onChange({ ...v, name: e.target.value, updatedAt: new Date().toISOString() })} aria-label="動画の名前" />

      <ol className="video-scenes" role="list">
        {v.sceneIds.map((id, i) => {
          const s = byId[id]
          const st = s ? p.sceneStats(s) : { clips: 0, sec: 0 }
          return (
            <li key={`${id}-${i}`} draggable className={`video-scene${id === p.currentSceneId ? ' current' : ''}${dragOver?.i === i ? (dragOver.after ? ' drop-after' : ' drop-before') : ''}`}
              onClick={() => s && p.onSelectScene(id)}
              onDragStart={e => e.dataTransfer.setData(DT_SCENE, String(i))}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(DT_SCENE)) return
                e.preventDefault()
                const b = e.currentTarget.getBoundingClientRect()
                setDragOver({ i, after: e.clientY > b.top + b.height / 2 })
              }}
              onDragEnd={() => setDragOver(null)}
              onDrop={e => {
                const from = Number(e.dataTransfer.getData(DT_SCENE)), slot = i + (dragOver?.i === i && dragOver.after ? 1 : 0)
                setDragOver(null)
                if (isNaN(from)) return
                const to = from < slot ? slot - 1 : slot // moveSceneAt counts the rows without the moved one
                if (to !== from) p.onChange(moveSceneAt(v, from, to))
              }}>
              <span className="grip" aria-hidden title="ドラッグで順番を変える">⠿</span>
              <span className="scene-no">{i + 1}</span>
              {s ? <InlineTitle className="scene-name" value={s.name} placeholder="（名前なし）" label="シーンの名前" onChange={name => p.onRenameScene(id, name)} />
                : <span className="scene-name">（削除されたシーン）</span>}
              {s && usedIn(id) > 1 && <span className="shared" title={`${usedIn(id)} 本の動画で使っています。直すとすべてに反映されます`}>共有 {usedIn(id)}</span>}
              <span className="muted">{st.clips} 本・{fmtSec(st.sec)}</span>
              <span className="clip-actions" onClick={e => e.stopPropagation()}>
                {s && <button className="gear" aria-label="シーンのタイトルカードの見た目" title="シーンのタイトルカードの見た目（位置・大きさ）を動画の画面で編集"
                  onClick={() => p.onEditCard(id)}>⚙</button>}
                <button title="動画から外す（シーンは残ります）" onClick={() => p.onChange(removeSceneAt(v, i))}>×</button>
              </span>
            </li>
          )
        })}
        {!v.sceneIds.length && <li className="muted pad-x">まだシーンがありません</li>}
      </ol>

      <div className="video-add">
        <select value="" onChange={e => { if (e.target.value) p.onChange(addScene(v, e.target.value)) }} aria-label="シーンを追加">
          <option value="">シーンを追加…</option>
          {p.scenes.map(s => <option key={s.id} value={s.id}>{s.name}{v.sceneIds.includes(s.id) ? '（追加済み）' : ''}</option>)}
        </select>
        <button onClick={p.onNewScene} title="新しいシーンを作ってこの動画に入れる">新しいシーン</button>
      </div>

      <div className="reel-controls">
        <button onClick={p.onOpenOverlay} title="スコアボード・テロップ・タイトルカード・配色（この動画の設定）">オーバーレイ</button>
        {p.playing
          ? <button onClick={p.onStop}>■ 停止</button>
          : <button className="primary" onClick={p.onPlay} disabled={!total.clips}>▶ 動画を再生</button>}
      </div>
      <div className="reel-export">
        <button className="primary" onClick={p.onExport} disabled={!total.clips || p.exporting}
          title={p.exporting ? '書き出し中です' : 'この動画を MP4 にする'}>⤓ MP4 に書き出す</button>
      </div>
      <p className="count">{v.sceneIds.length} シーン・{total.clips} クリップ・{fmtSec(total.sec)}（タイトルカードを除く）</p>
    </section>
  )
}

function fmtSec(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`
}
