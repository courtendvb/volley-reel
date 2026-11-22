import { useMemo, useState } from 'react'
import { EFFECTS, SKILLS, TYPES, cellOf, codeParts, codeWithClickZones, partsCode, pointOf, validCode, type CodeParts } from '../../../shared/codeEdit'
import { CourtPicker, type Clicks } from './CourtPicker'
import { effectName, skillName } from '../../../shared/labels'
import type { Play, Player } from '../../../shared/types'
import { t } from '../../../shared/i18n'

interface Props {
  play: Pick<Play, 'code' | 'original' | 'inserted' | 'skill' | 'setNum' | 'score' | 'time' | 'cells'>
  clicksEdited?: boolean // the clicks were corrected (they can go back to the file's)
  players: Player[] // the play's team, by jersey
  matchName: string
  // 'insert': a new play put in after this one; its time starts at the playhead (DVW seconds).
  mode: 'edit' | 'insert'
  insertTime?: number
  // An added play's time against the video: the playhead now (DVW seconds), one frame's length, and moving the video.
  playhead?: () => number
  frameSec?: number
  onSeek?: (dvwSec: number) => void
  // The file's code takes the correction off. start / end: the clicks as cells ('' none), only when they changed;
  // null: back to the file's.
  onSave: (code: string, extra: { time?: number; start?: string | null; end?: string | null }) => void
  onDelete?: () => void // takes the play out (a play put in by hand: takes it off)
  onInsertAfter?: () => void
  onList: () => void // the match's corrections and writing out the scout file
  onClose: () => void
}

const ZONES = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9']
const SUBS = ['', 'A', 'B', 'C', 'D']

