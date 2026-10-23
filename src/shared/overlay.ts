// Automatic overlays from the scout data (design §3.7): scoreboard, player caption, title card.
// Settings live on the reel; each clip can hide an element or rewrite the caption.
import { displayName } from './dvw'
import { ourSide } from './filter'
import { EFFECTS, SKILLS } from './labels'
import type { ParsedDVW, Play } from './types'

export type Anchor = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'

export interface OverlayTheme {
  base: string // plate color
  accent: string // number block, winner underline, title card number
}

export interface OverlaySettings {
  theme: OverlayTheme
  scoreboard: { enabled: boolean; anchor: Anchor; scale: number; showSets: boolean }
  playerCaption: { enabled: boolean; anchor: Anchor; scale: number; showNumber: boolean; showName: boolean; showSkill: boolean; showEvaluation: boolean }
  // enabled = a card before each marker group; sceneCards = a card with the scene name before each scene
  titleCard: { enabled: boolean; sceneCards: boolean; durationSec: number; showMarkerName: boolean; showMatch: boolean }
}

export interface ClipOverlayOverride {
  scoreboard?: { hidden?: boolean }
  playerCaption?: { hidden?: boolean; name?: string; line?: string }
}

export const THEME_PRESETS: { name: string; theme: OverlayTheme }[] = [
  { name: 'ブラック × レッド', theme: { base: '#111111', accent: '#C8102E' } },
  { name: 'ネイビー × ゴールド', theme: { base: '#0B1F3A', accent: '#C9A227' } },
  { name: 'チャコール × ボルドー', theme: { base: '#222224', accent: '#7A1F2B' } },
  { name: 'ブラック × ブルー', theme: { base: '#101418', accent: '#1D4ED8' } },
  { name: 'ダークグリーン × ライム', theme: { base: '#0F1F17', accent: '#65A30D' } },
]

export const DEFAULT_OVERLAY: OverlaySettings = {
  theme: THEME_PRESETS[0].theme,
  scoreboard: { enabled: false, anchor: 'tc', scale: 1, showSets: true }, // off unless asked for: the headline text sits there
  playerCaption: { enabled: true, anchor: 'bl', scale: 1, showNumber: true, showName: true, showSkill: true, showEvaluation: true },
  titleCard: { enabled: false, sceneCards: true, durationSec: 2, showMarkerName: true, showMatch: true },
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
  }
}

export interface ScoreboardData {
  left: string; right: string
  ptsL: number; ptsR: number
  setsL: number; setsR: number
  winner: 'L' | 'R' | null // who took this rally
}

export interface CaptionData { number: number | null; name: string | null; line: string | null }

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

export function captionData(dvw: ParsedDVW, play: Play, s: OverlaySettings['playerCaption'], o?: ClipOverlayOverride['playerCaption']): CaptionData {
  const skill = SKILLS[play.skill] ?? play.skill
  const effect = EFFECTS[play.skill]?.[play.effect] ?? play.effect
  const parts = [s.showSkill ? skill : null, s.showEvaluation ? effect : null].filter(Boolean) as string[]
  const autoLine = parts.length ? parts.join(' · ').toUpperCase() : null
  const name = o?.name?.trim() || displayName(dvw.players, play.side, play.jersey)
  return {
    number: s.showNumber ? play.jersey : null,
    name: s.showName ? name : null,
    line: o?.line !== undefined && o.line.trim() !== '' ? o.line.trim().toUpperCase() : autoLine,
  }
}
