import { useRef, useState, type ReactNode } from 'react'
import { composing } from '../keys'

// A select (the children) with a pencil beside it. The pencil turns it into a field for the open
// item's name: Enter or leaving saves, Escape cancels. A name saves once, so it is one undo step.
export function NameSelect({ name, label, onRename, children }: {
  name: string; label: string; onRename: (name: string) => void; children: ReactNode
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const open = useRef(false) // Enter and Escape remove the field, which can also blur it
  const finish = (save: boolean) => {
    if (!open.current) return
    open.current = false
    const next = draft?.trim()
    if (save && next && next !== name) onRename(next)
    setDraft(null)
  }
  return (
    <span className="name-select">
      {draft === null ? (
        <>
          {children}
          <button className="gear" aria-label={label} title={label} onClick={() => { open.current = true; setDraft(name) }}>✎</button>
        </>
      ) : (
        <input autoFocus aria-label={label} value={draft} onFocus={e => e.currentTarget.select()}
          onChange={e => setDraft(e.target.value)} onBlur={() => finish(true)}
          onKeyDown={e => {
            e.stopPropagation()
            if (composing(e)) return
            if (e.key === 'Enter') finish(true)
            else if (e.key === 'Escape') finish(false)
          }} />
      )}
    </span>
  )
}
