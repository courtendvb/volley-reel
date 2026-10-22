// The one place that moves the playhead (design §11). Components call these methods and
// subscribe to state; nothing else writes video.currentTime, so jumps can't overwrite each other.
// All times here are video times (DVW time + Match.offsetSec).

export interface PlaybackState {
  time: number
  duration: number
  paused: boolean
  ready: boolean
}

type Listener = (s: PlaybackState) => void

class Playback {
  private video: HTMLVideoElement | null = null
  private key: string | null = null // which match's video is attached
  private pending: { key: string; t: number; play: boolean } | null = null
  private fps = 30
  private listeners = new Set<Listener>()
  private state: PlaybackState = { time: 0, duration: 0, paused: true, ready: false }
  private detachEvents: (() => void) | null = null

  attach(video: HTMLVideoElement | null, fps: number, key: string | null = null): void {
    if (video === this.video) { this.fps = fps || 30; return }
    this.detachEvents?.()
    this.video = video
    this.key = video ? key : null
    this.fps = fps || 30
    this.set({ time: 0, duration: 0, paused: true, ready: false })
    if (!video) return

    const sync = () => this.set({ time: video.currentTime, duration: video.duration || 0, paused: video.paused, ready: video.readyState >= 1 })
    const applyPending = () => {
      const p = this.pending
      if (p && p.key === this.key) { this.pending = null; this.seek(p.t, { play: p.play }) }
    }
    video.addEventListener('loadedmetadata', applyPending)
    if (video.readyState >= 1) queueMicrotask(applyPending)
    const events = ['loadedmetadata', 'seeked', 'play', 'pause', 'ended', 'durationchange']
    events.forEach(ev => video.addEventListener(ev, sync))
    // requestVideoFrameCallback gives the presented frame's media time — frame-accurate, unlike timeupdate.
    let handle = 0
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      this.set({ ...this.state, time: meta.mediaTime, paused: video.paused })
      handle = video.requestVideoFrameCallback(onFrame)
    }
    handle = video.requestVideoFrameCallback(onFrame)
    this.detachEvents = () => {
      events.forEach(ev => video.removeEventListener(ev, sync))
      video.removeEventListener('loadedmetadata', applyPending)
      video.cancelVideoFrameCallback(handle)
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => { this.listeners.delete(fn) }
  }

  get current(): PlaybackState { return this.state }
  get attachedKey(): string | null { return this.key }

  seek(t: number, opts: { play?: boolean } = {}): void {
    const v = this.video
    if (!v) return
    v.currentTime = this.clamp(t)
    if (opts.play) void v.play()
  }

  // Seek in a given match's video. If another match is on screen, the seek waits until that
  // match's video is attached and has metadata, so it can never land on the outgoing video.
  seekIn(key: string, t: number, opts: { play?: boolean } = {}): void {
    if (key === this.key && this.video && this.video.readyState >= 1) { this.pending = null; this.seek(t, opts); return }
    this.pending = { key, t, play: !!opts.play }
  }

  // Resolves once the frame at `t` is on screen (used by the smoke check).
  async seekAndWait(t: number): Promise<number> {
    const v = this.video
    if (!v) throw new Error('no video')
    v.pause()
    await new Promise<void>(resolve => {
      v.addEventListener('seeked', () => resolve(), { once: true })
      v.currentTime = this.clamp(t)
    })
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000)
      v.requestVideoFrameCallback(() => { clearTimeout(timer); resolve() })
    })
    return v.currentTime
  }

  toggle(): void {
    const v = this.video
    if (!v) return
    if (v.paused) void v.play(); else v.pause()
  }

  nudge(sec: number): void {
    if (this.video) this.seek(this.video.currentTime + sec)
  }

  stepFrames(n: number): void {
    const v = this.video
    if (!v) return
    v.pause()
    this.seek(v.currentTime + n / this.fps)
  }

  private clamp(t: number): number {
    const d = this.video?.duration
    return Math.max(0, d && isFinite(d) ? Math.min(t, d - 0.05) : t)
  }

  private set(s: PlaybackState): void {
    this.state = s
    this.listeners.forEach(fn => fn(s))
  }
}

export const playback = new Playback()
