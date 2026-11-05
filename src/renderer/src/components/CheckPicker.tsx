// A drop-down of check boxes: nothing ticked means all of them. Its list is placed on the window, so
// the scrolling sidebar doesn't cut it off.
import { useRef, useState } from 'react'
import { t } from '../../../shared/i18n'

interface Props {
  label: string // for screen readers
  all: string // the first row, and the button when nothing is ticked
  options: { key: string; label: string }[]
  selected: string[]
  onChange: (keys: string[]) => void
  className?: string
}

export function CheckPicker({ label, all, options, selected, onChange, className }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  const open = () => {
    const r = button.current!.getBoundingClientRect()
    setAt({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 260) })
  }
  const shown = selected.length === 1 ? options.find(o => o.key === selected[0])?.label ?? all
    : selected.length ? t('{0} 件を選択中', selected.length) : all
  return (
    <>
      <button ref={button} type="button" className={`check-picker${className ? ` ${className}` : ''}`} aria-label={label} aria-haspopup="listbox" aria-expanded={!!at}
        title={selected.length > 1 ? options.filter(o => selected.includes(o.key)).map(o => o.label).join('\n') : undefined}
        onClick={() => (at ? setAt(null) : open())}><span>{shown}</span><span aria-hidden>▾</span></button>
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} />
          <div className="check-picker-list" role="listbox" aria-multiselectable aria-label={label} style={at}>
            <label className="check"><input type="checkbox" checked={!selected.length} onChange={() => onChange([])} /> {all}</label>
            {options.map(o => (
              <label key={o.key} className="check">
                <input type="checkbox" checked={selected.includes(o.key)}
                  onChange={e => onChange(e.target.checked ? [...selected, o.key] : selected.filter(k => k !== o.key))} /> {o.label}</label>
            ))}
          </div>
        </>
      )}
    </>
  )
}
