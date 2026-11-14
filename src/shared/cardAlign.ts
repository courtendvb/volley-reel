// "ほかのカードにも揃える": a title card's look made the same on other kinds of card (the video's
// opening card, scene cards, marker cards), each kind keeping its own settings otherwise. What can
// be copied: the title's place and size, the logo's place, and the card's objects (which then sit
// on every card of each kind, this one's too). Pure: the card editor writes what this returns.
import type { Annotation } from './annotation'
import type { CardKind, CardLayout, LogoPlace, OverlaySettings } from './overlay'

export type TitleCardSettings = OverlaySettings['titleCard']
export interface AlignChoice {
  title: boolean
  logo: boolean
  objects: boolean
  to: CardKind[] // the other kinds to align (the card's own kind is left out of this)
}
export interface AlignFrom {
  kind: CardKind
  layout: CardLayout // the card's title as shown, as a top-left
  logo: LogoPlace | undefined // its kind's logo place (undefined: beside the title)
  objects: Annotation[] // every object shown on the card (its own and its kind's)
}

export const layoutKeyOf = (k: CardKind): 'videoLayout' | 'sceneLayout' | 'markerLayout' => (k === 'video' ? 'videoLayout' : k === 'scene' ? 'sceneLayout' : 'markerLayout')

// The video's card settings with the choices applied. With objects, the card's kind shares exactly
// the card's objects (its own move there: the caller clears them from the card) and each kind aligned
// gets copies of them with new ids, in place of what it shared before.
export function alignTitleCards(tc: TitleCardSettings, from: AlignFrom, c: AlignChoice, newId: () => string = () => crypto.randomUUID()): TitleCardSettings {
  const to = c.to.filter(k => k !== from.kind)
  const out: TitleCardSettings = { ...tc }
  if (c.title) {
    // Scene and video layouts are saved as a top-left (origin 'tl'); a marker card's is one already.
    for (const k of to) out[layoutKeyOf(k)] = { x: from.layout.x, y: from.layout.y, scale: from.layout.scale, ...(k === 'marker' ? {} : { origin: 'tl' as const }) }
  }
  if (c.logo) {
    const logos = { ...(tc.logos ?? {}) }
    for (const k of to) { if (from.logo === undefined) delete logos[k]; else logos[k] = from.logo }
    out.logos = logos
  }
  if (c.objects) {
    const objects = { ...(tc.objects ?? {}), [from.kind]: from.objects }
    for (const k of to) objects[k] = from.objects.map(a => ({ ...a, id: newId(), ...(a.groupId ? { groupId: `${a.groupId}:${k}` } : {}) }))
    out.objects = objects
  }
  return out
}
