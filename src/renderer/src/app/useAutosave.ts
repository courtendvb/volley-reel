// Autosave: any scene or video whose JSON differs from what was last written is saved shortly after.
// Closing the window flushes whatever is still pending (see the main process's close handler).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Reel } from '../../../shared/reel'
import type { Video } from '../../../shared/video'
import type { AppLatest } from './appState'
import { t } from '../../../shared/i18n'

const api = window.api
export const SAVE_DELAY_MS = 400

export function useAutosave(reels: Reel[], videos: Video[], latest: RefObject<AppLatest>, setError: (e: string) => void) {
  // The last saved object per "scene:id" / "video:id" (unchanged = the same object) and its JSON.
  const saved = useRef(new Map<string, object>())
  const savedJson = useRef(new Map<string, string>())
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const allClean = () => latest.current.reels.every(x => saved.current.get(`scene:${x.id}`) === x)
    && latest.current.videos.every(x => saved.current.get(`video:${x.id}`) === x)
  const saveNow = useCallback(async (kind: 'scene' | 'video', obj: Reel | Video) => {
    const key = `${kind}:${obj.id}`
    if (saved.current.get(key) === obj) return
    // Serialized only here, for an object that may have changed: an edit that ended where it
    // started is not written again.
    const json = JSON.stringify(obj)
    if (savedJson.current.get(key) === json) { saved.current.set(key, obj); if (allClean()) setSaveState('saved'); return }
    try {
      if (kind === 'scene') await api.saveReel(obj as Reel); else await api.saveVideo(obj as Video)
      saved.current.set(key, obj); savedJson.current.set(key, json)
      if (allClean()) setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      setError(t('{0}を保存できませんでした: {1}', kind === 'scene' ? t('シーン') : t('動画'), (e as Error).message))
    }
  }, [])
  const flushAll = useCallback(() => Promise.all([
    ...latest.current.reels.map(r => saveNow('scene', r)), ...latest.current.videos.map(v => saveNow('video', v)),
  ]), [saveNow])

  useEffect(() => {
    const dirty = [
      ...reels.filter(r => saved.current.get(`scene:${r.id}`) !== r).map(r => ['scene', r] as const),
      ...videos.filter(v => saved.current.get(`video:${v.id}`) !== v).map(v => ['video', v] as const),
    ]
    if (!dirty.length) return
    setSaveState(s => (s === 'error' ? s : 'pending'))
    const timers = dirty.map(([k, o]) => window.setTimeout(() => void saveNow(k, o), SAVE_DELAY_MS))
    return () => timers.forEach(t => clearTimeout(t))
  }, [reels, videos, saveNow])
  useEffect(() => api.onFlushRequest(async () => { await flushAll() }), [flushAll])

  // What a project load reads counts as saved; a deleted scene or video is forgotten.
  const markSaved = useCallback((objs: [string, object][]) => {
    saved.current = new Map(objs)
    savedJson.current = new Map([...saved.current].map(([k, o]) => [k, JSON.stringify(o)] as const))
  }, [])
  const forget = useCallback((key: string) => { saved.current.delete(key); savedJson.current.delete(key) }, [])

  return { saveState, flushAll, markSaved, forget }
}
