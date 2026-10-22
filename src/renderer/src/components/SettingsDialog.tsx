import { useMemo, useState } from 'react'
import { listPeople, type PlayRef } from '../../../shared/filter'
import type { ProjectSettings } from '../../../shared/types'

interface Props {
  settings: ProjectSettings
  rawRefs: PlayRef[] // all matches, built without the alias table so every original key shows
  onSave: (s: ProjectSettings) => Promise<void>
  onClose: () => void
}

// 自チームのチームコードと名寄せ表 (design §3.2).
// Player IDs already merge home/away and the scrimmage "-a" suffix; this table is for what's left.
export function SettingsDialog({ settings, rawRefs, onSave, onClose }: Props) {
  const [codes, setCodes] = useState(settings.ourTeamCodes.join(', '))
  const [aliases, setAliases] = useState<Record<string, string>>(settings.playerAliases)
  const [showOpp, setShowOpp] = useState(false)
  const [saving, setSaving] = useState(false)

  const people = useMemo(() => listPeople(rawRefs), [rawRefs])
  const shown = people.filter(p => showOpp || p.teamRole !== 'opp')
  const label = (key: string) => {
    const p = people.find(x => x.key === key)
    return p ? `#${p.jerseys.join('/')} ${p.name}${p.teamCodes.length ? ` (${p.teamCodes.join('/')})` : ''}` : key
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ ourTeamCodes: codes.split(/[,\s]+/).filter(Boolean), playerAliases: aliases })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="設定" onClick={e => e.stopPropagation()}>
        <h2>設定</h2>

        <section>
          <label className="field-label" htmlFor="our-codes">自チームのチームコード</label>
          <input id="our-codes" value={codes} onChange={e => setCodes(e.target.value)} placeholder="HTH, HTA" />
          <p className="hint">DVW の [3TEAMS] のコード。ここにあるチームが「自チーム」になり、スコアボードでは左に置かれます。</p>
        </section>

        <section className="alias-section">
          <div className="filter-row">
            <span className="field-label">名寄せ表</span>
            <span className="spacer" />
            <label className="check"><input type="checkbox" checked={showOpp} onChange={e => setShowOpp(e.target.checked)} /> 相手チームの選手も表示</label>
          </div>
          <p className="hint">選手は DataVolley の選手IDで同じ人とみなします（ホーム/アウェイ、紅白戦の「-a」も自動で統合）。IDが違うのに同じ人の場合だけ指定してください。</p>
          <div className="alias-table">
            {shown.map(p => {
              const target = aliases[p.key] ?? ''
              const loops = !!target && leadsTo(target, p.key, aliases)
              return (
                <div key={p.key} className="alias-row">
                  <span className="who">{label(p.key)}</span>
                  <code className="key">{p.key}</code>
                  <span className="muted">{p.plays}</span>
                  <select value={target} aria-label={`${p.name} と同じ人`}
                    onChange={e => setAliases(a => { const n = { ...a }; if (e.target.value) n[p.key] = e.target.value; else delete n[p.key]; return n })}>
                    <option value="">（別の人）</option>
                    {people.filter(o => o.key !== p.key && (showOpp || o.teamRole !== 'opp')).map(o => (
                      <option key={o.key} value={o.key}>= {label(o.key)}</option>
                    ))}
                  </select>
                  {loops && <span className="warning-inline">循環しています</span>}
                </div>
              )
            })}
          </div>
        </section>

        {Object.keys(aliases).some(k => leadsTo(aliases[k], k, aliases)) && (
          <p className="hint">循環している指定は、たどり始めた選手で止まります。どちらか一方を「別の人」に戻してください。</p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={save} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  )
}

// Does following aliases from `from` come back to `to`?
function leadsTo(from: string, to: string, aliases: Record<string, string>): boolean {
  const seen = new Set<string>()
  for (let k: string | undefined = from; k && !seen.has(k); k = aliases[k]) {
    if (k === to) return true
    seen.add(k)
  }
  return false
}
