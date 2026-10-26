// Images for image annotations: decoded once per asset and shared by the preview and the export.
// A PDF is inserted as a picture of its first page, rendered here with pdf.js and saved as a PNG.
import type { ImageLookup } from '../../shared/annotation'

const api = window.api
// Decoded pictures take width × height × 4 bytes each (a phone photo is ~48 MB), so: they are
// decoded at most MAX_SIDE on their long side (the video is 720p, the export too), and the cache
// keeps at most CACHE_BYTES, dropping (and closing) the least recently drawn first.
const MAX_SIDE = 1920
const CACHE_BYTES = 192 * 1024 * 1024
const cache = new Map<string, ImageBitmap>() // in order of use: the first is the least recent
const loading = new Map<string, Promise<ImageBitmap | null>>()
const listeners = new Set<() => void>()
let cacheBytes = 0
const pinned = new Map<string, number>() // ids an export is drawing with: never dropped meanwhile
const bytesOf = (b: ImageBitmap) => b.width * b.height * 4

// Decodes image bytes, scaled down when larger than maxSide on its long side.
async function decode(data: Uint8Array, maxSide: number): Promise<ImageBitmap> {
  const full = await createImageBitmap(new Blob([data as BlobPart]))
  const k = maxSide / Math.max(full.width, full.height)
  if (k >= 1) return full
  const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
  full.close()
  return small
}

function keep(id: string, bmp: ImageBitmap): void {
  cache.set(id, bmp)
  cacheBytes += bytesOf(bmp)
  for (const [old, b] of cache) {
    if (cacheBytes <= CACHE_BYTES) break
    if (old === id || pinned.has(old)) continue
    cache.delete(old); loading.delete(old) // drawn again later: decoded again
    cacheBytes -= bytesOf(b)
    b.close()
  }
}

function load(id: string): Promise<ImageBitmap | null> {
  let p = loading.get(id)
  if (!p) {
    p = api.readAsset(id)
      .then(data => decode(data, MAX_SIDE))
      .then(bmp => { keep(id, bmp); listeners.forEach(f => f()); return bmp })
      .catch(() => null) // missing or unreadable: drawn as a placeholder
    loading.set(id, p)
  }
  return p
}

// For drawing: the image if it is decoded, else null (and it starts loading).
export const assetImage: ImageLookup = id => {
  const bmp = cache.get(id)
  if (!bmp) { void load(id); return null }
  cache.delete(id); cache.set(id, bmp) // most recently used
  return bmp
}

// A project's pictures belong to it: when another project opens, they are let go.
export function resetAssets(): void {
  for (const b of cache.values()) b.close()
  cache.clear(); loading.clear(); cacheBytes = 0
}

// For the memory smoke check.
export const assetStats = () => ({ images: cache.size, mb: +(cacheBytes / 1048576).toFixed(1) })

// Redraw when an image finishes loading.
export function subscribeAssets(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

// The export draws every frame layer at once: it waits for its images and holds them (they can't be
// dropped from the cache) until it calls release.
export async function preloadAssets(ids: string[]): Promise<{ lookup: ImageLookup; release: () => void }> {
  const want = [...new Set(ids)]
  for (const id of want) pinned.set(id, (pinned.get(id) ?? 0) + 1)
  const got = new Map<string, ImageBitmap>()
  await Promise.all(want.map(async id => { const b = await load(id); if (b) got.set(id, b) }))
  return {
    lookup: id => got.get(id) ?? null,
    release: () => { for (const id of want) { const n = (pinned.get(id) ?? 1) - 1; if (n > 0) pinned.set(id, n); else pinned.delete(id) } },
  }
}

// Team logos (library, by code), decoded once; forgetLogo after one is replaced or removed.
const logos = new Map<string, Promise<ImageBitmap | null>>()
const logoReady = new Map<string, ImageBitmap | null>()

function loadLogo(code: string): Promise<ImageBitmap | null> {
  let p = logos.get(code)
  if (!p) {
    p = api.readLogo(code)
      .then(data => (data ? decode(data, 800) : null)) // logos are drawn small
      .catch(() => null)
      .then(bmp => { logoReady.set(code, bmp); listeners.forEach(f => f()); return bmp })
    logos.set(code, p)
  }
  return p
}

export function logoImage(code: string | null | undefined): ImageBitmap | null {
  if (!code) return null
  if (!logoReady.has(code)) { void loadLogo(code); return null }
  return logoReady.get(code) ?? null
}

export async function preloadLogos(codes: (string | null | undefined)[]): Promise<void> {
  await Promise.all([...new Set(codes.filter((c): c is string => !!c))].map(loadLogo))
}

export function forgetLogo(code: string): void {
  logoReady.get(code)?.close()
  logos.delete(code); logoReady.delete(code)
  void loadLogo(code)
}

// Asks for an image or PDF and stores it in the project. Returns the asset and its pixel size.
export async function insertAsset(path?: string): Promise<{ assetId: string; width: number; height: number } | null> {
  const picked = path && api.smokePickAsset ? await api.smokePickAsset(path) : await api.pickAsset()
  if (!picked) return null
  const assetId = picked.kind === 'image' ? picked.assetId : await api.saveAsset(await pdfFirstPage(picked.data))
  const bmp = await load(assetId)
  if (!bmp) throw new Error('画像を読み込めませんでした')
  return { assetId, width: bmp.width, height: bmp.height }
}

// Page 1 at about 1600 px wide: sharp at 1080p even when shown large.
async function pdfFirstPage(data: Uint8Array): Promise<Uint8Array> {
  let first: Uint8Array | null = null
  await pdfPages(data, async (_n, png) => { first = png }, 1)
  if (!first) throw new Error('PDF を画像にできませんでした')
  return first
}

// Each page (up to `upTo`) rendered at about 1600 px wide, as a PNG, in order. Returns the page count.
export async function pdfPages(data: Uint8Array, each: (page: number, png: Uint8Array, total: number) => Promise<void>, upTo = Infinity): Promise<number> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  try {
    const canvas = document.createElement('canvas')
    for (let n = 1; n <= Math.min(doc.numPages, upTo); n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(4, 1600 / base.width) })
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#FFFFFF' // PDF pages are paper: transparent areas would show the video
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('PDF を画像にできませんでした'))), 'image/png'))
      await each(n, new Uint8Array(await blob.arrayBuffer()), doc.numPages)
      page.cleanup()
    }
    return doc.numPages
  } finally {
    void task.destroy()
  }
}
