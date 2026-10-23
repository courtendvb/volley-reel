import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, DEFAULT_VIDEO_LAYOUT, type CardLayout, type OverlaySettings } from '../../../shared/overlay'
import { drawTitleCard, type Box } from '../../../shared/overlayDraw'
import type { Card } from '../../../shared/video'
import { logoImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'

interface Props {
  size: { w: number; h: number }
  card: Card
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
  active: boolean // the title can be grabbed (else the objects on the card are being edited)
}

type Drag = { mode: 'move' | 'scale'; from: [number, number]; start: CardLayout; box: Box }

const HANDLE = 9 // px, the resize corner

// The title card drawn over the video window, with its title in a frame: drag it to move, drag the
// corner to resize. Changes the video's layout for that kind of card (all scene cards, or all marker cards).
export function CardEditor({ size, card, settings, onChange, active }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<Box | null>(null)
  const drag = useRef<Drag | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  const kind = layoutKey(card)
  const layout = settings.titleCard[kind] ?? defaultLayout(card)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, size.w, size.h)
    const b = drawTitleCard(ctx, size.w, size.h, card, settings.titleCard, settings.theme, logoImage(card.opp))
    boxRef.current = b
    if (!active) return
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#FACC15'
    ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12)
    ctx.setLineDash([])
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FACC15'
    ctx.fillRect(b.x + b.w + 6 - HANDLE / 2, b.y + b.h + 6 - HANDLE / 2, HANDLE, HANDLE)
    ctx.strokeRect(b.x + b.w + 6 - HANDLE / 2, b.y + b.h + 6 - HANDLE / 2, HANDLE, HANDLE)
  }, [size.w, size.h, card, settings, tick, active])

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
    <canvas ref={canvas} className="card-editor" data-testid="card-editor" style={{ width: size.w, height: size.h, cursor: active ? 'move' : 'default', pointerEvents: active ? 'auto' : 'none' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
  )
}

const layoutKey = (card: Card): 'videoLayout' | 'sceneLayout' | 'markerLayout' => (card.video ? 'videoLayout' : card.marker === null ? 'sceneLayout' : 'markerLayout')
const defaultLayout = (card: Card) => (card.video ? DEFAULT_VIDEO_LAYOUT : card.marker === null ? DEFAULT_SCENE_LAYOUT : DEFAULT_MARKER_LAYOUT)
const cardKindName = (card: Card) => (card.video ? '動画' : card.marker === null ? 'シーン' : 'マーカー')

// Below the video while a card is being edited: whether it is shown, what the pointer edits (the
// objects on this card, or the title's place and size for every card of this kind), reset and done.
export function CardEditBar({ card, settings, onChange, onDone, tool, onTool, shown, onShown }: {
  card: Card; settings: OverlaySettings; onChange: (s: OverlaySettings) => void; onDone: () => void
  tool: 'objects' | 'title'; onTool: (t: 'objects' | 'title') => void; shown: boolean; onShown: (on: boolean) => void
}) {
  const kind = layoutKey(card), def = defaultLayout(card)
  const layout = settings.titleCard[kind] ?? def
  const set = (l: CardLayout) => onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } })
  const what = cardKindName(card)
  return (
    <div className="card-edit-bar">
      <b>{what}のタイトルカード{card.name ? `「${card.name}」` : ''}</b>
      <label className="check"><input type="checkbox" checked={shown} onChange={e => onShown(e.target.checked)} /> このカードを出す</label>
      <div className="segmented" role="radiogroup" aria-label="カードの編集">
        <button role="radio" aria-checked={tool === 'objects'} className={tool === 'objects' ? 'on' : ''} onClick={() => onTool('objects')}
          title="このカードに文字・画像・図形を置く">図形・文字</button>
        <button role="radio" aria-checked={tool === 'title'} className={tool === 'title' ? 'on' : ''} onClick={() => onTool('title')}
          title={`タイトルの位置と大きさ（この動画のすべての${what}のカード）`}>タイトルの位置</button>
      </div>
      {tool === 'title' && (
        <>
          <span className="muted">ドラッグで移動、右下の角で大きさ（すべての{what}のカード）</span>
          <label className="check">大きさ
            <input type="range" aria-label="タイトルの大きさ" min={30} max={300} step={5} value={Math.round(layout.scale * 100)}
              onChange={e => set({ ...layout, scale: +e.target.value / 100 })} />
            <span>{Math.round(layout.scale * 100)}%</span></label>
          <button onClick={() => set(def)}>元に戻す</button>
        </>
      )}
      <span className="spacer" />
      <button className="primary" onClick={onDone}>完了</button>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
