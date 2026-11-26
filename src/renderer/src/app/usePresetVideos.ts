// Videos made from presets (the search's "プリセットから作る", shared/presets.ts): the dialog's
// open state, making a video, and making one again from the preset it remembers. And videos of a
// team's habits found by themselves (the インサイト dialog).
import { useMemo, useState, type RefObject } from 'react'
import type { PlayRef } from '../../../shared/filter'
import { cleanPreset, makePreset, presetLabels, presetLookups, presetReels, type VideoPreset } from '../../../shared/presets'
import { insightReels } from '../../../shared/insights'
import type { Reel } from '../../../shared/reel'
import type { ParsedDVW, PlayerRole } from '../../../shared/types'
import { newVideo, type Video } from '../../../shared/video'
import type { PresetChoice } from '../components/PresetDialog'
import type { InsightChoice } from '../components/InsightDialog'
import type { AppLatest } from './appState'
import type { Snapshot } from './useUndo'
import { t } from '../../../shared/i18n'

interface Host {
  latest: RefObject<AppLatest>
  dvws: Record<string, ParsedDVW>
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
  const addMadeVideo = (name: string, scenes: Reel[], preset?: VideoPreset) => {
    const v: Video = { ...newVideo(name, scenes.map(r => r.id), h.latest.current.settings?.overlay), ...(preset ? { preset } : {}) }
    h.record([{ kind: 'video', id: v.id, value: null }, ...scenes.map(r => ({ kind: 'scene', id: r.id, value: null }) as Snapshot)], false)
    h.addScenes(scenes)
    h.addVideo(v)
    h.showScene(scenes[0].id)
    h.setNotice(t('動画「{0}」を作りました（{1} シーン）', name, scenes.length))
  }

  const makePresetVideo = ({ preset, scenes: specs, name, prefix }: PresetChoice) => {
    const scenes = presetReels(specs, prefix, preset.mode)
    if (!scenes.length) return
    addMadeVideo(name, scenes, preset)
    setPresetOpen(false)
  }

  // A video of the habits picked in the インサイト dialog (shared/insights.ts), a scene each.
  const makeInsightVideo = ({ insights, name, ...options }: InsightChoice) => {
    const scenes = insightReels(insights, options)
    if (!scenes.length) return
    addMadeVideo(name, scenes)
    setInsightOpen(false)
  }

  // Made again from the matches searched now: its own scenes are replaced (and deleted), scenes it
  // shares with other videos only leave it. Its name and settings stay. One undo step puts it back.
  const remakePresetVideo = (id: string) => {
    const v = h.latest.current.videos.find(x => x.id === id)
    const preset = cleanPreset(v?.preset)
    if (!v || !preset) return
    const { prefix } = presetLabels(preset, h.team)
    const scenes = presetReels(makePreset(preset, h.scopeRefs, h.results, presetLook).scenes, prefix, preset.mode)
    if (!scenes.length) { h.setNotice(t('当てはまるプレーがないため、作り直しませんでした')); return }
    const own = h.scenesOnlyIn(v)
    h.record([h.videoSnap(v.id), ...scenes.map(r => ({ kind: 'scene', id: r.id, value: null }) as Snapshot), ...own.map(h.sceneSnap)], false)
    h.addScenes(scenes)
    h.putVideo({ ...v, sceneIds: scenes.map(r => r.id), updatedAt: new Date().toISOString() })
    h.removeScenes(own)
    h.showScene(scenes[0].id)
    h.setNotice(t('動画「{0}」を作り直しました（{1} シーン）', v.name, scenes.length))
  }

  return { presetOpen, setPresetOpen, presetLook, makePresetVideo, remakePresetVideo, insightOpen, setInsightOpen, makeInsightVideo }
}
