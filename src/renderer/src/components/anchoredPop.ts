import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

// A small pop-up (help text, a ⚙ menu, the colour palette) placed with position: fixed next to
// its wrapper, so a scrolling box around it (the work area under the video) doesn't clip it.
// above-left / above-right: over the wrapper, lined up with its left / right edge; below-left: under it.
export type PopPlace = 'above-left' | 'above-right' | 'below-left'

export function useAnchoredPop<T extends HTMLElement>(open: boolean, place: PopPlace, gap = 6) {
  const anchor = useRef<T>(null)
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)
  useLayoutEffect(() => {
    if (!open) return
    const put = () => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setStyle(place === 'below-left' ? { position: 'fixed', left: r.left, top: r.bottom + gap, right: 'auto', bottom: 'auto' }
        : place === 'above-left' ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + gap, right: 'auto', top: 'auto' }
        : { position: 'fixed', right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + gap, left: 'auto', top: 'auto' })
    }
    put()
    window.addEventListener('scroll', put, true)
    window.addEventListener('resize', put)
    return () => { window.removeEventListener('scroll', put, true); window.removeEventListener('resize', put) }
  }, [open, place, gap])
  return { anchor, style: open ? style : undefined }
}
