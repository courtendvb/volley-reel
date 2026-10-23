import { describe, expect, it } from 'vitest'
import type { Annotation } from './annotation'
import { changed, mergeScoped, moveToScope, scopeOf, splitScoped, type ScopedAnnotations } from './annotationScope'

const rect = (id: string, extra: Partial<Annotation> = {}): Annotation =>
  ({ id, kind: 'rect', color: '#FFF', x: 0, y: 0, w: 0.1, h: 0.1, width: 3, ...extra }) as Annotation
const lists: ScopedAnnotations = { video: [rect('v')], scene: [rect('s')], clip: [rect('c', { showFrom: 10, showTo: 12 })] }

describe('display scope', () => {
  it('merges video, scene and clip objects in drawing order', () => {
    expect(mergeScoped(lists).map(a => a.id)).toEqual(['v', 's', 'c'])
    expect(scopeOf(lists, 's')).toBe('scene')
  })

  it('splits an edited list back, with new objects on the clip', () => {
    const merged = mergeScoped(lists).filter(a => a.id !== 's')
    const out = splitScoped(lists, [...merged, rect('n')])
    expect(out.scene).toEqual([])
    expect(out.clip.map(a => a.id)).toEqual(['c', 'n'])
    expect(out.video).toEqual(lists.video)
  })

  it('moves an object between scopes and drops clip times when it leaves the clip', () => {
    const out = moveToScope(lists, 'c', 'scene')
    expect(out.clip).toEqual([])
    expect(out.scene.map(a => a.id)).toEqual(['s', 'c'])
    expect(out.scene[1]).not.toHaveProperty('showFrom')
    expect(moveToScope(lists, 'c', 'clip')).toBe(lists)
  })

  it('tells when a list was edited', () => {
    expect(changed(lists.clip, [...lists.clip])).toBe(false)
    expect(changed(lists.clip, [rect('c')])).toBe(true)
  })
})
