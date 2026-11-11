// The gears: edit a title card over the video window — its title's place and size, and objects on
// it (text, pictures, shapes). sceneId null = the video's opening card; marker null = the scene's card.
// slideId: a slide of the scene instead, edited the same way (its objects; no title).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Annotation } from '../../../shared/annotation'
import { changed } from '../../../shared/annotationScope'
import type { CardKind, CardLayout, OverlaySettings } from '../../../shared/overlay'
import { markerCardOn, setSlide, type Marker, type Reel } from '../../../shared/reel'
import type { Match, ProjectSettings } from '../../../shared/types'
import { cardMatch, cardObjects, slideCard, videoCard, type Card, type Video } from '../../../shared/video'
import { playback } from '../playback'
import type { AppLatest } from './appState'

export type CardEdit = { sceneId: string | null; marker: Marker | null; slideId?: string }
// Where a card's object lives: on this card only, or on every card of its kind (the video's titleCard.objects).
export type CardScope = 'card' | 'all'
const kindOf = (ce: CardEdit): CardKind => (ce.sceneId === null ? 'video' : ce.marker === null ? 'scene' : 'marker')
// The objects of every card of its kind this card doesn't show.
const hiddenOf = (ce: CardEdit, video: Video | null, sc: Reel | undefined): string[] =>
  (ce.sceneId === null ? video?.cardHidden : ce.marker === null ? sc?.cardHidden : sc?.markerCardHidden?.[ce.marker]) ?? []

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
    // A title card shows the objects of every card of its kind under its own, as it plays.
    if (cardEdit.sceneId === null) {
      if (!video) return null
      const vc = videoCard(video, Object.fromEntries(reels.map(r => [r.id, r])), matches, codes)
      return { ...vc, annotations: cardObjects(vc.annotations, 'video', overlay, video.cardHidden) }
    }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return null
    if (cardEdit.slideId) { const sl = sc.slides?.find(s => s.id === cardEdit.slideId); return sl ? slideCard(sl) : null }
    const m = cardEdit.marker
    const ids = m === null ? Object.keys(sc.clips) : sc.groups[m]
    const own = m === null ? sc.cardAnnotations : sc.markerCardAnnotations?.[m]
    return { marker: m, scene: sc.id, name: (m === null ? sc.cardTitle || sc.name : sc.markerCardTitles?.[m] || sc.markerNames[m]), ...cardMatch(sc, ids, matches, codes),
      annotations: cardObjects(own, m === null ? 'scene' : 'marker', overlay, hiddenOf(cardEdit, video, sc)), layout: m === null ? sc.cardLayout : sc.markerCardLayouts?.[m] }
  }, [cardEdit, reels, video, matches, settings, overlay])
  const cardEditRef = useRef(cardEdit)
  cardEditRef.current = cardEdit
  const cardAnnsRef = useRef<Annotation[]>([])
  cardAnnsRef.current = cardEditCard?.annotations ?? []
  // The card's objects as edited (the merged list) split back: those of every card of its kind to the
  // video's titleCard.objects (keeping the ones this card hides), the rest to the card. New objects go
  // on the card, or on every card with move.all; move.card takes objects off every card onto this one.
  const setCardAnns = useCallback((list: Annotation[], move: { all?: string[]; card?: string[] } = {}) => {
    const ce = cardEditRef.current
    if (!ce) return
    const now = new Date().toISOString()
    const sc = ce.sceneId === null ? undefined : latest.current.reels.find(x => x.id === ce.sceneId)
    if (ce.slideId) { const sl = sc?.slides?.find(s => s.id === ce.slideId); if (sc && sl) updateReel(setSlide(sc, { ...sl, annotations: list })); return }
    const v = latest.current.video, ov = latest.current.overlay, kind = kindOf(ce)
    const shared0 = ov.titleCard.objects?.[kind] ?? [], hidden = new Set(hiddenOf(ce, v, sc))
    const toCard = new Set(move.card ?? [])
    const isShared = new Set([...shared0.map(a => a.id), ...(move.all ?? [])].filter(id => !toCard.has(id)))
    const shared = list.filter(a => isShared.has(a.id))
    // Those this card hides stay for the others, at about their place.
    shared0.forEach((a, i) => { if (hidden.has(a.id) && !toCard.has(a.id)) shared.splice(Math.min(i, shared.length), 0, a) })
    const own = list.filter(a => !isShared.has(a.id))
    const ov2 = changed(shared0, shared) ? { ...ov, titleCard: { ...ov.titleCard, objects: { ...ov.titleCard.objects, [kind]: shared } } } : null
    if (ce.sceneId === null) { if (v) updateVideo({ ...v, ...(ov2 ? { overlay: ov2 } : {}), cardAnnotations: own, updatedAt: now }); return }
    if (ov2) setOverlay(ov2)
    if (!sc) return
    const own0 = (ce.marker === null ? sc.cardAnnotations : sc.markerCardAnnotations?.[ce.marker]) ?? []
    if (!changed(own0, own)) return
    updateReel(ce.marker === null ? { ...sc, cardAnnotations: own, updatedAt: now }
      : { ...sc, markerCardAnnotations: { ...sc.markerCardAnnotations, [ce.marker]: own }, updatedAt: now })
  }, [updateReel, updateVideo, setOverlay])
  // Where an object of the open card lives, and moving it (on top of the other list).
  const cardScopeOf = useCallback((id: string): CardScope => {
    const ce = cardEditRef.current
    return ce && !ce.slideId && (latest.current.overlay.titleCard.objects?.[kindOf(ce)] ?? []).some(a => a.id === id) ? 'all' : 'card'
  }, [])
  const setCardScope = useCallback((id: string, to: CardScope) => {
    if (cardScopeOf(id) === to) return
    const list = cardAnnsRef.current, a = list.find(x => x.id === id)
    if (!a) return
    setCardAnns([...list.filter(x => x.id !== id), a], to === 'all' ? { all: [id] } : { card: [id] })
  }, [cardScopeOf, setCardAnns])
  // Objects of every card of its kind left off this card, or put back.
  const hideOnCard = useCallback((ids: string[], hide: boolean) => {
    const ce = cardEditRef.current
    if (!ce || ce.slideId) return
    const now = new Date().toISOString(), v = latest.current.video
    const sc = ce.sceneId === null ? undefined : latest.current.reels.find(x => x.id === ce.sceneId)
    const before = hiddenOf(ce, v, sc), next = hide ? [...new Set([...before, ...ids])] : before.filter(id => !ids.includes(id))
    if (ce.sceneId === null) { if (v) updateVideo({ ...v, cardHidden: next, updatedAt: now }); return }
    if (!sc) return
    updateReel(ce.marker === null ? { ...sc, cardHidden: next, updatedAt: now } : { ...sc, markerCardHidden: { ...sc.markerCardHidden, [ce.marker]: next }, updatedAt: now })
  }, [updateReel, updateVideo])
  // The objects of every card of this kind this card leaves off (only those still there).
  const cardHiddenIds = useMemo(() => {
    if (!cardEdit || cardEdit.slideId) return []
    const shared = overlay.titleCard.objects?.[kindOf(cardEdit)] ?? []
    const hidden = hiddenOf(cardEdit, video, reels.find(x => x.id === cardEdit.sceneId))
    return hidden.filter(id => shared.some(a => a.id === id))
  }, [cardEdit, overlay, video, reels])
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
    cardEditCard, cardEditRef, cardAnnsRef, setCardAnns, cardScopeOf, setCardScope, hideOnCard, cardHiddenIds, cardTitleNow, setCardTitle, setCardLayout, cardShown, setCardShown,
    editCard, editingSlide, editingSource,
  }
}
