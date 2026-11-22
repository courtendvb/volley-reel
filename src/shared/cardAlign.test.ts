import { describe, expect, it } from 'vitest'
import type { Annotation } from './annotation'
import { alignTitleCards, type AlignFrom, type TitleCardSettings } from './cardAlign'

const tc: TitleCardSettings = { enabled: true, sceneCards: true, durationSec: 3, showMarkerName: true, showMatch: true,
  markerLayout: { x: 0.2, y: 0.2, scale: 1 }, logos: { marker: 'hidden' }, objects: { marker: [{ id: 'old', kind: 'rect', color: '#FFF', x: 0, y: 0, w: 0.1, h: 0.1, width: 2 }] } }
const frame: Annotation = { id: 'f', kind: 'image', color: '#FFF', x: 0.6, y: 0.2, w: 0.3, h: 0.5, assetId: '', frame: 'top' }
const text: Annotation = { id: 't', kind: 'text', color: '#FFF', x: 0.1, y: 0.8, text: 'HTH', size: 30, groupId: 'g' }
const from: AlignFrom = { kind: 'scene', layout: { x: 0.12, y: 0.4, scale: 1.2, origin: 'tl' }, logo: { x: 0.8, y: 0.2, h: 0.2 }, objects: [frame, text] }
let n = 0
const ids = () => `n${++n}`

describe('alignTitleCards', () => {
  it('copies the title place and size to the kinds chosen, each saved as its kind keeps it', () => {
    const out = alignTitleCards(tc, from, { title: true, logo: false, objects: false, to: ['marker', 'video'] })
    expect(out.markerLayout).toEqual({ x: 0.12, y: 0.4, scale: 1.2 })
    expect(out.videoLayout).toEqual({ x: 0.12, y: 0.4, scale: 1.2, origin: 'tl' })
    expect(out.sceneLayout).toBeUndefined() // the card's own kind is left as it is
    expect(out.logos).toEqual(tc.logos)
  })
  it('copies the logo place, or puts it back beside the title', () => {
    expect(alignTitleCards(tc, from, { title: false, logo: true, objects: false, to: ['marker'] }).logos).toEqual({ marker: { x: 0.8, y: 0.2, h: 0.2 } })
    expect(alignTitleCards(tc, { ...from, logo: undefined }, { title: false, logo: true, objects: false, to: ['marker'] }).logos).toEqual({})
  })
  it('shares the card\'s objects on its kind, and copies them (new ids, own groups) to each kind chosen', () => {
    const out = alignTitleCards(tc, from, { title: false, logo: false, objects: true, to: ['marker'] }, ids)
    expect(out.objects?.scene).toEqual([frame, text])
    const copies = out.objects!.marker!
    expect(copies.map(a => a.kind)).toEqual(['image', 'text']) // replaces what markers shared
    expect(copies.map(a => a.id)).not.toContain('f')
    expect(copies[1].groupId).toBe('g:marker')
    expect(out.objects?.video).toBeUndefined()
  })
  it('changes nothing it was not asked to', () => {
    expect(alignTitleCards(tc, from, { title: false, logo: false, objects: false, to: ['marker', 'video'] })).toEqual(tc)
  })
})
