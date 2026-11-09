// Objects (design §3.6) on the open clip or card: the clip's own with its marker's, scene's and video's
// (表示範囲), merged for the editor and split back to where each lives; when they show; pictures put
// in or pasted; the palette; and Ctrl+C / Ctrl+V of objects.
import { useCallback, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { freshIds, pasteCopies, shiftTimes, withGroups, type Annotation } from '../../../shared/annotation'
import { changed, mergeScoped, moveToScope, splitScoped, type AnnScope, type ScopedAnnotations } from '../../../shared/annotationScope'
import { keyName } from '../../../shared/keys'
import { setAnnotations, type Reel } from '../../../shared/reel'
import type { Card, Video } from '../../../shared/video'
import { insertAsset } from '../assets'
import type { Tool } from '../components/AnnotationLayer'
import { playback } from '../playback'
import { markerFor, type AppLatest } from './appState'
import type { CardEdit } from './useCardEdit'
import { t } from '../../../shared/i18n'

const api = window.api

interface Host {
  latest: RefObject<AppLatest>
  updateReel: (r: Reel) => void
  updateVideo: (v: Video) => void
  // The card being edited, if any
  cardEditRef: RefObject<CardEdit | null>
  cardAnnsRef: RefObject<Annotation[]>
  cardEditCard: Card | null
  setCardAnns: (list: Annotation[]) => void
  // The selection
  activeAnns: Annotation[]
  selectedAnn: string | null
  extraSel: string[]
  setExtraSel: (ids: string[]) => void
  selectAnn: (id: string | null) => void
  setSelectedAnn: (id: string | null) => void
  setAnnTool: Dispatch<SetStateAction<Tool>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setError: (e: string) => void
}

export function useObjects({ latest, updateReel, updateVideo, cardEditRef, cardAnnsRef, cardEditCard, setCardAnns, activeAnns, selectedAnn, extraSel, setExtraSel, selectAnn, setSelectedAnn, setAnnTool, setNotice, setError }: Host) {
  // The active clip's objects with its scene's and its video's (表示範囲). The editor gets them
  // merged; edits are split back to where each object lives.
  const scopedNow = (): ScopedAnnotations | null => {
    const { reel: r, activeClipId: id, video: v } = latest.current
    const c = r && id ? r.clips[id] : null
    const m = c ? markerFor(r!, c.id, latest.current.activeGroup) : null
    return c ? { video: v?.annotations ?? [], scene: r!.annotations ?? [], marker: m ? r!.markerAnnotations?.[m] ?? [] : [], clip: c.annotations } : null
  }
  const applyScoped = useCallback((next: ScopedAnnotations) => {
    const { reel: r, activeClipId: id, video: v } = latest.current
    const prev = scopedNow()
    if (!r || !id || !prev) return
    const now = new Date().toISOString()
    const m = markerFor(r, id, latest.current.activeGroup)
    if (changed(prev.clip, next.clip) || changed(prev.scene, next.scene) || (m && changed(prev.marker, next.marker))) {
      let nr = changed(prev.clip, next.clip) ? setAnnotations(r, id, next.clip) : r
      if (changed(prev.scene, next.scene)) nr = { ...nr, annotations: next.scene, updatedAt: now }
      if (m && changed(prev.marker, next.marker)) nr = { ...nr, markerAnnotations: { ...nr.markerAnnotations, [m]: next.marker }, updatedAt: now }
      updateReel(nr)
    }
    if (v && changed(prev.video, next.video)) updateVideo({ ...v, annotations: next.video, updatedAt: now })
  }, [updateReel, updateVideo])
  const setAnns = useCallback((list: Annotation[]) => {
    const prev = scopedNow()
    if (prev) applyScoped(splitScoped(prev, list))
  }, [applyScoped])
  const setAnnScope = useCallback((annId: string, to: AnnScope) => {
    const prev = scopedNow()
    if (prev) applyScoped(moveToScope(prev, annId, to))
  }, [applyScoped])
  // When an object shows (video times; null = the clip's edge), from the timeline under 編集 or 図形.
  const setObjectSpan = useCallback((id: string, span: { from?: number | null; to?: number | null }) => {
    const now = scopedNow()
    if (!now) return
    setAnns(mergeScoped(now).map(a => {
      if (a.id !== id) return a
      let next: Annotation = a
      for (const [edge, v] of Object.entries(span) as ['from' | 'to', number | null | undefined][]) {
        if (v === undefined) continue
        const key = edge === 'from' ? 'showFrom' : 'showTo'
        const { [key]: _old, ...rest } = next
        next = (v === null ? rest : { ...rest, [key]: v }) as Annotation
      }
      return next
    }))
  }, [setAnns])

  // A picture (from get) in the middle of the open clip or card, 30% of its width, selected to
  // move or resize. tell: say so when nothing is open to put it on (a paste can come at any time).
  const placeImage = useCallback(async (get: () => Promise<{ assetId: string; width: number; height: number } | null>, tell = false): Promise<string | null> => {
    const { reel: r, activeClipId: id, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const onCard = !!cardEditRef.current
    if (!c && !onCard) { if (tell) setNotice(t('画像を貼り付けるには、クリップかカードを開いてください')); return null }
    try {
      const img = await get()
      if (!img) return null
      const m = c ? ms[c.matchId] : undefined
      const frame = m?.width && m.height ? m.width / m.height : 16 / 9
      const ratio = (img.height / img.width) * frame // normalized height per normalized width
      let w = 0.3, h = w * ratio
      if (h > 0.8) { h = 0.8; w = h / ratio }
      const a: Annotation = { id: crypto.randomUUID(), kind: 'image', color: '#FFFFFF', x: (1 - w) / 2, y: (1 - h) / 2, w, h, assetId: img.assetId }
      if (cardEditRef.current) { setCardAnns([...cardAnnsRef.current, a]) } else {
        const now = scopedNow()
        if (now) setAnns([...mergeScoped(now), a])
      }
      setSelectedAnn(a.id); setAnnTool('select')
      return a.id
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [setAnns, setCardAnns])
  const insertImage = useCallback((path?: string) => placeImage(() => insertAsset(path)), [placeImage])
  // Ctrl+V with a picture on the system clipboard (a screenshot, an image copied elsewhere).
  const pasteImage = useCallback(() => placeImage(() => api.saveClipboardImage(), true), [placeImage])

  // The palette works on the card being edited, else on the active clip: what "save" stores is the
  // selection with its groups; a used item goes on top and is selected.
  const paletteSelection = useMemo(() => {
    const list = cardEditCard ? cardEditCard.annotations ?? [] : activeAnns
    if (!selectedAnn) return []
    const ids = withGroups(list, [selectedAnn, ...extraSel])
    return list.filter(a => ids.includes(a.id))
  }, [cardEditCard, activeAnns, selectedAnn, extraSel])
  const putPaletteItem = (anns: Annotation[]) => {
    if (!anns.length) return
    if (cardEditRef.current) setCardAnns([...cardAnnsRef.current, ...anns])
    else { const now = scopedNow(); if (!now) return; setAnns([...mergeScoped(now), ...anns]) }
    setAnnTool('select'); selectAnn(anns[0].id)
  }
  // Ctrl+C / Ctrl+V: the selected objects (with their groups) are kept here with times relative to
  // the clip's IN, like a palette item, and pasted as new objects on the clip or card being edited.
  // Only within the project: pictures are the project's own files.
  const paletteSelRef = useRef<Annotation[]>([])
  paletteSelRef.current = paletteSelection
  const copied = useRef<{ projectPath: string | null; anns: Annotation[] } | null>(null)
  // The edited clip's IN, or null on a title card; undefined when nothing can take objects.
  const editInNow = (): number | null | undefined => {
    if (cardEditRef.current) return null
    const { reel: r, activeClipId: id, clipInfo: info } = latest.current
    const c = r && id ? r.clips[id] : null
    return c ? info(c).range?.in : undefined
  }
  const copyObjects = (): boolean => {
    const sel = paletteSelRef.current, at = editInNow()
    if (!sel.length || at === undefined) return false
    copied.current = { projectPath: latest.current.projectPath, anns: sel.map(a => shiftTimes(a, at === null ? null : -at)) }
    void api.markObjectsCopied() // so Ctrl+V pastes these until something else is copied

    const msg = keyName(t('図形を {0} 個コピーしました（Ctrl+V で貼り付け）', sel.length))
    setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2500) // a short note, not one to dismiss
    return true
  }
  const pasteObjects = (): boolean => {
    const c = copied.current, at = editInNow()
    if (!c || c.projectPath !== latest.current.projectPath || at === undefined || playback.current.seq) return false
    const list = cardEditRef.current ? cardAnnsRef.current : mergeScoped(scopedNow()!)
    const copies = pasteCopies(freshIds(c.anns.map(a => shiftTimes(a, at))), list)
    putPaletteItem(copies)
    setExtraSel(copies.slice(1).map(a => a.id))
    return true
  }

  return { scopedNow, setAnns, setAnnScope, setObjectSpan, insertImage, pasteImage, placeImage, paletteSelection, putPaletteItem, copyObjects, pasteObjects }
}
