// Videos made from presets (the search's "プリセットから作る", shared/presets.ts): the dialog's
// open state, making a video, and making one again from the preset it remembers. And videos of a
// team's habits found by themselves (the インサイト dialog).
import { useMemo, useState, type RefObject } from 'react'
import type { PlayRef } from '../../../shared/filter'
import { cleanPreset, makePreset, presetLabels, presetLookups, presetReels } from '../../../shared/presets'
import { cleanVideoInsight, insightReels, refindInsights, videoInsight, type InsightDress, type League } from '../../../shared/insights'
import type { Reel } from '../../../shared/reel'
import type { ParsedDVW, PlayerRole } from '../../../shared/types'
import { newVideo, type Video } from '../../../shared/video'
import type { PresetChoice } from '../components/PresetDialog'
import type { InsightChoice } from '../components/InsightDialog'
import type { AppLatest } from './appState'
import type { Snapshot } from './useUndo'
import { getLang, inLang, t } from '../../../shared/i18n'

interface Host {
  latest: RefObject<AppLatest>
  dvws: Record<string, ParsedDVW>
  leagueRef: RefObject<League | null> // the league, once the インサイト dialog has loaded it
  dress: InsightDress // an insight scene's headline style and each match's court, to paint its zones
  roles: Record<string, PlayerRole> | undefined // the project's positions
  team: string // the project's target team code
  matchIds: string[] // the project's matches, oldest first
  scopeRefs: PlayRef[] // the matches searched now, and the search's results
  results: PlayRef[]
  addScenes: (rs: Reel[]) => void
  addVideo: (v: Video) => void
  putVideo: (v: Video) => void // not recorded: the caller's undo step covers it
  scenesOnlyIn: (v: Video) => string[]
  removeScenes: (ids: string[]) => void
  showScene: (id: string) => void
  setNotice: (n: string) => void
  record: (s: Snapshot[], merge: boolean) => void // one undo step
  sceneSnap: (id: string) => Snapshot
  videoSnap: (id: string) => Snapshot
}

export function usePresetVideos(h: Host) {
  const [presetOpen, setPresetOpen] = useState(false)
  const presetLook = useMemo(() => presetLookups(h.dvws, h.roles, h.matchIds), [h.dvws, h.roles, h.matchIds])

  const [insightOpen, setInsightOpen] = useState(false)

  // A new video of these scenes, as one undo step.
  const addMadeVideo = (name: string, scenes: Reel[], made: Pick<Video, 'preset' | 'insight'>) => {
    const v: Video = { ...newVideo(name, scenes.map(r => r.id), h.latest.current.settings?.overlay), ...made }
    h.record([{ kind: 'video', id: v.id, value: null }, ...scenes.map(r => ({ kind: 'scene', id: r.id, value: null }) as Snapshot)], false)
    h.addScenes(scenes)
    h.addVideo(v)
    h.showScene(scenes[0].id)
    h.setNotice(t('動画「{0}」を作りました（{1} シーン）', name, scenes.length))
  }

  const makePresetVideo = ({ preset, scenes: specs, name, prefix }: PresetChoice) => {
    const scenes = presetReels(specs, prefix, preset.mode)
    if (!scenes.length) return
    addMadeVideo(name, scenes, { preset })
    setPresetOpen(false)
  }

  // A video of the habits picked in the インサイト dialog (shared/insights.ts), a scene each.
  // Made in the language chosen for its headlines: in another than the interface's, the habits are
  // found again in it (the same habits, worded in it).
  const makeInsightVideo = ({ team, focus, insights, name, league, ...options }: InsightChoice) => {
    const lang = options.lang ?? getLang(), here = lang === getLang()
    const scenes = inLang(lang, () => {
      const list = here ? insights : refindInsights(h.scopeRefs, videoInsight(team, insights, options, focus, league), { ...presetLook, league: league ? h.leagueRef.current : null }).insights
      return insightReels(list, options, presetLook.matchIndex, Math.random, h.dress)
    })
    if (!scenes.length) return
    addMadeVideo(name, scenes, { insight: videoInsight(team, insights, options, focus, league) })
    setInsightOpen(false)
  }

  // Made again from the matches searched now: its own scenes are replaced (and deleted), scenes it
  // shares with other videos only leave it. Its name and settings stay. One undo step puts it back.
  // A preset video gathers its plays again; an insight video finds its habits again (one whose habit
  // is no longer clear leaves it, and the notice says how many).
  const remakePresetVideo = (id: string) => {
    const v = h.latest.current.videos.find(x => x.id === id)
    if (!v) return
    const preset = cleanPreset(v.preset), insight = preset ? null : cleanVideoInsight(v.insight)
    let scenes: Reel[], gone = 0
    if (preset) scenes = presetReels(makePreset(preset, h.scopeRefs, h.results, presetLook).scenes, presetLabels(preset, h.team).prefix, preset.mode)
    else if (insight) {
      const made = inLang(insight.lang ?? getLang(), () => {
        const found = refindInsights(h.scopeRefs, insight, { ...presetLook, league: insight.league ? h.leagueRef.current : null })
        return { found, reels: insightReels(found.insights, insight, presetLook.matchIndex, Math.random, h.dress) }
      })
      scenes = made.reels
      gone = made.found.gone
    } else return
    if (!scenes.length) { h.setNotice(insight ? t('はっきりした傾向が残っていないため、作り直しませんでした') : t('当てはまるプレーがないため、作り直しませんでした')); return }
    const own = h.scenesOnlyIn(v)
    h.record([h.videoSnap(v.id), ...scenes.map(r => ({ kind: 'scene', id: r.id, value: null }) as Snapshot), ...own.map(h.sceneSnap)], false)
    h.addScenes(scenes)
    h.putVideo({ ...v, sceneIds: scenes.map(r => r.id), updatedAt: new Date().toISOString() })
    h.removeScenes(own)
    h.showScene(scenes[0].id)
    h.setNotice(gone ? t('動画「{0}」を作り直しました（{1} シーン。傾向がはっきりしなくなった {2} シーンは外しました）', v.name, scenes.length, gone)
      : t('動画「{0}」を作り直しました（{1} シーン）', v.name, scenes.length))
  }

  return { presetOpen, setPresetOpen, presetLook, makePresetVideo, remakePresetVideo, insightOpen, setInsightOpen, makeInsightVideo }
}
