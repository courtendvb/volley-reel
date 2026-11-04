// A shot chart: where a search's serves and attacks go, one chart per start zone. The shots from a
// zone fan out from where they were struck; the fan over the other team's court is cut into five
// cones, painted on the floor as dark as their share of the shots, with the share and the kill rate
// on them, and a mark where the shots start. All are turned to play up the
// court, so either side and other matches lie on the same picture. Ordinary objects on a slide.
// Pure, so it is unit-tested without the app.
import type { Annotation } from './annotation'
import { homography, project, type CourtFit, type Pt } from './court'
import type { PlayRef } from './filter'
import { t } from './i18n'

const CONES = 5
const MIN_SHOTS = 3 // a zone with fewer gets no chart: one shot would read as a whole cone
const COURT_W = 9, COURT_L = 18 // metres, so angles on the court are true
const COLOR = '#EF4444'
const LOW = 0.12, HIGH = 0.75 // opacity of a cone: its share against the fullest one
const MARK = 0.016 // the start's mark, as a share of the picture's width

export interface ChartCone { from: number; to: number; shots: number; kills: number } // angles from straight up the court, radians, right positive
export interface ZoneChart { skill: string; zone: number; shots: number; cones: ChartCone[]; annotations: Annotation[] }
export interface ShotCharts { charts: ZoneChart[]; left: number } // left: serves and attacks not on a chart

type Shot = { x: number; y: number; ex: number; ey: number; kill: boolean } // metres on the court: up the court is y

// The other team's court, from a strike at (ox, oy): the angles it takes up, from straight up the
// court, right positive. The same fan for every chart from a place, so charts can be compared.
const FAR_CORNERS: [number, number][] = [[0, COURT_L], [COURT_W, COURT_L]]
const NET_CORNERS: [number, number][] = [[0, COURT_L / 2], [COURT_W, COURT_L / 2]]
export function courtFan(ox: number, oy: number): { lo: number; hi: number } {
  const angles = [...FAR_CORNERS, ...NET_CORNERS].map(([x, y]) => Math.atan2(x - ox, y - oy))
  return { lo: Math.min(...angles), hi: Math.max(...angles) }
}

// Five equal cones over a fan, each shot in one; a shot outside the fan (out, or tipped short) goes in the nearest.
export function fanCones(angles: { angle: number; kill: boolean }[], lo: number, hi: number): ChartCone[] {
  const step = (hi - lo) / CONES
  const cones: ChartCone[] = Array.from({ length: CONES }, (_, i) => ({ from: lo + i * step, to: lo + (i + 1) * step, shots: 0, kills: 0 }))
  for (const a of angles) {
    const c = cones[Math.max(0, Math.min(CONES - 1, Math.floor((a.angle - lo) / step)))]
    c.shots++
    if (a.kill) c.kills++
  }
  return cones
}

// Where a ray from (ox, oy) enters and leaves the other team's court, as distances; the strike is on
// the near side of the net or behind the end line, so it enters over the net.
function courtSpan(ox: number, oy: number, angle: number): { enter: number; leave: number } {
  const dx = Math.sin(angle), dy = Math.cos(angle)
  const net = dy > 1e-6 ? (COURT_L / 2 - oy) / dy : 0, far = dy > 1e-6 ? (COURT_L - oy) / dy : Infinity
  const side = dx > 1e-6 ? (COURT_W - ox) / dx : dx < -1e-6 ? -ox / dx : Infinity
  return { enter: Math.min(Math.max(0, net), side), leave: Math.min(far, side) }
}

