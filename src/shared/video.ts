// Videos (v3): a video is an ordered list of scenes, and a scene is what v2 called a reel (marker
// groups of clips). Scenes are shared: a video only refers to them by id, so fixing a scene fixes
// every video that uses it (design §0). The overlay look belongs to the video.
import { ourSide } from './filter'
import type { Annotation } from './annotation'
import type { SlideFlights, SlideMarks } from './court'
import type { CardLayout, OverlayPatch, OverlaySettings } from './overlay'
import { groupRows, markerCardOn, type Clip, type Group, type Marker, type Reel, type Slide, type SlideBg } from './reel'
import type { Match } from './types'
import { t } from './i18n'

export interface Video {
  id: string
  name: string
  sceneIds: string[] // play order; the same scene may appear in several videos
  overlay?: OverlayPatch // read through overlaySettings()
  annotations?: Annotation[] // objects shown on every clip of the video (表示範囲: 動画全体)
  cardAnnotations?: Annotation[] // objects on the video's title card (its opening card)
  cardTitle?: string // the opening card's text when it differs from the name (line breaks: one line each)
  cardLayout?: CardLayout // the opening card's own title place and size
  captionNames?: Record<string, string> // a player's name on the caption in every clip of the video, by player key (Play.playerKey)
  updatedAt: string
}

const uid = () => globalThis.crypto.randomUUID()
const touch = (v: Video): Video => ({ ...v, updatedAt: new Date().toISOString() })

export function newVideo(name: string, sceneIds: string[] = [], overlay?: OverlayPatch): Video {
  return { id: uid(), name, sceneIds: [...sceneIds], overlay, updatedAt: new Date().toISOString() }
}

export function addScene(v: Video, sceneId: string, index = v.sceneIds.length): Video {
  const ids = [...v.sceneIds]
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, sceneId)
  return touch({ ...v, sceneIds: ids })
}

// By position, since the same scene may be in a video twice on purpose.
export function removeSceneAt(v: Video, index: number): Video {
  return touch({ ...v, sceneIds: v.sceneIds.filter((_, i) => i !== index) })
}

export function moveSceneAt(v: Video, from: number, to: number): Video {
  const ids = [...v.sceneIds]
  const [id] = ids.splice(from, 1)
  if (id === undefined) return v
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id)
  return touch({ ...v, sceneIds: ids })
}

// After a scene is deleted, every video drops it.
export function dropScene(v: Video, sceneId: string): Video {
  return v.sceneIds.includes(sceneId) ? touch({ ...v, sceneIds: v.sceneIds.filter(id => id !== sceneId) }) : v
}

// marker null = scene card. opp: the opponent's team code when every clip is from one match (for its logo).
// video: the opening card with the video's name. annotations: objects drawn on the card.
// slide: a slide of a scene, played like a card (drawn as its page instead of a title).
// layout: this card's own title place and size, apart from its kind's.
export type Card = { marker: number | null; name: string; match: string | null; opp?: string | null; video?: boolean; annotations?: Annotation[]; layout?: CardLayout
  slide?: { id: string; bg: SlideBg; flights?: SlideFlights } & SlideMarks }
export type PlanItem =
  | { kind: 'card'; card: Card; durationSec: number }
  | { kind: 'clip'; clip: Clip; sceneId: string; group: Group } // group: the marker group it plays in ('none' = unmarked)

// One scene's clips in play order, with a card before each marker group when marker cards are on,
// and its slides where they sit. order is the scene's play order (playOrder, minus clips that can't
// be played). A clip with two markers is in it twice; walking the groups tells which group each
// occurrence belongs to. A group with only slides still plays (a scene can be just slides).
export function planScene(order: Clip[], scene: Reel, overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  return sceneParts(order, scene, overlay, matches, ourCodes).flatMap(p => p.items)
}

// planScene by group: each marker group that plays (its card first) and the unmarked clips, in order.
function sceneParts(order: Clip[], scene: Reel, overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): { group: Group; items: PlanItem[] }[] {
  const out: { group: Group; items: PlanItem[] }[] = []
  const playable = new Set(order.map(c => c.id))
  const items = (g: Group, ids?: string[]): PlanItem[] => groupRows(scene, g, ids).flatMap((r): PlanItem[] =>
    r.kind === 'slide' ? [slideItem(r.slide)] : playable.has(r.id) ? [{ kind: 'clip', clip: scene.clips[r.id], sceneId: scene.id, group: g }] : [])
  for (const g of scene.groupOrder.filter(m => !scene.markerOff?.[m])) {
    const list = items(g)
    if (!list.length) continue
    if (markerCardOn(scene, g, overlay.titleCard.enabled)) {
      list.unshift({ kind: 'card', card: { marker: g, name: scene.markerCardTitles?.[g] || scene.markerNames[g], ...cardMatch(scene, scene.groups[g], matches, ourCodes), layout: scene.markerCardLayouts?.[g], annotations: scene.markerCardAnnotations?.[g] ?? [] }, durationSec: overlay.titleCard.durationSec })
    }
    out.push({ group: g, items: list })
  }
  // Unmarked clips (and their slides) only play when the scene uses them all; order is chronological.
  const unmarked = new Set(scene.groups.none)
  const rest = scene.scope === 'all' ? items('none', order.filter(c => unmarked.has(c.id)).map(c => c.id)) : []
  if (rest.length) out.push({ group: 'none', items: rest })
  return out
}

