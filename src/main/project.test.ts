import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Project } from './project'
import type { Library } from './library'

const library = { getMatch: () => undefined, missing: () => ({ videos: [], dvws: [] }) } as unknown as Library
let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vr-project-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('Project settings', () => {
  it('reads back what was saved: the grid 濃さ, the overlay and the clip seconds', async () => {
    const p = await Project.create(dir, library, { name: 'P', ourTeamCodes: ['HTH'], matchIds: [] })
    const saved = p.info().settings
    await p.saveSettings({ ...saved, gridOpacity: 0.4, overlay: { scoreboard: { show: false } } as never, range: { keyBefore: 2 } })
    const again = (await Project.open(dir, library)).info().settings
    expect(again.gridOpacity).toBe(0.4)
    expect(again.range).toEqual({ keyBefore: 2 })
    expect(again.overlay).toEqual(p.info().settings.overlay)
    expect(again.overlay).toBeTruthy()
  })
})
