import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, DEFAULT_VIDEO_LAYOUT, type CardLayout, type OverlaySettings } from '../../../shared/overlay'
import { cardBackground, drawCard, type Box } from '../../../shared/overlayDraw'
import { drawFlights, drawHeat } from '../../../shared/court'
import type { Slide } from '../../../shared/reel'
import type { Card } from '../../../shared/video'
import { assetImage, logoImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'
import { t } from '../../../shared/i18n'

interface Props {
  size: { w: number; h: number }
  card: Card
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
  onOwn: (l: CardLayout | undefined) => void // this card's own title place and size; undefined: back with its kind
  active: boolean // the title can be grabbed (else the objects on the card are being edited)
}

type Drag = { mode: 'move' | 'scale'; from: [number, number]; start: CardLayout; box: Box }

const HANDLE = 9 // px, the resize corner

// The title card drawn over the video window, with its title in a frame: drag it to move, drag the
// corner to resize (a slide is only drawn: it has no title). Changes the video's layout for that kind of card (all scene cards, or all marker cards), or the card's own when it has one.
export function CardEditor({ size, card, settings, onChange, onOwn, active }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<Box | null>(null)
  const drag = useRef<Drag | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  const kind = layoutKey(card)
  const layout = card.layout ?? settings.titleCard[kind] ?? defaultLayout(card)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, size.w, size.h)
    const b = drawCard(ctx, size.w, size.h, card, settings.titleCard, settings.theme, logoImage(card.opp), assetImage)
    boxRef.current = b
    if (card.slide?.heat) drawHeat(ctx, size.w, size.h, card.slide.heat)
    if (card.slide?.flights) drawFlights(ctx, size.w, size.h, card.slide.flights, 1)
    if (!active || !b) return // a slide has no title to move
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
  const set = (l: CardLayout) => (card.layout ? onOwn(l) : onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } }))

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
const cardKindName = (card: Card) => (card.video ? t('動画') : card.marker === null ? t('シーン') : t('マーカー'))

// Below the video while a card is being edited: whether it is shown, its text (the name unless set;
// a line break makes a second line), the background of every card, what the pointer edits (the
// objects on this card, or the title's place and size for every card of this kind), reset and done.
export function CardEditBar({ card, settings, onChange, onOwn, onDone, tool, onTool, shown, onShown, title, nameTitle, onTitle }: {
  card: Card; settings: OverlaySettings; onChange: (s: OverlaySettings) => void; onOwn: (l: CardLayout | undefined) => void; onDone: () => void
  tool: 'objects' | 'title'; onTool: (t: 'objects' | 'title') => void; shown: boolean; onShown: (on: boolean) => void
  title: string; nameTitle: string; onTitle: (t: string) => void // title '' = the name (nameTitle)
}) {
  const kind = layoutKey(card), def = defaultLayout(card)
  const shared = settings.titleCard[kind] ?? def, own = !!card.layout
  const layout = card.layout ?? shared
  const set = (l: CardLayout) => (own ? onOwn(l) : onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } }))
  const what = cardKindName(card)
  return (
    <div className="card-edit-bar">
      <b>{what}{t('のタイトルカード')}{card.name ? t('「{0}」', card.name) : ''}</b>
      <label className="check"><input type="checkbox" checked={shown} onChange={e => onShown(e.target.checked)} /> {t('このカードを出す')}</label>
      <label className="check card-title-field" title={t('カードに出す文字。改行（Enter）で 2 段になる。空にすると名前を出す')}>{t('文字')}
        <textarea aria-label={t('カードの文字')} rows={Math.max(1, Math.min(3, (title || nameTitle).split('\n').length))} value={title} placeholder={nameTitle || t('（名前）')}
          onChange={e => onTitle(e.target.value)} /></label>
      <label className="check" title={t('すべてのタイトルカードと無地のスライドの背景色（この動画）')}>{t('背景')}
        <input type="color" aria-label={t('カードの背景色')} value={cardBackground(settings.titleCard, settings.theme)}
          onChange={e => onChange({ ...settings, titleCard: { ...settings.titleCard, background: e.target.value } })} /></label>
      {settings.titleCard.background && <button className="link" title={t('配色（テーマ）から決まる色に戻す')}
        onClick={() => { const { background: _bg, ...rest } = settings.titleCard; onChange({ ...settings, titleCard: rest }) }}>{t('配色に戻す')}</button>}
      <div className="segmented" role="radiogroup" aria-label={t('カードの編集')}>
        <button role="radio" aria-checked={tool === 'objects'} className={tool === 'objects' ? 'on' : ''} onClick={() => onTool('objects')}
          title={t('このカードに文字・画像・図形を置く')}>{t('図形・文字')}</button>
        <button role="radio" aria-checked={tool === 'title'} className={tool === 'title' ? 'on' : ''} onClick={() => onTool('title')}
          title={t('タイトルの位置と大きさ（この動画のすべての{0}のカード。「このカードだけ」にもできる）', what)}>{t('タイトルの位置')}</button>
      </div>
      {tool === 'title' && (
        <>
          <label className="check" title={t('このカードだけ別の位置と大きさにする（文字が長くて崩れるときなど）。外すと同じ種類のカードの設定に戻る')}>
            <input type="checkbox" checked={own} onChange={e => onOwn(e.target.checked ? layout : undefined)} /> {t('このカードだけ')}</label>
          <span className="muted">{own ? t('ドラッグで移動、右下の角で大きさ（このカードだけ）') : <>{t('ドラッグで移動、右下の角で大きさ（すべての')}{what}{t('のカード）')}</>}</span>
          <label className="check">{t('大きさ')}
            <input type="range" aria-label={t('タイトルの大きさ')} min={30} max={300} step={5} value={Math.round(layout.scale * 100)}
              onChange={e => set({ ...layout, scale: +e.target.value / 100 })} />
            <span>{Math.round(layout.scale * 100)}%</span></label>
          {!own && <button onClick={() => set(def)}>{t('元に戻す')}</button>}
        </>
      )}
      <span className="spacer" />
      <button className="primary" onClick={onDone}>{t('完了')}</button>
    </div>
  )
}

// Below the video while a slide is being edited: how long it stays up, reading its file again, done.
export function SlideEditBar({ slide, onChange, onReload, onDone }: {
  slide: Slide; onChange: (s: Slide) => void; onReload: (() => void) | null; onDone: () => void
}) {
  const src = slide.bg.kind === 'image' ? slide.bg.source : undefined
  return (
    <div className="card-edit-bar">
      <b>{t('スライド')}{src ? t('「{0}」', `${src.name}${src.page ? ` p.${src.page}` : ''}`) : slide.bg.kind === 'blank' ? t('（無地）') : t('（静止画）')}</b>
      <label className="check">{t('表示')}
        <input type="number" aria-label={t('スライドを出す秒数')} min={0.5} max={120} step={0.5} value={slide.durationSec} style={{ width: 64 }}
          onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 0.5) onChange({ ...slide, durationSec: Math.min(120, n) }) }} />{t('秒')}</label>
      <span className="muted">{t('下の道具で文字・図形・画像を置けます')}</span>
      {onReload && <button onClick={onReload} title={t('{0} を読み直す（PowerPoint で直して書き出し直したとき）', src?.path ?? '')}>{t('元のファイルを読み直す')}</button>}
      <span className="spacer" />
      <button className="primary" onClick={onDone}>{t('完了')}</button>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