// fit, w and h: the court on the picture the charts are laid on, in that picture's pixels. title: the search in words.
export function shotCharts(refs: PlayRef[], fit: CourtFit, w: number, h: number, title: string, newId: () => string = () => crypto.randomUUID()): ShotCharts {
  const corners = fit.corners.map(p => ({ x: p.x * w, y: p.y * h })) as [Pt, Pt, Pt, Pt]
  const floor = homography(corners)
  // Metres on the floor from the near left corner, up the court, onto the picture as 0–1.
  const onPicture = (x: number, y: number): [number, number] => {
    const p = project(floor, x / COURT_W, 1 - y / COURT_L)
    return [p.x / w, p.y / h]
  }
  const all = refs.filter(r => r.play.skill === 'S' || r.play.skill === 'A')
  const groups = new Map<string, { skill: string; zone: number; shots: Shot[] }>()
  for (const r of all) {
    const a = r.play.startClick, b = r.play.endClick, zone = r.play.startZone
    if (!a || !b || zone === null) continue
    const key = `${r.play.skill}${zone}`
    const g = groups.get(key) ?? { skill: r.play.skill, zone, shots: [] }
    g.shots.push({ x: a.u * COURT_W, y: a.v * COURT_L, ex: b.u * COURT_W, ey: b.v * COURT_L, kill: r.play.effect === '#' })
    groups.set(key, g)
  }
  const kept = [...groups.values()].filter(g => g.shots.length >= MIN_SHOTS)
    .sort((a, b) => (a.skill === b.skill ? b.shots.length - a.shots.length : a.skill === 'A' ? -1 : 1))
  const charts = kept.map((g): ZoneChart => {
    const n = g.shots.length, mean = (f: (s: Shot) => number) => g.shots.reduce((t, s) => t + f(s), 0) / n
    const ox = mean(s => s.x), oy = mean(s => s.y)
    const fan = courtFan(ox, oy)
    const cones = fanCones(g.shots.map(s => ({ angle: Math.atan2(s.ex - ox, s.ey - oy), kill: s.kill })), fan.lo, fan.hi)
    const fullest = Math.max(...cones.map(c => c.shots))
    const out = (angle: number, r: number) => onPicture(ox + r * Math.sin(angle), oy + r * Math.cos(angle))
    const shapes = cones.map((c): Annotation => {
      // The part of the other court in the cone: along the net, then back along the far edge, round
      // any far corner in it.
      const a = courtSpan(ox, oy, c.from), b = courtSpan(ox, oy, c.to)
      const corners = FAR_CORNERS.map(([x, y]) => ({ x, y, angle: Math.atan2(x - ox, y - oy) }))
        .filter(k => k.angle > c.from && k.angle < c.to).sort((p, q) => p.angle - q.angle)
      const points: [number, number][] = [out(c.from, a.enter), out(c.from, a.leave), ...corners.map(k => onPicture(k.x, k.y)), out(c.to, b.leave), out(c.to, b.enter)]
      return { id: newId(), kind: 'polygon', color: COLOR, width: 1, fill: COLOR, fillOpacity: c.shots ? LOW + (HIGH - LOW) * (c.shots / fullest) : 0.03, points }
    })
    const [mx, my] = onPicture(ox, oy)
    const mark: Annotation = { id: newId(), kind: 'circle', color: '#FFFFFF', x: mx - MARK / 2, y: my - (MARK * w) / h / 2, w: MARK, h: (MARK * w) / h, width: 2, fill: COLOR, fillOpacity: 1 }
    const labels = cones.flatMap((c): Annotation[] => {
      if (!c.shots) return []
      const mid = (c.from + c.to) / 2, span = courtSpan(ox, oy, mid)
      const [x, y] = out(mid, span.enter + (span.leave - span.enter) * 0.65) // past the middle: the start's mark is by the net
      const words = t('{0}%（{1} 本）\n決定 {2}%', Math.round((c.shots / n) * 100), c.shots, Math.round((c.kills / c.shots) * 100))
      return [{ id: newId(), kind: 'text', color: '#FFFFFF', x, y, text: words, size: 18, bold: true, outline: true, align: 'center' }]
    })
    const head = (y: number, s: string, size: number, bold: boolean): Annotation => ({ id: newId(), kind: 'text', color: '#FFFFFF', x: 0.03, y, text: s, size, bold, outline: true })
    const name = g.skill === 'A' ? t('アタック') : t('サーブ')
    return { skill: g.skill, zone: g.zone, shots: n, cones, annotations: [...shapes, mark, ...labels,
      head(0.04, `${title}・${t('{0} ゾーン {1} から', name, g.zone)}`, 30, true), head(0.11, t('{0} 本', n), 20, false)] }
  })
  return { charts, left: all.length - charts.reduce((s, c) => s + c.shots, 0) }
}
