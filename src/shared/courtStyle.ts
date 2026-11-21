// How the court tab draws (court.ts): the grid, the zones and the player's marks, kept per kind of play.
import { cleanSetChart, cleanSetCourt, cleanSetFilter, setFilterCount, type SetFilter, type SetChartStyle, type SetCourtStyle } from './setChart'
import { cleanChart, type ChartStyle } from './chart'
import { isMarkRange, type MarkRange } from './markRange'
import { isLandingFx, type LandingFx } from './courtFx'

export interface GridStyle {
  grid: boolean
  color: string
  opacity: number // 0..1
  lineWidth: number // px at 720p, scaled with the picture like the annotations
  playZones: boolean
  flight?: boolean // with the points: the ball's path as a curve
  flightStill?: boolean // the whole curve shown for the clip, instead of growing as the play goes
  heat?: boolean // on a serve or attack: a heatmap of where the player's shots of that skill landed
  ripple?: boolean // on the selected serve or attack: a ripple of light from where it landed, for 3 s (courtHeat.ts); a heatmap shows as it always does
  rippleKind?: LandingFx // what plays at the landing when `ripple` is on: the ripple (default), lock, flash or trail (courtFx.ts)
  rippleLead?: number // how many seconds before the landing the ripple starts (the landing is the DVW's, to the second); below 0, after it
  rippleColor?: string // the ripple's colour, unless the usual gold
  heatOpacity?: number // 0..1, the heatmap at its thickest; on slides too
  noLift?: boolean // no dashed line from the floor up to a point in the air
  serveFlights?: boolean // on a serve: all the player's serves flying with it
  landings?: boolean // on a serve or attack: where the player's shots landed, as points
  cones?: boolean // on an attack: the player's shots of that code as cones across the court
  coneColor?: string // their colour, unless the usual one
  chart?: ChartStyle // on an attack: the player's direction chart over the picture; none: off
  setChart?: SetChartStyle // on a set or the attack after one: the setter's distribution in that rotation, as a chart in a corner; none: off
  setFilter?: SetFilter // what the setter's sets above are kept to: rotations, setter calls, the other team's rotations
  range?: MarkRange // which shots all of the above are made from (markRange.ts); none: every shot of the player
  setCourt?: SetCourtStyle // the same laid on the court in the picture: where the sets were given, or each place's share; none: off
  // The marks of the player's other plays above, kept apart for each kind of play selected: a serve, an
  // attack or a set shows its own. When there, these win over the fields above (markStyle).
  bySkill?: Partial<Record<MarkSkill, PlayerMarkStyle>>
  detail: 'zone' | 'sub' | 'point' // the play's zones as whole zones, their sub-zones, or the scout's clicks as points; each falls back to the zone where the DVW lacks it
}

export type MarkSkill = 'S' | 'A' | 'E'
const MARK_KEYS = ['heat', 'serveFlights', 'landings', 'cones', 'chart', 'setChart', 'setCourt', 'setFilter', 'range'] as const
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

// The marks of one kind of play as read back from storage.
export function cleanPlayerMarks(m: Record<string, unknown> | undefined): PlayerMarkStyle {
  return {
    ...(m?.heat ? { heat: true } : {}), ...(m?.serveFlights ? { serveFlights: true } : {}), ...(m?.landings ? { landings: true } : {}), ...(m?.cones ? { cones: true } : {}),
    ...(isMarkRange(m?.range) && m.range !== 'all' ? { range: m.range } : {}),
    ...(m?.chart ? { chart: cleanChart(m.chart) } : {}), ...(m?.setChart ? { setChart: cleanSetChart(m.setChart) } : {}), ...(m?.setCourt ? { setCourt: cleanSetCourt(m.setCourt) } : {}), ...(m?.setFilter && setFilterCount(cleanSetFilter(m.setFilter)) ? { setFilter: cleanSetFilter(m.setFilter) } : {}),
  }
}

// What one clip pins of the 表示 tab (overlayOverride.court), so it looks its own way whatever the tab
// says: the selected play's detail, the landing effect and the marks of the clip's own kind of play
// (a serve, an attack, a set). Each part, when there, replaces the tab's wholesale; a part that is
// missing follows the tab. The grid, its colour and the near team stay the match's and the tab's.
export interface ClipCourtStyle {
  detail?: GridStyle['detail']
  effect?: { on: boolean; kind?: LandingFx; lead?: number; color?: string }
  marks?: PlayerMarkStyle
}

// The style a clip is drawn with: the 表示 tab's, with what the clip pins over it. `skill` is the
// clip's play's, which picks the marks it replaces.
export function clipCourtStyle(style: GridStyle, skill: string | null | undefined, pin: ClipCourtStyle | undefined): GridStyle {
  if (!pin) return style
  const out: GridStyle = { ...style }
  if (pin.detail) out.detail = pin.detail
  if (pin.effect) {
    delete out.ripple; delete out.rippleKind; delete out.rippleLead; delete out.rippleColor
    if (pin.effect.on) {
      out.ripple = true
      if (pin.effect.kind && pin.effect.kind !== 'ripple') out.rippleKind = pin.effect.kind
      if (pin.effect.lead) out.rippleLead = pin.effect.lead
      if (pin.effect.color) out.rippleColor = pin.effect.color
    }
  }
  const k = markSkill(skill)
  if (pin.marks && k) out.bySkill = { ...marksBySkill(out).bySkill, [k]: pin.marks }
  return out
}

