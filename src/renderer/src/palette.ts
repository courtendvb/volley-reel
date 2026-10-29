// The palette (kept in the library, shared by every project): my colors and saved objects.
import { useEffect, useState } from 'react'
import { freshIds, type Annotation } from '../../shared/annotation'
import type { Palette } from '../../shared/types'

const api = window.api
let current: Palette = { colors: [], items: [] }
let loaded = false
const listeners = new Set<(p: Palette) => void>()
const set = (p: Palette) => { current = p; listeners.forEach(f => f(p)) }

export function usePalette(): Palette {
  const [p, setP] = useState(current)
  useEffect(() => {
    listeners.add(setP)
    if (!loaded) { loaded = true; void api.getPalette().then(set).catch(() => { loaded = false }) }
    return () => { listeners.delete(setP) }
  }, [])
  return p
}

// A color picked freely goes to the front of my colors (once; at most 16 are kept).
export async function rememberColor(c: string): Promise<void> {
  const up = c.toUpperCase()
  if (current.colors[0] === up) return
  set(await api.setPaletteColors([up, ...current.colors.filter(x => x !== up)]))
}

export async function forgetColor(c: string): Promise<void> {
  set(await api.setPaletteColors(current.colors.filter(x => x !== c.toUpperCase())))
}

export async function savePaletteItem(name: string, anns: Annotation[]): Promise<void> {
  set(await api.savePaletteItem(name, anns))
}

export async function removePaletteItem(id: string): Promise<void> {
  set(await api.removePaletteItem(id))
}

export async function movePaletteItem(id: string, to: number): Promise<void> {
  set(await api.movePaletteItem(id, to))
}

export async function lockPaletteItem(id: string, locked: boolean): Promise<void> {
  set(await api.lockPaletteItem(id, locked))
}

// The item's objects with new ids (and new group ids), ready to add to a clip or a card.
export async function usePaletteItem(id: string): Promise<Annotation[]> {
  return freshIds(await api.usePaletteItem(id))
}
