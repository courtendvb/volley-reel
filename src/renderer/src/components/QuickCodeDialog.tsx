import { useEffect, useRef, useState } from 'react'
import { validCode } from '../../../shared/codeEdit'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

// Enter on a play in the list: its code alone on one line, corrected in place, play after play. Enter saves (when
// changed) and goes on to the next play; ↑ ↓ go to the play before / after (saving a change first); Esc closes.
// The same correction as the code dialog (codeEdit.ts); the scout file is not written.
export function QuickCodeDialog({ code, label, onSave, onMove, onClose }: {
  code: string
  label: string // which play: set, score, player
  onSave: (code: string, then: 1 | -1) => void // saved, then the next (1) or previous (-1) play
  onMove: (dir: 1 | -1) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(code)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, [])
  const ok = validCode(value)
  return (
    <div className="modal-backdrop quick-code-backdrop" onClick={onClose}>
      <div className="modal quick-code" role="dialog" aria-label={t('コードを直す')} onClick={e => e.stopPropagation()}>
        <div className="quick-code-label">{label}</div>
        <input ref={input} value={value} spellCheck={false} aria-invalid={!ok} aria-label={t('コード')}
          title={t('Enter で保存して次のプレーへ、↑↓ で前後のプレーへ、Esc で閉じる')}
          onChange={e => setValue(e.target.value.trim())}
          onKeyDown={e => {
            e.stopPropagation()
            if (composing(e)) return
            const go = (dir: 1 | -1) => { if (value === code) onMove(dir); else if (ok) onSave(value, dir) }
            if (e.key === 'Escape') { e.preventDefault(); onClose() }
            else if (e.key === 'Enter') { e.preventDefault(); go(1) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); go(1) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); go(-1) }
          }} />
        <div className="quick-code-keys">{t('Enter 保存して次へ · ↑↓ 前後のプレー · Esc 閉じる')}</div>
      </div>
    </div>
  )
}
