// The video maximized: the stage fills the screen (fullscreen) with only the video pane shown. The
// stage, not the pane, goes fullscreen: a through-play that moves to another match's video replaces
// the pane, and the stage stays.
import { useEffect, useState } from 'react'
import { playback } from './playback'

const stage = () => document.querySelector<HTMLElement>('.stage')

export const isMaximized = () => !!document.fullscreenElement

export async function setMaximized(on: boolean): Promise<void> {
  if (on === isMaximized()) return
  if (on) await stage()?.requestFullscreen().catch(() => { /* not allowed now (no user action): stays as it is */ })
  else await document.exitFullscreen().catch(() => {})
}

export const toggleMaximized = () => setMaximized(!isMaximized())

// A through-play started maximized: back to the normal view when it ends or is stopped (not when
// the view was already left by hand).
export async function playMaximized(start: () => void): Promise<void> {
  await setMaximized(true)
  start()
  let started = false
  const done = () => { off(); document.removeEventListener('fullscreenchange', left) }
  const left = () => { if (!isMaximized()) done() }
  const off = playback.subscribe(s => {
    if (s.seq) { started = true; return }
    if (!started) return
    done()
    void setMaximized(false)
  })
  document.addEventListener('fullscreenchange', left)
}

export function useMaximized(): boolean {
  const [on, setOn] = useState(isMaximized)
  useEffect(() => {
    const f = () => setOn(isMaximized())
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  return on
}
