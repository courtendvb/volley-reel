// Automatic overlays from the scout data (design §3.7): scoreboard, player caption, title card.
// Settings live on the reel; each clip can hide an element or rewrite the caption.
import type { Annotation } from './annotation'
import { displayName } from './dvw'
import { ourSide } from './filter'
import { effectName, skillName } from './labels'
import type { ParsedDVW, Play } from './types'
import { matchReport, type MatchReport } from './report'
import { t } from './i18n'

export type Anchor = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'

export interface OverlayTheme {
  base: string // plate color
  accent: string // number block, winner underline, title card number
}

// The design of the scoreboard, the caption and the serve speed plate (overlayDraw.ts lookOf): slanted
// black plates (the first one), square see-through plates, white plates, or no plates.
export type TelopLook = 'slant' | 'box' | 'light' | 'float'
export const TELOP_LOOKS: { look: TelopLook; name: string }[] = [
  { look: 'slant', name: t('スラント') }, { look: 'box', name: t('ボックス') }, { look: 'light', name: t('ライト') }, { look: 'float', name: t('フロート') },
]
export type LookTheme = OverlayTheme & { look?: TelopLook }

export interface OverlaySettings {
  theme: OverlayTheme
  look?: TelopLook // missing = slant
  scoreboard: { enabled: boolean; anchor: Anchor; scale: number; showSets: boolean }
  // photo: the player's photo from the player packs, above a caption at the bottom (below one at the top).
  playerCaption: { enabled: boolean; anchor: Anchor; scale: number; showNumber: boolean; showName: boolean; showSkill: boolean; showEvaluation: boolean; photo: boolean; showStats?: boolean }
  // A serve's measured speed (hit to the reception's touch, serveMark.ts) on its own plate, from the touch on.
  serveSpeed: { enabled: boolean; anchor: Anchor; scale: number }
  // enabled = a card before each marker group; sceneCards = a card with the scene name before each scene.
  // markerLayout / sceneLayout: where the title sits and how big, set in the card editor.
  titleCard: { enabled: boolean; sceneCards: boolean; durationSec: number; showMarkerName: boolean; showMatch: boolean
    showMarkerNumber?: boolean // the marker's number on its cards; missing = shown
    markerLayout?: CardLayout; sceneLayout?: CardLayout
    videoCard?: boolean; videoLayout?: CardLayout // videoCard: an opening card with the video's name
    logos?: Partial<Record<CardKind, LogoPlace>> // the opponent's logo apart from the title, per kind of card; missing = beside / above the title
    objects?: Partial<Record<CardKind, Annotation[]>> // objects on every card of a kind (a photo frame, a logo…), under each card's own
    background?: string } // the cards' (and blank slides') background; missing = a darker shade of the theme's base
  // Fade from and to black at the start and end of every clip and card.
  transition: { fade: boolean; durationSec: number }
  // The court grid and the play's zones in the export, drawn as the player shows them (the
  // look is set under the video). Only for matches whose court is fitted.
  court: { enabled: boolean }
  // YouTube chapters (a .txt beside the MP4) when the whole video is exported.
  chapters: { enabled: boolean }
}

// x / y: the title's top-left (0..1 of the frame), so a longer title only grows to the right and down;
// scale: 1 = default size. A scene or video card's layout saved before origin was its title's centre:
// sceneTopLeft reads it as a top-left.
export interface CardLayout { x: number; y: number; scale: number; origin?: 'tl' }
export type CardKind = 'marker' | 'scene' | 'video'
// The logo on its own: its centre (0..1 of the frame) and height (share of the frame's), or not shown.
export type LogoPlace = { x: number; y: number; h: number } | 'hidden'
export const DEFAULT_MARKER_LAYOUT: CardLayout = { x: 0.1, y: 0.3, scale: 1 }
export const DEFAULT_SCENE_LAYOUT: CardLayout = { x: 0.1, y: 0.4, scale: 1, origin: 'tl' }
export const DEFAULT_VIDEO_LAYOUT: CardLayout = { x: 0.1, y: 0.36, scale: 1.4, origin: 'tl' }

