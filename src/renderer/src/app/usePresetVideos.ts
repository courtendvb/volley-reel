// Videos made from presets (the search's "プリセットから作る", shared/presets.ts): the dialog's
// open state, making a video, and making one again from the preset it remembers.
import { useMemo, useState, type RefObject } from 'react'
import type { PlayRef } from '../../../shared/filter'
import { cleanPreset, makePreset, presetLabels, presetLookups, presetReels } from '../../../shared/presets'
import type { Reel } from '../../../shared/reel'
import type { ParsedDVW, PlayerRole } from '../../../shared/types'
import { newVideo, type Video } from '../../../shared/video'
import type { PresetChoice } from '../components/PresetDialog'
import type { AppLatest } from './appState'
import { t } from '../../../shared/i18n'

interface Host {
  latest: RefObject<AppLatest>
  dvws: Record<string, ParsedDVW>
  roles: Record<string, PlayerRole> | undefined // the project's positions
  team: string // the project's target team code
  scopeRefs: PlayRef[] // the matches searched now, and the search's results
  results: PlayRef[]
  addScenes: (rs: Reel[]) => void
  addVideo: (v: Video) => void
  putVideo: (v: Video) => void // not recorded for undo
  scenesOnlyIn: (v: Video) => string[]
  dropScenes: (ids: string[]) => Promise<void>
  showScene: (id: string) => void
  setNotice: (n: string) => void
}

export function usePresetVideos(h: Host) {
  const [presetOpen, setPresetOpen] = useState(false)
  const presetLook = useMemo(() => presetLookups(h.dvws, h.roles), [h.dvws, h.roles])

  const makePresetVideo = ({ preset, scenes: specs, name, prefix }: PresetChoice) => {
    const scenes = presetReels(specs, prefix, preset.mode)
    if (!scenes.length) return
    h.addScenes(scenes)
    h.addVideo({ ...newVideo(name, scenes.map(r => r.id)), preset })
    h.showScene(scenes[0].id)
    setPresetOpen(false)
    h.setNotice(t('動画「{0}」を作りました（{1} シーン）', name, scenes.length))
  }

  // Made again from the matches searched now: its own scenes are replaced (and deleted), scenes it
  // shares with other videos only leave it. Its name and settings stay.
  const remakePresetVideo = async (id: string) => {
    const v = h.latest.current.videos.find(x => x.id === id)
    const preset = cleanPreset(v?.preset)
    if (!v || !preset) return
    const { prefix } = presetLabels(preset, h.team)
    const scenes = presetReels(makePreset(preset, h.scopeRefs, h.results, presetLook).scenes, prefix, preset.mode)
    if (!scenes.length) { h.setNotice(t('当てはまるプレーがないため、作り直しませんでした')); return }
    const own = h.scenesOnlyIn(v)
    h.addScenes(scenes)
    h.putVideo({ ...v, sceneIds: scenes.map(r => r.id), updatedAt: new Date().toISOString() })
    await h.dropScenes(own)
    h.showScene(scenes[0].id)
    h.setNotice(t('動画「{0}」を作り直しました（{1} シーン）', v.name, scenes.length))
  }

  return { presetOpen, setPresetOpen, presetLook, makePresetVideo, remakePresetVideo }
}
