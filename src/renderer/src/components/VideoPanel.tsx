import { useEffect, useRef, useState } from 'react'
import type { Reel } from '../../../shared/reel'
import { addScene, moveSceneAt, removeSceneAt, type Video } from '../../../shared/video'
import { InlineTitle } from './InlineTitle'
import { NameSelect } from './NameSelect'
import { t } from '../../../shared/i18n'
import { formatLength } from '../format'

interface Props {
  part: 'head' | 'list' // the line above the right column's tabs, or the 動画の構成 tab
  videos: Video[]
  video: Video | null
  scenes: Reel[]
  sceneStats: (s: Reel) => { clips: number; sec: number }
  currentSceneId: string | null
  onSelectVideo: (id: string) => void
  onNewVideo: () => void
  onDeleteVideo: (id: string, withScenes: boolean) => void // withScenes: also the scenes no other video uses
  onRemake: (id: string) => void // a preset video made again from the matches searched now
  onChange: (v: Video) => void
  onSelectScene: (id: string) => void
  onRenameScene: (id: string, name: string) => void
  onEditCard: (sceneId: string) => void // the gear: edit how scene title cards look, in the video window
  onEditVideoCard: () => void // the gear by the video's name: its opening card
  videoCardOn: boolean
  onVideoCard: (on: boolean) => void
  sceneCardOn: (s: Reel) => boolean // the scene's card: its own choice, else the video's
  onSceneCard: (s: Reel, on: boolean) => void
  onNewScene: () => void
  onOpenOverlay: () => void
  playing: boolean
  onPlay: () => void
  onPlayMax: () => void // the same, maximized
  onStop: () => void
}

const DT_SCENE = 'application/x-vr-scene-index'
const NEW_VIDEO = '\0new' // the last row of the video select