// A scene or video card's layout as a top-left. One saved as a centre is moved by half of a usual
// title (a few words, its match line above), the same for every title, so it stays put from card to card.
const OLD_HALF_W = 0.105, OLD_HALF_H = 0.0625
export function sceneTopLeft(L: CardLayout): CardLayout {
  if (L.origin === 'tl') return L
  return { x: Math.max(0.02, L.x - OLD_HALF_W * L.scale), y: Math.max(0.02, L.y - OLD_HALF_H * L.scale), scale: L.scale, origin: 'tl' }
}

export interface ClipOverlayOverride {
  scoreboard?: { hidden?: boolean }
  playerCaption?: { hidden?: boolean; name?: string; line?: string }
}

export const THEME_PRESETS: { name: string; theme: OverlayTheme }[] = [
  { name: t('ブラック × レッド'), theme: { base: '#111111', accent: '#C8102E' } },
  { name: t('ネイビー × ゴールド'), theme: { base: '#0B1F3A', accent: '#C9A227' } },
  { name: t('チャコール × ボルドー'), theme: { base: '#222224', accent: '#7A1F2B' } },
  { name: t('ブラック × ブルー'), theme: { base: '#101418', accent: '#1D4ED8' } },
  { name: t('ダークグリーン × ライム'), theme: { base: '#0F1F17', accent: '#65A30D' } },
]

// The colors with the design, for the drawing functions.
export function lookTheme(s: OverlaySettings): LookTheme {
  return { ...s.theme, look: s.look ?? 'slant' }
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  theme: THEME_PRESETS[0].theme,
  scoreboard: { enabled: true, anchor: 'tl', scale: 1, showSets: true }, // top left: the headline sits at the top middle
  playerCaption: { enabled: true, anchor: 'bl', scale: 1, showNumber: true, showName: true, showSkill: true, showEvaluation: true, photo: false },
  serveSpeed: { enabled: true, anchor: 'tr', scale: 1 },
  titleCard: { enabled: false, sceneCards: true, durationSec: 2, showMarkerName: true, showMatch: true },
  transition: { fade: false, durationSec: 0.3 },
  court: { enabled: false },
  chapters: { enabled: false },
}

// What gets saved: any part may be missing, and missing parts fall back to the defaults.
export type OverlayPatch = { [K in Exclude<keyof OverlaySettings, 'look'>]?: Partial<OverlaySettings[K]> } & { look?: TelopLook }

// Reels saved before M6 have no overlay settings; partial objects keep the defaults underneath.
export function overlaySettings(saved: OverlayPatch | undefined): OverlaySettings {
  const s = saved ?? {}
  return {
    theme: { ...DEFAULT_OVERLAY.theme, ...(s.theme ?? {}) },
    ...(s.look && s.look !== 'slant' ? { look: s.look } : {}),
    scoreboard: { ...DEFAULT_OVERLAY.scoreboard, ...(s.scoreboard ?? {}) },
    playerCaption: { ...DEFAULT_OVERLAY.playerCaption, ...(s.playerCaption ?? {}) },
    serveSpeed: { ...DEFAULT_OVERLAY.serveSpeed, ...(s.serveSpeed ?? {}) },
    titleCard: { ...DEFAULT_OVERLAY.titleCard, ...(s.titleCard ?? {}) },
    transition: { ...DEFAULT_OVERLAY.transition, ...(s.transition ?? {}) },
    court: { ...DEFAULT_OVERLAY.court, ...(s.court ?? {}) },
    chapters: { ...DEFAULT_OVERLAY.chapters, ...(s.chapters ?? {}) },
  }
}

export interface ScoreboardData {
  left: string; right: string
  ptsL: number; ptsR: number
  setsL: number; setsR: number
  winner: 'L' | 'R' | null // who took this rally
}

