import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJSON, retryBusy, writeJSON } from './store'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vr-store-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('writeJSON', () => {
  it('runs saves to one file in order, so the last one asked wins', async () => {
    const f = join(dir, 'a.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJSON(f, { n: i, pad: 'x'.repeat(i * 5000) })))
    expect((await readJSON<{ n: number }>(f)).data.n).toBe(19)
    expect(JSON.parse(await readFile(`${f}.bak`, 'utf8')).n).toBe(18)
  })

  it('saves what the data was when asked, not when its turn came', async () => {
    const f = join(dir, 'b.json'), obj = { n: 1 }
    const first = writeJSON(f, { big: 'x'.repeat(100000) })
    const second = writeJSON(f, obj)
    obj.n = 2
    await Promise.all([first, second])
    expect((await readJSON<{ n: number }>(f)).data.n).toBe(1)
  })

  it('keeps going after a failed save', async () => {
    const f = join(dir, 'missing-folder', 'c.json')
    await expect(writeJSON(f, { n: 1 })).rejects.toThrow()
    const g = join(dir, 'c.json')
    await writeJSON(g, { n: 2 })
    expect((await readJSON<{ n: number }>(g)).data.n).toBe(2)
  })
})

describe('retryBusy', () => {
  const busy = (code: string) => Object.assign(new Error(code), { code })

  it('retries a file briefly held by another program', async () => {
    let calls = 0
    expect(await retryBusy(async () => { if (++calls < 3) throw busy('EPERM'); return 'ok' })).toBe('ok')
    expect(calls).toBe(3)
  })

  it('does not retry other errors', async () => {
    let calls = 0
    await expect(retryBusy(async () => { calls++; throw busy('ENOENT') })).rejects.toThrow('ENOENT')
    expect(calls).toBe(1)
  })
})
