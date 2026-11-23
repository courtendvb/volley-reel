import { useEffect, useMemo, useRef, useState } from 'react'
import type { AttackBoard, AttackSplit, BoardPlayer } from '../shared/board'
import { ATTACK_CONDITIONS, attackLayoutOf, defaultCodeGroups, type AttackCondition, type AttackLayout, type SetterRow } from './attackBoard'
import { attackCodes } from '../shared/board'
import { t } from '../shared/i18n'

// The データスライド dialog's parts for the team's own slides (board.ts INTERNAL_SKILLS).

// サーブの狙い: what the slide shows.
export function ServeTargetHint() {
  return <p className="hint">{t('このチームのレセプションを、受けた選手（写真付き）とサーブの種類（ジャンプ・フローター）ごと、サーブが入ったゾーンごとに並べます。チーム全体より 10 ポイント以上良い数字を青、悪い数字を赤で示します')}</p>
}

// アタックディレクション: how our defence
// stands, how the columns are split (by the pass, or by attack codes for a middle) and each column's codes,
// the setter's row the attacks are kept to, and our blockers and diggers. Tells the dialog what it makes,
// or null while nothing would be in it.
const conditionLabel = (c: AttackCondition) => (c === 'good' ? t('良いパス（# +）') : c === 'poor' ? t('M.PASS（! -）') : t('トランジション'))

export function AttackOptions({ attacker, names, initial, onChange }: {
  attacker: BoardPlayer | undefined // the column picked
  names: Record<string, string> // the attack codes' names in the DVWs
  initial?: AttackBoard // a slide made again
  onChange: (attack: AttackBoard | null) => void
}) {
  const [conditions, setConditions] = useState<AttackCondition[]>(initial?.conditions ?? ['good', 'poor'])
  const [setterRow, setSetterRow] = useState<SetterRow | ''>(initial?.setterRow ?? '')
  const [defense, setDefense] = useState(initial?.defense ?? true)
  // How the columns are split (null: by the pass, or by attack codes for a middle) and, by codes, each
  // column's codes (null: the quicks by the setter, then the rest); how our defence stands ('': from the attacker).
  const [attackSplit, setAttackSplit] = useState<AttackSplit | null>(initial?.split ?? null)
  const [codeGroups, setCodeGroups] = useState<string[][] | null>(initial?.codeGroups ?? null)
  const [attackLayout, setAttackLayout] = useState<AttackLayout | ''>(initial?.layout ?? '')
  // Another attacker: their codes start again from the default.
  const was = useRef(attacker?.key)
  useEffect(() => {
    if (was.current !== attacker?.key) { was.current = attacker?.key; setCodeGroups(null) }
  }, [attacker?.key])
  const theirCodes = useMemo(() => (attacker ? attackCodes([attacker]).map(c => c.code) : []), [attacker])
  const middle = !!attacker && (attackLayout || attackLayoutOf(attacker.player, attacker.plays)) === 'middle'
  const splitBy: AttackSplit = attackSplit ?? (middle ? 'codes' : 'pass')
  const groups = (codeGroups ?? defaultCodeGroups(theirCodes, names)).map(g => g.filter(c => theirCodes.includes(c)))
  const attack: AttackBoard = { conditions, ...(setterRow ? { setterRow } : {}), defense, split: splitBy, ...(splitBy === 'codes' ? { codeGroups: groups } : {}), ...(attackLayout ? { layout: attackLayout } : {}) }
  const ready = splitBy === 'pass' ? conditions.length > 0 : groups.some(g => g.length)
  const key = JSON.stringify(ready ? attack : null)
  useEffect(() => { onChange(ready ? attack : null) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickCode = (i: number, code: string, on: boolean) => setCodeGroups([0, 1].map(k => (k === i ? (on ? [...(groups[k] ?? []), code] : (groups[k] ?? []).filter(c => c !== code)) : (groups[k] ?? []).filter(c => !(on && c === code)))))
  return (
    <>
      <div className="filter-row">
        <span className="field-label">{t('配置')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('守備の配置')} title={t('サイド：2 枚ブロックとディガー 3 人（ゾーン 4 からは左右反転）。ミドル：3 枚ブロックとディガー 3 人。自動はポジション（なければ打った位置）で決めます')}>
          {([['', t('自動')], ['side', t('サイド')], ['middle', t('ミドル')]] as [AttackLayout | '', string][]).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={attackLayout === k} className={attackLayout === k ? 'on' : ''} onClick={() => setAttackLayout(k)}>{label}</button>
          ))}
        </div>
        <span className="field-label">{t('列の分け方')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('列の分け方')}>
          <button role="radio" aria-checked={splitBy === 'pass'} className={splitBy === 'pass' ? 'on' : ''} onClick={() => setAttackSplit('pass')} title={t('パスの質（とトランジション）で列を分け、各列の上にトスの位置を出します')}>{t('パスの質')}</button>
          <button role="radio" aria-checked={splitBy === 'codes'} className={splitBy === 'codes' ? 'on' : ''} onClick={() => setAttackSplit('codes')} title={t('アタックコードで列を分けます（ミドルの A・C クイックと、それ以外など）')}>{t('アタックコード')}</button>
        </div>
      </div>
      {splitBy === 'codes' && [0, 1].map(i => (
        <div key={i} className="filter-row">
          <span className="field-label">{t('{0} 列目', i + 1)}</span>
          {theirCodes.map(c => (
            <label key={c} className="check"><input type="checkbox" checked={(groups[i] ?? []).includes(c)} onChange={e => pickCode(i, c, e.target.checked)} /> {`${c}${names[c] ? ` ${names[c]}` : ''}`}</label>
          ))}
        </div>
      ))}
      <div className="filter-row" title={t('右に条件ごとの列を並べます。各列は、その条件でこの選手に上がったトスの位置と、打ち先のチャート（打ち方の割合、K・E・B・Att、K%・ERR%・Pos・Neg）です')}>
        {splitBy === 'pass' && <span className="field-label">{t('列')}</span>}
        {splitBy === 'pass' && ATTACK_CONDITIONS.map(c => (
          <label key={c} className="check"><input type="checkbox" checked={conditions.includes(c)}
            onChange={e => setConditions(ATTACK_CONDITIONS.filter(x => (x === c ? e.target.checked : conditions.includes(x))))} /> {conditionLabel(c)}</label>
        ))}
        <label className="field-label" htmlFor="board-setter-row">{t('セッター')}</label>
        <select id="board-setter-row" value={setterRow} onChange={e => setSetterRow(e.target.value as SetterRow | '')}>
          <option value="">{t('前衛・後衛とも')}</option>
          <option value="front">{t('前衛（Setter Front）')}</option>
          <option value="back">{t('後衛（Setter Back）')}</option>
        </select>
        <label className="check" title={t('味方のブロッカー（黄、サイドには 2 人、ミドルには 3 人）とディガー 3 人（緑）のコマを置きます。ドラッグで動かせます')}><input type="checkbox" checked={defense} onChange={e => setDefense(e.target.checked)} /> {t('守備のコマ')}</label>
      </div>
    </>
  )
}
