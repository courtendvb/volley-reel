// Turns a reel into an ExportJob: the clip order with title cards, and every overlay drawn to PNG
// with the same functions as the preview (design §3.8). The main process does the ffmpeg work.
import { drawAnnotation, type Annotation } from '../../shared/annotation'
import { ourSide } from '../../shared/filter'
import type { CaptionData, OverlaySettings, ScoreboardData } from '../../shared/overlay'
import { drawCaption, drawScoreboard, drawTitleCard } from '../../shared/overlayDraw'
import { groupOf, type Clip, type Reel } from '../../shared/reel'
import type { ExportItem, ExportJob, ExportLayer, Match } from '../../shared/types'

export type Card = { marker: number; name: string; match: string | null }
export type PlanItem = { kind: 'card'; card: Card; durationSec: number } | { kind: 'clip'; clip: Clip }

// Clips in order, with a title card before each marker group when enabled. Used by both the
// through-play preview and the export, so the two never disagree about where cards go.
export function planSequence(order: Clip[], reel: Reel, overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const out: PlanItem[] = []
  order.forEach((c, i) => {
    const g = groupOf(reel, c.id)
    if (overlay.titleCard.enabled && g !== null && g !== 'none' && (i === 0 || groupOf(reel, order[i - 1].id) !== g)) {
      const oneMatch = new Set(reel.groups[g].map(id => reel.clips[id]?.matchId)).size === 1
      const m = matches[c.matchId]
      out.push({ kind: 'card', card: { marker: g, name: reel.markerNames[g], match: oneMatch && m ? cardMatchLabel(m, ourCodes) : null }, durationSec: overlay.titleCard.durationSec })
    }
    out.push({ kind: 'clip', clip: c })
  })
  return out
}

// Title card match line: "VS SMT · 2026-10-11".
export function cardMatchLabel(m: Match, codes: string[]): string {
  const side = ourSide(m.teams, codes)
  const opp = side === '*' ? m.teams[1].code : side === 'a' ? m.teams[0].code : `${m.teams[0].code}-${m.teams[1].code}`
  return `VS ${opp}${m.date ? ` · ${m.date}` : ''}`
}

export const EXPORT_HEIGHT = 720

interface Deps {
  range: (c: Clip) => { in: number; out: number } | null
  overlayData: (c: Clip) => { scoreboard: ScoreboardData; caption: CaptionData } | null
  matches: Record<string, Match>
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
  const items: ExportItem[] = []
  for (const p of plan) {
    if (p.kind === 'card') {
      items.push({ kind: 'card', durationSec: p.durationSec, png: await png(W, H, ctx => drawTitleCard(ctx, W, H, p.card, overlay.titleCard, overlay.theme)) })
      continue
    }
    const c = p.clip, r = d.range(c)
    if (!r) continue
    items.push({ kind: 'clip', matchId: c.matchId, in: r.in, out: r.out, layers: await clipLayers(c, r, overlay, d, W, H) })
  }
  return { outPath, width: W, height: H, fpsStr, items }
}

// One layer for everything shown for the whole clip (auto overlays first, annotations on top),
// plus one per distinct show/hide window, switched by ffmpeg's enable='between(t,a,b)'.
async function clipLayers(c: Clip, r: { in: number; out: number }, overlay: OverlaySettings, d: Deps, W: number, H: number): Promise<ExportLayer[]> {
  const data = d.overlayData(c)
  const o = c.overlayOverride
  const showSb = !!data && overlay.scoreboard.enabled && !o?.scoreboard?.hidden
  const showCap = !!data && overlay.playerCaption.enabled && !o?.playerCaption?.hidden
  const window = (a: Annotation) => ({ from: Math.max(0, (a.showFrom ?? r.in) - r.in), to: Math.min(r.out, a.showTo ?? r.out) - r.in })
  const whole = (a: Annotation) => { const w = window(a); return w.from <= 0.001 && w.to >= r.out - r.in - 0.001 }

  const layers: ExportLayer[] = []
  const always = c.annotations.filter(whole)
  if (showSb || showCap || always.length) {
    layers.push({
      png: await png(W, H, ctx => {
        if (showSb) drawScoreboard(ctx, W, H, data!.scoreboard, overlay.scoreboard, overlay.theme)
        if (showCap) drawCaption(ctx, W, H, data!.caption, overlay.playerCaption, overlay.theme)
        for (const a of always) drawAnnotation(ctx, a, W, H)
      }),
    })
  }
  const timed = new Map<string, Annotation[]>()
  for (const a of c.annotations) {
    if (whole(a)) continue
    const w = window(a)
    if (w.to <= w.from) continue // window falls outside the trimmed clip
    const k = `${w.from.toFixed(3)}|${w.to.toFixed(3)}`
    timed.set(k, [...(timed.get(k) ?? []), a])
  }
  for (const [k, list] of timed) {
    const [from, to] = k.split('|').map(Number)
    layers.push({ from, to, png: await png(W, H, ctx => list.forEach(a => drawAnnotation(ctx, a, W, H))) })
  }
  return layers
}

async function png(W: number, H: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(W, H)
  draw(canvas.getContext('2d')!)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
