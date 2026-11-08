// One undo history for scenes, videos and the project settings, in the order edits happened. Edits to the same thing
// within UNDO_MERGE_MS (a handle drag, typing a name) become one step, unless `merge` is false (separate clicks).
import { useCallback, useRef } from 'react'
import type { Reel } from '../../../shared/reel'
import { mergeSettingsChanges, pickSettings, type SettingsChange } from '../../../shared/settingsUndo'
import type { Video } from '../../../shared/video'
import type { ProjectSettings } from '../../../shared/types'

const UNDO_MERGE_MS = 600
const UNDO_LIMIT = 100

// Settings are kept by what changed (shared/settingsUndo.ts), so undoing one change leaves later ones to other settings.
type Snapshot = { kind: 'scene'; value: Reel } | { kind: 'video'; value: Video } | { kind: 'settings'; value: SettingsChange }
type Step = { key: string; prev: Snapshot; at: number }

// What undo reads and puts back. now: the current version of a step's thing (undefined: deleted
// since, so that step is skipped; the whole settings for a settings step); restore: puts a version back.
interface UndoTarget {
  now: (s: Snapshot) => Reel | Video | ProjectSettings | undefined
  restore: (s: Snapshot) => void
}

export function useUndo(target: UndoTarget) {
  const undoStack = useRef<Step[]>([])
  const redoStack = useRef<Step[]>([])
  const targetRef = useRef(target)
  targetRef.current = target
  const record = useCallback((prev: Snapshot, merge = true) => {
    const key = prev.kind === 'settings' ? 'settings' : `${prev.kind}:${prev.value.id}`, now = Date.now(), top = undoStack.current[undoStack.current.length - 1]
    if (merge && top && top.key === key && now - top.at < UNDO_MERGE_MS) {
      top.at = now
      if (top.prev.kind === 'settings' && prev.kind === 'settings') top.prev = { kind: 'settings', value: mergeSettingsChanges(top.prev.value, prev.value) }
    }
    else { undoStack.current.push({ key, prev, at: now }); if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift() }
    redoStack.current = []
  }, [])
  const undoRedo = useCallback((dir: 'undo' | 'redo') => {
    const [from, to] = dir === 'undo' ? [undoStack.current, redoStack.current] : [redoStack.current, undoStack.current]
    for (let e = from.pop(); e; e = from.pop()) {
      const cur = targetRef.current.now(e.prev)
      if (!cur) continue
      const back: Snapshot = e.prev.kind === 'settings' ? { kind: 'settings', value: pickSettings(cur as ProjectSettings, e.prev.value) } : { kind: e.prev.kind, value: cur } as Snapshot
      to.push({ key: e.key, prev: back, at: 0 })
      targetRef.current.restore(e.prev)
      return
    }
  }, [])
  const clearHistory = useCallback(() => { undoStack.current = []; redoStack.current = [] }, [])
  return { record, undoRedo, clearHistory }
}