function slideItem(s: Slide): PlanItem {
  return { kind: 'card', card: slideCard(s), durationSec: s.durationSec }
}

export function slideCard(s: Slide): Card {
  return { marker: null, name: '', match: null, slide: { id: s.id, bg: s.bg, ...(s.flights ? { flights: s.flights } : {}), ...(s.heat ? { heat: s.heat } : {}), ...(s.landings ? { landings: s.landings } : {}), ...(s.cones ? { cones: s.cones } : {}), ...(s.chart ? { chart: s.chart } : {}), ...(s.charts ? { charts: s.charts } : {}), ...(s.zones ? { zones: s.zones } : {}) }, annotations: s.annotations }
}

// A whole video: each scene in turn, led by a scene card (the scene's name) when scene cards are on.
// orderOf gives a scene's clips in play order (its scope, minus clips that can't be played).
// Used by both the through-play and the export, so the two never disagree.
export function planVideo(video: Video, scenes: Record<string, Reel>, orderOf: (s: Reel) => Clip[], overlay: OverlaySettings,
  matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  return planVideoChapters(video, scenes, orderOf, overlay, matches, ourCodes).plan
}

// Where the video's chapters start (YouTube's chapter list): each scene, and each marker group of a
// scene with more than one. at is an index into the plan; a scene's first chapter takes in its card,
// and the first chapter starts the video (YouTube wants 0:00 first), so the opening card is in it.
export interface Chapter { at: number; title: string }

export function planVideoChapters(video: Video, scenes: Record<string, Reel>, orderOf: (s: Reel) => Clip[], overlay: OverlaySettings,
  matches: Record<string, Match>, ourCodes: string[]): { plan: PlanItem[]; chapters: Chapter[] } {
  const plan: PlanItem[] = [], chapters: Chapter[] = []
  if (overlay.titleCard.videoCard) plan.push({ kind: 'card', card: videoCard(video, scenes, matches, ourCodes), durationSec: overlay.titleCard.durationSec })
  for (const id of video.sceneIds) {
    const s = scenes[id]
    if (!s) continue
    const order = orderOf(s)
    const parts = sceneParts(order, s, overlay, matches, ourCodes)
    if (!parts.length) continue
    const card = sceneCard(s, order, overlay, matches, ourCodes)
    for (const [i, p] of parts.entries()) {
      const name = parts.length === 1 ? s.name : `${s.name} - ${p.group === 'none' ? t('その他') : s.markerNames[p.group] || t('マーカー {0}', p.group)}`
      chapters.push({ at: chapters.length ? plan.length : 0, title: name })
      if (i === 0 && card) plan.push(card)
      plan.push(...p.items)
    }
  }
  return { plan, chapters }
}

