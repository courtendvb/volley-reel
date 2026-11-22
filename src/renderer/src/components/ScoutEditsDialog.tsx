import type { Match, ParsedDVW } from '../../../shared/types'
import { editCount } from '../../../shared/codeEdit'
import { t } from '../../../shared/i18n'

interface Props {
  match: Match
  dvw: ParsedDVW | undefined
  busy: boolean
  onUndoEdit: (line: number, from: string) => void
  onUndoInsert: (id: string) => void
  onClearAll: () => void
  onExport: (format: 'dvw' | 'vsm') => void
  onClose: () => void
}

// A match's corrections to its scout file (codeEdit.ts), each with its undo, and writing out the corrected file:
// a .dvw from either kind, a .vsm only from a .vsm. The original file is never written.
export function ScoutEditsDialog({ match: m, dvw, busy, onUndoEdit, onUndoInsert, onClearAll, onExport, onClose }: Props) {
  const edits = m.codeEdits ?? [], inserts = m.codeInserts ?? []
  const n = editCount({ edits, inserts })
  const fromVsm = /\.vsm$/i.test(m.dvwPath)
  const staleN = (dvw?.stale?.edits.length ?? 0) + (dvw?.stale?.inserts.length ?? 0)
  const isStale = (line: number) => !!dvw?.stale?.edits.some(e => e.line === line)
  const insStale = (id: string) => !!dvw?.stale?.inserts.some(i => i.id === id)
  const rows = [
    ...edits.map(e => ({ key: `e${e.line}`, line: e.line, kind: e.to === '' ? t('削除') : t('変更'), text: e.to === '' ? e.from : `${e.from} → ${e.to}`, stale: isStale(e.line), undo: () => onUndoEdit(e.line, e.from) })),
    ...inserts.map(i => ({ key: `i${i.id}`, line: i.after + 0.5, kind: t('追加'), text: `${i.code}  (${t('{0} 秒', Math.round(i.time * 10) / 10)})`, stale: insStale(i.id), undo: () => onUndoInsert(i.id) })),
  ].sort((a, b) => a.line - b.line)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scout-edits" role="dialog" aria-label={t('スカウトの修正')} onClick={e => e.stopPropagation()}>
        <h2>{t('スカウトの修正')}</h2>
        <p className="muted small">{m.name} · {m.dvwPath}</p>
        {staleN > 0 && <p className="hint warning">{t('スカウトファイルが変わったため、{0} 件の修正を使っていません（その行のコードが、修正したときと違います）', staleN)}</p>}
        {n ? (
          <ul className="scout-edit-list">
            {rows.map(r => (
              <li key={r.key} className={r.stale ? 'stale' : ''}>
                <span className="kind">{r.kind}</span><code>{r.text}</code>
                <button className="link" disabled={busy} onClick={r.undo}>{t('元に戻す')}</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">{t('この試合の修正はまだありません。プレー一覧の行を右クリックすると直せます')}</p>}
        <p className="hint">{t('直したスカウトファイルを、元とは別のファイルに書き出します。DataVolley や VolleyStation で開けます')}</p>
        <div className="modal-actions">
          {n > 0 && <button className="danger" disabled={busy} onClick={() => { if (window.confirm(t('この試合の修正 {0} 件をすべて元に戻しますか？', n))) onClearAll() }}>{t('すべて元に戻す')}</button>}
          <span className="spacer" />
          <button disabled={busy || !n} onClick={() => onExport('dvw')}>{t('DVW で書き出す…')}</button>
          <button disabled={busy || !n || !fromVsm} onClick={() => onExport('vsm')}
            title={fromVsm ? undefined : t('VSM で書き出せるのは、VolleyStation のファイル（.vsm）から取り込んだ試合だけです')}>{t('VSM で書き出す…')}</button>
          <button className="primary" onClick={onClose}>{t('閉じる')}</button>
        </div>
      </div>
    </div>
  )
}
