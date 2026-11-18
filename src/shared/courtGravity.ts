import { COURT_L_M, COURT_W_M } from './courtHeat'
import { type CourtFit, type Ctx, type Pt, homography, inPixels, project } from './courtGeometry'

// The gravity field (重力場): lines and points on the floor, no filled area. The player's past landings
// light up as small nodes, thin threads are pulled from each to their centre (the core), and when the
// ball lands the new mark shows whether it was drawn into the core (a shot where they always aim) or
// broke away from it (a surprise). The core's colour, size, spin and the threads follow how tightly
// the past landings lie. Times are seconds from the landing: negative, before it.

export const GRAVITY_PRE_SEC = 2.0, GRAVITY_HOLD_SEC = 2.2, GRAVITY_END_SEC = 3.0
const NODES_AT = [-2.0, -1.5], THREADS_AT = [-1.6, -0.5], CORE_AT = [-1.0, -0.3] // [from, to]
export const GRAVITY_MIN_NODES = 3

export interface GravityField {
  nodes: Pt[] // the past landings, in court units
  core: Pt // their mean
  spread: number // the mean distance from the core, metres
  impact: Pt
  caught: boolean // the new landing lies inside the core
}

export interface GravityLook { color: string; threadW: number; threadAlpha: number; coreR: number; spin: number; label: 'sharp' | 'area' | 'scattered' }
// Tight: a short bright red-orange vortex; an area: calm cyan; scattered: faint threads and a small pale core.
export function gravityLook(spread: number): GravityLook {
  if (spread <= 1.5) return { color: '#FF5A36', threadW: 1.7, threadAlpha: 1, coreR: 1.0, spin: 2.2, label: 'sharp' }
  if (spread <= 4) return { color: '#22D3EE', threadW: 1, threadAlpha: 0.85, coreR: 1.5, spin: 0.5, label: 'area' }
  return { color: '#E2E8F0', threadW: 0.55, threadAlpha: 0.45, coreR: 0.7, spin: 0.15, label: 'scattered' }
}

const metres = (p: Pt): Pt => ({ x: p.x * COURT_W_M, y: p.y * COURT_L_M })

