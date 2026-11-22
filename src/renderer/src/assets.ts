// Images for image annotations: decoded once per asset and shared by the preview and the export.
// A PDF is inserted as a picture of its first page, rendered here with pdf.js and saved as a PNG.
import type { ImageLookup } from '../../shared/annotation'
import { t } from '../../shared/i18n'
import { mainColor } from '../../shared/rotationBoard'

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
export async function decodeImage(data: Uint8Array, maxSide: number): Promise<ImageBitmap> {
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

// A pack's photo drawn straight from the library (a filled photo frame), by an id of its own.
export const packAssetId = (pack: string, photo: string) => `pack:${encodeURIComponent(pack)}/${encodeURIComponent(photo)}`
function readImage(id: string): Promise<Uint8Array> {
  const m = /^pack:([^/]+)\/(.+)$/.exec(id)
  if (m) return api.readPackPhoto(decodeURIComponent(m[1]), decodeURIComponent(m[2]))
  if (id.startsWith('frame:')) return Promise.reject(new Error('an empty photo frame'))
  return api.readAsset(id)
}

function load(id: string): Promise<ImageBitmap | null> {
  let p = loading.get(id)
  if (!p) {
    p = readImage(id)
      .then(data => decodeImage(data, MAX_SIDE))
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
      .then(data => (data ? decodeImage(data, 800) : null)) // logos are drawn small
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

// A team's colour from its logo in the library (its most common strong colour), or null.
export async function logoColor(code: string): Promise<string | null> {
  const bmp = await loadLogo(code)
  if (!bmp) return null
  const c = new OffscreenCanvas(48, 48), g = c.getContext('2d')
  if (!g) return null
  g.drawImage(bmp, 0, 0, 48, 48)
  return mainColor(g.getImageData(0, 0, 48, 48).data)
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
  if (!bmp) throw new Error(t('画像を読み込めませんでした'))
  return { assetId, width: bmp.width, height: bmp.height }
}

// Page 1 at about 1600 px wide: sharp at 1080p even when shown large.
async function pdfFirstPage(data: Uint8Array): Promise<Uint8Array> {
  let first: Uint8Array | null = null
  await pdfPages(data, async (_n, png) => { first = png }, 1)
  if (!first) throw new Error(t('PDF を画像にできませんでした'))
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
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error(t('PDF を画像にできませんでした')))), 'image/png'))
      await each(n, new Uint8Array(await blob.arrayBuffer()), doc.numPages)
      page.cleanup()
    }
    return doc.numPages
  } finally {
    void task.destroy()
  }
}

// Player photos from the packs for the caption, decoded once at full size (they are small).
const packPhotos = new Map<string, Promise<ImageBitmap | null>>()
const packPhotoReady = new Map<string, ImageBitmap | null>()
type PhotoRef = { pack: string; photo: string }

function loadPackPhoto(r: PhotoRef): Promise<ImageBitmap | null> {
  const key = `${r.pack}/${r.photo}`
  let p = packPhotos.get(key)
  if (!p) {
    p = api.readPackPhoto(r.pack, r.photo)
      .then(data => decodeImage(data, 800))
      .catch(() => null)
      .then(bmp => { packPhotoReady.set(key, bmp); listeners.forEach(f => f()); return bmp })
    packPhotos.set(key, p)
  }
  return p
}

export function packPhotoImage(r: PhotoRef | null | undefined): ImageBitmap | null {
  if (!r) return null
  const key = `${r.pack}/${r.photo}`
  if (!packPhotoReady.has(key)) { void loadPackPhoto(r); return null }
  return packPhotoReady.get(key) ?? null
}

export async function preloadPackPhotos(refs: (PhotoRef | null | undefined)[]): Promise<void> {
  await Promise.all(refs.filter((r): r is PhotoRef => !!r).map(loadPackPhoto))
}
