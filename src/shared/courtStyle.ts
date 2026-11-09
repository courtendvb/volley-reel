// How the court tab draws (court.ts): the grid, the zones and the player's marks, kept per kind of play.
import { cleanSetChart, cleanSetCourt, cleanSetFilter, setFilterCount, type SetFilter, type SetChartStyle, type SetCourtStyle } from './setChart'
import { cleanChart, type ChartStyle } from './chart'

export interface GridStyle {
  grid: boolean
  color: string
  opacity: number // 0..1
  lineWidth: number // px at 720p, scaled with the picture like the annotations
  playZones: boolean
  flight?: boolean // with the points: the ball's path as a curve
  flightStill?: boolean // the whole curve shown for the clip, instead of growing as the play goes
  heat?: boolean // on a serve or attack: a heatmap of where the player's shots of that skill landed
  heatOpacity?: number // 0..1, the heatmap at its thickest; on slides too
  noLift?: boolean // no dashed line from the floor up to a point in the air
  serveFlights?: boolean // on a serve: all the player's serves flying with it
  landings?: boolean // on a serve or attack: where the player's shots landed, as points
  cones?: boolean // on an attack: the player's shots of that code as cones across the court
  coneColor?: string // their colour, unless the usual one
  chart?: ChartStyle // on an attack: the player's direction chart over the picture; none: off
  setChart?: SetChartStyle // on a set or the attack after one: the setter's distribution in that rotation, as a chart in a corner; none: off
  setFilter?: SetFilter // what the setter's sets above are kept to: rotations, setter calls, the other team's rotations
  setCourt?: SetCourtStyle // the same laid on the court in the picture: where the sets were given, or each place's share; none: off
  // The marks of the player's other plays above, kept apart for each kind of play selected: a serve, an
  // attack or a set shows its own. When there, these win over the fields above (markStyle).
  bySkill?: Partial<Record<MarkSkill, PlayerMarkStyle>>
  detail: 'zone' | 'sub' | 'point' // the play's zones as whole zones, their sub-zones, or the scout's clicks as points; each falls back to the zone where the DVW lacks it
}

export type MarkSkill = 'S' | 'A' | 'E'
const MARK_KEYS = ['heat', 'serveFlights', 'landings', 'cones', 'chart', 'setChart', 'setCourt', 'setFilter'] as const
export type PlayerMarkStyle = Pick<GridStyle, typeof MARK_KEYS[number]>
export const markSkill = (skill: string | null | undefined): MarkSkill | null => (skill === 'S' || skill === 'A' || skill === 'E' ? skill : null)
// The style for a play of this skill: its own marks, none for other skills. A style without bySkill
// (made in code, or saved before) is taken as it is.
export function markStyle(style: GridStyle, skill: string | null | undefined): GridStyle {
  if (!style.bySkill) return style
  const k = markSkill(skill), rest: GridStyle = { ...style }
  for (const key of MARK_KEYS) delete rest[key]
  return { ...rest, ...(k ? style.bySkill[k] ?? {} : {}) }
}
// A style saved before the marks were kept per skill: each skill takes what applied to it.
export function marksBySkill(style: GridStyle): GridStyle {
  if (style.bySkill) return style
  const pick = (keys: readonly (typeof MARK_KEYS[number])[]): PlayerMarkStyle => Object.fromEntries(keys.filter(k => style[k]).map(k => [k, style[k]]))
  const rest: GridStyle = { ...style }
  for (const key of MARK_KEYS) delete rest[key]
  return { ...rest, bySkill: { S: pick(['heat', 'serveFlights', 'landings', 'chart']), A: pick(['heat', 'landings', 'cones', 'chart', 'setChart']), E: pick(['setChart']) } }
}

// A style as read back from storage: anything missing or of the wrong kind takes the usual value;
// one saved before the marks were per skill is split up (marksBySkill).
export function cleanGridStyle(x: unknown): GridStyle {
  const o = { ...DEFAULT_GRID_STYLE, ...(x && typeof x === 'object' ? x : {}) } as GridStyle & Record<string, unknown>
  const marks = (m: Record<string, unknown> | undefined): PlayerMarkStyle => ({
    ...(m?.heat ? { heat: true } : {}), ...(m?.serveFlights ? { serveFlights: true } : {}), ...(m?.landings ? { landings: true } : {}), ...(m?.cones ? { cones: true } : {}),
    ...(m?.chart ? { chart: cleanChart(m.chart) } : {}), ...(m?.setChart ? { setChart: cleanSetChart(m.setChart) } : {}), ...(m?.setCourt ? { setCourt: cleanSetCourt(m.setCourt) } : {}), ...(m?.setFilter && setFilterCount(cleanSetFilter(m.setFilter)) ? { setFilter: cleanSetFilter(m.setFilter) } : {}),
  })
  const base: GridStyle = {
    grid: o.grid !== false, color: typeof o.color === 'string' ? o.color : DEFAULT_GRID_STYLE.color, opacity: typeof o.opacity === 'number' ? o.opacity : DEFAULT_GRID_STYLE.opacity,
    lineWidth: typeof o.lineWidth === 'number' ? o.lineWidth : DEFAULT_GRID_STYLE.lineWidth, playZones: o.playZones !== false,
    flight: !!o.flight, flightStill: !!o.flightStill, noLift: !!o.noLift, detail: o.detail === 'sub' || o.detail === 'point' ? o.detail : 'zone',
    ...(typeof o.heatOpacity === 'number' ? { heatOpacity: o.heatOpacity } : {}), ...(typeof o.coneColor === 'string' ? { coneColor: o.coneColor } : {}),
  }
  const by = o.bySkill as Record<string, Record<string, unknown>> | undefined
  return by && typeof by === 'object'
    ? { ...base, bySkill: { S: marks(by.S), A: marks(by.A), E: marks(by.E) } }
    : marksBySkill({ ...base, ...marks(o) })
}

export const DEFAULT_GRID_STYLE: GridStyle = {
  grid: true, color: '#FFFFFF', opacity: 0.7, lineWidth: 2, playZones: true, detail: 'zone',
}

