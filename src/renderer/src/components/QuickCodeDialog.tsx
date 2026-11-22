import { useEffect, useRef, useState } from 'react'
import { validCode } from '../../../shared/codeEdit'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

// Enter on a play in the list: its code alone on one line, corrected in place. Enter saves, Esc closes.
// The same correction as the code dialog (codeEdit.ts); the scout file is not written.
export function QuickCodeDialog({ code, onSave, onClose }: { code: string; onSave: (code: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(code)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, [])
  const ok = validCode(value)
  return (
    <div className="modal-backdrop quick-code-backdrop" onClick={onClose}>
      <div className="modal quick-code" role="dialog" aria-label={t('コードを直す')} onClick={e => e.stopPropagation()}>
        <input ref={input} value={value} spellCheck={false} aria-invalid={!ok} aria-label={t('コード')}
          title={t('Enter で保存、Esc で閉じる')}
          onChange={e => setValue(e.target.value.trim())}
          onKeyDown={e => {
            e.stopPropagation()
            if (composing(e)) return
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'Enter') { e.preventDefault(); if (value === code) onClose(); else if (ok) onSave(value) }
          }} />
      </div>
    </div>
  )
}
