import { useEffect, useRef, useState } from 'react'
import type { CompareSession } from '../../../shared/videoCompare'
import { t } from '../../../shared/i18n'

// The top bar's entry to video comparison: a new one, or one saved before (comparisons save themselves).
export function CompareMenu({ compares, onOpenMenu, onNew, onOpen, onDelete }: {
  compares: CompareSession[]; onOpenMenu: () => void; onNew: () => void; onOpen: (s: CompareSession) => void; onDelete: (s: CompareSession) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="cmp-source" ref={ref}>
      <button onClick={() => { if (!open) onOpenMenu(); setOpen(o => !o) }} aria-expanded={open}
        title={t('2本の動画を左右に並べて見比べる（プロジェクトとは別。DVW のない動画も使えます）')}>{t('比較動画')} ▾</button>
      {open && (
        <div className="cmp-menu right">
          <button className="primary" onClick={() => { setOpen(false); onNew() }}>{t('新しい比較を作る')}</button>
          <h3 className="muted small-head">{t('保存した比較')}</h3>
          <div className="cmp-list">
            {compares.map(c => (
              <div key={c.id} className="cmp-saved">
                <button onClick={() => { setOpen(false); onOpen(c) }} title={c.name}>{c.name}</button>
                <button className="small" onClick={() => { if (window.confirm(t('比較「{0}」を削除します（動画は消えません）。よろしいですか？', c.name))) onDelete(c) }} title={t('この比較を削除（動画は消えません）')}>{t('削除')}</button>
              </div>
            ))}
            {!compares.length && <p className="muted small">{t('まだありません')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
