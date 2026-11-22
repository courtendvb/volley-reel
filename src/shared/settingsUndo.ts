// Undo for the project settings by what changed, not the whole settings: undoing one change puts
// back only the settings it touched, so a later change to something else (a saved filter, the
// positions) is kept. Pure, so it is unit-tested.
import type { ProjectSettings } from './types'

// The settings a change touched, as they were before it (a key there with undefined: it was unset).
export type SettingsChange = Partial<ProjectSettings>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function settingsChange(prev: ProjectSettings, next: ProjectSettings): SettingsChange {
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof ProjectSettings>) {
    if (!same(prev[k], next[k])) out[k] = prev[k]
  }
  return out as SettingsChange
}

// The same settings as they are now (what redo puts back).
export function pickSettings(cur: ProjectSettings, keysOf: SettingsChange): SettingsChange {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(keysOf) as (keyof ProjectSettings)[]) out[k] = cur[k]
  return out as SettingsChange
}

export function applySettingsChange(cur: ProjectSettings, change: SettingsChange): ProjectSettings {
  const out: Record<string, unknown> = { ...cur }
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) delete out[k]
    else out[k] = v
  }
  return out as unknown as ProjectSettings
}

// Two changes undone as one step (quick edits in a row): the older one's values win, and settings
// only the newer one touched join in.
export const mergeSettingsChanges = (older: SettingsChange, newer: SettingsChange): SettingsChange => ({ ...newer, ...older })
