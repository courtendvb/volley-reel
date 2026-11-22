// One undo history for scenes, videos and the project settings, in the order edits happened. Edits to the same thing
// within UNDO_MERGE_MS (a handle drag, typing a name) become one step, unless `merge` is false (separate clicks).
// A step can hold several scenes and videos (making a preset video, deleting a scene from the videos that use it),
// and a scene or video that did not exist (made by the step) or no longer does (deleted by it), so making and
// deleting undo too.
import { useCallback, useRef } from 'react'
import type { Reel } from '../../../shared/reel'
import { mergeSettingsChanges, pickSettings, type SettingsChange } from '../../../shared/settingsUndo'
import type { Video } from '../../../shared/video'
import type { ProjectSettings } from '../../../shared/types'

const UNDO_MERGE_MS = 600
const UNDO_LIMIT = 100

// A scene or video as it was (null: it did not exist), or the settings a change touched as they
// were (shared/settingsUndo.ts, so undoing one change leaves later ones to other settings).
export type Snapshot = { kind: 'scene'; id: string; value: Reel | null } | { kind: 'video'; id: string; value: Video | null } | { kind: 'settings'; value: SettingsChange }
type Step = { key: string; prev: Snapshot[]; at: number }

// What undo reads and puts back. now: a scene or video as it is (null: not there), or the whole
// settings (null: no project, and the step is skipped); restore: puts a step's versions back.
interface UndoTarget {
  now: (s: Snapshot) => Reel | Video | ProjectSettings | null
  restore: (s: Snapshot[]) => void
}

const keyOf = (s: Snapshot) => (s.kind === 'settings' ? 'settings' : `${s.kind}:${s.id}`)

export function useUndo(target: UndoTarget) {
  const undoStack = useRef<Step[]>([])
  const redoStack = useRef<Step[]>([])
  const targetRef = useRef(target)
  targetRef.current = target
  const groups = useRef(0)
  const record = useCallback((prev: Snapshot | Snapshot[], merge = true) => {
    const list = Array.isArray(prev) ? prev : [prev]
    if (!list.length) return
    // Several things at once are one step of their own, never merged with the next.
    const key = list.length === 1 ? keyOf(list[0]) : `group:${++groups.current}`, now = Date.now(), top = undoStack.current[undoStack.current.length - 1]
    if (merge && list.length === 1 && top && top.key === key && now - top.at < UNDO_MERGE_MS) {
      top.at = now
      const [a, b] = [top.prev[0], list[0]]
      if (a.kind === 'settings' && b.kind === 'settings') top.prev = [{ kind: 'settings', value: mergeSettingsChanges(a.value, b.value) }]
    }
    else { undoStack.current.push({ key, prev: list, at: now }); if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift() }
    redoStack.current = []
  }, [])
  const undoRedo = useCallback((dir: 'undo' | 'redo') => {
    const [from, to] = dir === 'undo' ? [undoStack.current, redoStack.current] : [redoStack.current, undoStack.current]
    for (let e = from.pop(); e; e = from.pop()) {
      const back: Snapshot[] = []
      for (const s of e.prev) {
        const cur = targetRef.current.now(s)
        if (s.kind === 'settings') { if (cur) back.push({ kind: 'settings', value: pickSettings(cur as ProjectSettings, s.value) }) }
        else back.push({ ...s, value: cur } as Snapshot)
      }
      if (!back.length) continue
      to.push({ key: e.key, prev: back, at: 0 })
      targetRef.current.restore(e.prev)
      return
    }
  }, [])
  const clearHistory = useCallback(() => { undoStack.current = []; redoStack.current = [] }, [])
  return { record, undoRedo, clearHistory }
}
