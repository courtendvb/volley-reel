// The keyboard shortcuts (the list in ShortcutsDialog). The handler is registered once and reads
// what it acts on from `h`, as of the last render.
import { useEffect, useRef, type RefObject } from 'react'
import { chronological, type Clip, type Group, type Marker, type Reel } from '../../../shared/reel'
import { mergeScoped, type ScopedAnnotations } from '../../../shared/annotationScope'
import { withGroups, type Annotation } from '../../../shared/annotation'
import type { PlayRef } from '../../../shared/filter'
import type { Tool } from '../components/AnnotationLayer'
import { arrowSec, composing, ctrlArrowSec } from '../keys'
import { playback } from '../playback'
import { isMaximized, setMaximized, toggleMaximized } from '../maximize'
import type { AppLatest } from './appState'

const api = window.api

interface ShortcutHandlers {
  latest: RefObject<AppLatest>
  paused: boolean // a dialog that takes the keys is open (settings)
  focusPane: RefObject<'list' | 'scene'> // the list Up / Down walk: the one clicked last
  editingCard: () => boolean // a title card or slide is being edited
  cardAnns: () => Annotation[]
  setCardAnns: (list: Annotation[]) => void
  scopedNow: () => ScopedAnnotations | null
  setAnns: (list: Annotation[]) => void
  extraSel: () => string[]
  clearSelection: () => void
  undoRedo: (dir: 'undo' | 'redo') => void
  copyObjects: () => boolean
  pasteObjects: () => boolean
  pasteImage: () => void
  toggleShortcuts: () => void
  activateClip: (c: Clip, g?: Group) => void
  whenIn: (s: Reel) => (c: Clip) => [string, number]
  jump: (r: PlayRef) => void
  setAnnTool: (t: Tool) => void
  trim: (edge: 'in' | 'out', t: number | null) => void
  setTag: (n: string) => void
  markerKey: (m: Marker | null) => void
}

const TOOLS: Record<string, Tool> = { v: 'select', t: 'text', a: 'arrow', c: 'circle', r: 'rect', g: 'triangle', l: 'polyline', p: 'polygon' }

export function useShortcuts(handlers: ShortcutHandlers) {
  const hRef = useRef(handlers)
  hRef.current = handlers
  useEffect(() => {
    // The clip below (down) or above in the scene editor's rows, opened like a click on it.
    const stepClip = (down: boolean) => {
      const h = hRef.current, r = h.latest.current.reel
      if (!r) return
      const rows = [...r.groupOrder.flatMap(g => r.groups[g].map(id => ({ id, g: g as Group }))),
        ...chronological(r, r.groups.none, h.whenIn(r)).map(c => ({ id: c.id, g: 'none' as Group }))]
      const a = h.latest.current.activeClipId, ag = h.latest.current.activeGroup
      let i = rows.findIndex(x => x.id === a && (ag === null || x.g === ag))
      if (i < 0) i = rows.findIndex(x => x.id === a)
      const next = rows[down ? i + 1 : i < 0 ? 0 : i - 1]
      if (next) h.activateClip(r.clips[next.id], next.g)
    }
    const onKey = (e: KeyboardEvent) => {
      const h = hRef.current, latest = h.latest.current
      const t = e.target
      if ((t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || h.paused || composing(e)) return
      // A slider in a panel (transparency, opacity…) moves with the arrow keys; only the seek bar
      // leaves them to the shortcuts, so ← → still step the video after it is clicked.
      if (t instanceof HTMLInputElement && t.type === 'range' && !t.closest('.transport') && /^(Arrow|Page|Home$|End$)/.test(e.key)) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); playback.nudge(k === 'arrowleft' ? -ctrlArrowSec() : ctrlArrowSec()) }
        else if (k === 'z' && !e.shiftKey) { e.preventDefault(); h.undoRedo('undo') }
        else if (k === 'c' && !e.shiftKey && !window.getSelection()?.toString()) { if (h.copyObjects()) e.preventDefault() }
        else if (k === 'v' && !e.shiftKey) {
          // Whatever was copied last: a picture from elsewhere, or objects copied here (they leave a
          // mark on the system clipboard, so a screenshot taken after them wins).
          e.preventDefault()
          void api.clipboardKind().then(kind => { if (kind === 'image') hRef.current.pasteImage(); else hRef.current.pasteObjects() })
        }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); h.undoRedo('redo') }
        return
      }
      if (e.altKey) return
      if (e.key === '?') { h.toggleShortcuts(); return }
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && h.focusPane.current === 'scene') {
        // Up / Down in the scene editor (last clicked): the clip above / below, opened like a click on it.
        e.preventDefault()
        stepClip(e.key === 'ArrowDown')
      }
      else if (/^[fd]$/i.test(e.key) && !e.shiftKey && latest.reel && !h.editingCard()) {
        // F / D: the next / previous clip of the scene, from anywhere (the clip loops while it is edited).
        e.preventDefault()
        stepClip(e.key.toLowerCase() === 'f')
      }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Up / Down: the previous / next play in the left list (played like a click on it).
        e.preventDefault()
        const res = latest.results, s = latest.selected
        const i = s ? res.findIndex(x => x.matchId === s.matchId && x.play.id === s.playId) : -1
        const next = res[e.key === 'ArrowDown' ? i + 1 : i < 0 ? 0 : i - 1]
        if (next) h.jump(next)
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-arrowSec()) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(arrowSec()) }
      else if (e.key === 'Escape') { if (isMaximized()) void setMaximized(false); else playback.stopSequence() } // maximized: Esc only leaves it
      else if (/^m$/i.test(e.key) && !e.shiftKey) { e.preventDefault(); void toggleMaximized() }
      else if ((latest.activeClipId || h.editingCard()) && /^[vtacrglp]$/i.test(e.key)) h.setAnnTool(TOOLS[e.key.toLowerCase()])
      else if ((e.key === 'Delete' || e.key === 'Backspace') && latest.selectedAnn) {
        const sel = latest.selectedAnn, now = h.scopedNow()
        // The selected object, the other selected ones and their groups.
        const drop = (list: Annotation[]) => { const ids = withGroups(list, [sel, ...h.extraSel()]); return list.filter(a => !ids.includes(a.id)) }
        if (h.editingCard()) { e.preventDefault(); h.setCardAnns(drop(h.cardAnns())); h.clearSelection() }
        else if (now) { e.preventDefault(); h.setAnns(drop(mergeScoped(now))); h.clearSelection() }
      }
      else if (e.key === '[' || e.key === ']') {
        const { reel: r, activeClipId: id } = latest
        if (r && id && r.clips[id]?.matchId === playback.attachedKey) { e.preventDefault(); h.trim(e.key === '[' ? 'in' : 'out', playback.current.time) }
      }
      else if (e.shiftKey && /^(Digit|Numpad)[0-5]$/.test(e.code)) {
        // Shift + 1–5: the active clip's tag (the same number takes it off; Shift + 0 always does).
        // By key position, as Shift + a digit types a symbol on most layouts.
        const { reel: r, activeClipId: id } = latest
        if (!r || !id || !r.clips[id]) return
        e.preventDefault()
        h.setTag(e.code.slice(-1))
      }
      else if (/^[0-5]$/.test(e.key)) { e.preventDefault(); h.markerKey(e.key === '0' ? null : (Number(e.key) as Marker)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
