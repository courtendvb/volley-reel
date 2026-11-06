// Automatic overlays from the scout data (design §3.7): scoreboard, player caption, title card.
// Settings live on the reel; each clip can hide an element or rewrite the caption.
import { displayName } from './dvw'
import { ourSide } from './filter'
import { effectName, skillName } from './labels'
import type { ParsedDVW, Play } from './types'
import { t } from './i18n'

export type Anchor = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'

export interface OverlayTheme {
  base: string // plate color
  accent: string // number block, winner underline, title card number
}

export interface OverlaySettings {
  theme: OverlayTheme
  scoreboard: { enabled: boolean; anchor: Anchor; scale: number; showSets: boolean }
  // photo: the player's photo from the player packs, above a caption at the bottom (below one at the top).
  playerCaption: { enabled: boolean; anchor: Anchor; scale: number; showNumber: boolean; showName: boolean; showSkill: boolean; showEvaluation: boolean; photo: boolean }
  // enabled = a card before each marker group; sceneCards = a card with the scene name before each scene.
  // markerLayout / sceneLayout: where the title sits and how big, set in the card editor.
  titleCard: { enabled: boolean; sceneCards: boolean; durationSec: number; showMarkerName: boolean; showMatch: boolean
    showMarkerNumber?: boolean // the marker's number on its cards; missing = shown
    markerLayout?: CardLayout; sceneLayout?: CardLayout
    videoCard?: boolean; videoLayout?: CardLayout // videoCard: an opening card with the video's name
    background?: string } // the cards' (and blank slides') background; missing = a darker shade of the theme's base
  // Fade from and to black at the start and end of every clip and card.
  transition: { fade: boolean; durationSec: number }
  // The court grid and the play's zones in the export, drawn as the player shows them (the
  // look is set under the video). Only for matches whose court is fitted.
  court: { enabled: boolean }
  // YouTube chapters (a .txt beside the MP4) when the whole video is exported.
  chapters: { enabled: boolean }
}

// x / y: the marker title's top-left, or the scene title's center (0..1 of the frame); scale: 1 = default size.
export interface CardLayout { x: number; y: number; scale: number }
export const DEFAULT_MARKER_LAYOUT: CardLayout = { x: 0.1, y: 0.3, scale: 1 }
export const DEFAULT_SCENE_LAYOUT: CardLayout = { x: 0.5, y: 0.5, scale: 1 }
export const DEFAULT_VIDEO_LAYOUT: CardLayout = { x: 0.5, y: 0.5, scale: 1.4 }

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

export const DEFAULT_OVERLAY: OverlaySettings = {
  theme: THEME_PRESETS[0].theme,
  scoreboard: { enabled: true, anchor: 'tl', scale: 1, showSets: true }, // top left: the headline sits at the top middle
  playerCaption: { enabled: true, anchor: 'bl', scale: 1, showNumber: true, showName: true, showSkill: true, showEvaluation: true, photo: false },
  titleCard: { enabled: false, sceneCards: true, durationSec: 2, showMarkerName: true, showMatch: true },
  transition: { fade: false, durationSec: 0.3 },
  court: { enabled: false },
  chapters: { enabled: false },
}

// What gets saved: any part may be missing, and missing parts fall back to the defaults.
export type OverlayPatch = { [K in keyof OverlaySettings]?: Partial<OverlaySettings[K]> }

// Reels saved before M6 have no overlay settings; partial objects keep the defaults underneath.
export function overlaySettings(saved: OverlayPatch | undefined): OverlaySettings {
  const s = saved ?? {}
  return {
    theme: { ...DEFAULT_OVERLAY.theme, ...(s.theme ?? {}) },
    scoreboard: { ...DEFAULT_OVERLAY.scoreboard, ...(s.scoreboard ?? {}) },
    playerCaption: { ...DEFAULT_OVERLAY.playerCaption, ...(s.playerCaption ?? {}) },
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

// photo: the player's photo in a pack (shared/pack.ts captionPhoto), when the caption shows one.
export interface CaptionData { number: number | null; name: string | null; line: string | null; photo?: { pack: string; photo: string } | null }

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
  }
}
