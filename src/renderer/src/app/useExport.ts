// Export (design §3.8): the job is built here (PNG layers drawn with the preview's functions) and
// handed to the main process, which encodes in the background; the app stays usable meanwhile.
import { chartName } from '../../../shared/chart'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Clip, Marker, Reel } from '../../../shared/reel'
import type { OverlaySettings } from '../../../shared/overlay'
import { flightTiming, playMarks, type GridStyle } from '../../../shared/court'
import type { ExportEvent, Match, ParsedDVW, ProjectSettings } from '../../../shared/types'
import { planScene, planSceneWithCard, planVideoChapters, sceneFileNames, type PlanItem, type Video } from '../../../shared/video'
import type { ClipInfo } from '../components/ReelPanel'
import type { ExportTarget } from '../components/ExportPanel'
import { EXPORT_HEIGHT, buildExportJob } from '../exportRender'
import type { AppLatest } from './appState'
import { clipPlayedSec } from '../../../shared/timing'
import { t } from '../../../shared/i18n'
import { formatLength } from '../format'

const api = window.api
const onlyMarker = (sc: Reel, m: Marker) => ({ ...sc, markerOff: {}, scope: 'marked' as const, groupOrder: [m] })

export type ExportState = { status: 'preparing' | 'running' | ExportEvent['type']; ratio: number; message: string; outPath?: string }

// What the export panel lists, read from the render's state.
interface Now {
  video: Video | null; reel: Reel | null; reels: Reel[]; overlay: OverlaySettings; matches: Record<string, Match>
  settings: ProjectSettings | undefined; dvws: Record<string, ParsedDVW>
  infoFor: (c: Clip, scene: Reel | null) => ClipInfo; orderOf: (s: Reel) => Clip[]
}

