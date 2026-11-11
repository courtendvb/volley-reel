import { PaletteColor } from './PaletteColor'
import { restyleBoard } from '../../../shared/board'
import { ChartShow } from './BoardDialog'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { DEFAULT_MARKER_LAYOUT, DEFAULT_SCENE_LAYOUT, DEFAULT_VIDEO_LAYOUT, type CardLayout, type LogoPlace, type OverlaySettings } from '../../../shared/overlay'
import { cardBackground, cardKind, drawCard, type Box, type TitleBox } from '../../../shared/overlayDraw'
import { drawFlights, drawSlideMarks } from '../../../shared/court'
import type { Slide } from '../../../shared/reel'
import type { Card } from '../../../shared/video'
import { assetImage, logoImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'
import { t } from '../../../shared/i18n'

interface Props {
  size: { w: number; h: number }
  heatOpacity?: number // of a slide's heatmap
  card: Card
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
  onOwn: (l: CardLayout | undefined) => void // this card's own title place and size; undefined: back with its kind
  active: boolean // the title can be grabbed (else the objects on the card are being edited)
  target?: 'title' | 'logo' // what is grabbed: the title, or the logo on its own
}

type Drag = { mode: 'move' | 'scale'; from: [number, number]; start: CardLayout; box: Box; logo?: { x: number; y: number; h: number } }

const HANDLE = 9 // px, the resize corner

// The title card drawn over the video window, with its title in a frame: drag it to move, drag the
// corner to resize (a slide is only drawn: it has no title). Changes the video's layout for that kind of card (all scene cards, or all marker cards), or the card's own when it has one.
export function CardEditor({ heatOpacity, size, card, settings, onChange, onOwn, active, target = 'title' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<TitleBox | null>(null)
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
    if (card.slide) drawSlideMarks(ctx, size.w, size.h, card.slide, heatOpacity)
    if (card.slide?.flights) drawFlights(ctx, size.w, size.h, card.slide.flights, 1)
    const g = target === 'logo' ? b?.logo : b
    if (!active || !g) return // a slide has no title to move
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#FACC15'
    ctx.strokeRect(g.x - 6, g.y - 6, g.w + 12, g.h + 12)
    ctx.setLineDash([])
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FACC15'
    ctx.fillRect(g.x + g.w + 6 - HANDLE / 2, g.y + g.h + 6 - HANDLE / 2, HANDLE, HANDLE)
    ctx.strokeRect(g.x + g.w + 6 - HANDLE / 2, g.y + g.h + 6 - HANDLE / 2, HANDLE, HANDLE)
  }, [heatOpacity, size.w, size.h, card, settings, tick, active, target])

  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const set = (l: CardLayout) => (card.layout ? onOwn(l) : onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } }))

  // The logo's own place for this kind of card; the first drag takes it from beside the title.
  const setLogo = (l: LogoPlace | undefined) => {
    const k = cardKind(card), { [k]: _old, ...rest } = settings.titleCard.logos ?? {}
    onChange({ ...settings, titleCard: { ...settings.titleCard, logos: l === undefined ? rest : { ...rest, [k]: l } } })
  }
  const onDown = (e: PointerEvent) => {
    const b = target === 'logo' ? boxRef.current?.logo : boxRef.current
    if (!b) return
    const [x, y] = at(e)
    const corner = Math.abs(x - (b.x + b.w + 6)) <= HANDLE && Math.abs(y - (b.y + b.h + 6)) <= HANDLE
    const inside = x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6
    if (!corner && !inside) return
    try { canvas.current!.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
    drag.current = { mode: corner ? 'scale' : 'move', from: [x, y], start: layout, box: b,
      ...(target === 'logo' ? { logo: { x: (b.x + b.w / 2) / size.w, y: (b.y + b.h / 2) / size.h, h: b.h / size.h } } : {}) }
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, y] = at(e)
    if (d.logo) {
      const L = d.logo
      if (d.mode === 'move') setLogo({ ...L, x: clamp(L.x + (x - d.from[0]) / size.w, 0, 1), y: clamp(L.y + (y - d.from[1]) / size.h, 0, 1) })
      else if (d.box.w > 0) setLogo({ ...L, h: clamp(L.h * ((x - (d.box.x + d.box.w / 2)) / (d.box.w / 2)), 0.03, 0.9) }) // grows from its centre
      return
    }
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
// What can be put on a card as a picture: players' photos from the packs (the card's own players
// first) and the logos the library has for teams.
export interface CardPhotoChoice { key: string; label: string; own: boolean; pack: string; photo: string }
export interface CardInserts { photos: CardPhotoChoice[]; logos: { code: string; label: string }[]; onPhoto: (pack: string, photo: string) => void; onLogo: (code: string) => void }

export function CardEditBar({ card, settings, onChange, onOwn, onDone, tool, onTool, shown, onShown, title, nameTitle, onTitle, inserts }: {
  card: Card; settings: OverlaySettings; onChange: (s: OverlaySettings) => void; onOwn: (l: CardLayout | undefined) => void; onDone: () => void
  tool: 'objects' | 'title' | 'logo'; onTool: (t: 'objects' | 'title' | 'logo') => void; shown: boolean; onShown: (on: boolean) => void
  title: string; nameTitle: string; onTitle: (t: string) => void // title '' = the name (nameTitle)
  inserts?: CardInserts
}) {
  const kind = layoutKey(card), def = defaultLayout(card)
  const shared = settings.titleCard[kind] ?? def, own = !!card.layout
  const layout = card.layout ?? shared
  const set = (l: CardLayout) => (own ? onOwn(l) : onChange({ ...settings, titleCard: { ...settings.titleCard, [kind]: l } }))
  const what = cardKindName(card)
  // The opponent's logo apart from the title: for every card of this kind, like the title's place.
  const ck = cardKind(card), logoAt = settings.titleCard.logos?.[ck]
  const setLogo = (l: LogoPlace | undefined) => {
    const { [ck]: _old, ...rest } = settings.titleCard.logos ?? {}
    onChange({ ...settings, titleCard: { ...settings.titleCard, logos: l === undefined ? rest : { ...rest, [ck]: l } } })
  }
  return (
    <div className="card-edit-bar">
      <b>{what}{t('のタイトルカード')}{card.name ? t('「{0}」', card.name) : ''}</b>
      <label className="check"><input type="checkbox" checked={shown} onChange={e => onShown(e.target.checked)} /> {t('このカードを出す')}</label>
      <label className="check card-title-field" title={t('カードに出す文字。改行（Enter）で 2 段になる。空にすると名前を出す')}>{t('文字')}
        <textarea aria-label={t('カードの文字')} rows={Math.max(1, Math.min(3, (title || nameTitle).split('\n').length))} value={title} placeholder={nameTitle || t('（名前）')}
          onChange={e => onTitle(e.target.value)} /></label>
      <label className="check" title={t('すべてのタイトルカードと無地のスライドの背景色（この動画）')}>{t('背景')}
        <PaletteColor label={t('カードの背景色')} value={cardBackground(settings.titleCard, settings.theme)}
          onChange={c => onChange({ ...settings, titleCard: { ...settings.titleCard, background: c } })} /></label>
      {settings.titleCard.background && <button className="link" title={t('配色（テーマ）から決まる色に戻す')}
        onClick={() => { const { background: _bg, ...rest } = settings.titleCard; onChange({ ...settings, titleCard: rest }) }}>{t('配色に戻す')}</button>}
      <div className="segmented" role="radiogroup" aria-label={t('カードの編集')}>
        <button role="radio" aria-checked={tool === 'objects'} className={tool === 'objects' ? 'on' : ''} onClick={() => onTool('objects')}
          title={t('このカードに文字・画像・図形を置く')}>{t('図形・文字')}</button>
        <button role="radio" aria-checked={tool === 'title'} className={tool === 'title' ? 'on' : ''} onClick={() => onTool('title')}
          title={t('タイトルの位置と大きさ（この動画のすべての{0}のカード。「このカードだけ」にもできる）', what)}>{t('タイトルの位置')}</button>
        {card.opp && (
          <button role="radio" aria-checked={tool === 'logo'} className={tool === 'logo' ? 'on' : ''} onClick={() => onTool('logo')}
            title={t('相手チームのロゴの位置と大きさを、タイトルとは別に決める（この動画のすべての{0}のカード）', what)}>{t('ロゴ')}</button>
        )}
      </div>
      {tool === 'objects' && inserts && (inserts.photos.length > 0 || inserts.logos.length > 0) && (
        <>
          {inserts.photos.length > 0 && (
            <select value="" aria-label={t('選手の写真を入れる')} title={t('パックの選手の顔写真を、このカードに画像として入れる（あとで動かせる）')}
              onChange={e => { const c = inserts.photos.find(x => x.key === e.target.value); if (c) inserts.onPhoto(c.pack, c.photo) }}>
              <option value="">{t('＋ 選手の写真')}</option>
              {[true, false].map(own => {
                const list = inserts.photos.filter(x => x.own === own)
                return list.length ? <optgroup key={String(own)} label={own ? t('このカードのクリップの選手') : t('試合のほかの選手')}>
                  {list.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup> : null
              })}
            </select>
          )}
          {inserts.logos.length > 0 && (
            <select value="" aria-label={t('ロゴを入れる')} title={t('チームのロゴを、このカードに画像として入れる（あとで動かせる。ロゴは「設定」で登録）')}
              onChange={e => { if (e.target.value) inserts.onLogo(e.target.value) }}>
              <option value="">{t('＋ ロゴ')}</option>
              {inserts.logos.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          )}
        </>
      )}
      {tool === 'logo' && (
        <>
          <label className="check"><input type="checkbox" checked={logoAt !== 'hidden'} onChange={e => setLogo(e.target.checked ? undefined : 'hidden')} /> {t('ロゴを出す')}</label>
          {logoAt !== 'hidden' && <span className="muted">{logoAt ? t('ドラッグで移動、右下の角で大きさ（すべての{0}のカード）', what) : t('いまはタイトルの横（上）。ドラッグするとタイトルから離れて動かせます')}</span>}
          {logoAt && logoAt !== 'hidden' && (
            <>
              <label className="check">{t('大きさ')}
                <input type="range" aria-label={t('ロゴの大きさ')} min={3} max={90} step={1} value={Math.round(logoAt.h * 100)}
                  onChange={e => setLogo({ ...logoAt, h: +e.target.value / 100 })} />
                <span>{Math.round(logoAt.h * 100)}%</span></label>
              <button onClick={() => setLogo(undefined)} title={t('ロゴをタイトルの横（上）に戻し、タイトルと一緒に動かす')}>{t('タイトルに付ける')}</button>
            </>
          )}
        </>
      )}
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
// What can go on a slide from the court: from the play selected in the list.
// The bar for a data slide: a sheet of data, so only what makes up that sheet.
export function BoardEditBar({ slide, onChange, onBoard, onSave, onDone }: {
  slide: Slide; onChange: (s: Slide) => void; onBoard: () => void; onSave: (as: 'png' | 'pdf') => void; onDone: () => void
}) {
  const look = slide.charts?.[0]?.chart.look
  return (
    <div className="card-edit-bar">
      <b>{t('データスライド')}</b>
      <button onClick={onBoard} title={t('選手・アタックコード・人数などを変えて作り直します。手で足した図形とノートは残ります')}>{t('構成を変える…')}</button>
      <span className="spacer" />
      <button onClick={() => onSave('png')} title={t('このスライドを画像に書き出します')}>{t('PNG に書き出す…')}</button>
      <button onClick={() => onSave('pdf')} title={t('このシーンのカードとスライドを、順に 1 つの PDF にします')}>{t('PDF に書き出す…')}</button>
      <button className="primary" onClick={onDone}>{t('完了')}</button>
      <div className="slide-marks">
        {look && <ChartShow value={look} {...(slide.board ? { skill: slide.board.config.skill } : {})} onChange={p => onChange(restyleBoard(slide, p))} />}
        <span className="spacer" />
        <label className="check muted" title={t('動画の中で流すときの秒数')}>{t('動画では')}
          <input type="number" aria-label={t('動画で出す秒数')} min={0.5} max={120} step={0.5} value={slide.durationSec} style={{ width: 56 }}
            onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 0.5) onChange({ ...slide, durationSec: Math.min(120, n) }) }} />{t('秒')}</label>
      </div>
    </div>
  )
}

export type SlideMark = 'zones' | 'heat' | 'landings' | 'flights' | 'cones' | 'chart'

export function SlideEditBar({ slide, onChange, onReload, onDone, target, onMark, onSave }: {
  slide: Slide; onChange: (s: Slide) => void; onReload: (() => void) | null; onDone: () => void
  onSave: (as: 'png' | 'pdf') => void
  target: string | null // the play the court marks come from, in words; null: none to use
  onMark: (mark: SlideMark, on: boolean) => void
}) {
  const src = slide.bg.kind === 'image' ? slide.bg.source : undefined
  return (
    <div className="card-edit-bar">
      <b>{slide.charts || src ? t('カード') : t('スライド')}{src ? t('「{0}」', `${src.name}${src.page ? ` p.${src.page}` : ''}`) : slide.bg.kind === 'blank' ? t('（無地）') : t('（静止画）')}</b>
      <label className="check">{t('表示')}
        <input type="number" aria-label={t('スライドを出す秒数')} min={0.5} max={120} step={0.5} value={slide.durationSec} style={{ width: 64 }}
          onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 0.5) onChange({ ...slide, durationSec: Math.min(120, n) }) }} />{t('秒')}</label>
      <span className="muted">{t('下の道具で文字・図形・画像を置けます')}</span>
      {onReload && <button onClick={onReload} title={t('{0} を読み直す（PowerPoint で直して書き出し直したとき）', src?.path ?? '')}>{t('元のファイルを読み直す')}</button>}
      <span className="spacer" />
      <button onClick={() => onSave('png')} title={t('このカードを画像に書き出します')}>{t('PNG に書き出す…')}</button>
      <button onClick={() => onSave('pdf')} title={t('このシーンのカードとスライドを、順に 1 つの PDF にします')}>{t('PDF に書き出す…')}</button>
      <button className="primary" onClick={onDone}>{t('完了')}</button>
      <div className="slide-marks">
        <span className="court-row-label" title={t('左の一覧で選んだプレーから、コートの表示をこのスライドに載せます。載せた内容は固定され、あとでプレーを変えても変わりません')}>{t('コートの表示')}</span>
        {([['zones', t('ゾーン')], ['heat', t('ヒートマップ')], ['landings', t('落下点')], ['flights', t('サーブ軌道')], ['cones', t('コーン')], ['chart', t('チャート')]] as [SlideMark, string][]).map(([m, label]) => (
          <label key={m} className="check">
            <input type="checkbox" checked={!!slide[m]} disabled={!target && !slide[m]} onChange={e => onMark(m, e.target.checked)} /> {label}</label>
        ))}
        <span className="muted">{target ? t('元のプレー: {0}', target) : t('左の一覧でプレーを選び、コートを合わせた試合の動画を出すと使えます')}</span>
      </div>
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
