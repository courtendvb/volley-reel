// 着弾のあと (after the landing): what the court shows once a serve or an attack has come down, from the
// DVW's evaluation of it. Seconds are from the landing; the picture is drawn in pixels by court.ts.
//   mark       a badge over the landing: a star for an ace or a kill, a cross for an error, a shield for a
//              block; for a ball still in play the evaluation symbol itself (+ ! − /), which means something
//   tint       the flight's curve and its landing point take the result's colour, and stay so
import type { Ctx, Pt } from './courtGeometry'

export type ResultKind = 'win' | 'lost' | 'blocked' | 'play'
export interface PlayResult { kind: ResultKind; symbol: string; color: string | null } // color: null for a ball still in play (the usual gold)

export const RESULT_GREEN = '#22C55E'
export const RESULT_RED = '#EF4444'

// A serve's or an attack's result from its evaluation: # an ace or a kill, = an error, / on an attack
// blocked (on a serve it is only an evaluation); anything else is a ball in play, shown as its symbol.
// null for other skills and for no evaluation.
export function playResult(skill: string | undefined, effect: string | undefined): PlayResult | null {
  if (skill !== 'S' && skill !== 'A') return null
  const e = (effect ?? '').trim()
  if (!e) return null
  if (e === '#') return { kind: 'win', symbol: '#', color: RESULT_GREEN }
  if (e === '=') return { kind: 'lost', symbol: '=', color: RESULT_RED }
  if (skill === 'A' && e === '/') return { kind: 'blocked', symbol: '/', color: RESULT_RED }
  return { kind: 'play', symbol: e, color: null }
}

export const AFTER_FADE_FROM_SEC = 2.6 // the badge holds until here, then fade
export const AFTER_END_SEC = 3.2 // and are gone
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOutBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2 }

export interface AfterPhase { pop: number; fade: number } // the badge's size (pops past 1 and settles), how much of it is left
// What shows `sec` seconds after the landing, or null when nothing does (before it, or once it is over).
export function afterPhase(sec: number): AfterPhase | null {
  if (!(sec >= 0) || sec >= AFTER_END_SEC) return null
  const fade = sec < AFTER_FADE_FROM_SEC ? 1 : 1 - (sec - AFTER_FADE_FROM_SEC) / (AFTER_END_SEC - AFTER_FADE_FROM_SEC)
  return { pop: Math.max(0.05, easeOutBack(clamp01(sec / 0.3))), fade }
}

// The moments the export draws (each its own layer): [from, to) seconds from the landing, and the time drawn.
// Quick at first for the pop, then slower for the fade.
export function afterSteps(): { from: number; to: number; at: number }[] {
  const edges = [0, 0.08, 0.16, 0.24, 0.34, 0.5, 1, 1.5, 2, AFTER_FADE_FROM_SEC, 2.8, 3, AFTER_END_SEC], out: { from: number; to: number; at: number }[] = []
  for (let i = 0; i + 1 < edges.length; i++) out.push({ from: edges[i], to: edges[i + 1], at: (edges[i] + edges[i + 1]) / 2 })
  return out
}

// The badge over the landing `at` (a point on the picture): a disc on a short stem, with the result in it.
export function drawResultMark(ctx: Ctx, at: Pt, result: PlayResult, phase: AfterPhase, w: number): void {
  const r = Math.max(12, w / 46) * phase.pop, lift = Math.max(12, w / 46) * 2.1, c = { x: at.x, y: at.y - lift }
  const color = result.color ?? '#FACC15'
  ctx.save()
  ctx.globalAlpha = phase.fade
  ctx.strokeStyle = '#FFFFFF'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, w / 700)
  ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(c.x, c.y + r); ctx.stroke() // the stem
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = w / 120
  ctx.fillStyle = result.kind === 'play' ? 'rgba(20,24,32,0.88)' : color
  ctx.lineWidth = Math.max(2, w / 420); ctx.strokeStyle = result.kind === 'play' ? color : '#FFFFFF'
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(2.2, r * 0.18)
  if (result.kind === 'win') { // a star
    ctx.beginPath()
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = (i % 2 ? 0.34 : 0.72) * r; ctx.lineTo(c.x + rr * Math.cos(a), c.y + rr * Math.sin(a)) }
    ctx.closePath(); ctx.fill()
  } else if (result.kind === 'lost') { // a cross
    const k = r * 0.46
    ctx.beginPath(); ctx.moveTo(c.x - k, c.y - k); ctx.lineTo(c.x + k, c.y + k); ctx.moveTo(c.x + k, c.y - k); ctx.lineTo(c.x - k, c.y + k); ctx.stroke()
  } else if (result.kind === 'blocked') { // a shield
    const k = r * 0.5
    ctx.beginPath()
    ctx.moveTo(c.x - k, c.y - k * 0.8); ctx.lineTo(c.x + k, c.y - k * 0.8); ctx.lineTo(c.x + k, c.y + k * 0.1)
    ctx.quadraticCurveTo(c.x + k, c.y + k, c.x, c.y + k * 1.2); ctx.quadraticCurveTo(c.x - k, c.y + k, c.x - k, c.y + k * 0.1)
    ctx.closePath(); ctx.fill()
  } else { // the evaluation's own symbol
    ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(result.symbol === '-' ? '−' : result.symbol, c.x, c.y + r * 0.05)
  }
  ctx.restore()
}
