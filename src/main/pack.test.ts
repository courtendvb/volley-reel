import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

vi.mock('electron', () => ({ app: {} }))
const { Library } = await import('./library')

const manifest = (o: object = {}) => strToU8(JSON.stringify({ format: 'volley-reel-pack', version: 1, id: 'test', name: 'Test',
  players: [{ team: 'HTH', lastName: 'YANAGITA', photo: 'a.png' }, { team: 'HTH', lastName: 'GONE', photo: 'b.png' }], ...o }))
const png = new Uint8Array([137, 80, 78, 71])

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vr-pack-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const pack = (files: Record<string, Uint8Array>) => { const f = join(dir, 'p.vrpack'); writeFileSync(f, zipSync(files)); return f }

describe('Library packs', () => {
  it('reads a pack in (players without their photo left out), lists it and takes it out', async () => {
    const lib = await Library.open(join(dir, 'lib'))
    const got = await lib.importPack(pack({ 'manifest.json': manifest(), 'photos/a.png': png, 'photos/extra.png': png }))
    expect(got.players.map(p => p.lastName)).toEqual(['YANAGITA'])
    expect(readdirSync(join(dir, 'lib', 'addons', 'test', 'photos'))).toEqual(['a.png'])
    expect((await lib.packs()).map(p => p.id)).toEqual(['test'])
    expect(await lib.readPackPhoto('test', 'a.png')).toEqual(png)
    const used = await lib.usePackPhoto('test', 'a.png', join(dir, 'assets'))
    expect(used.assetId).toMatch(/^[0-9a-f-]{36}\.png$/)
    await lib.removePack('test')
    expect(await lib.packs()).toEqual([])
  })

  it('takes a zipped folder (manifest one level down), and replaces a pack with the same id', async () => {
    const lib = await Library.open(join(dir, 'lib'))
    await lib.importPack(pack({ 'manifest.json': manifest(), 'photos/a.png': png }))
    await lib.importPack(pack({ 'top/manifest.json': manifest({ name: 'Again' }), 'top/photos/a.png': png }))
    expect((await lib.packs()).map(p => p.name)).toEqual(['Again'])
    expect(readdirSync(join(dir, 'lib', 'addons'))).toEqual(['test']) // no temporary folder left
  })

  it('never writes outside the pack, and refuses what is not a pack', async () => {
    const lib = await Library.open(join(dir, 'lib'))
    const evil = manifest({ players: [{ team: 'HTH', lastName: 'X', photo: '../../evil.png' }, { team: 'HTH', lastName: 'Y', photo: 'a.png' }] })
    await lib.importPack(pack({ 'manifest.json': evil, 'photos/a.png': png, 'evil.png': png }))
    expect(existsSync(join(dir, 'lib', 'evil.png'))).toBe(false)
    await expect(lib.readPackPhoto('test', '../manifest.json')).rejects.toThrow()
    await expect(lib.importPack(pack({ 'photos/a.png': png }))).rejects.toThrow(/manifest/)
    await expect(lib.importPack(pack({ 'manifest.json': manifest({ version: 9 }) }))).rejects.toThrow()
    const notZip = join(dir, 'x.vrpack'); writeFileSync(notZip, 'hello')
    await expect(lib.importPack(notZip)).rejects.toThrow()
  })
})