// A scene as it plays inside a video: its title card (when on) and then its clips and slides.
// Nothing when the scene has nothing to play.
export function planSceneWithCard(s: Reel, order: Clip[], overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem[] {
  const items = planScene(order, s, overlay, matches, ourCodes)
  const card = sceneCard(s, order, overlay, matches, ourCodes)
  return items.length && card ? [card, ...items] : items
}

function sceneCard(s: Reel, order: Clip[], overlay: OverlaySettings, matches: Record<string, Match>, ourCodes: string[]): PlanItem | null {
  if (!(s.sceneCard ?? overlay.titleCard.sceneCards)) return null
  const card: Card = { marker: null, name: s.cardTitle || s.name, ...cardMatch(s, order.map(c => c.id), matches, ourCodes), annotations: s.cardAnnotations ?? [], layout: s.cardLayout }
  return { kind: 'card', card, durationSec: overlay.titleCard.durationSec }
}

// YouTube's chapter text: "0:00 Title" per line (h:mm:ss past an hour). starts are seconds; the
// first is always 0:00. YouTube also wants at least 3 chapters of 10 seconds or more: short says
// which titles are under that (lengths need the video's length, totalSec).
// After a blank line, each chapter's title and a link to it, with the video's ID left as 〇×11:
// once the video is up, replacing 〇〇〇〇〇〇〇〇〇〇〇 with its ID makes them work.
const VIDEO_ID_MARK = '〇'.repeat(11) // a YouTube video ID is 11 characters

export function chapterText(chapters: { startSec: number; title: string }[], totalSec: number): { text: string; short: string[] } {
  const hours = totalSec >= 3600
  const fmt = (t: number) => {
    const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
    return hours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${Math.floor(s / 60)}:${ss}`
  }
  const starts = chapters.map((c, i) => (i === 0 ? 0 : c.startSec))
  const short = chapters.filter((_, i) => (starts[i + 1] ?? totalSec) - starts[i] < 10).map(c => c.title)
  const list = chapters.map((c, i) => `${fmt(starts[i])} ${c.title}`).join('\n')
  const links = chapters.map((c, i) => `${c.title}\nhttps://youtu.be/${VIDEO_ID_MARK}?t=${Math.floor(starts[i])}`).join('\n')
  return { text: `${list}\n\n${links}\n`, short }
}

// Chapters for part of a video (a scene, a marker group): one where the marker group (or the scene)
// changes. A title card goes with what follows it, a slide with what came before. None for one part
// alone. Named by the marker, with the scene's name too when there is more than one scene.
export function planChapters(plan: PlanItem[], scenes: Record<string, Reel>): Chapter[] {
  const keyOf = (p: PlanItem) => (p.kind === 'clip' ? `${p.sceneId}|${p.group}` : null)
  const keys: (string | null)[] = plan.map(keyOf)
  for (let i = plan.length - 1; i >= 0; i--) { const p = plan[i]; if (!keys[i] && p.kind === 'card' && !p.card.slide) keys[i] = keys[i + 1] ?? null }
  for (let i = 0; i < plan.length; i++) if (!keys[i]) keys[i] = keys[i - 1] ?? keys.find(Boolean) ?? null
  const sceneIds = new Set(keys.filter(Boolean).map(k => k!.split('|')[0]))
  const out: Chapter[] = []
  keys.forEach((k, i) => {
    if (!k || (i > 0 && keys[i - 1] === k)) return
    const [sceneId, g] = k.split('|'), s = scenes[sceneId]
    const marker = g === 'none' ? t('その他') : s?.markerNames[Number(g) as Marker] || t('マーカー {0}', g)
    out.push({ at: out.length ? i : 0, title: sceneIds.size > 1 ? `${s?.name ?? ''} - ${marker}` : marker })
  })
  return out.length > 1 ? out : []
}

// The same chapters for the MP4 itself (ffmpeg's metadata file), so players such as VLC list them and
// jump to them. Written while the segments are joined with stream copy: the picture is not touched.
// Every chapter keeps its place, however short (the 10 s rule is YouTube's alone); times in ms.
export function chapterMetadata(chapters: { startSec: number; title: string }[], totalSec: number): string {
  // A title on one line, with the signs the format reserves escaped by a backslash.
  const esc = (v: string) => v.replace(/[\r\n]+/g, ' ').replace(/[\\=;#]/g, c => `\\${c}`)
  const ms = (sec: number) => Math.max(0, Math.round(sec * 1000))
  const starts = chapters.map((c, i) => (i === 0 ? 0 : c.startSec))
  const lines = [';FFMETADATA1']
  chapters.forEach((c, i) => lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(starts[i])}`, `END=${ms(starts[i + 1] ?? totalSec)}`, `title=${esc(c.title)}`))
  return lines.join('\n') + '\n'
}

// File names for one MP4 per scene: the scene's name with characters Windows won't take replaced,
// and " (2)", " (3)"… on names already used (Windows ignores case).
export function sceneFileNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map(n => {
    const base = n.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').trim() || t('シーン')
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`
    used.add(name.toLowerCase())
    return name
  })
}

// The video's opening card: its name, and the match line when the whole video is one match.
export function videoCard(video: Video, scenes: Record<string, Reel>, matches: Record<string, Match>, ourCodes: string[]): Card {
  const ids = new Set(video.sceneIds.flatMap(id => Object.values(scenes[id]?.clips ?? {}).map(c => c.matchId)))
  const m = ids.size === 1 ? matches[[...ids][0]] : undefined
  return { marker: null, video: true, layout: video.cardLayout, name: video.cardTitle || video.name, match: m ? cardMatchLabel(m, ourCodes) : null, opp: m ? cardOpponent(m, ourCodes) : null, annotations: video.cardAnnotations ?? [] }
}

// The card's match line, when every clip it introduces comes from one match.
export function cardMatch(scene: Reel, clipIds: string[], matches: Record<string, Match>, ourCodes: string[]): { match: string | null; opp: string | null } {
  const ids = new Set(clipIds.map(id => scene.clips[id]?.matchId).filter(Boolean))
  const m = ids.size === 1 ? matches[[...ids][0]!] : undefined
  return m ? { match: cardMatchLabel(m, ourCodes), opp: cardOpponent(m, ourCodes) } : { match: null, opp: null }
}

// The other team's code, or null when neither or both teams are ours.
function cardOpponent(m: Match, codes: string[]): string | null {
  const side = ourSide(m.teams, codes)
  if (side === null || codes.includes(m.teams[0].code) && codes.includes(m.teams[1].code)) return null
  return side === '*' ? m.teams[1].code : m.teams[0].code
}

// Title card match line: "VS SMT · 2026-10-11".
function cardMatchLabel(m: Match, codes: string[]): string {
  return `VS ${opponentLabel(m, codes)}${m.date ? ` · ${m.date}` : ''}`
}

// The opponent's code; both teams' when neither is ours.
export function opponentLabel(m: Match, codes: string[]): string {
  const side = ourSide(m.teams, codes)
  return side === '*' ? m.teams[1].code : side === 'a' ? m.teams[0].code : `${m.teams[0].code}-${m.teams[1].code}`
}
