// Turns a video plan (scenes → marker groups → clips, with title cards) into an ExportJob, with
// every overlay drawn to PNG by the preview's functions (design §3.8). Main does the ffmpeg work.
import { drawAnnotation, type Annotation } from '../../shared/annotation'
import type { CaptionData, OverlaySettings, ScoreboardData } from '../../shared/overlay'
import { drawCaption, drawScoreboard, drawTitleCard } from '../../shared/overlayDraw'
import type { Clip } from '../../shared/reel'
import type { PlanItem } from '../../shared/video'
import type { ExportItem, ExportJob, ExportLayer, Match } from '../../shared/types'
import { assetImage, logoImage, preloadAssets, preloadLogos } from './assets'

export const EXPORT_HEIGHT = 720

interface Deps {
  range: (c: Clip, sceneId: string) => { in: number; out: number } | null // a scene's own length defaults apply
  overlayData: (c: Clip) => { scoreboard: ScoreboardData; caption: CaptionData } | null
  matches: Record<string, Match>
  sceneAnnotations: (sceneId: string) => Annotation[] // 表示範囲: シーン全体
  videoAnnotations: Annotation[] // 表示範囲: 動画全体
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

export async function buildExportJob(plan: PlanItem[], overlay: OverlaySettings, d: Deps, outPath: string): Promise<ExportJob> {
  const clips = plan.flatMap(p => (p.kind === 'clip' ? [p.clip] : []))
  const { width: W, height: H, fpsStr } = exportFormat(clips, d.matches)
  const sceneIds = [...new Set(plan.flatMap(p => (p.kind === 'clip' ? [p.sceneId] : [])))]
  const all = [...d.videoAnnotations, ...sceneIds.flatMap(d.sceneAnnotations), ...clips.flatMap(c => c.annotations),
    ...plan.flatMap(p => (p.kind === 'card' ? p.card.annotations ?? [] : []))]
  await preloadAssets(all.flatMap(a => (a.kind === 'image' ? [a.assetId] : [])))
  await preloadLogos(plan.map(p => (p.kind === 'card' ? p.card.opp : null)))
  const items: ExportItem[] = []
  for (const p of plan) {
    if (p.kind === 'card') {
      items.push({ kind: 'card', durationSec: p.durationSec, png: await png(W, H, ctx => {
        drawTitleCard(ctx, W, H, p.card, overlay.titleCard, overlay.theme, logoImage(p.card.opp))
        for (const a of p.card.annotations ?? []) drawAnnotation(ctx, a, W, H, assetImage)
      }) })
      continue
    }
    const c = p.clip, r = d.range(c, p.sceneId)
    if (!r) continue
    items.push({ kind: 'clip', matchId: c.matchId, in: r.in, out: r.out, layers: await clipLayers(c, p.sceneId, r, overlay, d, W, H) })
  }
  return { outPath, width: W, height: H, fpsStr, items, ...(overlay.transition.fade ? { fadeSec: overlay.transition.durationSec } : {}) }
}

// One layer for everything shown for the whole clip (auto overlays first, annotations on top),
// plus one per distinct show/hide window, switched by ffmpeg's enable='between(t,a,b)'.
async function clipLayers(c: Clip, sceneId: string, r: { in: number; out: number }, overlay: OverlaySettings, d: Deps, W: number, H: number): Promise<ExportLayer[]> {
  const data = d.overlayData(c)
  const o = c.overlayOverride
  const showSb = !!data && overlay.scoreboard.enabled && !o?.scoreboard?.hidden
  const showCap = !!data && overlay.playerCaption.enabled && !o?.playerCaption?.hidden
  const window = (a: Annotation) => ({ from: Math.max(0, (a.showFrom ?? r.in) - r.in), to: Math.min(r.out, a.showTo ?? r.out) - r.in })
  const whole = (a: Annotation) => { const w = window(a); return w.from <= 0.001 && w.to >= r.out - r.in - 0.001 }

  // The video's objects at the bottom, then the scene's, then the clip's (as in the editor).
  const anns = [...d.videoAnnotations, ...d.sceneAnnotations(sceneId), ...c.annotations]
  const layers: ExportLayer[] = []
  const always = anns.filter(whole)
  if (showSb || showCap || always.length) {
    layers.push({
      png: await png(W, H, ctx => {
        if (showSb) drawScoreboard(ctx, W, H, data!.scoreboard, overlay.scoreboard, overlay.theme)
        if (showCap) drawCaption(ctx, W, H, data!.caption, overlay.playerCaption, overlay.theme)
        for (const a of always) drawAnnotation(ctx, a, W, H, assetImage)
      }),
    })
  }
  const timed = new Map<string, Annotation[]>()
  for (const a of anns) {
    if (whole(a)) continue
    const w = window(a)
    if (w.to <= w.from) continue // window falls outside the trimmed clip
    const k = `${w.from.toFixed(3)}|${w.to.toFixed(3)}`
    timed.set(k, [...(timed.get(k) ?? []), a])
  }
  for (const [k, list] of timed) {
    const [from, to] = k.split('|').map(Number)
    layers.push({ from, to, png: await png(W, H, ctx => list.forEach(a => drawAnnotation(ctx, a, W, H, assetImage))) })
  }
  return layers
}

async function png(W: number, H: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(W, H)
  draw(canvas.getContext('2d')!)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
