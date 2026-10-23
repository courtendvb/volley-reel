import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import {
  applyStyle, bounds, drawAnnotation, hitTest, normalizeBox, translate, visibleAt,
  type Annotation, type AnnotationKind, type StylePatch,
} from '../../../shared/annotation'
import { cropHandle, dragHandle, fullRect, handlesOf, panCrop, pointsBox, removeVertex, trianglePoints, zoomCrop, type BoxHandle, type Handle } from '../../../shared/annotationEdit'
import { assetImage, subscribeAssets } from '../assets'
import { playback } from '../playback'
import type { AnnScope } from '../../../shared/annotationScope'

const SCOPE_COLOR: Record<AnnScope, string> = { clip: '#4B61D1', scene: '#D97706', video: '#059669' }
const SCOPE_TAG: Record<AnnScope, string> = { clip: '', scene: 'シーン全体', video: '動画全体' }

// A triangle is drawn like a box and stored as a polygon.
export type Tool = 'select' | AnnotationKind | 'triangle'
// The style for the next shape; also what the format panel shows when nothing is selected.
// textColor: new text is white by default while shapes are red, so text has its own color.
export type AnnStyle = StylePatch & { color: string; width: number; size: number; textColor?: string }
export const textStyle = (s: AnnStyle): AnnStyle => ({ ...s, color: s.textColor ?? '#FFFFFF' })

interface Props {
  size: { w: number; h: number }
  annotations: Annotation[]
  clip: { key: string; in: number; out: number }
  editable: boolean
  tool: Tool
  style: AnnStyle
  selectedId: string | null
  scopeOf?: (id: string) => AnnScope | null // where each object lives (frame color and tag)
  editPoints: boolean // Office's "Edit Points": vertex handles instead of the box
  cropping: boolean // the selected picture is being cropped: handles move the frame, dragging moves the picture
  always?: boolean // a title card's objects: shown whatever the video is doing
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
}

type PathDraft = { kind: 'polyline' | 'polygon'; points: [number, number][]; hover: [number, number] | null }

type Drag =
  | { mode: 'move'; id: string; from: [number, number]; orig: Annotation }
  | { mode: 'handle'; id: string; handle: string }
  | { mode: 'draw'; draft: Annotation; from: [number, number] }
  | { mode: 'crop'; id: string; handle: BoxHandle; full: Box }
  | { mode: 'pan'; id: string; from: [number, number]; orig: ImageAnn; full: Box }

type ImageAnn = Extract<Annotation, { kind: 'image' }>
type Box = { x: number; y: number; w: number; h: number }

