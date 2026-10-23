import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, type CardLayout, type OverlaySettings } from '../../../shared/overlay'
import { drawTitleCard, type Box } from '../../../shared/overlayDraw'
import type { Card } from '../../../shared/video'
import { logoImage, subscribeAssets } from '../assets'

interface Props {
  size: { w: number; h: number }
  card: Card
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
}

type Drag = { mode: 'move' | 'scale'; from: [number, number]; start: CardLayout; box: Box }

const HANDLE = 9 // px, the resize corner

// The title card drawn over the video window, with its title in a frame: drag it to move, drag the
// corner to resize. Changes the video's layout for that kind of card (all scene cards, or all marker cards).
export function CardEditor({ size, card, settings, onChange }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<Box | null>(null)
  const drag = useRef<Drag | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  const kind = card.marker === null ? 'sceneLayout' : 'markerLayout'
  const layout = settings.titleCard[kind] ?? (card.marker === null ? DEFAULT_SCENE_LAYOUT : DEFAULT_MARKER_LAYOUT)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const b = drawTitleCard(ctx, size.w, size.h, card, settings.titleCard, settings.theme, logoImage(card.opp))
    boxRef.current = b
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#FACC15'
    ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12)
    ctx.setLineDash([])
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FACC15'
    ctx.fillRect(b.x + b.w + 6 - HANDLE / 2, b.y + b.h + 6 - HANDLE / 2, HANDLE, HANDLE)
    ctx.strokeRect(b.x + b.w + 6 - HANDLE / 2, b.y + b.h + 6 - HANDLE / 2, HANDLE, HANDLE)
  }, [size.w, size.h, card, settings, tick])

  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const set = (l: CardLayout) => onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } })

  const onDown = (e: PointerEvent) => {
    const b = boxRef.current
    if (!b) return
    const [x, y] = at(e)
    const corner = Math.abs(x - (b.x + b.w + 6)) <= HANDLE && Math.abs(y - (b.y + b.h + 6)) <= HANDLE
    const inside = x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6
    if (!corner && !inside) return
    try { canvas.current!.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
    drag.current = { mode: corner ? 'scale' : 'move', from: [x, y], start: layout, box: b }
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, y] = at(e)
    if (d.mode === 'move') {
      set({ ...d.start, x: clamp(d.start.x + (x - d.from[0]) / size.w, 0, 1), y: clamp(d.start.y + (y - d.from[1]) / size.h, 0, 1) })
      return
    }
    // Resize by the corner: marker titles grow from their top-left, scene titles from their center.
    const w0 = card.marker === null ? d.box.w / 2 : d.box.w
    const w1 = card.marker === null ? x - (d.box.x + d.box.w / 2) : x - d.box.x
    if (w0 > 0) set({ ...d.start, scale: clamp(d.start.scale * (w1 / w0), 0.3, 3) })
  }
  const onUp = () => { drag.current = null }

  return (
    <canvas ref={canvas} className="card-editor" data-testid="card-editor" style={{ width: size.w, height: size.h, cursor: 'move' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
  )
}

// Below the video while a card is being edited: what is being edited, its size, reset and done.
export function CardEditBar({ card, settings, onChange, onDone }: { card: Card; settings: OverlaySettings; onChange: (s: OverlaySettings) => void; onDone: () => void }) {
  const kind = card.marker === null ? 'sceneLayout' : 'markerLayout'
  const def = card.marker === null ? DEFAULT_SCENE_LAYOUT : DEFAULT_MARKER_LAYOUT
  const layout = settings.titleCard[kind] ?? def
  const set = (l: CardLayout) => onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } })
  return (
    <div className="card-edit-bar">
      <b>{card.marker === null ? 'シーン' : 'マーカー'}のタイトルカードの見た目</b>
      <span className="muted">この動画のすべての{card.marker === null ? 'シーン' : 'マーカー'}のカードに使います。タイトルをドラッグで移動、右下の角で大きさ</span>
      <span className="spacer" />
      <label className="check">大きさ
        <input type="range" aria-label="タイトルの大きさ" min={30} max={300} step={5} value={Math.round(layout.scale * 100)}
          onChange={e => set({ ...layout, scale: +e.target.value / 100 })} />
        <span>{Math.round(layout.scale * 100)}%</span></label>
      <button onClick={() => set(def)}>元に戻す</button>
      <button className="primary" onClick={onDone}>完了</button>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
