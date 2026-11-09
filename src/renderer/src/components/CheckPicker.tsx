// A drop-down of check boxes: nothing ticked means all of them. Its list is placed on the window, so
// the scrolling sidebar doesn't cut it off. It closes with its 閉じる button, Esc, or a click anywhere
// outside it, and stays inside the window: below the button, or above it when there is more room there.
// It follows the button when the column moves (ticking a player can add the saved-filter row above it).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { t } from '../../../shared/i18n'

interface Props {
  label: string // for screen readers
  all: string // the first row, and the button when nothing is ticked
  options: { key: string; label: string }[]
  selected: string[]
  onChange: (keys: string[]) => void
  className?: string
}

const GAP = 2, MARGIN = 8, MAX_SHARE = 0.5 // the list's room: at most half the window's height

// Where the list goes for a button at `r` in a window `h` high: below it, or above it when the
// room below is short and there is more above. Its height is held to the room it has.
export function pickerPlace(r: { left: number; top: number; bottom: number; width: number }, h: number): CSSProperties {
  const below = h - r.bottom - GAP - MARGIN, above = r.top - GAP - MARGIN
  const up = below < 200 && above > below
  const room = Math.max(120, Math.min(h * MAX_SHARE, up ? above : below))
  return { left: r.left, width: Math.max(r.width, 260), maxHeight: room, ...(up ? { bottom: h - r.top + GAP } : { top: r.bottom + GAP }) }
}

export function CheckPicker({ label, all, options, selected, onChange, className }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<CSSProperties | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const place = () => pickerPlace(button.current!.getBoundingClientRect(), window.innerHeight)
  const open = () => setAt(place())
  // After every render while open (the column may have moved): put the list back by the button.
  useLayoutEffect(() => {
    if (!at || !button.current) return
    const next = place()
    if (JSON.stringify(next) !== JSON.stringify(at)) setAt(next)
  })
  const close = () => { setAt(null); button.current?.focus() }
  // Esc closes it; so does a change of the window's size, which would leave it out of place.
  useEffect(() => {
    if (!at) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const onResize = () => setAt(null)
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && listRef.current?.contains(e.target)) && button.current) setAt(place()) } // the column scrolled: follow the button
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onScroll, true) }
  }, [at])
  const shown = selected.length === 1 ? options.find(o => o.key === selected[0])?.label ?? all
    : selected.length ? t('{0} 件を選択中', selected.length) : all
  return (
    <>
      <button ref={button} type="button" className={`check-picker${className ? ` ${className}` : ''}`} aria-label={label} aria-haspopup="listbox" aria-expanded={!!at}
        title={selected.length > 1 ? options.filter(o => selected.includes(o.key)).map(o => o.label).join('\n') : undefined}
        onClick={() => (at ? close() : open())}><span>{shown}</span><span aria-hidden>▾</span></button>
      {at && (
        <>
          <div className="menu-backdrop" onClick={close} />
          <div ref={listRef} className="check-picker-list" role="listbox" aria-multiselectable aria-label={label} style={at}>
            <div className="check-picker-items">
              <label className="check"><input type="checkbox" checked={!selected.length} onChange={() => onChange([])} /> {all}</label>
              {options.map(o => (
                <label key={o.key} className="check">
                  <input type="checkbox" checked={selected.includes(o.key)}
                    onChange={e => onChange(e.target.checked ? [...selected, o.key] : selected.filter(k => k !== o.key))} /> {o.label}</label>
              ))}
            </div>
            <div className="check-picker-foot">
              <span className="muted">{selected.length ? t('{0} 件を選択中', selected.length) : all}</span>
              <button type="button" className="primary" onClick={close}>{t('閉じる')}</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