const uid = () => crypto.randomUUID()
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
  const inputRef = useRef<HTMLInputElement>(null)
  // A polyline / polygon being drawn: fixed points plus the rubber-band point under the cursor.
  const [path, setPathState] = useState<PathDraft | null>(null)
  // Mirrors path so finishing reads the latest points and runs once, outside any state updater.
  const pathRef = useRef<PathDraft | null>(null)
  const setPath = (q: PathDraft | null) => { pathRef.current = q; setPathState(q) }
  const [textEdit, setTextEdit] = useState<{ id: string | null; x: number; y: number; value: string } | null>(null)
  const [assetTick, setAssetTick] = useState(0) // redraw when an image finishes loading
  useEffect(() => subscribeAssets(() => setAssetTick(n => n + 1)), [])
  const [time, setTime] = useState(playback.current.time)
  // A title card covers the frame during a through-play: the clip's objects are not on it.
  const [onCard, setOnCard] = useState(!!playback.current.card)
  useEffect(() => playback.subscribe(s => { setTime(s.time); setOnCard(!!s.card) }), [])

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
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(p.size.w * dpr); c.height = Math.round(p.size.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, p.size.w, p.size.h)
    if (!onScreen || (onCard && !p.always)) return
    for (const a of shown) {
      if (textEdit?.id === a.id) continue
      const vis = visibleAt(a, time, p.clip) || a.id === 'path-draft'
      if (!vis && !p.editable) continue
      ctx.globalAlpha = vis ? 1 : 0.3
      if (cropImg && a.id === cropImg.id) {
        // While cropping, the whole picture shows faintly around the frame.
        const img = assetImage(cropImg.assetId), f = fullRect(cropImg)
        if (img) { ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(img, f.x * p.size.w, f.y * p.size.h, f.w * p.size.w, f.h * p.size.h); ctx.restore() }
      }
      drawAnnotation(ctx, a, p.size.w, p.size.h, assetImage)
    }
    ctx.globalAlpha = 1
    if (selected) {
      const b = bounds(ctx, selected, p.size.w, p.size.h)
      const scope = p.scopeOf?.(selected.id) ?? 'clip'
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = SCOPE_COLOR[scope]
      ctx.strokeRect(b.x * p.size.w - 6, b.y * p.size.h - 6, b.w * p.size.w + 12, b.h * p.size.h + 12)
      ctx.setLineDash([])
      if (SCOPE_TAG[scope]) {
        ctx.font = 'bold 11px "Segoe UI", "Yu Gothic UI", sans-serif'
        const tw = ctx.measureText(SCOPE_TAG[scope]).width + 10, tx = b.x * p.size.w - 6, ty = Math.max(0, b.y * p.size.h - 24)
        ctx.fillStyle = SCOPE_COLOR[scope]; ctx.fillRect(tx, ty, tw, 17)
        ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle'; ctx.fillText(SCOPE_TAG[scope], tx + 5, ty + 9)
      }
      for (const h of handles) drawHandle(ctx, h, p.size.w, p.size.h)
    }
  }, [shown, time, p.size.w, p.size.h, p.editable, selected, handles, p.clip, onScreen, textEdit, assetTick, onCard, p.scopeOf])

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
  const cropRef = useRef<ImageAnn | null>(null)
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
  }

  const onDown = (e: PointerEvent) => {
    if (!p.editable || textEdit) return
    const pt = at(e)
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
      p.onSelect(hit?.id ?? null)
      if (hit) setDrag({ mode: 'move', id: hit.id, from: pt, orig: hit })
      return
    }
    playback.pause()
    const base = { id: uid(), color: p.style.color }
    const draft: Annotation = p.tool === 'arrow' ? { ...base, kind: 'arrow', x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], width: p.style.width }
      : p.tool === 'freehand' ? { ...base, kind: 'freehand', points: [pt], width: p.style.width }
      : p.tool === 'triangle' ? { ...base, kind: 'polygon', points: trianglePoints(pt, pt), width: p.style.width }
      : { ...base, kind: p.tool as 'rect' | 'circle', x: pt[0], y: pt[1], w: 0, h: 0, width: p.style.width }
    setDrag({ mode: 'draw', draft: applyStyle(draft, p.style), from: pt })
  }

  const onMove = (e: PointerEvent) => {
    const [x, y] = at(e)
    if (pathRef.current) { setPath({ ...pathRef.current, hover: [x, y] }); return }
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'move') {
      replace(translate(drag.orig, x - drag.from[0], y - drag.from[1]))
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
      const r = dragHandle(cur, drag.handle, x, y, { keepAspect: e.shiftKey })
      replace(r.a)
      if (r.id !== drag.handle) setDrag({ ...drag, handle: r.id }) // a midpoint became a vertex
      return
    }
    const d = drag.draft
    const next: Annotation = d.kind === 'arrow' ? { ...d, x2: x, y2: y }
      : d.kind === 'freehand' ? { ...d, points: [...d.points, [x, y]] }
      : d.kind === 'rect' || d.kind === 'circle' ? { ...d, w: x - drag.from[0], h: y - drag.from[1] }
      : d.kind === 'polygon' ? { ...d, points: trianglePoints(drag.from, [x, y]) }
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
      if (big) {
        const done = d.kind === 'circle' || d.kind === 'rect' ? normalizeBox(d) : d
        p.onChange([...annsRef.current, done])
        p.onSelect(done.id)
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
      p.onChange(value ? p.annotations.map(a => (a.id === t.id && a.kind === 'text' ? { ...a, text: value } : a)) : p.annotations.filter(a => a.id !== t.id))
      return
    }
    if (!value) return
    const ts = textStyle(p.style)
    const a = applyStyle({ id: uid(), kind: 'text', color: ts.color, x: t.x, y: t.y, text: value, size: ts.size }, ts)
    p.onChange([...p.annotations, a])
    p.onSelect(a.id)
  }
  const onTextKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitText()
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
      {path && <div className="ann-hint">クリックで頂点を追加・ダブルクリックか Enter で確定・Backspace で1つ戻す・Esc で中止</div>}
      {textEdit && (
        <input
          ref={inputRef} className="ann-text-input" autoFocus value={textEdit.value} placeholder="テキスト"
          style={{ left: textEdit.x * p.size.w, top: textEdit.y * p.size.h, fontSize: textSize, color: editingText?.color ?? textStyle(p.style).color }}
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