// A video is a list of scenes (v3, design §0). Scenes are shared: the same scene can be in several
// videos, and editing it changes all of them. The overlay look, through-play and export are per video.
export function VideoPanel(p: Props) {
  const v = p.video
  // Where a dragged scene will land: above or below the row under the pointer (shown as a line).
  const [dragOver, setDragOver] = useState<{ i: number; after: boolean } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // The open scene stays in view (it can be picked from the scene editor's select too).
  useEffect(() => { listRef.current?.querySelector('.video-scene.current')?.scrollIntoView({ block: 'nearest' }) }, [p.currentSceneId, v?.id])
  const byId = Object.fromEntries(p.scenes.map(s => [s.id, s]))
  const usedIn = (id: string) => p.videos.filter(x => x.sceneIds.includes(id)).length
  const total = v ? v.sceneIds.reduce((acc, id) => { const s = byId[id]; if (!s) return acc; const st = p.sceneStats(s); return { clips: acc.clips + st.clips, sec: acc.sec + st.sec } }, { clips: 0, sec: 0 }) : { clips: 0, sec: 0 }

  if (p.part === 'head') {
    return (
      <section className="video-head">
        {v ? (
          <>
            <span className="panel-kicker">{t('動画')}</span>
            <NameSelect name={v.name} label={t('動画の名前を変更')} onRename={name => p.onChange({ ...v, name, updatedAt: new Date().toISOString() })}>
              <select value={v.id} onChange={e => { if (e.target.value === NEW_VIDEO) p.onNewVideo(); else p.onSelectVideo(e.target.value) }} aria-label={t('動画')}>
                {p.videos.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                <option value={NEW_VIDEO}>{t('＋ 別の動画を作る')}</option>
              </select>
            </NameSelect>
            {p.playing
              ? <button onClick={p.onStop}>{t('■ 停止')}</button>
              : <><button className="primary" onClick={p.onPlay} disabled={!total.clips} title={t('動画を最初から再生')}>{t('▶ 再生')}</button>
                <button onClick={p.onPlayMax} disabled={!total.clips} title={t('最大化して再生（終わると元に戻る）')} aria-label={t('最大化して再生')}>⛶</button></>}
            <button onClick={p.onOpenOverlay} title={t('この動画の設定: スコアボード・テロップ・タイトルカード・フェード')} aria-label={t('動画の設定')}>⚙</button>
          </>
        ) : <button className="primary" onClick={p.onNewVideo}>{t('動画を作成')}</button>}
      </section>
    )
  }
  if (!v) return <section className="video-panel"><p className="muted pad-x">{t('動画はシーンを並べたものです。シーン（マーカーで分けたクリップの集まり）を作って、動画に入れます。')}</p></section>

  return (
    <section className="video-panel">
      <div className="reel-head">
        <input className="reel-name" value={v.name} onChange={e => p.onChange({ ...v, name: e.target.value, updatedAt: new Date().toISOString() })} aria-label={t('動画の名前')} />
        <button className={`card-toggle${p.videoCardOn ? ' on' : ''}`} aria-pressed={p.videoCardOn}
          title={p.videoCardOn ? t('動画の頭に動画名のカードを出す（クリックで出さない）') : t('動画の頭に動画名のカードを出さない（クリックで出す）')}
          onClick={() => p.onVideoCard(!p.videoCardOn)}>{t('カード')}</button>
        <button className="gear" aria-label={t('動画のタイトルカード')} title={t('動画の頭のタイトルカード（動画名）を動画の画面で編集')} onClick={p.onEditVideoCard}>⚙</button>
        {v.preset && (
          <button onClick={() => { if (confirm(t('動画「{0}」をプリセットで作り直しますか？\n今「検索する試合」で選んでいる試合から集め直します。この動画だけで使っているシーンは新しいシーンに置き換わり（reels/deleted/ に移動します）、そこで加えた図形やトリムは消えます。', v.name))) p.onRemake(v.id) }}
            title={t('この動画を作ったプリセットで、今の試合から作り直す')}>{t('作り直す')}</button>
        )}
        <button onClick={() => {
          const own = [...new Set(v.sceneIds)].filter(id => byId[id] && usedIn(id) === 1).length
          if (!confirm(own ? t('動画「{0}」を削除しますか？（videos/deleted/ に移動します）', v.name) : t('動画「{0}」を削除しますか？（シーンは残ります。videos/deleted/ に移動します）', v.name))) return
          p.onDeleteVideo(v.id, own > 0 && confirm(t('この動画だけで使っているシーン {0} 個も削除しますか？\n（OK で削除して reels/deleted/ に移動します。キャンセルするとシーンは残ります）', own)))
        }} title={t('動画を削除')}>{t('削除')}</button>
      </div>

      <div className="video-add">
        <button className="primary" onClick={p.onNewScene} title={t('新しいシーンを作ってこの動画に入れる')}>{t('＋ 新しいシーン')}</button>
        <select value="" onChange={e => { if (e.target.value) p.onChange(addScene(v, e.target.value)) }} aria-label={t('作ったシーンを入れる')}>
          <option value="">{t('作ったシーンを入れる…')}</option>
          {p.scenes.map(s => <option key={s.id} value={s.id}>{s.name}{v.sceneIds.includes(s.id) ? t('（追加済み）') : ''}</option>)}
        </select>
      </div>

      <ol ref={listRef} className="video-scenes" role="list">
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
              <span className="grip" aria-hidden title={t('ドラッグで順番を変える')}>⠿</span>
              <span className="scene-no">{i + 1}</span>
              {s ? <InlineTitle className="scene-name" value={s.name} placeholder={t('（名前なし）')} label={t('シーンの名前')} onChange={name => p.onRenameScene(id, name)} />
                : <span className="scene-name">{t('（削除されたシーン）')}</span>}
              {s && usedIn(id) > 1 && <span className="shared" title={t('{0} 本の動画で使っています。直すとすべてに反映されます', usedIn(id))}>{t('共有')} {usedIn(id)}</span>}
              <span className="muted">{st.clips} {t('本・')}{formatLength(st.sec)}</span>
              <span className="clip-actions" onClick={e => e.stopPropagation()}>
                {s && (
                  <button className={`card-toggle${p.sceneCardOn(s) ? ' on' : ''}`} aria-pressed={p.sceneCardOn(s)}
                    title={`${p.sceneCardOn(s) ? t('このシーンの前にタイトルカードを出す（クリックで出さない）') : t('このシーンの前にタイトルカードを出さない（クリックで出す）')}${s.sceneCard === undefined ? t('。今は動画の設定どおり') : ''}`}
                    onClick={() => p.onSceneCard(s, !p.sceneCardOn(s))}>{t('カード')}</button>
                )}
                {s && <button className="gear" aria-label={t('シーンのタイトルカードの見た目')} title={t('シーンのタイトルカードの見た目（位置・大きさ）を動画の画面で編集')}
                  onClick={() => p.onEditCard(id)}>⚙</button>}
                <button title={t('動画から外す（シーンは残ります）')} onClick={() => p.onChange(removeSceneAt(v, i))}>×</button>
              </span>
            </li>
          )
        })}
        {!v.sceneIds.length && <li className="muted pad-x">{t('まだシーンがありません')}</li>}
      </ol>
      <p className="count">{v.sceneIds.length} {t('シーン・')}{total.clips} {t('クリップ・')}{formatLength(total.sec)}{t('（タイトルカードを除く）')}</p>
    </section>
  )
}
