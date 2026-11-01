// Turns a video plan (scenes → marker groups → clips, with title cards) into an ExportJob, with
// every overlay drawn to PNG by the preview's functions (design §3.8). Main does the ffmpeg work.
import { drawAnnotation, type Annotation } from '../../shared/annotation'
import type { CaptionData, OverlaySettings, ScoreboardData } from '../../shared/overlay'
import { drawCaption, drawCard, drawScoreboard } from '../../shared/overlayDraw'
import type { Clip, Group } from '../../shared/reel'
import type { Chapter, PlanItem } from '../../shared/video'
import type { ExportItem, ExportJob, ExportLayer, Match } from '../../shared/types'
import type { ImageLookup } from '../../shared/annotation'
import { drawCourt, type CourtFit, type GridStyle, type PlayZones } from '../../shared/court'
import { logoImage, packPhotoImage, preloadAssets, preloadLogos, preloadPackPhotos } from './assets'

export const EXPORT_HEIGHT = 720

interface Deps {
  range: (c: Clip, sceneId: string) => { in: number; out: number } | null // a scene's own length defaults apply
  overlayData: (c: Clip) => { scoreboard: ScoreboardData; caption: CaptionData } | null
  matches: Record<string, Match>
  sceneAnnotations: (sceneId: string) => Annotation[] // 表示範囲: シーン全体
  videoAnnotations: Annotation[] // 表示範囲: 動画全体
  markerAnnotations: (sceneId: string, group: Group) => Annotation[] // 表示範囲: マーカー全体
  court?: (c: Clip) => { fit: CourtFit; zones: PlayZones | null } | null // the clip's fitted court and its play's zones
  courtStyle?: GridStyle // the grid's look, as in the player
}

// 720p at the source aspect, at the source frame rate when every match shares one (else 30).
export function exportFormat(clips: Clip[], matches: Record<string, Match>): { width: number; height: number; fpsStr: string } {
  const ms = [...new Set(clips.map(c => c.matchId))].map(id => matches[id]).filter(Boolean)
  const first = ms[0]
  const aspect = first?.width && first.height ? first.width / first.height : 16 / 9
  const width = Math.round((EXPORT_HEIGHT * aspect) / 2) * 2
  const rates = new Set(ms.map(m => m.fpsStr))
  return { width, height: EXPORT_HEIGHT, fpsStr: rates.size === 1 && first?.fpsStr ? first.fpsStr : '30' }
}

// chapters: where YouTube chapters start, as plan indexes (planVideoChapters); kept on the job as item indexes.
export async function buildExportJob(plan: PlanItem[], overlay: OverlaySettings, d: Deps, outPath: string, chapters?: Chapter[]): Promise<ExportJob> {
  const clips = plan.flatMap(p => (p.kind === 'clip' ? [p.clip] : []))
  const { width: W, height: H, fpsStr } = exportFormat(clips, d.matches)
  const sceneIds = [...new Set(plan.flatMap(p => (p.kind === 'clip' ? [p.sceneId] : [])))]
  const all = [...d.videoAnnotations, ...sceneIds.flatMap(d.sceneAnnotations), ...clips.flatMap(c => c.annotations),
    ...plan.flatMap(p => (p.kind === 'clip' ? d.markerAnnotations(p.sceneId, p.group) : [])),
    ...plan.flatMap(p => (p.kind === 'card' ? p.card.annotations ?? [] : []))]
  const slides = plan.flatMap(p => (p.kind === 'card' && p.card.slide?.bg.kind === 'image' ? [p.card.slide.bg.assetId] : []))
  const images = await preloadAssets([...slides, ...all.flatMap(a => (a.kind === 'image' ? [a.assetId] : []))])
  try {
    return await buildItems(plan, overlay, d, outPath, W, H, fpsStr, images.lookup, chapters)
  } finally {
    images.release()
  }
}

