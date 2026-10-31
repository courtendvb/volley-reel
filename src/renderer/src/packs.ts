// Add-on packs (kept in the library, shared by every project) and their photos, decoded once for
// the picker's thumbnails.
import { useEffect, useState } from 'react'
import type { PackInfo, PhotoTarget } from '../../shared/pack'

const api = window.api
let current: PackInfo[] = []
let loaded = false
const listeners = new Set<(p: PackInfo[]) => void>()
const set = (p: PackInfo[]) => { current = p; listeners.forEach(f => f(p)) }

export function usePacks(): PackInfo[] {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    if (!loaded) { loaded = true; void api.listPacks().then(set).catch(() => { loaded = false }) }
    return () => { listeners.delete(setP) }
  }, [])
  return p
}

// For the self-check, after it changed the packs from the main process.
export async function refreshPacks(): Promise<void> { loaded = true; set(await api.listPacks()) }
export async function importPack(): Promise<void> { photos.clear(); set(await api.importPack()) }
export async function removePack(id: string): Promise<void> { set(await api.removePack(id)) }
export async function setPlayerPhoto(tg: PhotoTarget): Promise<void> { set(await api.setPlayerPhoto(tg)) }
export async function removePlayerPhoto(tg: PhotoTarget): Promise<void> { set(await api.removePlayerPhoto(tg)) }

// Thumbnails are small: decoded at most 160 px on the long side.
const photos = new Map<string, Promise<ImageBitmap | null>>()
export function packPhoto(pack: string, photo: string): Promise<ImageBitmap | null> {
  const key = `${pack}/${photo}`
  let p = photos.get(key)
  if (!p) {
    p = api.readPackPhoto(pack, photo)
      .then(async data => {
        const full = await createImageBitmap(new Blob([data as BlobPart]))
        const k = 160 / Math.max(full.width, full.height)
        if (k >= 1) return full
        const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
        full.close()
        return small
      })
      .catch(() => null)
    photos.set(key, p)
  }
  return p
}
