import { useEffect, useMemo, useRef, useState } from 'react'
import { drawAnnotation } from '../../../shared/annotation'
import { boardSlide, type BoardOptions, type BoardPhoto, type BoardPlayer, type BoardSkill } from '../../../shared/board'
import { drawChart } from '../../../shared/chart'
import { drawSetChart } from '../../../shared/setChart'
import { findPhoto } from '../../../shared/pack'
import { logoImage, packPhotoImage, subscribeAssets } from '../assets'
import { logoKey } from '../../../shared/serveTargetBoard'
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
    // A serve target or a rotation: the team's logo, from the library.
    // A comparison: both teams' logos.
    const teams = !withPhotos ? [] : skill === 'C' ? [opts.compare?.left.code, opts.compare?.right.code] : skill === 'T' || skill === 'R' ? [columns[0]?.team] : []
    for (const team of teams) {
      const logo = team ? logoImage(team) : null
      if (team && logo) { photos[logoKey(team)] = { assetId: `preview:logo:${team}`, width: logo.width, height: logo.height }; images.set(`preview:logo:${team}`, logo) }
    }
    return { photos, images }
  }, [columns, packs, withPhotos, tick, skill, opts.compare])
  const slide = useMemo(() => (columns.length || (skill === 'C' && opts.compare) ? boardSlide(columns, skill, opts, photos) : null), [columns, skill, opts, photos])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, W, H)
    ctx.fillStyle = opts.background ?? '#FFFFFF'; ctx.fillRect(0, 0, W, H)
    if (!slide) return
    for (const ch of slide.charts) drawChart(ctx, ch.chart, { x: ch.x * W, y: ch.y * H, h: ch.h * H })
    for (const ch of slide.setCharts ?? []) drawSetChart(ctx, ch.chart, { x: ch.x * W, y: ch.y * H, h: ch.h * H }, 'auto', false, !!ch.rich)
    for (const a of slide.annotations) drawAnnotation(ctx, a, W, H, id => images.get(id) ?? null)
  }, [slide, images, opts.background])
  return (
    <div className="board-preview">
      <canvas ref={canvas} style={{ width: W, height: H }} aria-label={t('スライドのプレビュー')} />
    </div>
  )
}