// A serve's measured speed and when its plate comes up: the reception's touch (a video time).
export interface SpeedData { kmh: number; touchSec: number }

// photo: the player's photo in a pack (shared/pack.ts captionPhoto), when the caption shows one.
export interface CaptionData { number: number | null; name: string | null; line: string | null; photo?: { pack: string; photo: string } | null; stats?: CaptionStat[] | null }

// A figure shown beside the caption: what it is, the percentage, and the count it comes from.
export interface CaptionStat { label: string; value: string; count: string } // count '': none shown

// The player's figures for the skill of the play, over the whole match (the match report's lines):
// serve ERR% and BP%, attack KILL% and EFF% (EFF without a count: its top is no number of plays),
// reception #+% and #%. Null for other skills, or when the
// player has none of that skill in the match.
const reports = new WeakMap<ParsedDVW, MatchReport>()
export function captionStats(dvw: ParsedDVW, play: Play): CaptionStat[] | null {
  if (play.skill !== 'S' && play.skill !== 'A' && play.skill !== 'R') return null
  let r = reports.get(dvw)
  if (!r) { r = matchReport(dvw); reports.set(dvw, r) }
  const line = r.teams[play.side === '*' ? 0 : 1].players.find(p => p.jersey === play.jersey)
  if (!line) return null
  const stat = (label: string, n: number, of: number, count = true): CaptionStat => ({ label, value: `${Math.round((n / of) * 100)}%`, count: count ? `${n}/${of}` : '' })
  if (play.skill === 'S') { const s = line.serve; return s.tot ? [stat('ERR', s.err, s.tot), stat('BP', s.brk, s.tot)] : null }
  if (play.skill === 'A') { const a = line.att; return a.tot ? [stat('KILL', a.pts, a.tot), stat('EFF', a.pts - a.err - a.blo, a.tot, false)] : null }
  const c = line.rec
  return c.tot ? [stat('#+', c.pos, c.tot), stat('#', c.exc, c.tot)] : null
}

// Our team always on the left (design §3.7); scrimmages and all-home files keep home on the left.
// The score is the one before the rally.
export function scoreboardData(dvw: ParsedDVW, play: Play, ourCodes: string[]): ScoreboardData {
  const side = dvw.allHome ? '*' : ourSide(dvw.teams, ourCodes) ?? '*'
  const homeLeft = side === '*'
  const [home, away] = dvw.teams
  const rally = play.rallyId !== null ? dvw.rallies[play.rallyId] : null
  const won = rally?.wonBy ?? null
  return {
    left: (homeLeft ? home : away).code, right: (homeLeft ? away : home).code,
    ptsL: homeLeft ? play.score.home : play.score.away, ptsR: homeLeft ? play.score.away : play.score.home,
    setsL: homeLeft ? play.setsBefore.home : play.setsBefore.away, setsR: homeLeft ? play.setsBefore.away : play.setsBefore.home,
    winner: won === null ? null : (won === '*') === homeLeft ? 'L' : 'R',
  }
}

// The name: the clip's own, else the video's name for the player (Video.captionNames), else the DVW's.
export function captionData(dvw: ParsedDVW, play: Play, s: OverlaySettings['playerCaption'], o?: ClipOverlayOverride['playerCaption'], names?: Record<string, string>): CaptionData {
  const parts = [s.showSkill ? skillName(play.skill) : null, s.showEvaluation ? effectName(play.skill, play.effect) : null].filter(Boolean) as string[]
  const autoLine = parts.length ? parts.join(' · ').toUpperCase() : null
  const name = o?.name?.trim() || names?.[play.playerKey]?.trim() || displayName(dvw.players, play.side, play.jersey)
  return {
    number: s.showNumber ? play.jersey : null,
    name: s.showName ? name : null,
    line: o?.line !== undefined && o.line.trim() !== '' ? o.line.trim().toUpperCase() : autoLine,
    ...(s.showStats ? { stats: captionStats(dvw, play) } : {}),
  }
}
