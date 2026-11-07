import { useState } from 'react'
import { t } from '../../../shared/i18n'

// The 20 basic colours of Windows Paint: picking from a few fixed ones makes the same colour easy to find again.
export const PAINT_COLORS = [
  '#000000', '#7F7F7F', '#880015', '#ED1C24', '#FF7F27', '#FFF200', '#22B14C', '#00A2E8', '#3F48CC', '#A349A4',
  '#FFFFFF', '#C3C3C3', '#B97A57', '#FFAEC9', '#FFC90E', '#EFE4B0', '#B5E61D', '#99D9EA', '#7092BE', '#C8BFE7',
]

// A swatch that opens the palette; the colour in use is shown even when it isn't one of them.
export function PaletteColor({ value, label, onChange }: { value: string; label: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="palette-color">
      <button className="palette-swatch" style={{ background: value }} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(o => !o)} />
      {open && (
        <>
          <span className="palette-backdrop" onClick={() => setOpen(false)} />
          <span className="palette-pop" role="listbox" aria-label={label}>
            {PAINT_COLORS.map(c => (
              <button key={c} role="option" aria-selected={c.toUpperCase() === value.toUpperCase()} className={c.toUpperCase() === value.toUpperCase() ? 'on' : ''}
                style={{ background: c }} title={c} aria-label={t('{0} にする', c)} onClick={() => { onChange(c); setOpen(false) }} />
            ))}
          </span>
        </>
      )}
    </span>
  )
}
