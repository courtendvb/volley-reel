// The project's scenes and videos: the open one of each, saving them (useAutosave), undo for them
// and the settings (useUndo), and making, changing and deleting them. Every change goes into
// `latest` at once too, for steps that follow in the same tick.
import { useCallback, useState, type RefObject } from 'react'
import { newReel, type Reel } from '../../../shared/reel'
import { applySettingsChange } from '../../../shared/settingsUndo'
import type { ProjectInfo } from '../../../shared/types'
import { addScene, dropScene, newVideo, type Video } from '../../../shared/video'
import type { AppLatest } from './appState'
import { useAutosave } from './useAutosave'
import { useUndo, type Snapshot } from './useUndo'
import { t } from '../../../shared/i18n'

const api = window.api

interface Host {
  latest: RefObject<AppLatest>
  setActiveClipId: (id: string | null) => void
  setProject: (p: ProjectInfo | null) => void
  setError: (e: string) => void
}

export function useSceneStore({ latest, setActiveClipId, setProject, setError }: Host) {
  const [reels, setReels] = useState<Reel[]>([])
  const [reelId, setReelId] = useState<string | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [videoId, setVideoId] = useState<string | null>(null)
  const reel = reels.find(r => r.id === reelId) ?? null
  const video = videos.find(v => v.id === videoId) ?? null
  const { saveState, flushAll, markSaved, forget } = useAutosave(reels, videos, latest, setError)

  // Undo puts back a scene or video (and shows it), or the project settings.
  const { record, undoRedo, clearHistory } = useUndo({
    now: e => (e.kind === 'settings' ? latest.current.settings ?? null : e.kind === 'scene' ? latest.current.reels.find(x => x.id === e.id) ?? null : latest.current.videos.find(x => x.id === e.id) ?? null),
    // Each scene or video back as it was: changed back, made again (saved anew), or taken out again.
    restore: list => {
      let scene: string | null = null, video: string | null = null
      for (const e of list) {
        if (e.kind === 'settings') { const cur = latest.current.settings; if (cur) void api.saveSettings(applySettingsChange(cur, e.value)).then(setProject).catch(err => setError(String(err))) }
        else if (e.kind === 'scene') {
          const has = latest.current.reels.some(x => x.id === e.id)
          if (!e.value) { if (has) removeScenes([e.id]) } else { if (has) putScene(e.value); else addScenes([e.value]); scene = e.id }
        } else {
          const has = latest.current.videos.some(x => x.id === e.id)
          if (!e.value) { if (has) removeVideo(e.id) } else { if (has) putVideo(e.value); else addVideo(e.value); video = e.id }
        }
      }
      if (video) setVideoId(video)
      if (scene) showScene(scene)
    },
  })
  const putScene = (r: Reel) => {
    latest.current = { ...latest.current, reels: latest.current.reels.map(x => (x.id === r.id ? r : x)), reel: latest.current.reel?.id === r.id ? r : latest.current.reel }
    setReels(rs => rs.map(x => (x.id === r.id ? r : x)))
  }
  const putVideo = (v: Video) => {
    latest.current = { ...latest.current, videos: latest.current.videos.map(x => (x.id === v.id ? v : x)), video: latest.current.video?.id === v.id ? v : latest.current.video }
    setVideos(vs => vs.map(x => (x.id === v.id ? v : x)))
  }
  const addScenes = (rs: Reel[]) => {
    latest.current = { ...latest.current, reels: [...latest.current.reels, ...rs] }
    setReels(x => [...x, ...rs])
  }
  const addVideo = (v: Video) => {
    latest.current = { ...latest.current, videos: [...latest.current.videos, v], video: v }
    setVideos(x => [...x, v]); setVideoId(v.id)
  }
  const showScene = (id: string) => { setReelId(id); setActiveClipId(null) }
  // Scenes and a video taken out, their files moved to deleted/ (undo puts them back and saves them anew).
  const removeScenes = (ids: string[]) => {
    if (!ids.length) return
    const gone = new Set(ids)
    latest.current = { ...latest.current, reels: latest.current.reels.filter(r => !gone.has(r.id)) }
    setReels(rs => rs.filter(r => !gone.has(r.id)))
    if (latest.current.reelId && gone.has(latest.current.reelId)) { setReelId(null); setActiveClipId(null) }
    for (const id of ids) { forget(`scene:${id}`); void api.deleteReel(id) }
  }
  const removeVideo = (id: string) => {
    const rest = latest.current.videos.filter(v => v.id !== id)
    latest.current = { ...latest.current, videos: rest, video: latest.current.video?.id === id ? rest[0] ?? null : latest.current.video }
    setVideos(rest); setVideoId(cur => (cur === id ? rest[0]?.id ?? null : cur))
    forget(`video:${id}`); void api.deleteVideo(id)
  }
  // A scene or video as it is now, for undo (null: not there).
  const sceneSnap = (id: string): Snapshot => ({ kind: 'scene', id, value: latest.current.reels.find(x => x.id === id) ?? null })
  const videoSnap = (id: string): Snapshot => ({ kind: 'video', id, value: latest.current.videos.find(x => x.id === id) ?? null })

  const updateReel = useCallback((r: Reel) => {
    const prev = latest.current.reels.find(x => x.id === r.id)
    if (prev && prev !== r) record({ kind: 'scene', id: prev.id, value: prev })
    putScene(r)
  }, [record])
  const updateVideo = useCallback((v: Video) => {
    const prev = latest.current.videos.find(x => x.id === v.id)
    if (prev && prev !== v) record({ kind: 'video', id: prev.id, value: prev })
    putVideo(v)
  }, [record])
  // A scene changed by a function of it (for steps that change a scene that may not be the open one).
  const updateScene = (id: string, fn: (r: Reel) => Reel) => {
    const r = latest.current.reels.find(x => x.id === id)
    if (r) updateReel(fn(r))
  }

  // The reel to add to: the current one, or a new one on first use. Computed outside a state
  // updater because new clips get random ids, and StrictMode runs updaters twice.
  const withReel = useCallback((fn: (r: Reel) => Reel): Reel => {
    const rs = latest.current.reels
    const cur = rs.find(r => r.id === latest.current.reelId)
    const next = fn(cur ?? newReel(t('シーン {0}', rs.length + 1)))
    if (cur) record({ kind: 'scene', id: cur.id, value: cur })
    const all = cur ? rs.map(r => (r.id === cur.id ? next : r)) : [...rs, next]
    latest.current = { ...latest.current, reels: all, reelId: next.id, reel: next }
    setReels(all)
    setReelId(next.id)
    if (!cur) record([{ kind: 'scene', id: next.id, value: null }, placeInVideo(next.id)], false)
    return next
  }, [record])
  // A new scene goes into the current video; with no video yet, the first one is made for it.
  // Returns the video as it was, for the caller's undo step.
  const placeInVideo = (sceneId: string): Snapshot => {
    const v = latest.current.video
    if (v) { const was = videoSnap(v.id); putVideo(addScene(v, sceneId)); return was }
    const nv = newVideo(t('動画 {0}', latest.current.videos.length + 1), [sceneId])
    addVideo(nv)
    return { kind: 'video', id: nv.id, value: null }
  }
  // A new empty scene, opened and put in the current video.
  const makeScene = (): Reel => {
    const r = newReel(t('シーン {0}', latest.current.reels.length + 1))
    addScenes([r]); latest.current = { ...latest.current, reel: r }; showScene(r.id)
    record([{ kind: 'scene', id: r.id, value: null }, placeInVideo(r.id)], false)
    return r
  }
  // Deleting a scene takes it out of every video that used it (one undo step for all of it).
  const deleteReel = (id: string) => {
    const users = latest.current.videos.filter(v => v.sceneIds.includes(id))
    record([sceneSnap(id), ...users.map(v => videoSnap(v.id))], false)
    for (const v of users) putVideo(dropScene(v, id))
    removeScenes([id])
    const first = latest.current.reels[0]?.id ?? null
    setReelId(first); setActiveClipId(null)
  }
  // A new video starts empty; its scenes are added (or made) for it. Switching videos shows one of its scenes.
  const createVideo = () => {
    const v = newVideo(t('動画 {0}', latest.current.videos.length + 1), [])
    addVideo(v); record({ kind: 'video', id: v.id, value: null }, false)
    setReelId(null); setActiveClipId(null)
  }
  // The scenes no other video uses.
  const scenesOnlyIn = (v: Video) => [...new Set(v.sceneIds)].filter(id => !latest.current.videos.some(o => o.id !== v.id && o.sceneIds.includes(id)))
  const selectVideo = (id: string) => {
    setVideoId(id)
    const v = videos.find(x => x.id === id)
    if (v && !(reelId && v.sceneIds.includes(reelId))) { setReelId(v.sceneIds.find(s => reels.some(r => r.id === s)) ?? null); setActiveClipId(null) }
  }
  // withScenes: also the scenes no other video uses. One undo step puts it all back.
  const deleteVideo = (id: string, withScenes = false) => {
    const v = latest.current.videos.find(x => x.id === id)
    if (!v) return
    const own = withScenes ? scenesOnlyIn(v) : []
    record([videoSnap(id), ...own.map(sceneSnap)], false)
    removeVideo(id)
    removeScenes(own)
  }

  return {
    reels, setReels, reelId, setReelId, videos, setVideos, videoId, setVideoId, reel, video,
    saveState, flushAll, markSaved, forget, record, undoRedo, clearHistory,
    putScene, putVideo, addScenes, addVideo, showScene, removeScenes, sceneSnap, videoSnap,
    updateReel, updateVideo, updateScene, withReel, makeScene, deleteReel, createVideo, scenesOnlyIn, selectVideo, deleteVideo,
  }
}
