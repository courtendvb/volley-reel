// Slides in a scene: blank pages, PDF pages and pictures (they remember their file, to be read again
// when it changes), the picture on screen, and data slides comparing players. Blank and on-screen
// slides open for editing right away. Also saving the cards and slides as a picture or a PDF.
import { useMemo, useState, type RefObject } from 'react'
import { boardSlide, keptByHand, type BoardPhoto } from '../../../shared/board'
import { logoKey } from '../../../shared/serveTargetBoard'
import { markStyle, type GridStyle } from '../../../shared/court'
import type { OverlaySettings } from '../../../shared/overlay'
import { findPhoto, type PackInfo } from '../../../shared/pack'
import { pdfFromJpegs } from '../../../shared/pdf'
import { chronological, groupRows, markersOf, newSlide, putSlides, setSlide, spotAt, type Clip, type Group, type Marker, type Reel, type Slide, type SlideSpot } from '../../../shared/reel'
import { withRoles } from '../../../shared/roles'
import type { ImportProgress, ParsedDVW, ProjectSettings, SlideFile } from '../../../shared/types'
import { slideCard } from '../../../shared/video'
import { pdfPages } from '../assets'
import type { BoardChoice } from '../components/BoardDialog'
import type { SlideHow } from '../components/ReelPanel'
import { CARD_H, CARD_W, cardImages } from '../exportRender'
import { playback } from '../playback'
import type { AppLatest } from './appState'
import type { CardEdit } from './useCardEdit'
import { t } from '../../../shared/i18n'

const api = window.api
const BOARD_SEC = 10 // a slide comparing players stays up long enough to read

interface Host {
  latest: RefObject<AppLatest>
  dvws: Record<string, ParsedDVW>
  settings: ProjectSettings | undefined
  packs: PackInfo[]
  gridStyle: GridStyle
  overlay: OverlaySettings
  activeGroup: Group | null
  whenIn: (s: Reel) => (c: Clip) => [string, number]
  cardEdit: CardEdit | null
  editCard: (sceneId: string | null, marker: Marker | null, slideId?: string) => void
  updateScene: (id: string, fn: (r: Reel) => Reel) => void
  makeScene: () => Reel
  setProgress: (p: ImportProgress | null) => void
  setNotice: (n: string | null | ((n: string | null) => string | null)) => void
  setError: (e: string) => void
}

