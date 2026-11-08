import { useEffect, useMemo, useRef, useState } from 'react'
import { drawAnnotation } from '../../../shared/annotation'
import { boardSlide, type BoardOptions, type BoardPhoto, type BoardPlayer, type BoardSkill } from '../../../shared/board'
import { drawChart } from '../../../shared/chart'
import { findPhoto } from '../../../shared/pack'
import { packPhotoImage, subscribeAssets } from '../assets'
import { usePacks } from '../packs'
import { prepareCanvas } from '../canvas'
import { t } from '../../../shared/i18n'

const W = 560, H = 315

// The card as it will be made, drawn while it is set out: the players' columns with their charts, set
// diagrams, rates, notes and photos (from the packs, once loaded), so a choice is seen before making it.
export function BoardPreview({ columns, skill, opts, photos: withPhotos }: { columns: BoardPlayer[]; skill: BoardSkill; opts: BoardOptions; photos: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const packs = usePacks()
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  // The pack photos that are loaded, under made-up ids the drawing looks up.
  const { photos, images } = useMemo(() => {
    const photos: Record<string, BoardPhoto> = {}, images = new Map<string, CanvasImageSource>()
    for (const p of withPhotos ? columns : []) {
      const found = findPhoto(packs, p.player, p.team), img = found ? packPhotoImage({ pack: found.pack, photo: found.player.photo }) : null
      if (!img || photos[p.key]) continue
      const id = `preview:${p.key}`
      photos[p.key] = { assetId: id, width: img.width, height: img.height }
      images.set(id, img)
    }
    return { photos, images }
  }, [columns, packs, withPhotos, tick])
  const slide = useMemo(() => (columns.length ? boardSlide(columns, skill, opts, photos) : null), [columns, skill, opts, photos])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, W, H)
    ctx.fillStyle = opts.background ?? '#FFFFFF'; ctx.fillRect(0, 0, W, H)
    if (!slide) return
    for (const ch of slide.charts) drawChart(ctx, ch.chart, { x: ch.x * W, y: ch.y * H, h: ch.h * H })
    for (const a of slide.annotations) drawAnnotation(ctx, a, W, H, id => images.get(id) ?? null)
  }, [slide, images, opts.background])
  return (
    <div className="board-preview">
      <canvas ref={canvas} style={{ width: W, height: H }} aria-label={t('スライドのプレビュー')} />
    </div>
  )
}