// The field from the past landings and this one; null with too few past landings.
export function gravityField(past: Pt[], impact: Pt): GravityField | null {
  const i = past.findIndex(p => Math.abs(p.x - impact.x) < 1e-6 && Math.abs(p.y - impact.y) < 1e-6) // this shot is not its own past
  const nodes = i >= 0 ? [...past.slice(0, i), ...past.slice(i + 1)] : past
  if (nodes.length < GRAVITY_MIN_NODES) return null
  const core = { x: nodes.reduce((s, p) => s + p.x, 0) / nodes.length, y: nodes.reduce((s, p) => s + p.y, 0) / nodes.length }
  const c = metres(core)
  const spread = nodes.reduce((s, p) => s + Math.hypot(metres(p).x - c.x, metres(p).y - c.y), 0) / nodes.length
  const look = gravityLook(spread), m = metres(impact)
  return { nodes, core, spread, impact, caught: Math.hypot(m.x - c.x, m.y - c.y) <= Math.max(1.5, look.coreR * 1.4) }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const span = (sec: number, [a, b]: number[]) => clamp01((sec - a) / (b - a))
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2

// The moments the export draws (each its own layer): [from, to) seconds from the landing, and the time drawn.
export function gravitySteps(): { from: number; to: number; at: number }[] {
  const out: { from: number; to: number; at: number }[] = []
  for (let t = -GRAVITY_PRE_SEC; t < -1e-9; t += 0.1) out.push({ from: t, to: Math.min(0, t + 0.1), at: t + 0.05 })
  for (let t = 0; t < GRAVITY_END_SEC - 1e-9; t += 0.1) out.push({ from: t, to: Math.min(GRAVITY_END_SEC, t + 0.1), at: t + 0.05 })
  return out
}

export function drawGravity(ctx: Ctx, w: number, h: number, fit: CourtFit, g: GravityField, sec: number): void {
  if (sec < -GRAVITY_PRE_SEC || sec >= GRAVITY_END_SEC) return
  const H = homography(inPixels(fit, w, h)), look = gravityLook(g.spread)
  const px = (p: Pt): Pt => project(H, p.x, p.y)
  const fade = sec < GRAVITY_HOLD_SEC ? 1 : 1 - (sec - GRAVITY_HOLD_SEC) / (GRAVITY_END_SEC - GRAVITY_HOLD_SEC)
  const unit = w / 1280, core = px(g.core)
  const ring = (c: Pt, r: number, from = 0, to = Math.PI * 2, steps = 48): Pt[] => Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps
    return px({ x: c.x + (r * Math.cos(a)) / COURT_W_M, y: c.y + (r * Math.sin(a)) / COURT_L_M })
  })
  const path = (pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))) }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.shadowColor = look.color
  ctx.shadowBlur = 6 * unit
  const per = (NODES_AT[1] - NODES_AT[0]) / g.nodes.length
  const nodeP = (i: number) => easeOutBack(span(sec, [NODES_AT[0] + per * i, NODES_AT[0] + per * (i + 1) + 0.15]))
  // The threads, pulled from each node toward the core.
  const pull = easeOutCubic(span(sec, THREADS_AT)), bright = g.caught && sec >= 0 ? 1.4 : 1
  ctx.strokeStyle = look.color
  ctx.lineWidth = Math.max(1, look.threadW * 2.4 * unit)
  g.nodes.forEach((n, i) => {
    if (pull <= 0 || nodeP(i) <= 0) return
    const end = { x: n.x + (g.core.x - n.x) * pull, y: n.y + (g.core.y - n.y) * pull }
    ctx.globalAlpha = fade * Math.min(1, look.threadAlpha * bright)
    path([px(n), px(end)])
    ctx.stroke()
  })
  // The nodes: small lit points, popping up one after another.
  ctx.fillStyle = look.color
  g.nodes.forEach((n, i) => {
    const p = nodeP(i)
    if (p <= 0) return
    ctx.globalAlpha = fade
    const c = px(n)
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, 4 * unit * p), 0, Math.PI * 2); ctx.fill()
  })
  // The core: a double ring; the outer one runs round as dashes at the field's own speed.
  const born = span(sec, CORE_AT), shatter = !g.caught && sec >= 0 ? easeOutCubic(clamp01(sec / 0.6)) : 0
  if (born > 0) {
    const r = look.coreR * easeOutCubic(born)
    ctx.globalAlpha = fade * (1 - shatter * 0.9)
    ctx.lineWidth = Math.max(1.5, 2.2 * unit)
    if (shatter === 0) { path(ring(g.core, r * 0.55)); ctx.stroke() }
    const turn = sec * look.spin * Math.PI, arcs = 6, gap = 0.45
    ctx.lineWidth = Math.max(1.2, 1.8 * unit)
    for (let k = 0; k < arcs; k++) { // six arcs that fly apart when the core breaks
      const a0 = turn + (k * Math.PI * 2) / arcs, a1 = a0 + ((Math.PI * 2) / arcs) * (1 - gap)
      const out = shatter * look.coreR * 1.6, mid = (a0 + a1) / 2
      const c = { x: g.core.x + (out * Math.cos(mid)) / COURT_W_M, y: g.core.y + (out * Math.sin(mid)) / COURT_L_M }
      path(ring(c, r, a0, a1, 10)); ctx.stroke()
    }
    if (shatter === 0) { ctx.beginPath(); ctx.arc(core.x, core.y, Math.max(1.5, 2.5 * unit), 0, Math.PI * 2); ctx.fill() }
  }
  // The landing (a star): it pops up where the ball came down; broken away, a new thread runs from the core to it.
  if (sec >= 0) {
    const p = easeOutBack(clamp01(sec / 0.3)), at = px(g.impact)
    ctx.globalAlpha = fade
    if (!g.caught) {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1.5, 2 * unit)
      const grow = easeOutCubic(clamp01((sec - 0.1) / 0.5))
      path([core, { x: core.x + (at.x - core.x) * grow, y: core.y + (at.y - core.y) * grow }])
      ctx.stroke()
    }
    ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = g.caught ? look.color : '#FFFFFF'
    star(ctx, at.x, at.y, Math.max(3, 9 * unit * Math.max(0.05, p)))
  }
  ctx.restore()
}

function star(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * 0.45 : r
    if (i) ctx.lineTo(x + d * Math.cos(a), y + d * Math.sin(a))
    else ctx.moveTo(x + d * Math.cos(a), y + d * Math.sin(a))
  }
  ctx.closePath(); ctx.fill()
}
