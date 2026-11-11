import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { composing } from '../keys'
import {
  applyStyle, bounds, drawAnnotation, fadeAlpha, hitTest, normalizeBox, pointsBox, translate, visibleAt, withGroups,
  type Annotation, type AnnotationKind, type ImageAnnotation, type ImageLookup, type Rect, type StylePatch, nextNumber, numberCircle } from '../../../shared/annotation'
import { cropHandle, dragHandle, fullRect, handlesOf, panCrop, removeVertex, snapToNeighbors, trianglePoints, zoomCrop, type BoxHandle, type Handle } from '../../../shared/annotationEdit'
import { assetImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'
import { playback } from '../playback'
import type { AnnScope } from '../../../shared/annotationScope'
import { t } from '../../../shared/i18n'
import { floorAt, floorRect, type CourtFit } from '../../../shared/court'
import { discOutline, discShapes, type FloorDisc } from '../../../shared/disc'

const SCOPE_COLOR: Record<AnnScope, string> = { clip: '#4B61D1', marker: '#7C3AED', scene: '#D97706', video: '#059669' }
const SCOPE_TAG: Record<AnnScope, string> = { clip: '', marker: t('マーカー全体'), scene: t('シーン全体'), video: t('動画全体') }

// A triangle is drawn like a box and stored as a polygon; so is a rectangle laid on the court's floor,
// which follows its perspective (a plain box when there is no court or the drag leaves the floor).
// The field text is typed in shows it in its own colour on a ground it can be read on, with a caret that
// stands out from both: dark text on light, light text on dark.
function editColors(color: string): { color: string; background: string; caretColor: string } {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  const light = m ? 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) > 150 : true
  return light ? { color, background: 'rgba(15, 23, 42, 0.85)', caretColor: '#FACC15' } : { color, background: 'rgba(255, 255, 255, 0.95)', caretColor: '#DC2626' }
}

export type Tool = 'select' | AnnotationKind | 'triangle' | 'number' | 'floorRect' | 'floorDisc'
// The style for the next shape; also what the format panel shows when nothing is selected.
// textColor: new text is white by default while shapes are red, so text has its own color.
export type AnnStyle = StylePatch & { color: string; width: number; size: number; textColor?: string; discHeight?: number } // discHeight: metres, for new discs on the court
export const textStyle = (s: AnnStyle): AnnStyle => ({ ...s, color: s.textColor ?? '#FFFFFF' })

interface Props {
  images?: ImageLookup // how pictures are found (a title card's photo frame shows its player); else the project's assets
  size: { w: number; h: number }
  annotations: Annotation[]
  clip: { key: string; in: number; out: number }
  editable: boolean
  tool: Tool
  style: AnnStyle
  selectedId: string | null
  extraIds?: string[] // more selected objects (Shift+click), moved and deleted with the selected one
  onToggleExtra?: (id: string) => void
  scopeOf?: (id: string) => AnnScope | null // where each object lives (frame color and tag)
  editPoints: boolean // Office's "Edit Points": vertex handles instead of the box
  onMade?: () => void // an object was just made: the tools go back to 選択
  cropping: boolean // the selected picture is being cropped: handles move the frame, dragging moves the picture
  always?: boolean // a title card's objects: shown whatever the video is doing
  floor?: CourtFit['corners'] | null // the court fitted to the video: shapes can be laid on its floor
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
}

type PathDraft = { kind: 'polyline' | 'polygon'; points: [number, number][]; hover: [number, number] | null }

type Drag =
  | { mode: 'move'; id: string; from: [number, number]; orig: Annotation; others: Annotation[] }
  | { mode: 'handle'; id: string; handle: string }
  | { mode: 'draw'; draft: Annotation; from: [number, number] }
  | { mode: 'crop'; id: string; handle: BoxHandle; full: Rect }
  | { mode: 'pan'; id: string; from: [number, number]; orig: ImageAnnotation; full: Rect }


const uid = () => crypto.randomUUID()
const DISC_HEIGHT = 0.2 // metres, a new disc's thickness unless set
const plainBox = (a: [number, number], b: [number, number]): [number, number][] => [a, [b[0], a[1]], b, [a[0], b[1]]]
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const HANDLE_PX = 7 // grab radius around a handle

