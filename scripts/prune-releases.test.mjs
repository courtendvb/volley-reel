import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneReleases } from './prune-releases.mjs'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vr-prune-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const put = (...names) => names.forEach(n => writeFileSync(join(dir, n), ''))
const setup = v => [`syncscout-video-editor-setup-${v}.exe`, `syncscout-video-editor-setup-${v}.exe.blockmap`]
const oldSetup = v => [`volley-reel-setup-${v}.exe`, `volley-reel-setup-${v}.exe.blockmap`]

describe('pruneReleases', () => {
  it('keeps the newest versions by number, not by name, with their blockmaps', () => {
    put(...['0.2.2', '0.2.9', '0.2.10', '0.2.11', '0.3.0', '0.1.0'].flatMap(setup))
    expect(pruneReleases(dir, 3)).toEqual(['0.2.9', '0.2.2', '0.1.0'])
    expect(readdirSync(dir).sort()).toEqual(['0.2.10', '0.2.11', '0.3.0'].flatMap(setup).sort())
  })

  it('counts installers with the old name too', () => {
    put(...oldSetup('0.2.24'), ...oldSetup('0.2.25'), ...setup('0.2.26'))
    expect(pruneReleases(dir, 2)).toEqual(['0.2.24'])
    expect(readdirSync(dir).sort()).toEqual([...oldSetup('0.2.25'), ...setup('0.2.26')].sort())
  })

  it('leaves everything else alone, and does nothing with few versions', () => {
    mkdirSync(join(dir, 'packs'))
    put('latest.yml', 'builder-debug.yml', 'sv-2026.vrpack', ...setup('0.2.1'))
    expect(pruneReleases(dir, 5)).toEqual([])
    expect(readdirSync(dir)).toHaveLength(6)
  })
})