// One play's code corrected, or a play put in (codeEdit.ts): the parts people change most (player, skill, hit
// type, evaluation, combination, zones), or the code as text. Saved beside the match; the scout file stays as it is.
export function CodeEditDialog({ play, players, matchName, mode, insertTime, playhead, frameSec = 1 / 30, onSeek, clicksEdited, onSave, onDelete, onInsertAfter, onList, onClose }: Props) {
  const fileCode = play.original ?? play.code
  const [code, setCode] = useState(play.code)
  const [time, setTime] = useState(String(Math.round((insertTime ?? play.time) * 10) / 10))
  const parts = useMemo(() => codeParts(code), [code])
  const firstClicks: Clicks = useMemo(() => ({ start: pointOf(play.cells?.start), end: pointOf(play.cells?.end) }), [play.cells])
  const [clicks, setClicks] = useState<Clicks>(firstClicks)
  const cell = (p: Clicks['start']) => (p ? cellOf(p) : '')
  const clicksChanged = cell(clicks.start) !== (play.cells?.start ?? '') || cell(clicks.end) !== (play.cells?.end ?? '')
  const set = (patch: Partial<CodeParts>) => setCode(partsCode({ ...parts, ...patch }))
  const ok = validCode(code) && (mode === 'edit' || Number.isFinite(parseFloat(time)))
  const changed = mode === 'insert' || code !== play.code || clicksChanged
  // A serve's or attack's zones as its points put them, when the code says otherwise.
  const zoned = codeWithClickZones(code, cell(clicks.start) || undefined, cell(clicks.end) || undefined)
  const zoneText = (c: string) => { const z = codeParts(c); return `${z.startZone || '—'} → ${z.endZone || '—'}${z.endSub}` }
  const extra = () => ({ ...(mode === 'insert' ? { time: parseFloat(time) } : {}), ...(clicksChanged || (mode === 'insert' && (clicks.start || clicks.end)) ? { start: cell(clicks.start), end: cell(clicks.end) } : {}) })
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
      <div className="modal code-edit" role="dialog" aria-label={mode === 'insert' ? t('プレーを足す') : t('コードを直す')} onClick={e => e.stopPropagation()}>
        <h2>{mode === 'insert' ? t('プレーを足す') : t('コードを直す')}</h2>
        <p className="muted small">{matchName} · S{play.setNum} {play.score.home}-{play.score.away}{mode === 'insert' ? ` · ${t('このプレーの後に入れます')}` : ''}</p>
        <div className="code-fields">
          {pick(t('チーム'), parts.side, ['*', 'a'], v => set({ side: v as '*' | 'a' }), v => (v === '*' ? t('ホーム（*）') : t('アウェイ（a）')))}
          {pick(t('選手'), String(parts.jersey), players.filter(p => p.side === parts.side).map(p => String(p.jersey)), v => set({ jersey: +v }),
            v => { const p = players.find(x => x.side === parts.side && String(x.jersey) === v); return p ? `#${p.jersey} ${p.lastName}` : `#${v}` })}
          {pick(t('スキル'), parts.skill, [...SKILLS], v => set({ skill: v }), v => `${v} ${skillName(v)}`)}
          {pick(t('打ち方'), parts.type, ['', ...TYPES], v => set({ type: v }))}
          {pick(t('評価'), parts.effect, [...EFFECTS], v => set({ effect: v }), v => `${v} ${effectName(parts.skill, v)}`)}
          <label className="code-field"><span className="field-label">{t('コンビ')}</span>
            <input value={parts.combo} maxLength={2} onChange={e => set({ combo: e.target.value.toUpperCase().slice(0, 2) })} placeholder="X5" /></label>
          {pick(t('開始ゾーン'), parts.startZone, ZONES, v => set({ startZone: v }))}
          {pick(t('終了ゾーン'), parts.endZone, ZONES, v => set({ endZone: v }))}
          {pick(t('サブゾーン'), parts.endSub, SUBS, v => set({ endSub: v }))}
          {mode === 'insert' && (
            <div className="code-field code-time"><span className="field-label">{t('時刻（秒）')}</span>
              <input type="number" step={0.1} value={time} onChange={e => { setTime(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onSeek?.(v) }}
                title={t('スカウトファイルの時刻（動画の時刻から、この試合の時刻合わせのずれを引いたもの）')} />
              {playhead && <button className="small" onClick={() => setTime(String(Math.round(playhead() * 100) / 100))} title={t('動画の今の再生位置を、このプレーの時刻にします')}>{t('今の位置')}</button>}
              {([-1, 1] as const).map(d => (
                <button key={d} className="small" title={d < 0 ? t('1 コマ前') : t('1 コマ後')} onClick={() => {
                  const v = Math.round(((parseFloat(time) || 0) + d * frameSec) * 1000) / 1000
                  setTime(String(v)); onSeek?.(v)
                }}>{d < 0 ? '−1f' : '+1f'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="code-court">
          <CourtPicker value={clicks} onChange={setClicks} />
          <div className="code-court-side">
            <p className="hint">{t('コートの上で、プレーの始まりから終わりへドラッグすると座標を直せます。点をドラッグして動かすこともできます（緑が始まり、赤が終わり）')}</p>
            {zoned && (
              <p className="hint warning">{t('点の位置のゾーン（{0}）とコードのゾーン（{1}）が違います', zoneText(zoned), zoneText(code))}
                {' '}<button className="link" onClick={() => setCode(zoned)}>{t('ゾーンも合わせる')}</button></p>
            )}
            {(play.skill === 'R' || play.skill === 'D') && <p className="hint">{t('レセプション・ディグの線は、相手のサーブ・アタックの座標から描きます')}</p>}
            <button className="small" onClick={() => setClicks({ start: null, end: null })}>{t('座標を消す')}</button>
            {clicksChanged && <button className="small" onClick={() => setClicks(firstClicks)}>{t('座標を戻す')}</button>}
            {mode === 'edit' && clicksEdited && !clicksChanged && <button className="small" onClick={() => onSave(code, { start: null, end: null })}>{t('ファイルの座標に戻す')}</button>}
          </div>
        </div>
        <label className="code-raw"><span className="field-label">{t('コード')}</span>
          <input value={code} onChange={e => setCode(e.target.value.trim())} spellCheck={false} aria-invalid={!validCode(code)} /></label>
        {!validCode(code) && <p className="hint warning">{t('コードの形が正しくありません。チーム（* か a）、背番号 2 桁、スキル、打ち方、評価の順です')}</p>}
        {mode === 'edit' && !play.inserted && <p className="hint">{t('元のコード: {0}', fileCode)}{play.original ? ` · ${t('今は直したコードを使っています')}` : ''}</p>}
        {mode === 'edit' && play.inserted && <p className="hint">{t('手で足したプレーです')}</p>}
        <p className="hint">{t('直したコードは倉庫に保存し、スカウトファイルは書き換えません。絞り込み・レポート・スライド・コートの表示のすべてに使います')}
          {' '}<button className="link" onClick={onList}>{t('この試合の修正と書き出し…')}</button></p>
        <div className="modal-actions">
          {mode === 'edit' && onDelete && <button className="danger" onClick={onDelete}>{play.inserted ? t('足したプレーを消す') : t('このプレーを削除')}</button>}
          {mode === 'edit' && onInsertAfter && <button onClick={onInsertAfter}>{t('この後にプレーを足す…')}</button>}
          {mode === 'edit' && play.original && <button onClick={() => onSave(fileCode, {})}>{t('元のコードに戻す')}</button>}
          <span className="spacer" />
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!ok || !changed} onClick={() => onSave(code, extra())}>{mode === 'insert' ? t('足す') : t('保存')}</button>
        </div>
      </div>
    </div>
  )
}
