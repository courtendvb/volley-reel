import { useMemo, useState } from 'react'
import { EFFECTS, SKILLS, TYPES, codeParts, partsCode, validCode, type CodeParts } from '../../../shared/codeEdit'
import { effectName, skillName } from '../../../shared/labels'
import type { Play, Player } from '../../../shared/types'
import { t } from '../../../shared/i18n'

interface Props {
  play: Pick<Play, 'code' | 'original' | 'skill' | 'setNum' | 'score'>
  players: Player[] // the play's team, by jersey
  matchName: string
  onSave: (code: string) => void // the file's code takes the correction off
  onClose: () => void
}

const ZONES = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9']
const SUBS = ['', 'A', 'B', 'C', 'D']
const TYPE_NAMES: Record<string, string> = { H: 'H', M: 'M', Q: 'Q', T: 'T', U: 'U', N: 'N', O: 'O' }

// One play's code corrected (codeEdit.ts): the parts people change most (player, skill, hit type,
// evaluation, combination, zones), or the code as text. Saved beside the match; the scout file stays as it is.
export function CodeEditDialog({ play, players, matchName, onSave, onClose }: Props) {
  const fileCode = play.original ?? play.code
  const [code, setCode] = useState(play.code)
  const parts = useMemo(() => codeParts(code), [code])
  const set = (patch: Partial<CodeParts>) => setCode(partsCode({ ...parts, ...patch }))
  const ok = validCode(code)
  const changed = code !== play.code
  const pick = (label: string, value: string, options: string[], on: (v: string) => void, name: (v: string) => string = v => v || '—') => (
    <label className="code-field"><span className="field-label">{label}</span>
      <select value={value} onChange={e => on(e.target.value)}>
        {!options.includes(value) && <option value={value}>{name(value)}</option>}
        {options.map(o => <option key={o} value={o}>{name(o)}</option>)}
      </select>
    </label>
  )
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal code-edit" role="dialog" aria-label={t('コードを直す')} onClick={e => e.stopPropagation()}>
        <h2>{t('コードを直す')}</h2>
        <p className="muted small">{matchName} · S{play.setNum} {play.score.home}-{play.score.away}</p>
        <div className="code-fields">
          {pick(t('選手'), String(parts.jersey), players.map(p => String(p.jersey)), v => set({ jersey: +v }),
            v => { const p = players.find(x => String(x.jersey) === v); return p ? `#${p.jersey} ${p.lastName}` : `#${v}` })}
          {pick(t('スキル'), parts.skill, [...SKILLS], v => set({ skill: v }), v => `${v} ${skillName(v)}`)}
          {pick(t('打ち方'), parts.type, ['', ...TYPES], v => set({ type: v }), v => TYPE_NAMES[v] ?? '—')}
          {pick(t('評価'), parts.effect, [...EFFECTS], v => set({ effect: v }), v => `${v} ${effectName(parts.skill, v)}`)}
          <label className="code-field"><span className="field-label">{t('コンビ')}</span>
            <input value={parts.combo} maxLength={2} onChange={e => set({ combo: e.target.value.toUpperCase().slice(0, 2) })} placeholder="X5" /></label>
          {pick(t('開始ゾーン'), parts.startZone, ZONES, v => set({ startZone: v }))}
          {pick(t('終了ゾーン'), parts.endZone, ZONES, v => set({ endZone: v }))}
          {pick(t('サブゾーン'), parts.endSub, SUBS, v => set({ endSub: v }))}
        </div>
        <label className="code-raw"><span className="field-label">{t('コード')}</span>
          <input value={code} onChange={e => setCode(e.target.value.trim())} spellCheck={false} aria-invalid={!ok} /></label>
        {!ok && <p className="hint warning">{t('コードの形が正しくありません。チーム（* か a）、背番号 2 桁、スキル、打ち方、評価の順です')}</p>}
        <p className="hint">{t('元のコード: {0}', fileCode)}{play.original ? ` · ${t('今は直したコードを使っています')}` : ''}</p>
        <p className="hint">{t('直したコードは倉庫に保存し、スカウトファイルは書き換えません。絞り込み・レポート・スライド・コートの表示のすべてに使います')}</p>
        <div className="modal-actions">
          {play.original && <button onClick={() => onSave(fileCode)}>{t('元のコードに戻す')}</button>}
          <span className="spacer" />
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!ok || !changed} onClick={() => onSave(code)}>{t('保存')}</button>
        </div>
      </div>
    </div>
  )
}
