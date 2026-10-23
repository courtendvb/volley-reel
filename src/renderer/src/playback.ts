// The one place that moves the playhead (design §11). Components call these methods and
// subscribe to state; nothing else writes video.currentTime, so jumps can't overwrite each other.
// All times here are video times (DVW time + Match.offsetSec).
import type { Card } from '../../shared/video'

export interface SeqItem {
  key: string // match id
  in: number
  out: number
}

// A title card in a through-play: shown over the paused video for durationSec, then the next item.
export interface CardItem {
  card: Card // marker null = scene card (or the video's opening card)
  durationSec: number
}

export type SequenceItem = SeqItem | CardItem
const isCard = (it: SequenceItem): it is CardItem => 'card' in it

export interface PlaybackState {
  time: number
  duration: number
  paused: boolean
  ready: boolean
  seq: { index: number; total: number } | null // through-play position, when a reel is playing
  loop: SeqItem | null // the clip being trimmed: playback wraps from OUT back to IN
  card: CardItem['card'] | null // title card on screen during a through-play
  cardSec: number // how long that card stays up (0 without one)
}

type Listener = (s: PlaybackState) => void

class Playback {
  private video: HTMLVideoElement | null = null
  private key: string | null = null // which match's video is attached
  private pending: { key: string; t: number; play: boolean } | null = null
  private fps = 30
  private listeners = new Set<Listener>()
  private state: PlaybackState = { time: 0, duration: 0, paused: true, ready: false, seq: null, loop: null, card: null, cardSec: 0 }
  private detachEvents: (() => void) | null = null
  private seq: { items: SequenceItem[]; index: number; onIndex: (i: number | null) => void } | null = null
  private cardTimer = 0

  attach(video: HTMLVideoElement | null, fps: number, key: string | null = null): void {
    if (video === this.video) { this.fps = fps || 30; return }
    this.detachEvents?.()
    this.video = video
    this.key = video ? key : null
    this.fps = fps || 30
    this.set({ ...this.state, time: 0, duration: 0, paused: true, ready: false })
    if (!video) return

    const sync = () => this.set({ ...this.state, time: video.currentTime, duration: video.duration || 0, paused: video.paused, ready: video.readyState >= 1 })
    const applyPending = () => {
      const p = this.pending
      if (p && p.key === this.key) { this.pending = null; this.rawSeek(p.t, p.play) }
    }
    video.addEventListener('loadedmetadata', applyPending)
    if (video.readyState >= 1) queueMicrotask(applyPending)
    const events = ['loadedmetadata', 'seeked', 'play', 'pause', 'ended', 'durationchange']
    events.forEach(ev => video.addEventListener(ev, sync))
    // requestVideoFrameCallback gives the presented frame's media time — frame-accurate, unlike timeupdate.
    let handle = 0
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      this.set({ ...this.state, time: meta.mediaTime, paused: video.paused })
      this.checkSequence(meta.mediaTime)
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
  // Video element state, for smoke-check failure messages.
  get debugVideo(): string {
    const v = this.video
    if (!v) return 'no video'
    const b = v.buffered
    const ranges = Array.from({ length: b.length }, (_, i) => `${b.start(i).toFixed(1)}-${b.end(i).toFixed(1)}`).join(',')
    return `visibility=${document.visibilityState} paused=${v.paused} ready=${v.readyState} net=${v.networkState} seeking=${v.seeking} err=${v.error?.code ?? '-'} buffered=[${ranges}]`
  }

  // User seeks (list clicks, scrubber, nudges) end a through-play: the user has taken over.
  seek(t: number, opts: { play?: boolean } = {}): void {
    this.stopSequence()
    this.rawSeek(t, !!opts.play)
  }

  // Seek in a given match's video. If another match is on screen, the seek waits until that
  // match's video is attached and has metadata, so it can never land on the outgoing video.
  seekIn(key: string, t: number, opts: { play?: boolean } = {}): void {
    this.stopSequence()
    this.queueSeek(key, t, !!opts.play)
  }

  // Through-play: each item from `in` to `out`, switching matches as needed. onIndex reports the
  // item playing (null when finished or stopped) so the reel panel can follow along.
  playSequence(items: SequenceItem[], onIndex: (i: number | null) => void, startAt = 0): void {
    this.stopSequence()
    if (!items.length) return
    this.seq = { items, index: -1, onIndex }
    this.startItem(Math.max(0, Math.min(startAt, items.length - 1)))
  }

  // Loop bounds for trimming (design §3.5). Setting them doesn't move the playhead; while playing,
  // reaching OUT jumps back to IN. A through-play takes precedence over the loop.
  setLoop(item: SeqItem | null): void {
    const l = this.state.loop
    if (l === item || (l && item && l.key === item.key && l.in === item.in && l.out === item.out)) return
    this.set({ ...this.state, loop: item })
  }

  stopSequence(): void {
    const s = this.seq
    if (!s) return
    this.seq = null
    clearTimeout(this.cardTimer)
    this.set({ ...this.state, seq: null, card: null, cardSec: 0 })
    s.onIndex(null)
  }

  // Resolves once the frame at `t` is on screen (used by the smoke check).
  async seekAndWait(t: number): Promise<number> {
    const v = this.video
    if (!v) throw new Error('no video')
    this.stopSequence()
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

  pause(): void {
    this.video?.pause()
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

  private startItem(i: number): void {
    const s = this.seq!
    s.index = i
    const it = s.items[i]
    clearTimeout(this.cardTimer)
    this.set({ ...this.state, seq: { index: i, total: s.items.length }, card: isCard(it) ? it.card : null, cardSec: isCard(it) ? it.durationSec : 0 })
    s.onIndex(i)
    if (isCard(it)) {
      this.video?.pause()
      this.cardTimer = window.setTimeout(() => this.advance(), it.durationSec * 1000)
      return
    }
    this.queueSeek(it.key, it.in, true)
  }

  private advance(): void {
    const s = this.seq
    if (!s) return
    if (s.index + 1 < s.items.length) this.startItem(s.index + 1)
    else { this.video?.pause(); this.stopSequence() }
  }

  // Advance when the playing item reaches its OUT. Only trusted once the seek to this item has
  // landed (right video, not seeking, time past IN), so stale frames from the previous clip or
  // the outgoing video can't skip an item.
  private checkSequence(t: number): void {
    const s = this.seq, v = this.video
    if (!v || v.seeking || this.pending) return
    if (!s) {
      const l = this.state.loop
      if (l && l.key === this.key && !v.paused && t >= l.out) this.rawSeek(l.in, true)
      return
    }
    const it = s.items[s.index]
    if (isCard(it) || this.key !== it.key || t < it.in - 0.25 || t < it.out) return
    this.advance()
  }

  private queueSeek(key: string, t: number, play: boolean): void {
    if (key === this.key && this.video && this.video.readyState >= 1) { this.pending = null; this.rawSeek(t, play); return }
    this.pending = { key, t, play }
  }

  private rawSeek(t: number, play: boolean): void {
    const v = this.video
    if (!v) return
    v.currentTime = this.clamp(t)
    if (play) void v.play()
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
