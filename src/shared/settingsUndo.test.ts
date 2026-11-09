import { describe, expect, it } from 'vitest'
import { applySettingsChange, mergeSettingsChanges, pickSettings, settingsChange } from './settingsUndo'
import type { ProjectSettings } from './types'

const base: ProjectSettings = { ourTeamCodes: ['HTH'], filters: [], pointScale: 1 }

describe('settings undo', () => {
  it('keeps only what changed, as it was', () => {
    expect(settingsChange(base, { ...base, pointScale: 2 })).toEqual({ pointScale: 1 })
    const c = settingsChange(base, { ...base, theme: { base: 'navy', accent: 'red' } as ProjectSettings['theme'] })
    expect(Object.keys(c)).toEqual(['theme'])
    expect(c.theme).toBeUndefined()
    expect(settingsChange(base, { ...base })).toEqual({})
  })

  it('undoing an older change keeps a later change to something else', () => {
    const a = { ...base, pointScale: 2 }
    const undoA = settingsChange(base, a)
    const b = { ...a, filters: [{ id: 'f', name: 'x', filter: {} as never }] }
    // Undo the point size only: the saved filter made after it stays.
    expect(applySettingsChange(b, undoA)).toEqual({ ...b, pointScale: 1 })
  })

  it('takes off a setting that was unset before', () => {
    const withTheme = { ...base, theme: { base: 'navy', accent: 'red' } as ProjectSettings['theme'] }
    expect('theme' in applySettingsChange(withTheme, settingsChange(base, withTheme))).toBe(false)
  })

  it('redo puts back the same settings as they are now', () => {
    const cur = { ...base, pointScale: 3, filters: [] }
    expect(pickSettings(cur, { pointScale: 1 })).toEqual({ pointScale: 3 })
  })

  it('merges quick changes into one step, the older values first', () => {
    expect(mergeSettingsChanges({ pointScale: 1 }, { pointScale: 2, filters: [] })).toEqual({ pointScale: 1, filters: [] })
  })
})
