import { useEffect, useRef, useState } from 'react'
import { validCode } from '../../../shared/codeEdit'
import { composing } from '../keys'
import { playback } from '../playback'
import { t } from '../../../shared/i18n'

// Enter on a play in the list: its code, corrected right in its row, play after play, with the video left in view.
// Enter saves (when changed) and goes on to the next play; ↑ ↓ go to the play before / after (saving a change first);
// Space plays / pauses the video (a code has no spaces); Esc closes. Clicking elsewhere leaves it open, so the video
// can be scrubbed and the code picked up again. The same correction as the code dialog (codeEdit.ts); the scout
// file is not written.
export function QuickCodeInput({ code, onSave, onMove, onClose }: {
  code: string
  onSave: (code: string, then: 1 | -1) => void // saved, then the next (1) or previous (-1) play
  onMove: (dir: 1 | -1) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(code)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, [])
  const ok = validCode(value)
  return (
    <input ref={input} className="quick-code" value={value} spellCheck={false} aria-invalid={!ok} aria-label={t('コードを直す')}
      title={t('Enter 保存して次へ · ↑↓ 前後のプレー · Space 再生 / 一時停止 · Esc 閉じる')}
      onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}
      onChange={e => setValue(e.target.value.replace(/\s/g, ''))}
      onKeyDown={e => {
        e.stopPropagation()
        if (composing(e)) return
        const go = (dir: 1 | -1) => { if (value === code) onMove(dir); else if (ok) onSave(value, dir) }
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); go(1) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); go(-1) }
        else if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      }} />
  )
}