// What a clip pins when it is set to look its own way: a copy of how it looks now.
export function pinClipStyle(style: GridStyle, skill: string | null | undefined): ClipCourtStyle {
  const k = markSkill(skill)
  const effect: NonNullable<ClipCourtStyle['effect']> = { on: !!style.ripple }
  if (style.ripple) {
    if (style.rippleKind && style.rippleKind !== 'ripple') effect.kind = style.rippleKind
    if (style.rippleLead) effect.lead = style.rippleLead
    if (style.rippleColor) effect.color = style.rippleColor
  }
  return { detail: style.detail, effect, ...(k ? { marks: { ...(marksBySkill(style).bySkill?.[k] ?? {}) } } : {}) }
}

// A style changed on the 表示 tab while a clip is pinned, as the two things it comes to: the tab's own
// style (only what is not the clip's changes there) and the clip's new pin.
export function splitClipStyle(next: GridStyle, tab: GridStyle, skill: string | null | undefined): { tab: GridStyle; pin: ClipCourtStyle } {
  const rest: GridStyle = { ...next }
  for (const key of ['detail', 'ripple', 'rippleKind', 'rippleLead', 'rippleColor'] as const) {
    if (tab[key] === undefined) delete rest[key]
    else (rest as unknown as Record<string, unknown>)[key] = tab[key]
  }
  if (tab.bySkill) rest.bySkill = tab.bySkill
  else delete rest.bySkill
  return { tab: rest, pin: pinClipStyle(next, skill) }
}

// A clip's pin as read back from a saved scene: anything of the wrong kind is dropped, and a pin with nothing left is none.
export function cleanClipCourtStyle(x: unknown): ClipCourtStyle | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  const out: ClipCourtStyle = {}
  if (o.detail === 'zone' || o.detail === 'sub' || o.detail === 'point') out.detail = o.detail
  const e = o.effect as Record<string, unknown> | undefined
  if (e && typeof e === 'object') {
    const effect: NonNullable<ClipCourtStyle['effect']> = { on: !!e.on }
    if (effect.on) {
      if (isLandingFx(e.kind) && e.kind !== 'ripple') effect.kind = e.kind
      if (typeof e.lead === 'number' && Number.isFinite(e.lead) && e.lead !== 0) effect.lead = Math.max(-RIPPLE_LEAD_MAX, Math.min(RIPPLE_LEAD_MAX, e.lead))
      if (typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color)) effect.color = e.color
    }
    out.effect = effect
  }
  if (o.marks && typeof o.marks === 'object') out.marks = cleanPlayerMarks(o.marks as Record<string, unknown>)
  return out.detail || out.effect || out.marks ? out : undefined
}

// A style as read back from storage: anything missing or of the wrong kind takes the usual value;
// one saved before the marks were per skill is split up (marksBySkill).
export function cleanGridStyle(x: unknown): GridStyle {
  const o = { ...DEFAULT_GRID_STYLE, ...(x && typeof x === 'object' ? x : {}) } as GridStyle & Record<string, unknown>
  const marks = cleanPlayerMarks
  const base: GridStyle = {
    grid: o.grid !== false, color: typeof o.color === 'string' ? o.color : DEFAULT_GRID_STYLE.color, opacity: typeof o.opacity === 'number' ? o.opacity : DEFAULT_GRID_STYLE.opacity,
    lineWidth: typeof o.lineWidth === 'number' ? o.lineWidth : DEFAULT_GRID_STYLE.lineWidth, playZones: o.playZones !== false,
    flight: !!o.flight, flightStill: !!o.flightStill, noLift: !!o.noLift, detail: o.detail === 'sub' || o.detail === 'point' ? o.detail : 'zone',
    ...(typeof o.heatOpacity === 'number' ? { heatOpacity: o.heatOpacity } : {}), ...(typeof o.coneColor === 'string' ? { coneColor: o.coneColor } : {}), ...(typeof o.rippleColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.rippleColor) ? { rippleColor: o.rippleColor } : {}),
  }
  const by = o.bySkill as Record<string, Record<string, unknown>> | undefined
  // The ripple was set per kind of play before it moved to the selected play's row: on for one is on.
  if (o.ripple || (by && typeof by === 'object' && Object.values(by).some(m => m?.ripple))) base.ripple = true
  if (isLandingFx(o.rippleKind) && o.rippleKind !== 'ripple') base.rippleKind = o.rippleKind
  if (typeof o.rippleLead === 'number' && Number.isFinite(o.rippleLead) && o.rippleLead !== 0) base.rippleLead = Math.max(-RIPPLE_LEAD_MAX, Math.min(RIPPLE_LEAD_MAX, o.rippleLead))
  return by && typeof by === 'object'
    ? { ...base, bySkill: { S: marks(by.S), A: marks(by.A), E: marks(by.E) } }
    : marksBySkill({ ...base, ...marks(o) })
}

export const RIPPLE_LEAD_MAX = 3 // seconds either way

export const DEFAULT_GRID_STYLE: GridStyle = {
  grid: true, color: '#FFFFFF', opacity: 0.7, lineWidth: 2, playZones: true, detail: 'zone',
}

