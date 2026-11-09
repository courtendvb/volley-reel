import { useState } from 'react'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

// A title shown as text; clicking it turns it into a field to edit in place (Enter / Escape / leaving it ends).
// shown: what the text shows when it differs from the value (the value is still what is edited, and the tooltip).
export function InlineTitle({ value, shown, placeholder, label, onChange, className = '' }: {
  value: string; shown?: string; placeholder: string; label: string; onChange: (v: string) => void; className?: string
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input className={`inline-title ${className}`} autoFocus aria-label={label} value={value} placeholder={placeholder}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={e => { e.stopPropagation(); if ((e.key === 'Enter' || e.key === 'Escape') && !composing(e)) setEditing(false) }} />
    )
  }
  return (
    <span className={`inline-title-text ${className}${value ? '' : ' muted'}`} title={shown && shown !== value ? `${value}
${t('クリックで名前を編集')}` : t('クリックで名前を編集')}
      onClick={e => { e.stopPropagation(); setEditing(true) }}>{(shown || value) || placeholder}</span>
  )
}