export function useSlides({ latest, dvws, settings, packs, gridStyle, overlay, activeGroup, whenIn, cardEdit, editCard, updateScene, makeScene, setProgress, setNotice, setError }: Host) {
  const slidesFrom = async (files: SlideFile[]): Promise<Slide[]> => {
    const out: Slide[] = []
    try {
      for (const f of files) {
        const source = { path: f.path, name: f.name, mtimeMs: f.mtimeMs }
        if (f.kind === 'image') { out.push(newSlide({ kind: 'image', assetId: f.assetId, source: { ...source, page: null } })); continue }
        const pages: Slide[] = []
        const total = await pdfPages(f.data, async (n, png, total) => {
          setProgress({ stage: 'save', message: t('{0} を読み込んでいます（{1} / {2} ページ）', f.name, n, total), ratio: n / total })
          pages.push(newSlide({ kind: 'image', assetId: await api.saveAsset(png), source: { ...source, page: n } }))
        })
        out.push(...pages.map(s => (s.bg.kind === 'image' && s.bg.source ? { ...s, bg: { ...s.bg, source: { ...s.bg.source, pages: total } } } : s)))
      }
    } finally {
      setProgress(null)
    }
    return out
  }

  // The ＋ in the scene editor: a blank page, files, or the picture on screen, at `spot`.
  const putSlide = async (spot: SlideSpot, how: SlideHow, files?: SlideFile[]) => {
    const sceneId = latest.current.reel?.id
    if (!sceneId) return
    try {
      let list: Slide[]
      if (how === 'blank') list = [newSlide({ kind: 'blank' })]
      else if (how === 'frame') {
        const key = playback.attachedKey
        if (!key) return
        list = [newSlide({ kind: 'image', assetId: await api.grabFrame(key, playback.current.time) })]
      } else list = await slidesFrom(files ?? await api.pickSlides())
      if (!list.length) return
      updateScene(sceneId, r => putSlides(r, list, spot))
      if (how === 'file') { const msg = t('スライドを {0} 枚入れました', list.length); setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2500) }
      else editCard(sceneId, null, list[0].id)
    } catch (e) {
      setProgress(null)
      setError(t('スライドを入れられませんでした: {0}', (e as Error).message))
    }
  }

  // The picture on screen as a slide right after the open clip, in the group it was opened from.
  const frameAfterClip = () => {
    const r = latest.current.reel, id = latest.current.activeClipId
    if (!r || !id) return
    const group = activeGroup !== null && r.groups[activeGroup].includes(id) ? activeGroup : markersOf(r, id)[0] ?? 'none'
    const ids = group === 'none' ? chronological(r, r.groups.none, whenIn(r)).map(c => c.id) : r.groups[group]
    const rows = groupRows(r, group, ids)
    return putSlide(spotAt(rows, group, rows.findIndex(x => x.kind === 'clip' && x.id === id) + 1), 'frame')
  }

  // The data slides read positions from the players: the project's positions put on them.
  const boardDvws = useMemo(() => Object.values(dvws).map(d => withRoles(d, settings?.roles)), [dvws, settings?.roles])
  // Slides comparing players: each lays out its players, with their photos copied into the project.
  // They go at the head of the chosen marker of the open scene, or into a new scene when none is open.
  const [boardOpen, setBoardOpen] = useState(false)
  const [boardEdit, setBoardEdit] = useState<Slide | null>(null) // the card whose make-up is being changed
  const makeBoard = async (c: BoardChoice) => {
    const { setView, setLayout, rotations, display, skill, columns, split, notes, noteSize, noteFills, photos: withPhotos, background, marker, team, searched, teamColor, discLine } = c, perSlide = columns.length
    const old = boardEdit
    setBoardOpen(false); setBoardEdit(null)
    try {
      const photos: Record<string, BoardPhoto> = {}
      for (const p of withPhotos ? columns : []) {
        const found = photos[p.key] ? null : findPhoto(packs, p.player, p.team)
        if (found) photos[p.key] = await api.usePackPhoto(found.pack, found.player.photo)
      }
      // A serve target or a rotation: the team's logo too, when the library has one.
      if (withPhotos && (skill === 'T' || skill === 'R') && columns[0]) {
        const logo = await api.useLogo(columns[0].team)
        if (logo) photos[logoKey(columns[0].team)] = logo
      }
      const list: Slide[] = []
      const kept = old ? keptByHand(old) : { hand: [], noteTexts: [] }
      // A rotation: one slide per rotation picked, of the one setter; the rest: the columns, perSlide a slide.
      const runs = skill === 'R' ? rotations.map(rotation => ({ part: columns.slice(0, 1), rotation })) : Array.from({ length: Math.ceil(columns.length / perSlide) }, (_, k) => ({ part: columns.slice(k * perSlide, (k + 1) * perSlide), rotation: undefined as number | undefined }))
      for (const [i, { part, rotation }] of runs.entries()) {
        const s = newSlide({ kind: 'blank', color: background }, old?.durationSec ?? BOARD_SEC)
        const { annotations, charts, noteIds, setCharts } = boardSlide(part, skill, { setView, ...(skill === 'E' ? { setLayout } : {}), ...(rotation ? { rotation, teamColor, discLine } : {}), split, notes, noteSize, noteFills, background, display, ...(markStyle(gridStyle, skill).chart ? { style: markStyle(gridStyle, skill).chart } : {}), ...(i ? {} : { noteTexts: kept.noteTexts }) }, photos)
        const config = { setView, ...(skill === 'E' ? { setLayout } : {}), ...(rotation ? { rotation, teamColor, discLine } : {}), display, skill, team, split, notes, noteSize, noteFills, photos: withPhotos, background, searched, columns: part.map(x => ({ key: x.key, code: x.code ?? null, ...(x.attention ? { attention: true } : {}) })) }
        list.push({ ...s, annotations: i ? annotations : [...annotations, ...kept.hand], charts, ...(setCharts ? { setCharts } : {}), board: { config, made: annotations.map(a => a.id), noteIds } })
      }
      if (old && cardEdit?.sceneId) {
        // In place of the card; if it no longer fits on one, the rest right after it.
        const sceneId = cardEdit.sceneId
        updateScene(sceneId, r => {
          const at = (r.slides ?? []).filter(x => x.group === old.group && x.after === old.after).findIndex(x => x.id === old.id)
          const [first, ...rest] = list
          return putSlides(setSlide(r, { ...first, id: old.id, group: old.group, after: old.after }), rest, { group: old.group, after: old.after, index: at + 1 })
        })
        return
      }
      const scene = latest.current.reel ?? makeScene()
      // At the head of the marker, where its title card would be.
      const group = marker, sceneId = scene.id
      updateScene(sceneId, r => putSlides(r, list, spotAt(groupRows(scene, group), group, 0)))
      editCard(sceneId, null, list[0].id)
    } catch (e) {
      setError(String(e))
    }
  }

  // The open card as a picture, or all the scene's cards and slides, in order, as a PDF.
  const saveCards = async (as: 'png' | 'pdf', slide: Slide) => {
    try {
      const scene = latest.current.reel
      const name = scene?.name || t('データスライド')
      if (as === 'png') {
        const [png] = await cardImages([slideCard(slide)], overlay, gridStyle.heatOpacity, 'image/png')
        const path = await api.saveCard(name, 'png', png)
        if (path) setNotice(t('書き出しました: {0}', path))
        return
      }
      const all = scene ? ['head' as const, ...scene.groupOrder, 'none' as const].flatMap(g => groupRows(scene, g).flatMap(r => (r.kind === 'slide' ? [r.slide] : []))) : [slide]
      const pages = await cardImages(all.map(slideCard), overlay, gridStyle.heatOpacity, 'image/jpeg')
      const path = await api.saveCard(name, 'pdf', pdfFromJpegs(pages.map(jpeg => ({ jpeg, width: CARD_W, height: CARD_H }))))
      if (path) setNotice(t('書き出しました: {0}', path))
    } catch (e) {
      setError(String(e))
    }
  }

  return { putSlide, frameAfterClip, boardDvws, boardOpen, setBoardOpen, boardEdit, setBoardEdit, makeBoard, saveCards }
}
