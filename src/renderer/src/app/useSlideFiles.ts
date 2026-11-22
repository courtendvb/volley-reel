// Slides read from a file are checked against it when the project opens and whenever the window
// comes back to the front (after exporting from PowerPoint again): a bar offers to read them again.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Reel } from '../../../shared/reel'
import type { ImportProgress } from '../../../shared/types'
import { pdfPages } from '../assets'
import { t } from '../../../shared/i18n'

const api = window.api

function sourcesOf(rs: Reel[]) {
  const out = new Map<string, number>() // path -> the oldest time a slide read it
  for (const r of rs) for (const s of r.slides ?? []) {
    if (s.bg.kind === 'image' && s.bg.source) out.set(s.bg.source.path, Math.min(out.get(s.bg.source.path) ?? Infinity, s.bg.source.mtimeMs))
  }
  return out
}

export function useSlideFiles(reelsNow: () => Reel[], updateReel: (r: Reel) => void, setProgress: (p: ImportProgress | null) => void, setNotice: (n: string) => void) {
  const [staleSlides, setStaleSlides] = useState<string[]>([])
  const dismissedSlides = useRef(new Map<string, number>()) // "later": not asked again until the file changes again
  const reelsRef = useRef(reelsNow)
  reelsRef.current = reelsNow
  const checkSlideFiles = useCallback(async (rs: Reel[] = reelsRef.current()) => {
    const srcs = sourcesOf(rs)
    if (!srcs.size) { setStaleSlides([]); return }
    const times = await api.slideFileTimes([...srcs.keys()]).catch(() => ({} as Record<string, number | null>))
    setStaleSlides([...srcs].filter(([path, t]) => {
      const now = times[path]
      return now != null && now > t + 1 && dismissedSlides.current.get(path) !== now
    }).map(([path]) => path))
  }, [])
  useEffect(() => {
    const onFocus = () => void checkSlideFiles()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkSlideFiles])
  const laterSlides = async () => {
    const paths = staleSlides
    setStaleSlides([])
    const times = await api.slideFileTimes(paths).catch(() => ({} as Record<string, number | null>))
    for (const path of paths) { const t = times[path]; if (t != null) dismissedSlides.current.set(path, t) }
  }
  // Each slide from the file gets its page again (a picture: the picture); pages the file no longer
  // has keep their old picture, and new pages are only reported.
  const reloadSlideFiles = async (paths: string[]) => {
    const notes: string[] = []
    setStaleSlides(s => s.filter(x => !paths.includes(x)))
    try {
      for (const path of paths) {
        const using = reelsRef.current().flatMap(r => (r.slides ?? []).flatMap(s => (s.bg.kind === 'image' && s.bg.source?.path === path ? [s.bg.source] : [])))
        if (!using.length) continue
        const name = using[0].name
        try {
          const f = await api.readSlideFile(path)
          const assets = new Map<number | null, string>()
          let total: number | undefined
          if (f.kind === 'image') assets.set(null, f.assetId)
          else {
            const want = new Set(using.map(s => s.page ?? 1))
            total = await pdfPages(f.data, async (n, png, all) => {
              setProgress({ stage: 'save', message: t('{0} を読み直しています（{1} / {2} ページ）', f.name, n, all), ratio: n / all })
              if (want.has(n)) assets.set(n, await api.saveAsset(png))
            }, Math.max(...want))
            // pdfPages stops at the last page used; the page count comes from the file.
          }
          for (const r of reelsRef.current()) {
            if (!r.slides?.some(s => s.bg.kind === 'image' && s.bg.source?.path === path)) continue
            updateReel({ ...r, updatedAt: new Date().toISOString(), slides: r.slides.map(s => {
              if (s.bg.kind !== 'image' || s.bg.source?.path !== path) return s
              const id = assets.get(f.kind === 'image' ? null : s.bg.source.page ?? 1)
              if (!id) return s
              return { ...s, bg: { ...s.bg, assetId: id, source: { ...s.bg.source, mtimeMs: f.mtimeMs, ...(total ? { pages: total } : {}) } } }
            }) })
          }
          if (f.kind === 'pdf' && total) {
            const gone = [...new Set(using.map(s => s.page ?? 1))].filter(n => n > total!).sort((a, b) => a - b)
            if (gone.length) notes.push(t('{0} は {1} ページになりました。p.{2} のスライドは前のままです', name, total, gone.join(', ')))
            const before = Math.max(...using.map(s => s.pages ?? 0))
            if (before && total > before) notes.push(t('{0} のページが {1} → {2} に増えました。増えたページは「＋」→「PDF・画像を読み込む」で入れられます', name, before, total))
          }
        } catch (e) {
          notes.push(t('{0} を読み直せませんでした: {1}', name, (e as Error).message))
        }
      }
    } finally {
      setProgress(null)
    }
    setNotice(notes.length ? notes.join(' / ') : t('スライドを読み直しました'))
  }
  return { staleSlides, checkSlideFiles, laterSlides, reloadSlideFiles }
}