async function buildItems(plan: PlanItem[], overlay: OverlaySettings, d: Deps, outPath: string, W: number, H: number, fpsStr: string, assetImage: ImageLookup, chapters?: Chapter[]): Promise<ExportJob> {
  // One canvas for every layer of the job (each layer is drawn, encoded to PNG, then cleared).
  const png = pngOn(new OffscreenCanvas(W, H))
  await preloadLogos(plan.map(p => (p.kind === 'card' ? p.card.opp : null)))
  if (overlay.playerCaption.photo) await preloadPackPhotos(plan.map(p => (p.kind === 'clip' ? d.overlayData(p.clip)?.caption.photo : null)))
  const items: ExportItem[] = []
  const firstItem: number[] = [] // per plan index: the job item it starts at (a skipped clip starts at the next)
  for (const p of plan) {
    firstItem.push(items.length)
    if (p.kind === 'card') {
      items.push({ kind: 'card', durationSec: p.durationSec, png: await png(ctx => {
        drawCard(ctx, W, H, p.card, overlay.titleCard, overlay.theme, logoImage(p.card.opp), assetImage)
        for (const a of p.card.annotations ?? []) drawAnnotation(ctx, a, W, H, assetImage)
      }) })
      continue
    }
    const c = p.clip, r = d.range(c, p.sceneId)
    if (!r) continue
    items.push({ kind: 'clip', matchId: c.matchId, in: r.in, out: r.out, layers: await clipLayers(c, p.sceneId, p.group, r, overlay, d, W, H, png, assetImage) })
  }
  // Chapters left with nothing in them (every clip skipped) are dropped.
  const marks = (chapters ?? []).map(c => ({ item: firstItem[c.at] ?? items.length, title: c.title }))
    .filter((c, i, all) => c.item < items.length && (all[i + 1]?.item ?? items.length) > c.item)
  return { outPath, width: W, height: H, fpsStr, items, ...(overlay.transition.fade ? { fadeSec: overlay.transition.durationSec } : {}),
    ...(marks.length ? { chapters: marks } : {}) }
}

// One layer for everything shown for the whole clip (the court, auto overlays, annotations on top),
// plus one per distinct show/hide window, switched by ffmpeg's enable='between(t,a,b)'.
async function clipLayers(c: Clip, sceneId: string, group: Group, r: { in: number; out: number }, overlay: OverlaySettings, d: Deps, W: number, H: number,
  png: Png, assetImage: ImageLookup): Promise<ExportLayer[]> {
  const data = d.overlayData(c)
  const o = c.overlayOverride
  const showSb = !!data && overlay.scoreboard.enabled && !o?.scoreboard?.hidden
  const showCap = !!data && overlay.playerCaption.enabled && !o?.playerCaption?.hidden
  const court = overlay.court.enabled && d.courtStyle ? d.court?.(c) ?? null : null
  const window = (a: Annotation) => ({ from: Math.max(0, (a.showFrom ?? r.in) - r.in), to: Math.min(r.out, a.showTo ?? r.out) - r.in })
  const fades = (a: Annotation) => !!(a.fadeIn || a.fadeOut)
  // Objects shown for the whole clip without a fade share one layer; the rest go by window (and fade).
  const whole = (a: Annotation) => { const w = window(a); return !fades(a) && w.from <= 0.001 && w.to >= r.out - r.in - 0.001 }

  // The video's objects at the bottom, then the scene's, the marker group's, the clip's (as in the editor).
  const anns = [...d.videoAnnotations, ...d.sceneAnnotations(sceneId), ...d.markerAnnotations(sceneId, group), ...c.annotations]
  const layers: ExportLayer[] = []
  const always = anns.filter(whole)
  if (court || showSb || showCap || always.length) {
    layers.push({
      png: await png(ctx => {
        // The court lies on the floor: under the scoreboard, the caption and every object.
        if (court) drawCourt(ctx, W, H, court.fit, d.courtStyle!, court.zones)
        if (showSb) drawScoreboard(ctx, W, H, data!.scoreboard, overlay.scoreboard, overlay.theme)
        if (showCap) drawCaption(ctx, W, H, data!.caption, overlay.playerCaption, overlay.theme, packPhotoImage(data!.caption.photo))
        for (const a of always) drawAnnotation(ctx, a, W, H, assetImage)
      }),
    })
  }
  const timed = new Map<string, Annotation[]>()
  for (const a of anns) {
    if (whole(a)) continue
    const w = window(a)
    if (w.to <= w.from) continue // window falls outside the trimmed clip
    const k = `${w.from.toFixed(3)}|${w.to.toFixed(3)}|${a.fadeIn ?? 0}|${a.fadeOut ?? 0}`
    timed.set(k, [...(timed.get(k) ?? []), a])
  }
  for (const [k, list] of timed) {
    const [from, to, fadeIn, fadeOut] = k.split('|').map(Number)
    layers.push({ from, to, ...(fadeIn ? { fadeIn } : {}), ...(fadeOut ? { fadeOut } : {}), png: await png(ctx => list.forEach(a => drawAnnotation(ctx, a, W, H, assetImage))) })
  }
  return layers
}

type Png = (draw: (ctx: OffscreenCanvasRenderingContext2D) => void) => Promise<Uint8Array>

function pngOn(canvas: OffscreenCanvas): Png {
  const ctx = canvas.getContext('2d')!
  return async draw => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    draw(ctx)
    ctx.restore()
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }
}