export function useExport(now: Now, latest: RefObject<AppLatest>, currentPlan: (target: 'video' | 'scene') => PlanItem[], gridStyleRef: RefObject<GridStyle>) {
  const { video, reel, reels, overlay, matches, settings, dvws, infoFor, orderOf } = now
  const [exportState, setExportState] = useState<ExportState | null>(null)
  // Scene by scene: one MP4 after another (see exportScenes).
  const sceneRun = useRef<{ items: { name: string; plan: PlanItem[]; path: string }[]; i: number } | null>(null)

  useEffect(() => api.onExportEvent(ev => {
    // Scene by scene: the bar shows the whole run, the text which scene is being written.
    const run = sceneRun.current
    const n = run?.items.length ?? 1, at = run ? t('シーン {0} / {1}「{2}」: ', run.i + 1, n, run.items[run.i].name) : ''
    if (ev.type !== 'progress' && ev.type !== 'done') sceneRun.current = null
    if (ev.type === 'progress') setExportState(s => ({ ...(s ?? { message: '' }), status: 'running', ratio: ((run?.i ?? 0) + ev.ratio) / n, message: t('{0}{1} / {2} 本目を書き出し中{3}', at, ev.item + 1, ev.items, eta(ev.ratio, ev.elapsedSec)) }))
    else if (ev.type === 'done' && run && run.i + 1 < n) {
      run.i++
      const next = run.items[run.i]
      void startExportRef.current(next.path, { plan: next.plan, name: next.name }).then(job => { if (!job) sceneRun.current = null })
    }
    else if (ev.type === 'done' && run) { sceneRun.current = null; setExportState({ status: 'done', ratio: 1, outPath: ev.outPath, message: t('シーンごとに {0} 本を書き出しました', n) }) }
    else if (ev.type === 'done') {
      // YouTube only shows chapters when there are 3 or more and each is 10 seconds or longer.
      const short = ev.shortChapters ?? [], few = (ev.chapterCount ?? 0) < 3
      const why = [few ? t('チャプターが {0} つだけ', ev.chapterCount) : '', short.length ? t('10 秒未満: {0}', short.join(t('、'))) : ''].filter(Boolean).join(t('・'))
      const chapters = !ev.chaptersPath ? '' : t('。YouTube のチャプターを「{0}」に書き出しました{1}', ev.chaptersPath.split(/[\\/]/).pop(), why ? t('（{0}。YouTube では 3 つ以上・各 10 秒以上でないとチャプターになりません）', why) : '')
      setExportState({ status: 'done', ratio: 1, outPath: ev.outPath, message: t('書き出しました（{0} 秒分を {1} 秒、{2} MB）{3}', Math.round(ev.footageSec), Math.round(ev.elapsedSec), (ev.sizeBytes / 1e6).toFixed(1), chapters) })
    }
    else if (ev.type === 'error') setExportState({ status: 'error', ratio: 0, message: t('{0}書き出しに失敗しました: {1}{2}', at, ev.message, run ? t('（残りのシーンは書き出していません）') : '') })
    else setExportState({ status: 'cancelled', ratio: 0, message: t('書き出しをキャンセルしました{0}', run ? t('（{0} / {1} 本は書き出し済み）', run.i, n) : '') })
  }), [])

  // The whole video by default, with its YouTube chapters (a .txt beside the MP4) when they are on; part of it (a
  // scene, one marker group) when a plan and a file name are given.
  const startExport = useCallback(async (outPathArg?: string, part?: { plan: PlanItem[]; name: string }) => {
    const { video: v, reels: rs, overlay: ov, matches: ms, infoFor: inf, orderOf: of, settings: st } = latest.current
    const whole = !part && v ? planVideoChapters(v, Object.fromEntries(rs.map(s => [s.id, s])), of, ov, ms, st?.ourTeamCodes ?? []) : null
    const plan = part?.plan ?? whole?.plan ?? []
    if (!v || !plan.some(p => p.kind === 'clip' || p.card.slide)) return null
    const outPath = outPathArg ?? await api.chooseExportPath(part?.name ?? v.name)
    if (!outPath) return null
    // Between the scenes of a scene-by-scene run the bar stays where it is.
    setExportState(s => ({ status: 'preparing', ratio: sceneRun.current ? s?.ratio ?? 0 : 0, message: t('オーバーレイを準備しています') }))
    try {
      const byId = Object.fromEntries(rs.map(s => [s.id, s]))
      const job = await buildExportJob(plan, ov,
        { range: (c, sceneId) => inf(c, byId[sceneId] ?? null).range, overlayData: c => latest.current.overlayData!(c), matches: ms,
          sceneAnnotations: id => byId[id]?.annotations ?? [], videoAnnotations: v.annotations ?? [],
          markerAnnotations: (id, g) => (g === 'none' ? [] : byId[id]?.markerAnnotations?.[g] ?? []),
          court: c => {
            const fit = ms[c.matchId]?.court, plays = latest.current.dvwsRef?.[c.matchId]?.plays, play = plays?.[c.playId]
            const dvws = latest.current.dvwsRef ?? {}
            return fit && play ? { fit, zones: playMarks(play, fit, plays![c.playId + 1], gridStyleRef.current, () => Object.values(dvws).flatMap(x => x.plays), { filtered: () => latest.current.results.map(r => r.play), name: chartName(dvws[c.matchId], play) }), flight: flightTiming(play, ms[c.matchId].offsetSec, c) } : null
          },
          courtStyle: gridStyleRef.current }, outPath, ov.chapters.enabled ? whole?.chapters : undefined)
      await api.startExport(job)
      return job
    } catch (e) {
      setExportState({ status: 'error', ratio: 0, message: t('書き出しに失敗しました: {0}', (e as Error).message) })
      return null
    }
  }, [currentPlan])
  const startExportRef = useRef(startExport)
  startExportRef.current = startExport

  // The export panel's choices: the whole video, the open scene, each marker group of it.
  const planSec = (plan: PlanItem[]) => {
    const byId = Object.fromEntries(reels.map(s => [s.id, s]))
    let sec = 0, clips = 0, slides = 0
    for (const it of plan) {
      if (it.kind === 'card') { sec += it.durationSec; if (it.card.slide) slides++; continue }
      const r = infoFor(it.clip, byId[it.sceneId] ?? null).range
      if (r) { sec += clipPlayedSec(r, it.clip.timing); clips++ }
    }
    return { sec, clips, slides, empty: !clips && !slides }
  }
  const slidesNote = (n: number) => (n ? t('・スライド {0}', n) : '')
  const markerPlan = (sc: Reel, m: Marker) => {
    const only = onlyMarker(sc, m)
    return planScene(orderOf(only), only, overlay, matches, settings?.ourTeamCodes ?? [])
  }
  // Each scene of the video with something to play, once, in the video's order: its plan as in the
  // video (its card, then its clips) and the file name it is saved under.
  const scenePlans = () => {
    const { video: v, reels: rs, orderOf: of, overlay: ov, matches: ms, settings: st } = latest.current
    if (!v) return []
    const byId = Object.fromEntries(rs.map(s => [s.id, s]))
    const list = [...new Set(v.sceneIds)].flatMap(id => {
      const s = byId[id]
      const plan = s ? planSceneWithCard(s, of(s), ov, ms, st?.ourTeamCodes ?? []) : []
      return s && plan.some(p => p.kind === 'clip' || p.card.slide) ? [{ name: s.name, plan }] : []
    })
    const files = sceneFileNames(list.map(x => x.name))
    return list.map((x, i) => ({ ...x, file: files[i] }))
  }
  // Rebuilt when the video, its scenes or the overlay change (planSec and markerPlan read the same state).
  const exportTargets: ExportTarget[] = useMemo(() => {
    if (!video) return []
    const out: ExportTarget[] = []
    const vp = planSec(currentPlan('video'))
    out.push({ key: 'video', label: t('すべて書き出し'), detail: t('{0} シーン・{1} クリップ{2}・{3}', video.sceneIds.length, vp.clips, slidesNote(vp.slides), formatLength(vp.sec)), empty: vp.empty,
      hint: t('動画「{0}」全体を 1 本に', video.name) })
    const each = scenePlans()
    if (video.sceneIds.length > 1 || each.length > 1) {
      const sec = each.reduce((a, x) => a + planSec(x.plan).sec, 0)
      out.push({ key: 'scenes', label: t('シーンごとに書き出し'), detail: t('{0} 本・{1}', each.length, formatLength(sec)), empty: !each.length,
        hint: t('シーンを 1 本ずつ、シーンの名前のファイルに。フォルダを選ぶと順に書き出す') })
    }
    if (reel) {
      const sp = planSec(currentPlan('scene'))
      out.push({ key: 'scene', label: t('シーン「{0}」だけ', reel.name), detail: t('{0} クリップ{1}・{2}', sp.clips, slidesNote(sp.slides), formatLength(sp.sec)), empty: sp.empty })
      for (const m of reel.groupOrder) {
        if (!reel.groups[m].length && !reel.slides?.some(s => s.group === m)) continue
        const mp = planSec(markerPlan(reel, m))
        out.push({ key: `marker:${m}`, label: reel.markerNames[m] ? t('マーカー {0}「{1}」だけ', m, reel.markerNames[m]) : t('マーカー {0} だけ', m), detail: t('{0} クリップ{1}・{2}', mp.clips, slidesNote(mp.slides), formatLength(mp.sec)), empty: mp.empty })
      }
    }
    return out
  }, [video, reel, reels, overlay, matches, settings, dvws])
  const exportInfo = t('{0}p・{1}・{2}', EXPORT_HEIGHT, overlay.transition.fade ? t('フェードあり') : t('フェードなし'), overlay.titleCard.videoCard || overlay.titleCard.sceneCards || overlay.titleCard.enabled ? t('タイトルカードあり') : t('タイトルカードなし'))
  const exportTarget = (key: string) => {
    if (key === 'video') { void startExport(); return }
    if (key === 'scenes') { void exportScenes(); return }
    const sc = latest.current.reel
    if (!sc) return
    if (key === 'scene') { void startExport(undefined, { plan: currentPlan('scene'), name: `${video?.name ?? sc.name} - ${sc.name}` }); return }
    void exportMarker(sc.id, Number(key.split(':')[1]) as Marker)
  }
  // One MP4 per scene, named after it, into a folder picked once. They export one after another:
  // the export events start the next (sceneRun), and an error or a cancel stops the rest.
  // dir: the folder without asking (smoke runs only).
  const exportScenes = async (dir?: string) => {
    const list = scenePlans()
    if (!list.length) return
    const r = dir ? { paths: list.map(x => `${dir}/${x.file}.mp4`), existing: [] } : await api.chooseExportFolder(list.map(x => x.file))
    if (!r) return
    if (r.existing.length && !confirm(t('同じ名前のファイルが {0} 本あります。上書きしますか？\n{1}', r.existing.length, r.existing.map(p => p.split(/[\\/]/).pop()).join('\n')))) return
    sceneRun.current = { items: list.map((x, i) => ({ name: x.name, plan: x.plan, path: r.paths[i] })), i: 0 }
    const first = sceneRun.current.items[0]
    if (!await startExport(first.path, { plan: first.plan, name: first.name })) sceneRun.current = null
  }
  // One marker group of a scene as its own MP4: its card (when on) and its clips, with the video's
  // overlays and objects. A group switched off can still be exported this way.
  const exportMarker = (sceneId: string, m: Marker, outPath?: string) => {
    const { reels: rs, orderOf: of, overlay: ov, matches: ms, settings: st, video: v } = latest.current
    const sc = rs.find(x => x.id === sceneId)
    if (!sc) return Promise.resolve(null)
    const only = onlyMarker(sc, m)
    const plan = planScene(of(only), only, ov, ms, st?.ourTeamCodes ?? [])
    const name = `${v?.name ?? sc.name} - ${sc.markerNames[m] || t('マーカー{0}', m)}`
    return startExport(outPath, { plan, name })
  }

  return { exportState, setExportState, startExport, exportScenes, exportMarker, exportTargets, exportInfo, exportTarget }
}

function eta(ratio: number, elapsedSec: number): string {
  if (ratio < 0.03 || elapsedSec < 2) return ''
  const left = Math.max(0, Math.round(elapsedSec / ratio - elapsedSec))
  return t('・残り約 {0}', left >= 60 ? t('{0}分{1}秒', Math.floor(left / 60), left % 60) : t('{0}秒', left))
}
