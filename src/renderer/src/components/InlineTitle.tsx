import { useState } from 'react'

// A title shown as text; clicking it turns it into a field to edit in place (Enter / Escape / leaving it ends).
export function InlineTitle({ value, placeholder, label, onChange, className = '' }: {
  value: string; placeholder: string; label: string; onChange: (v: string) => void; className?: string
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input className={`inline-title ${className}`} autoFocus aria-label={label} value={value} placeholder={placeholder}
        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') setEditing(false) }} />
    )
  }
  return (
    <span className={`inline-title-text ${className}${value ? '' : ' muted'}`} title="クリックで名前を編集"
      onClick={e => { e.stopPropagation(); setEditing(true) }}>{value || placeholder}</span>
  )
}
