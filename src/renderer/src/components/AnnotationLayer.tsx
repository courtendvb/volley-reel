import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import {
  bounds, drawAnnotation, hitTest, normalizeBox, translate, visibleAt, type Annotation, type AnnotationKind,
} from '../../../shared/annotation'
import { playback } from '../playback'

export type Tool = 'select' | AnnotationKind
export interface AnnStyle { color: string; width: number; size: number }

interface Props {
  size: { w: number; h: number }
  annotations: Annotation[]
  clip: { key: string; in: number; out: number }
  editable: boolean
  tool: Tool
  style: AnnStyle
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
}

type Drag =
  | { mode: 'move'; id: string; from: [number, number]; orig: Annotation }
  | { mode: 'draw'; draft: Annotation; from: [number, number] }

const uid = () => crypto.randomUUID()
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// Canvas over the video box. Shows the annotations visible at the playhead (others faint while
// editing, so they can still be picked) and handles drawing, selecting, moving and text editing.
export function AnnotationLayer(p: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [textEdit, setTextEdit] = useState<{ id: string | null; x: number; y: number; value: string } | null>(null)
  const [time, setTime] = useState(playback.current.time)
  useEffect(() => playback.subscribe(s => setTime(s.time)), [])

  const onScreen = playback.attachedKey === p.clip.key
  const shown = drag?.mode === 'draw' ? [...p.annotations, drag.draft] : p.annotations

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(p.size.w * dpr); c.height = Math.round(p.size.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, p.size.w, p.size.h)
    if (!onScreen) return
    for (const a of shown) {
      if (textEdit?.id === a.id) continue
      const vis = visibleAt(a, time, p.clip)
      if (!vis && !p.editable) continue
      ctx.globalAlpha = vis ? 1 : 0.3
      drawAnnotation(ctx, a, p.size.w, p.size.h)
    }
    ctx.globalAlpha = 1
    const sel = p.editable && p.selectedId ? shown.find(a => a.id === p.selectedId) : null
    if (sel) {
      const b = bounds(ctx, sel, p.size.w, p.size.h)
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4B61D1'
      ctx.strokeRect(b.x * p.size.w - 6, b.y * p.size.h - 6, b.w * p.size.w + 12, b.h * p.size.h + 12)
    }
  }, [shown, time, p.size.w, p.size.h, p.editable, p.selectedId, p.clip, onScreen, textEdit])

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }
  const ctx2d = () => canvas.current!.getContext('2d')!

  const onDown = (e: PointerEvent) => {
    if (!p.editable || textEdit) return
    try { canvas.current!.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
    const pt = at(e)
    if (p.tool === 'select') {
      const hit = hitTest(ctx2d(), p.annotations, pt[0], pt[1], p.size.w, p.size.h)
      p.onSelect(hit?.id ?? null)
      if (hit) setDrag({ mode: 'move', id: hit.id, from: pt, orig: hit })
      return
    }
    if (p.tool === 'text') { setTextEdit({ id: null, x: pt[0], y: pt[1], value: '' }); return }
    playback.pause()
    const base = { id: uid(), color: p.style.color }
    const draft: Annotation = p.tool === 'arrow' ? { ...base, kind: 'arrow', x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], width: p.style.width }
      : p.tool === 'freehand' ? { ...base, kind: 'freehand', points: [pt], width: p.style.width }
      : { ...base, kind: p.tool, x: pt[0], y: pt[1], w: 0, h: 0, width: p.style.width }
    setDrag({ mode: 'draw', draft, from: pt })
  }

  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const [x, y] = at(e)
    if (drag.mode === 'move') {
      const moved = translate(drag.orig, x - drag.from[0], y - drag.from[1])
      p.onChange(p.annotations.map(a => (a.id === drag.id ? moved : a)))
      return
    }
    const d = drag.draft
    const next: Annotation = d.kind === 'arrow' ? { ...d, x2: x, y2: y }
      : d.kind === 'freehand' ? { ...d, points: [...d.points, [x, y]] }
      : d.kind === 'text' ? d
      : { ...d, w: x - drag.from[0], h: y - drag.from[1] }
    setDrag({ ...drag, draft: next })
  }

  const onUp = () => {
    if (drag?.mode === 'draw') {
      const d = drag.draft
      const big = d.kind === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.01
        : d.kind === 'freehand' ? d.points.length > 2
        : d.kind === 'text' ? true
        : Math.abs(d.w) > 0.005 && Math.abs(d.h) > 0.005
      if (big) {
        const done = d.kind === 'circle' || d.kind === 'rect' ? normalizeBox(d) : d
        p.onChange([...p.annotations, done])
        p.onSelect(done.id)
      }
    }
    setDrag(null)
  }

  const onDouble = (e: MouseEvent) => {
    if (!p.editable) return
    const pt = at(e)
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
    const a: Annotation = { id: uid(), kind: 'text', color: p.style.color, x: t.x, y: t.y, text: value, size: p.style.size }
    p.onChange([...p.annotations, a])
    p.onSelect(a.id)
  }
  const onTextKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitText()
    else if (e.key === 'Escape') setTextEdit(null)
  }

  const editingText = textEdit?.id ? p.annotations.find(a => a.id === textEdit.id) : null
  const textSize = (editingText?.kind === 'text' ? editingText.size : p.style.size) * (p.size.h / 720)

  return (
    <div className="ann-layer" style={{ pointerEvents: p.editable ? 'auto' : 'none', cursor: p.tool === 'select' ? 'default' : 'crosshair' }}>
      <canvas ref={canvas} style={{ width: p.size.w, height: p.size.h }} data-testid="ann-canvas"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} />
      {textEdit && (
        <input
          className="ann-text-input" autoFocus value={textEdit.value} placeholder="テキスト"
          style={{ left: textEdit.x * p.size.w, top: textEdit.y * p.size.h, fontSize: textSize, color: editingText?.color ?? p.style.color }}
          onChange={e => setTextEdit({ ...textEdit, value: e.target.value })} onKeyDown={onTextKey} onBlur={commitText}
        />
      )}
    </div>
  )
}
