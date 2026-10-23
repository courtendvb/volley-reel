import { useEffect, useState, type ReactNode } from 'react'

// A fold-away section of the right column (palette, export): a full-width header to click, its
// open state remembered per section.
export function Accordion({ id, title, icon, badge, children }: { id: string; title: string; icon: string; badge?: ReactNode; children: ReactNode }) {
  const key = `vr.accordion.${id}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(key, open ? '1' : '0') } catch { /* not kept */ } }, [key, open])
  return (
    <section className={`accordion${open ? ' open' : ''}`} data-accordion={id}>
      <button className="accordion-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="accordion-arrow" aria-hidden>{open ? '▼' : '▶'}</span>
        <span className="accordion-icon" aria-hidden>{icon}</span>
        <span className="accordion-title">{title}</span>
        {badge !== undefined && <span className="accordion-badge">{badge}</span>}
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </section>
  )
}
