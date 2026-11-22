// Small parts the 表示 tab's court bar is built from, so a setting reads the same wherever it is.
import { useEffect, useState } from 'react'
import type { ChartCorner } from '../../../shared/chart'
import { t } from '../../../shared/i18n'
import { useAnchoredPop } from './anchoredPop'

// A "?" that opens the long explanation of a setting, so the control's own title can stay one
// short line. Each string of `text` is one paragraph. Closes on a click elsewhere or Escape.
export function Help({ text }: { text: string[] }) {
  const [open, setOpen] = useState(false)
  const { anchor: ref, style } = useAnchoredPop<HTMLSpanElement>(open, 'above-left')
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <span className="help-wrap" ref={ref}>
      <button type="button" className="help-btn" aria-label={t('説明')} aria-expanded={open} onClick={() => setOpen(o => !o)}>?</button>
      {open && <div className="help-pop" role="note" style={style}>{text.map((p, i) => <p key={i}>{p}</p>)}</div>}
    </span>
  )
}

// Where a part sits on the picture (a corner) and how big it is: the same two controls for the
// chart and the set chart.
export function Placement({ corner, scale, onCorner, onScale, cornerLabel, scaleLabel }: {
  corner: ChartCorner; scale: number; onCorner: (c: ChartCorner) => void; onScale: (n: number) => void; cornerLabel: string; scaleLabel: string
}) {
  return (
    <>
      <select value={corner} aria-label={cornerLabel} onChange={e => onCorner(e.target.value as ChartCorner)}>
        <option value="tl">{t('左上')}</option><option value="tr">{t('右上')}</option><option value="bl">{t('左下')}</option><option value="br">{t('右下')}</option>
      </select>
      <label className="check">{t('大きさ')} <input type="range" min={0.5} max={1.5} step={0.05} value={scale} aria-label={scaleLabel} onChange={e => onScale(+e.target.value)} /></label>
    </>
  )
}