// Canvas over the video box. Shows the annotations visible at the playhead (others faint while
// editing, so they can still be picked) and handles drawing, selecting, moving, handle editing
// (arrow ends, box resize, vertices), polyline / polygon drawing by clicks, and text editing.
export function AnnotationLayer(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  // Pointer moves can arrive faster than React re-renders, so the drag and the list it edits are
  // also kept in refs: each move builds on the previous one, not on a stale render.
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d) }
  const annsRef = useRef(p.annotations)
  annsRef.current = p.annotations
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // A polyline / polygon being drawn: fixed points plus the rubber-band point under the cursor.
  const [path, setPathState] = useState<PathDraft | null>(null)
  // Mirrors path so finishing reads the latest points and runs once, outside any state updater.
  const pathRef = useRef<PathDraft | null>(null)
  const setPath = (q: PathDraft | null) => { pathRef.current = q; setPathState(q) }
  const [textEdit, setTextEdit] = useState<{ id: string | null; x: number; y: number; value: string } | null>(null)
  const [assetTick, setAssetTick] = useState(0) // redraw when an image finishes loading
  useEffect(() => subscribeAssets(() => setAssetTick(n => n + 1)), [])
  // Which objects are visible right now ("id,id,…"): the layer redraws when this changes, not on
  // every frame of the video.
  // A title card covers the frame during a through-play: the clip's objects are not on it.
  const [onCard, setOnCard] = useState(!!playback.current.card)
  // Fading objects add their opacity in twentieths, so the layer redraws as they fade.
  const visibleKey = (t: number) => `${playback.attachedKey}|${annsRef.current.filter(a => visibleAt(a, t, clipRef.current))
    .map(a => (a.fadeIn || a.fadeOut ? `${a.id}:${Math.round(fadeAlpha(a, t, clipRef.current) * 20)}` : a.id)).join(',')}`
  const [visKey, setVisKey] = useState('')
  const clipRef = useRef(p.clip)
  clipRef.current = p.clip
  useEffect(() => playback.subscribe(s => { setVisKey(visibleKey(s.time)); setOnCard(!!s.card) }), [])

  const onScreen = p.always || playback.attachedKey === p.clip.key
  const pathDraft: Annotation | null = path && path.points.length
    ? applyStyle({ id: 'path-draft', kind: path.kind, color: p.style.color, width: p.style.width, points: path.hover ? [...path.points, path.hover] : path.points } as Annotation, p.style)
    : null
  const shown = drag?.mode === 'draw' ? [...p.annotations, drag.draft] : pathDraft ? [...p.annotations, pathDraft] : p.annotations
  const selected = p.editable && p.selectedId ? p.annotations.find(a => a.id === p.selectedId) ?? null : null
  const handles = selected ? handlesOf(selected, p.editPoints) : []
  const cropImg = p.cropping && selected?.kind === 'image' ? selected : null

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, p.size.w, p.size.h)
    if (!onScreen || (onCard && !p.always)) return
    const time = playback.current.time
    for (const a of shown) {
      if (textEdit?.id === a.id) continue
      const vis = visibleAt(a, time, p.clip) || a.id === 'path-draft'
      if (!vis && !p.editable) continue
      ctx.globalAlpha = vis ? (p.always ? 1 : fadeAlpha(a, time, p.clip)) : 0.3
      if (cropImg && a.id === cropImg.id) {
        // While cropping, the whole picture shows faintly around the frame.
        const img = assetImage(cropImg.assetId), f = fullRect(cropImg)
        if (img) { ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(img, f.x * p.size.w, f.y * p.size.h, f.w * p.size.w, f.h * p.size.h); ctx.restore() }
      }
      drawAnnotation(ctx, a, p.size.w, p.size.h, p.images ?? assetImage)
    }
    ctx.globalAlpha = 1
    // The other selected objects and the selected one's group: a thin frame each.
    if (selected) {
      for (const id of withGroups(p.annotations, [selected.id, ...(p.extraIds ?? [])])) {
        if (id === selected.id) continue
        const o = p.annotations.find(a => a.id === id)
        if (!o) continue
        const b = bounds(ctx, o, p.size.w, p.size.h)
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeStyle = '#4B61D1'
        ctx.strokeRect(b.x * p.size.w - 4, b.y * p.size.h - 4, b.w * p.size.w + 8, b.h * p.size.h + 8)
        ctx.setLineDash([])
      }
    }
    if (selected) {
      const b = bounds(ctx, selected, p.size.w, p.size.h)
      const scope = p.scopeOf?.(selected.id) ?? 'clip'
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = SCOPE_COLOR[scope]
      ctx.strokeRect(b.x * p.size.w - 6, b.y * p.size.h - 6, b.w * p.size.w + 12, b.h * p.size.h + 12)
      ctx.setLineDash([])
      if (SCOPE_TAG[scope]) {
        ctx.font = 'bold 11px "Segoe UI", "Yu Gothic UI", "Helvetica Neue", "Hiragino Sans", sans-serif'
        const tw = ctx.measureText(SCOPE_TAG[scope]).width + 10, tx = b.x * p.size.w - 6, ty = Math.max(0, b.y * p.size.h - 24)
        ctx.fillStyle = SCOPE_COLOR[scope]; ctx.fillRect(tx, ty, tw, 17)
        ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle'; ctx.fillText(SCOPE_TAG[scope], tx + 5, ty + 9)
      }
      for (const h of handles) drawHandle(ctx, h, p.size.w, p.size.h)
    }
  }, [shown, visKey, p.size.w, p.size.h, p.editable, selected, handles, p.clip, onScreen, textEdit, assetTick, onCard, p.scopeOf, p.extraIds, p.images])

  // Enter / Escape finish or cancel a polyline / polygon being drawn.
  useEffect(() => {
    if (!path) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finishPath() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setPath(null) }
      else if (e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); const q = pathRef.current; setPath(q && q.points.length > 1 ? { ...q, points: q.points.slice(0, -1) } : null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  useEffect(() => { if (p.tool !== 'polyline' && p.tool !== 'polygon') setPath(null) }, [p.tool])

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }
  const ctx2d = () => canvas.current!.getContext('2d')!
  // The wheel zooms the picture being cropped (a native listener: React's wheel handler can't prevent scrolling).
  const cropRef = useRef<ImageAnnotation | null>(null)
  cropRef.current = cropImg
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      const img = cropRef.current
      if (!img) return
      e.preventDefault()
      const cur = annsRef.current.find(a => a.id === img.id)
      if (cur?.kind === 'image') replace(zoomCrop(cur, e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  })
  const handleAt = (pt: [number, number]): Handle | null => {
    // Vertices win over midpoints when they overlap.
    const near = handles.filter(h => Math.hypot((h.x - pt[0]) * p.size.w, (h.y - pt[1]) * p.size.h) <= HANDLE_PX)
    return near.find(h => h.kind !== 'mid') ?? near[0] ?? null
  }
  const replace = (a: Annotation) => {
    const next = annsRef.current.map(x => (x.id === a.id ? a : x))
    annsRef.current = next
    p.onChange(next)
  }

  const finishPath = (points?: [number, number][]) => {
    const cur = pathRef.current
    setPath(null)
    if (!cur) return
    const q = { ...cur, points: points ?? cur.points }
    const min = q.kind === 'polygon' ? 3 : 2
    if (q.points.length < min) return
    const a = applyStyle({ id: uid(), kind: q.kind, color: p.style.color, width: p.style.width, points: q.points } as Annotation, p.style)
    p.onChange([...p.annotations, a])
    p.onSelect(a.id)
    p.onMade?.()
  }

  const onFloor = (a: [number, number], b: [number, number]): [number, number][] =>
    (p.floor && floorRect(p.floor, { x: a[0], y: a[1] }, { x: b[0], y: b[1] })) || plainBox(a, b)
  // A disc on the court: dragged from its centre out to its edge; its thickness from the style.
  const discAt = (from: [number, number], to: [number, number]): FloorDisc | null => {
    const c = p.floor && floorAt({ corners: p.floor }, { x: from[0], y: from[1] }), e = p.floor && floorAt({ corners: p.floor }, { x: to[0], y: to[1] })
    if (!c || !e) return null
    return { u: c.x, v: c.y, r: Math.max(0.1, Math.round(Math.hypot((e.x - c.x) * 9, (e.y - c.y) * 18) * 10) / 10), z: p.style.discHeight ?? DISC_HEIGHT }
  }
  const discFill = () => p.style.fill ?? p.style.color
  const onDown = (e: PointerEvent) => {
    if (!p.editable || textEdit) return
    const pt = at(e)
    if (p.tool === 'number') {
      e.preventDefault()
      const n = numberCircle(uid(), pt[0], pt[1], nextNumber(p.annotations), p.style.color, Math.max(14, Math.round(p.style.size * 0.6)))
      p.onChange([...p.annotations, n])
      p.onSelect(n.id)
      p.onMade?.()
      return
    }
    if (p.tool === 'text') {
      e.preventDefault()
      setTimeout(() => setTextEdit({ id: null, x: pt[0], y: pt[1], value: '' }), 0)
      return
    }
    try { canvas.current!.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
    if (p.tool === 'polyline' || p.tool === 'polygon') {
      playback.pause()
      const q = pathRef.current
      if (!q) { setPath({ kind: p.tool as 'polyline' | 'polygon', points: [pt], hover: null }); return }
      // Clicking the first point closes a polygon.
      const first = q.points[0]
      if (q.kind === 'polygon' && q.points.length >= 3 && Math.hypot((first[0] - pt[0]) * p.size.w, (first[1] - pt[1]) * p.size.h) <= HANDLE_PX) { finishPath(); return }
      setPath({ ...q, points: [...q.points, pt] })
      return
    }
    if (p.tool === 'select' && cropImg) {
      const h = handleAt(pt), f = fullRect(cropImg)
      if (h) { playback.pause(); setDrag({ mode: 'crop', id: cropImg.id, handle: h.id as BoxHandle, full: f }); return }
      if (pt[0] >= f.x && pt[0] <= f.x + f.w && pt[1] >= f.y && pt[1] <= f.y + f.h) {
        playback.pause(); setDrag({ mode: 'pan', id: cropImg.id, from: pt, orig: cropImg, full: f }); return
      }
    }
    if (p.tool === 'select') {
      const h = handleAt(pt)
      if (h && selected) { playback.pause(); setDrag({ mode: 'handle', id: selected.id, handle: h.id }); return }
      const hit = hitTest(ctx2d(), p.annotations, pt[0], pt[1], p.size.w, p.size.h)
      if (e.shiftKey && hit && selected && hit.id !== selected.id && p.onToggleExtra) { p.onToggleExtra(hit.id); return }
      const keep = !!hit && (hit.id === selected?.id || (p.extraIds ?? []).includes(hit.id))
      if (!keep) p.onSelect(hit?.id ?? null) // a click on the selection keeps it (and drags all of it)
      if (hit) {
        const extras = keep ? [...(selected ? [selected.id] : []), ...(p.extraIds ?? [])] : []
        const ids = withGroups(p.annotations, [hit.id, ...extras]).filter(id => id !== hit.id)
        setDrag({ mode: 'move', id: hit.id, from: pt, orig: hit, others: p.annotations.filter(a => ids.includes(a.id)) })
      }
      return
    }
    playback.pause()
    const base = { id: uid(), color: p.style.color }
    const draft: Annotation = p.tool === 'arrow' ? { ...base, kind: 'arrow', x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], width: p.style.width }
      : p.tool === 'freehand' ? { ...base, kind: 'freehand', points: [pt], width: p.style.width }
      : p.tool === 'triangle' ? { ...base, kind: 'polygon', points: trianglePoints(pt, pt), width: p.style.width }
      : p.tool === 'floorRect' ? { ...base, kind: 'polygon', points: onFloor(pt, pt), width: p.style.width }
      : p.tool === 'floorDisc' ? { ...base, kind: 'polygon', points: [pt, pt, pt], width: p.style.width, fill: discFill(), fillOpacity: p.style.fillOpacity ?? 1 }
      : { ...base, kind: p.tool as 'rect' | 'circle', x: pt[0], y: pt[1], w: 0, h: 0, width: p.style.width }
    setDrag({ mode: 'draw', draft: applyStyle(draft, p.style), from: pt })
  }

  const onMove = (e: PointerEvent) => {
    const [x, y] = at(e)
    if (pathRef.current) { setPath({ ...pathRef.current, hover: [x, y] }); return }
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'move') {
      const dx = x - drag.from[0], dy = y - drag.from[1]
      const moved = new Map([drag.orig, ...drag.others].map(a => [a.id, translate(a, dx, dy)]))
      const next = annsRef.current.map(a => moved.get(a.id) ?? a)
      annsRef.current = next
      p.onChange(next)
      return
    }
    if (drag.mode === 'crop') {
      const cur = annsRef.current.find(a => a.id === drag.id)
      if (cur?.kind === 'image') replace(cropHandle(cur, drag.full, drag.handle, x, y))
      return
    }
    if (drag.mode === 'pan') {
      replace(panCrop(drag.orig, drag.full, x - drag.from[0], y - drag.from[1]))
      return
    }
    if (drag.mode === 'handle') {
      const cur = annsRef.current.find(a => a.id === drag.id)
      if (!cur) return
      // Shift: box corners keep their proportions; vertices and arrow ends line up with a neighbor.
      const snap = e.shiftKey && /^(p[12]|[vm]\d+)$/.test(drag.handle)
      const [sx, sy] = snap ? snapToNeighbors(cur, drag.handle, x, y, p.size.w, p.size.h) : [x, y]
      const r = dragHandle(cur, drag.handle, sx, sy, { keepAspect: e.shiftKey && !snap })
      replace(r.a)
      if (r.id !== drag.handle) setDrag({ ...drag, handle: r.id }) // a midpoint became a vertex
      return
    }
    const d = drag.draft
    const next: Annotation = d.kind === 'arrow' ? { ...d, x2: x, y2: y }
      : d.kind === 'freehand' ? { ...d, points: [...d.points, [x, y]] }
      : d.kind === 'rect' || d.kind === 'circle' ? { ...d, w: x - drag.from[0], h: y - drag.from[1] }
      : d.kind === 'polygon' && p.tool === 'floorDisc' ? (() => { const dc = discAt(drag.from, [x, y]); return dc && p.floor ? { ...d, points: discOutline(p.floor, dc).side, disc: { ...dc, part: 'top' as const } } : d })()
      : d.kind === 'polygon' ? { ...d, points: p.tool === 'floorRect' ? onFloor(drag.from, [x, y]) : trianglePoints(drag.from, [x, y]) }
      : d
    setDrag({ ...drag, draft: next })
  }

  const onUp = () => {
    const drag = dragRef.current
    if (drag?.mode === 'draw') {
      const d = drag.draft
      const big = d.kind === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.01
        : d.kind === 'freehand' ? d.points.length > 2
        : d.kind === 'rect' || d.kind === 'circle' ? Math.abs(d.w) > 0.005 && Math.abs(d.h) > 0.005
        : d.kind === 'polygon' ? pointsBox(d.points).w > 0.005 && pointsBox(d.points).h > 0.005
        : true
      if (big && d.kind === 'polygon' && d.disc && p.floor) {
        // The disc: its side and top in one group, the top selected.
        const { part: _p, ...dc } = d.disc
        const shapes = discShapes(p.floor, dc, { color: d.color, fill: d.fill ?? discFill(), fillOpacity: d.fillOpacity ?? 1, width: d.width, ...(d.dash ? { dash: d.dash } : {}) }, { side: uid(), top: d.id, group: uid() })
        p.onChange([...annsRef.current, ...shapes])
        p.onSelect(d.id)
        p.onMade?.()
      } else if (big) {
        const done = d.kind === 'circle' || d.kind === 'rect' ? normalizeBox(d) : d
        p.onChange([...annsRef.current, done])
        p.onSelect(done.id)
        p.onMade?.()
      }
    }
    setDrag(null)
  }

  const onDouble = (e: MouseEvent) => {
    if (!p.editable) return
    const pt = at(e)
    const q = pathRef.current
    if (q) {
      // The two clicks of a double-click each added a point; drop the duplicate, then finish.
      finishPath(q.points.length > 1 ? q.points.slice(0, -1) : q.points)
      return
    }
    const h = handleAt(pt)
    if (h?.kind === 'vertex' && selected) { replace(removeVertex(selected, Number(h.id.slice(1)))); return }
    const hit = hitTest(ctx2d(), p.annotations, pt[0], pt[1], p.size.w, p.size.h)
    if (hit?.kind === 'text') { p.onSelect(hit.id); setTextEdit({ id: hit.id, x: hit.x, y: hit.y, value: hit.text }) }
  }

  const commitText = () => {
    const t = textEdit
    setTextEdit(null)
    if (!t) return
    const value = t.value.trim()
    if (t.id) {
      // A box of a fixed width (a note line) stays when emptied: it is still there to write in.
      const stays = p.annotations.some(a => a.id === t.id && a.kind === 'text' && a.box?.width)
      p.onChange(value || stays ? p.annotations.map(a => (a.id === t.id && a.kind === 'text' ? { ...a, text: value } : a)) : p.annotations.filter(a => a.id !== t.id))
      return
    }
    if (!value) return
    const ts = textStyle(p.style)
    const a = applyStyle({ id: uid(), kind: 'text', color: ts.color, x: t.x, y: t.y, text: value, size: ts.size }, ts)
    p.onChange([...p.annotations, a])
    p.onSelect(a.id)
    p.onMade?.()
  }
  // Enter finishes; Alt+Enter or Shift+Enter starts a new line; Escape cancels.
  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (composing(e)) return // the IME's Enter confirms the conversion, not the text
    if (e.key === 'Enter' && (e.altKey || e.shiftKey)) {
      e.preventDefault()
      const el = e.currentTarget, at = el.selectionStart, v = el.value
      setTextEdit(t => (t ? { ...t, value: v.slice(0, at) + '\n' + v.slice(el.selectionEnd) } : t))
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = at + 1 })
    }
    else if (e.key === 'Enter') { e.preventDefault(); commitText() }
    else if (e.key === 'Escape') setTextEdit(null)
  }

  useEffect(() => { if (textEdit) requestAnimationFrame(() => inputRef.current?.focus()) }, [textEdit?.id, textEdit?.x, textEdit?.y])

  const editingText = textEdit?.id ? p.annotations.find(a => a.id === textEdit.id) : null
  const textSize = (editingText?.kind === 'text' ? editingText.size : p.style.size) * (p.size.h / 720)
  const cursor = p.tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="ann-layer" style={{ pointerEvents: p.editable ? 'auto' : 'none', cursor }}>
      <canvas ref={canvas} style={{ width: p.size.w, height: p.size.h }} data-testid="ann-canvas"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} />
      {path && <div className="ann-hint">{t('クリックで頂点を追加・ダブルクリックか Enter で確定・Backspace で1つ戻す・Esc で中止')}</div>}
      {textEdit && (
        <textarea
          ref={inputRef} className="ann-text-input" autoFocus value={textEdit.value} placeholder={t('テキスト（Alt+Enter で改行）')}
          rows={Math.max(1, textEdit.value.split('\n').length)}
          style={{ left: textEdit.x * p.size.w, top: textEdit.y * p.size.h, fontSize: textSize, ...editColors(editingText?.color ?? textStyle(p.style).color) }}
          onChange={e => setTextEdit({ ...textEdit, value: e.target.value })} onKeyDown={onTextKey} onBlur={commitText}
        />
      )}
    </div>
  )
}

// Office-like handles: squares for corners / ends / vertices, small circles for midpoints.
function drawHandle(ctx: CanvasRenderingContext2D, h: Handle, W: number, H: number): void {
  const x = h.x * W, y = h.y * H
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#4B61D1'
  ctx.fillStyle = h.kind === 'mid' ? 'rgba(255,255,255,0.75)' : '#FFFFFF'
  ctx.beginPath()
  if (h.kind === 'mid') ctx.arc(x, y, 4, 0, Math.PI * 2)
  else ctx.rect(x - 5, y - 5, 10, 10)
  ctx.fill(); ctx.stroke()
  ctx.restore()
}
