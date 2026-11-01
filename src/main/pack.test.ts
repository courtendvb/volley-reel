import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

  it('keeps one photo per player set in the app, apart from league packs', async () => {
    const lib = await Library.open(join(dir, 'lib'))
    const tg = { key: 'YAN-YUR-02', team: 'HTH', jersey: 2, lastName: 'YANAKITA', firstName: 'Yuri' }
    const a = join(dir, 'a.jpg'), b = join(dir, 'b.png'); writeFileSync(a, png); writeFileSync(b, png)
    await lib.setPlayerPhoto(tg, a)
    await lib.setPlayerPhoto(tg, b) // replaces the first, file and all
    const local = (await lib.packs()).find(p => p.id === 'local')!
    expect(local.players).toHaveLength(1)
    expect(local.players[0].photo).toMatch(/\.png$/)
    expect(readdirSync(join(dir, 'lib', 'addons', 'local', 'photos'))).toEqual([local.players[0].photo])
    await expect(lib.importPack(pack({ 'manifest.json': manifest({ id: 'local' }), 'photos/a.png': png }))).rejects.toThrow()
    await expect(lib.setPlayerPhoto(tg, join(dir, 'p.vrpack'))).rejects.toThrow()
    await lib.removePlayerPhoto(tg)
    expect(await lib.packs()).toEqual([])
  })

  it('lists the packs shipped with the app, read-only, unless the library has one of the same id', async () => {
    const shipped = join(dir, 'shipped'), own = join(dir, 'lib')
    const put = (root: string, name: string) => {
      mkdirSync(join(root, 'test', 'photos'), { recursive: true })
      writeFileSync(join(root, 'test', 'manifest.json'), manifest({ name }))
      writeFileSync(join(root, 'test', 'photos', 'a.png'), png)
    }
    put(shipped, 'Shipped')
    Library.bundledPacks = shipped
    try {
      const lib = await Library.open(own)
      expect((await lib.packs()).map(p => [p.name, p.bundled])).toEqual([['Shipped', true]])
      expect(await lib.readPackPhoto('test', 'a.png')).toEqual(png)
      await lib.removePack('test') // nothing to take out: it stays
      expect(existsSync(join(shipped, 'test'))).toBe(true)
      put(join(own, 'addons'), 'Read in')
      expect((await lib.packs()).map(p => [p.name, p.bundled])).toEqual([['Read in', undefined]])
    } finally {
      Library.bundledPacks = null
    }
  })
})
