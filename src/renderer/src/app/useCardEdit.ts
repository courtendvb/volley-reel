// The gears: edit a title card over the video window — its title's place and size, and objects on
// it (text, pictures, shapes). sceneId null = the video's opening card; marker null = the scene's card.
// slideId: a slide of the scene instead, edited the same way (its objects; no title).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Annotation } from '../../../shared/annotation'
import type { CardLayout, OverlaySettings } from '../../../shared/overlay'
import { markerCardOn, setSlide, type Marker, type Reel } from '../../../shared/reel'
import type { Match, ProjectSettings } from '../../../shared/types'
import { cardMatch, slideCard, videoCard, type Card, type Video } from '../../../shared/video'
import { playback } from '../playback'
import type { AppLatest } from './appState'

export type CardEdit = { sceneId: string | null; marker: Marker | null; slideId?: string }

interface Host {
  latest: RefObject<AppLatest>
  settings: ProjectSettings | undefined
  video: Video | null
  reels: Reel[]
  matches: Record<string, Match>
  overlay: OverlaySettings
  setOverlay: (s: OverlaySettings) => void
  selectedAnn: string | null
  setSelectedAnn: (id: string | null) => void
  updateReel: (r: Reel) => void
  updateVideo: (v: Video) => void
}

export function useCardEdit({ latest, settings, video, reels, matches, overlay, setOverlay, selectedAnn, setSelectedAnn, updateReel, updateVideo }: Host) {
  const [cardEdit, setCardEdit] = useState<CardEdit | null>(null)
  // The edit mode: the side columns put away, the stage (a slide, a card or a clip) and its editing as large as can be.
  const [focusEdit, setFocusEdit] = useState(false)
  const [cardTool, setCardTool] = useState<'objects' | 'title' | 'logo'>('objects') // what the pointer edits on the card
  const [cardToolsOpen, setCardToolsOpen] = useState(false) // the object tools under a card or slide: folded until wanted
  useEffect(() => { if (cardEdit && selectedAnn) setCardToolsOpen(true) }, [cardEdit, selectedAnn]) // an object picked on it opens them
  const cardEditCard = useMemo((): Card | null => {
    if (!cardEdit) return null
    const codes = settings?.ourTeamCodes ?? []
    if (cardEdit.sceneId === null) return video ? videoCard(video, Object.fromEntries(reels.map(r => [r.id, r])), matches, codes) : null
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return null
    if (cardEdit.slideId) { const sl = sc.slides?.find(s => s.id === cardEdit.slideId); return sl ? slideCard(sl) : null }
    const m = cardEdit.marker
    const ids = m === null ? Object.keys(sc.clips) : sc.groups[m]
    return { marker: m, scene: sc.id, name: (m === null ? sc.cardTitle || sc.name : sc.markerCardTitles?.[m] || sc.markerNames[m]), ...cardMatch(sc, ids, matches, codes),
      annotations: (m === null ? sc.cardAnnotations : sc.markerCardAnnotations?.[m]) ?? [], layout: m === null ? sc.cardLayout : sc.markerCardLayouts?.[m] }
  }, [cardEdit, reels, video, matches, settings])
  const cardEditRef = useRef(cardEdit)
  cardEditRef.current = cardEdit
  const cardAnnsRef = useRef<Annotation[]>([])
  cardAnnsRef.current = cardEditCard?.annotations ?? []
  const setCardAnns = useCallback((list: Annotation[]) => {
    const ce = cardEditRef.current
    if (!ce) return
    const now = new Date().toISOString()
    if (ce.sceneId === null) { const v = latest.current.video; if (v) updateVideo({ ...v, cardAnnotations: list, updatedAt: now }); return }
    const sc = latest.current.reels.find(x => x.id === ce.sceneId)
    if (!sc) return
    if (ce.slideId) { const sl = sc.slides?.find(s => s.id === ce.slideId); if (sl) updateReel(setSlide(sc, { ...sl, annotations: list })); return }
    updateReel(ce.marker === null ? { ...sc, cardAnnotations: list, updatedAt: now }
      : { ...sc, markerCardAnnotations: { ...sc.markerCardAnnotations, [ce.marker]: list }, updatedAt: now })
  }, [updateReel, updateVideo])
  // The card's own text ('' = its name) and the name it falls back to.
  const cardTitleNow = (() => {
    if (!cardEdit || cardEdit.slideId) return { title: '', name: '' }
    if (cardEdit.sceneId === null) return { title: video?.cardTitle ?? '', name: video?.name ?? '' }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    const m = cardEdit.marker
    return m === null ? { title: sc?.cardTitle ?? '', name: sc?.name ?? '' } : { title: sc?.markerCardTitles?.[m] ?? '', name: sc?.markerNames[m] ?? '' }
  })()
  const setCardTitle = (t: string) => {
    if (!cardEdit) return
    const now = new Date().toISOString(), value = t.trim() ? t : undefined
    if (cardEdit.sceneId === null) { if (video) updateVideo({ ...video, cardTitle: value, updatedAt: now }); return }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return
    const m = cardEdit.marker
    updateReel(m === null ? { ...sc, cardTitle: value, updatedAt: now } : { ...sc, markerCardTitles: { ...sc.markerCardTitles, [m]: value }, updatedAt: now })
  }
  // This card's own title place and size, apart from the others of its kind (undefined: back with them).
  const setCardLayout = (l: CardLayout | undefined) => {
    if (!cardEdit) return
    const now = new Date().toISOString()
    if (cardEdit.sceneId === null) { if (video) updateVideo({ ...video, cardLayout: l, updatedAt: now }); return }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return
    const m = cardEdit.marker
    updateReel(m === null ? { ...sc, cardLayout: l, updatedAt: now } : { ...sc, markerCardLayouts: { ...sc.markerCardLayouts, [m]: l }, updatedAt: now })
  }
  // Whether this card is shown at all (the same switches as the overlay dialog and the scene editor).
  const cardShown = !cardEdit ? false : cardEdit.sceneId === null ? !!overlay.titleCard.videoCard
    : cardEdit.marker === null ? (reels.find(x => x.id === cardEdit.sceneId)?.sceneCard ?? overlay.titleCard.sceneCards)
    : (() => { const sc = reels.find(x => x.id === cardEdit.sceneId); return sc ? markerCardOn(sc, cardEdit.marker!, overlay.titleCard.enabled) : false })()
  const setCardShown = (on: boolean) => {
    if (!cardEdit) return
    if (cardEdit.sceneId === null) { setOverlay({ ...overlay, titleCard: { ...overlay.titleCard, videoCard: on } }); return }
    if (cardEdit.marker === null) {
      const s = reels.find(x => x.id === cardEdit.sceneId)
      if (s) updateReel({ ...s, sceneCard: on, updatedAt: new Date().toISOString() })
      return
    }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (sc) updateReel({ ...sc, markerCards: { ...sc.markerCards, [cardEdit.marker]: on }, updatedAt: new Date().toISOString() })
  }
  const editCard = (sceneId: string | null, marker: Marker | null, slideId?: string) => {
    playback.stopSequence(); playback.pause(); setSelectedAnn(null); setCardTool('objects'); setCardToolsOpen(false); setCardEdit({ sceneId, marker, ...(slideId ? { slideId } : {}) })
  }
  // A slide that was removed (or undone away) while open: back to the clips.
  useEffect(() => { if (cardEdit?.slideId && !cardEditCard) setCardEdit(null) }, [cardEdit, cardEditCard])
  const editingSlide = useMemo(() => {
    const ce = cardEdit
    return ce?.slideId ? reels.find(x => x.id === ce.sceneId)?.slides?.find(s => s.id === ce.slideId) ?? null : null
  }, [cardEdit, reels])
  const editingSource = editingSlide?.bg.kind === 'image' ? editingSlide.bg.source : undefined

  return {
    cardEdit, setCardEdit, focusEdit, setFocusEdit, cardTool, setCardTool, cardToolsOpen, setCardToolsOpen,
    cardEditCard, cardEditRef, cardAnnsRef, setCardAnns, cardTitleNow, setCardTitle, setCardLayout, cardShown, setCardShown,
    editCard, editingSlide, editingSource,
  }
}
