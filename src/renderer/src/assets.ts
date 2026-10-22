// Images for image annotations: decoded once per asset and shared by the preview and the export.
// A PDF is inserted as a picture of its first page, rendered here with pdf.js and saved as a PNG.
import type { ImageLookup } from '../../shared/annotation'

const api = window.api
const cache = new Map<string, ImageBitmap>()
const loading = new Map<string, Promise<ImageBitmap | null>>()
const listeners = new Set<() => void>()

function load(id: string): Promise<ImageBitmap | null> {
  let p = loading.get(id)
  if (!p) {
    p = api.readAsset(id)
      .then(data => createImageBitmap(new Blob([data as BlobPart])))
      .then(bmp => { cache.set(id, bmp); listeners.forEach(f => f()); return bmp })
      .catch(() => null) // missing or unreadable: drawn as a placeholder
    loading.set(id, p)
  }
  return p
}

// For drawing: the image if it is decoded, else null (and it starts loading).
export const assetImage: ImageLookup = id => {
  const bmp = cache.get(id)
  if (!bmp) void load(id)
  return bmp ?? null
}

// Redraw when an image finishes loading.
export function subscribeAssets(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

// The export draws every frame layer at once, so it waits for its images first.
export async function preloadAssets(ids: string[]): Promise<void> {
  await Promise.all([...new Set(ids)].map(load))
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
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(4, 1600 / base.width) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#FFFFFF' // PDF pages are paper: transparent areas would show the video
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('PDF を画像にできませんでした'))), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    void task.destroy()
  }
}
