import { useMemo, useState } from 'react'
import type { Match } from '../../../shared/types'
import { formatTime } from '../format'

interface Props {
  mode: 'create' | 'edit'
  matches: Match[] // the whole library
  initial: { name: string; codes: string[]; selected: string[] }
  onDone: (r: { name: string; codes: string[]; matchIds: string[] }) => void
  onClose: () => void
}

// Choose a project's matches from the library (v3): type our team's three-letter codes and the
// library narrows to matches with those teams; tick any number of them.
export function MatchPicker({ mode, matches, initial, onDone, onClose }: Props) {
  const [name, setName] = useState(initial.name)
  const [codesText, setCodesText] = useState(initial.codes.join(', '))
  const [selected, setSelected] = useState(() => new Set(initial.selected))
  const codes = codesText.toUpperCase().split(/[,\s]+/).filter(Boolean)
  const candidates = useMemo(() => {
    const ofTeam = codes.length ? matches.filter(m => m.teams.some(t => codes.includes(t.code.toUpperCase()))) : matches
    // Keep ticked matches visible even if the codes no longer cover them.
    const extra = matches.filter(m => selected.has(m.id) && !ofTeam.includes(m))
    return [...ofTeam, ...extra].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [matches, codesText, selected])

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const all = candidates.every(m => selected.has(m.id))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker-modal" role="dialog" aria-label="試合を選ぶ" onClick={e => e.stopPropagation()}>
        <h2>{mode === 'create' ? '新しいプロジェクト' : 'プロジェクトの試合'}</h2>
        <div className="picker-fields">
          {mode === 'create' && (
            <label className="field"><span className="field-label">名前</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="例: 2026-27 前半ハイライト" /></label>
          )}
          <label className="field"><span className="field-label">対象チーム</span>
            <input value={codesText} onChange={e => setCodesText(e.target.value)} placeholder="HTH, HTA" aria-label="対象チームのコード" /></label>
          <p className="hint">スリーレターコード（DVW の [3TEAMS]）。このチームが出ている試合だけを倉庫から抽出し、プロジェクトの「自チーム」になります。</p>
        </div>
        <div className="filter-row">
          <span className="count"><b>{selected.size}</b> 試合を選択中（候補 {candidates.length}）</span>
          <span className="spacer" />
          <button className="link" onClick={() => setSelected(s => { const n = new Set(s); for (const m of candidates) { if (all) n.delete(m.id); else n.add(m.id) } return n })}>
            {all ? '候補をすべて外す' : '候補をすべて選ぶ'}
          </button>
        </div>
        <div className="match-table picker" role="list">
          {candidates.map(m => (
            <label key={m.id} className={`match-row pick${selected.has(m.id) ? ' on' : ''}`} role="listitem">
              <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
              <span className="date">{m.date ?? '—'}</span>
              <span className="teams"><b>{m.teams[0].code}</b> – <b>{m.teams[1].code}</b></span>
              <span className="muted names">{m.teams[0].name} / {m.teams[1].name}</span>
              <span className="muted dur">{formatTime(m.durationSec)}</span>
            </label>
          ))}
          {!candidates.length && <p className="muted pad">このチームの試合は倉庫にありません</p>}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={!selected.size} onClick={() => onDone({ name, codes, matchIds: [...selected] })}>
            {mode === 'create' ? 'フォルダを選んで作成' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
