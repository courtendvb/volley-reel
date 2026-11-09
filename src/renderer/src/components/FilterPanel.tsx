import { useEffect, useState } from 'react'
import { EFFECTS, HITS, SKILLS, TEMPOS } from '../../../shared/labels'
import { EMPTY_FILTER, sameFilter, type Person, type PlayFilter, type SavedFilter, type detailOptions } from '../../../shared/filter'
import type { ClipMode, RangeDefaults } from '../../../shared/reel'
import { CheckPicker } from './CheckPicker'
import { ZoneCourts } from './ZoneCourts'
import { SecInput } from './ReelPanel'
import { t } from '../../../shared/i18n'

interface Props {
  filter: PlayFilter
  onChange: (f: PlayFilter) => void
  people: Person[]
  details: ReturnType<typeof detailOptions> // what the detailed search can offer for the plays in scope
  extract: ClipMode // how plays added from here are cut
  onExtract: (m: ClipMode) => void
  range: RangeDefaults // the open scene's seconds (the defaults when there is no scene yet)
  onRange: ((d: RangeDefaults) => void) | null // null: no scene to keep them in
  shown: number
  total: number
  targetCode: string // the project's target team, shown on the team button
  teamFilterLimited: boolean // some plays in scope have no known team (all-home input)
  dirUnknown: number // plays in scope whose way on screen isn't known (no fitted court); sets aren't counted
  onAddAll: () => void
  onPreset: () => void // make a video from a preset (PresetDialog)
  saved: SavedFilter[] // the project's saved conditions
  onSaved: (list: SavedFilter[]) => void
}

const EFFECT_KEYS = ['#', '+', '!', '-', '/', '=']
const NEAR_SKILLS: Record<string, string> = { ...SKILLS, F: 'Freeball' }

export function FilterPanel({ filter: f, onChange, people, details, targetCode, extract, onExtract, range: d, onRange, shown, total, teamFilterLimited, dirUnknown, onAddAll, onPreset, saved, onSaved }: Props) {
  const set = (patch: Partial<PlayFilter>) => onChange({ ...f, ...patch })
  const effectHint = f.skills.length === 1 ? EFFECTS[f.skills[0]] : null
  const detailCount = f.tempos.length + f.combos.length + f.hits.length + f.startZones.length + f.endZones.length
  const [detailOpen, setDetailOpen] = useState(detailCount > 0)
  useEffect(() => { if (detailCount > 0) setDetailOpen(true) }, [detailCount > 0]) // show detailed conditions that are in use
  // Set, rotations, phase and the plays around: folded like the detailed search, opened when one is in use.
  const situCount = f.sets.length + f.rots.length + (f.oppRots?.length ?? 0) + (f.frontPlayers?.length ?? 0) + (f.phase !== 'all' ? 1 : 0) + (f.recEffects?.length ?? 0)
    + f.prevSkills.length + f.prevEffects.length + (f.prevTeam !== 'any' ? 1 : 0) + (f.prevSkipSet ? 1 : 0)
    + f.nextSkills.length + f.nextEffects.length + (f.nextTeam !== 'any' ? 1 : 0) + (f.nextSkipSet ? 1 : 0)
  const [situOpen, setSituOpen] = useState(situCount > 0)
  useEffect(() => { if (situCount > 0) setSituOpen(true) }, [situCount > 0])
  // The target team's players, or the opponents' once the team says so; unknown teams (all-home
  // files) stay, and so does anyone already picked.
  const wanted = f.team === 'opp' ? 'opp' : 'our'
  const inTeam = people.filter(p => p.teamRole === wanted || p.teamRole === null || f.persons?.includes(p.key))
  const playerChoices = inTeam.length ? inTeam : people
  const personOption = (p: Person) => ({ key: p.key, label: `#${p.jerseys.join('/')} ${p.name}${p.teamCodes.length ? ` (${p.teamCodes.join('/')})` : ''} — ${p.plays}` })
  const comboName = (code: string) => details.combos.find(c => c.code === code)?.name

  return (
    <div className="filters">
      <SavedRow filter={f} onChange={onChange} saved={saved} onSaved={onSaved} />
      <div className="filter-row">
        <label className="field-label">{t('チーム')}</label>
        <Segmented value={f.team} onChange={team => set({ team, persons: [] })} options={[['all', t('すべて')], ['our', targetCode || t('対象チーム')], ['opp', t('相手')]]} />
      </div>
      <div className="filter-row" title={t('シーンに入れるときの長さ。秒数は今開いているシーンの設定で、そのシーンのクリップすべてに効きます')}>
        <label className="field-label">{t('切り出し')}</label>
        <Segmented value={extract} onChange={onExtract} options={[['keyplay', t('プレー前後')], ['toEnd', t('ラリー終わりまで')]]} />
      </div>
      <div className="filter-row extract-sec">
        <span className="field-label" />
        <span>{t('キープレー −')}<SecInput v={d.keyBefore} label={t('キープレーの何秒前から')} disabled={!onRange} onChange={n => onRange?.({ ...d, keyBefore: n })} />{t('秒')}</span>
        {extract === 'keyplay'
          ? <span>{t('〜 +')}<SecInput v={d.keyAfter} label={t('キープレーの何秒後まで')} disabled={!onRange} onChange={n => onRange?.({ ...d, keyAfter: n })} />{t('秒')}</span>
          : <span>{t('〜 ラリー終わり +')}<SecInput v={d.rallyTail} label={t('最後のプレーの何秒後まで')} disabled={!onRange} onChange={n => onRange?.({ ...d, rallyTail: n })} />{t('秒')}</span>}
      </div>
      <div className="filter-row" title={t('ボールが画面の上へ向かうか下へ向かうか。サーブ・アタックは打った側から、レセプション・ディグ・ブロックは相手側から。セットは向きで絞ると出ません。コートのグリッドを合わせた試合だけ分かります')}>
        <label className="field-label">{t('プレーの向き')}</label>
        <Segmented value={f.dir ?? 'all'} onChange={dir => set({ dir })} options={[['all', t('すべて')], ['up', t('↑ 下から上')], ['down', t('↓ 上から下')]]} />
      </div>
      {dirUnknown > 0 && f.dir !== 'all' && (
        <p className="hint">{t('コートのグリッドを合わせていない試合のプレー {0} 件は、向きが分からないため除いています', dirUnknown)}</p>
      )}
      {teamFilterLimited && f.team !== 'all' && (
        <p className="hint">{t('全部ホーム入力の試合や対象チームが出ていない試合はチームを区別できないため、全プレーを含めています')}</p>
      )}

      <div className="filter-row" title={t('チームを「相手」にすると相手の選手を選べます。何も選ばなければ全員です')}>
        <span className="field-label">{t('選手')}</span>
        <CheckPicker label={t('選手')} all={t('すべての選手')} selected={f.persons ?? []} onChange={persons => set({ persons })}
          options={playerChoices.map(personOption)} />
      </div>

      <Chips label={t('スキル')} values={Object.keys(SKILLS)} selected={f.skills} onChange={skills => set({ skills })} render={k => SKILLS[k]} />
      <Chips label={t('評価')} values={EFFECT_KEYS} selected={f.effects} onChange={effects => set({ effects })}
        render={k => effectHint ? `${k} ${effectHint[k]}` : k} />
      <div className="filter-row">
        <button className="link" aria-expanded={situOpen} onClick={() => setSituOpen(o => !o)}>
          {situOpen ? '▾' : '▸'} {t('試合の状況（セット・ローテ・前衛・局面・直前直後）')}{situCount ? t('（{0}）', situCount) : ''}</button>
      </div>
      {situOpen && (
        <div className="filter-detail">
        <Chips label={t('セット')} values={[1, 2, 3, 4, 5]} selected={f.sets} onChange={sets => set({ sets })} />
        {/* Rotations by team, whoever made the play: ours, and the opponent's right under it. */}
        <Chips label={t('ローテ')} values={[1, 2, 3, 4, 5, 6]} selected={f.rots} onChange={rots => set({ rots })}
          title={() => t('{0}のローテーション', targetCode || t('対象チーム'))} />
        <Chips label={t('相手ローテ')} values={[1, 2, 3, 4, 5, 6]} selected={f.oppRots ?? []} onChange={oppRots => set({ oppRots })}
          title={() => t('相手チームのローテーション')} />
        <div className="filter-row" title={t('選んだ選手が前衛にいるときのプレーに絞ります（どちらのチームの選手でも選べます）。複数選ぶと全員が前衛のとき。例: チームを相手、スキルをアタックにして、自チームのブロッカーを選ぶと、その選手が前衛のときの相手アタック')}>
          <span className="field-label">{t('前衛')}</span>
          <CheckPicker label={t('前衛にいる選手')} all={t('指定なし')} selected={f.frontPlayers ?? []} onChange={frontPlayers => set({ frontPlayers })} options={people.map(personOption)} />
        </div>
        <div className="filter-row" title={t('レセプション: サーブを受けたチームのレセプションから、ボールが相手に返るまで（レセプションアタックとそのトス）。トランジション: それ以外のプレー（ディグ・フリーボール・ブロックフォローからの攻撃など）。サーブはどちらにも入りません')}>
          <label className="field-label">{t('局面')}</label>
          <Segmented value={f.phase} onChange={phase => set({ phase, recEffects: [] })} options={[['all', t('すべて')], ['reception', t('レセプション')], ['transition', t('トランジション')]]} />
        </div>
        {f.phase === 'reception' && (
          <Chips label={t('レセプション評価')} values={EFFECT_KEYS} selected={f.recEffects ?? []} onChange={recEffects => set({ recEffects })}
            render={k => `${k} ${EFFECTS.R[k]}`} title={() => t('そのラリーのレセプションの評価で絞ります。レセプションアタックとそのトスは、もとのレセプションの評価で探します')} />
        )}
        <Near f={f} set={set} which="prev" label={t('直前')} title={t('同じラリーで一つ前のプレー（フリーボールも数えます）')}
          skipTitle={t('直前が自チームのトスなら、その前のプレーで探します。レセプション#からのアタックなど')} />
        <Near f={f} set={set} which="next" label={t('直後')} title={t('同じラリーで一つ後のプレー（フリーボールも数えます）。ラリー最後のプレーは入りません')}
          skipTitle={t('直後が自チームのトスなら、その次のプレーで探します。レセプションからのアタックの結果など')} />
        </div>
      )}
      <div className="filter-row">
        <button className="link" aria-expanded={detailOpen} onClick={() => setDetailOpen(o => !o)}>
          {detailOpen ? '▾' : '▸'} {t('詳細（テンポ・コンビ・打ち方・ゾーン）')}{detailCount ? t('（{0}）', detailCount) : ''}</button>
      </div>
      {detailOpen && (
        <div className="filter-detail">
          <Chips label={t('テンポ')} values={Object.keys(TEMPOS).filter(t => details.tempos.includes(t))} selected={f.tempos}
            onChange={tempos => set({ tempos })} render={t => `${t} ${TEMPOS[t]}`} />
          {details.hits.length > 0 && (
            <Chips label={t('打ち方')} values={Object.keys(HITS).filter(h => details.hits.includes(h))} selected={f.hits}
              onChange={hits => set({ hits })} render={h => `${h} ${HITS[h]}`} />
          )}
          {details.combos.length > 0 && (
            <Chips label={t('コンビ')} values={[...new Set([...details.combos.map(c => c.code), ...f.combos])]} selected={f.combos}
              onChange={combos => set({ combos })} title={comboName}
              render={c => { const n = comboName(c); return n ? `${c} ${n}` : c }} />
          )}
          <div className="filter-row">
            <span className="field-label">{t('ゾーン')}</span>
            <ZoneCourts start={f.startZones} end={f.endZones} onStart={startZones => set({ startZones })} onEnd={endZones => set({ endZones })} />
          </div>
          <p className="hint">{t('コンビはアタックのコンビネーションとセッターコール（DVW の表の名前つき）。スキルを選ぶと、そのスキルにあるものだけ出ます。')}</p>
        </div>
      )}
      <div className="filter-row actions">
        <p className="count"><b>{shown.toLocaleString()}</b> / {total.toLocaleString()} {t('プレー')}</p>
        <span className="spacer" />
        <button className="link" onClick={() => onChange(EMPTY_FILTER)} disabled={f === EMPTY_FILTER}>{t('条件をクリア')}</button>
        <button onClick={onAddAll} disabled={!shown || shown === total}
          title={shown === total ? t('条件で絞り込んでから追加してください') : undefined}>{t('結果をシーンに追加')}</button>
        <button onClick={onPreset} title={t('サイドアウト・サーブ・ブロック・アタックのビデオを、決まった形のシーンに分けて作ります')}>{t('プリセットから作る')}</button>
      </div>
    </div>
  )
}

// The play just before or just after: its skill, and once that is used, its evaluation and team.
function Near({ f, set, which, label, title, skipTitle }: { f: PlayFilter; set: (p: Partial<PlayFilter>) => void; which: 'prev' | 'next'; label: string; title: string; skipTitle: string }) {
  const put = (s: string, v: unknown) => set({ [`${which}${s}`]: v } as Partial<PlayFilter>)
  const skills = f[`${which}Skills`], effects = f[`${which}Effects`], team = f[`${which}Team`], skipSet = f[`${which}SkipSet`]
  const hint = skills.length === 1 ? EFFECTS[skills[0]] : null
  return (
    <>
      <Chips label={label} values={Object.keys(NEAR_SKILLS)} selected={skills} onChange={v => put('Skills', v)} render={s => NEAR_SKILLS[s]} title={() => title} />
      {(skills.length > 0 || effects.length > 0 || team !== 'any') && (
        <div className="filter-detail">
          <Chips label={t('{0}評価', label)} values={EFFECT_KEYS} selected={effects} onChange={v => put('Effects', v)}
            render={e => hint ? `${e} ${hint[e]}` : e} />
          <div className="filter-row">
            <label className="field-label">{t('{0}チーム', label)}</label>
            <Segmented value={team} onChange={v => put('Team', v)} options={[['any', t('どちらでも')], ['same', t('同じチーム')], ['opp', t('相手')]]} />
          </div>
          <label className="check" title={skipTitle}>
            <input type="checkbox" checked={skipSet} onChange={e => put('SkipSet', e.target.checked)} /> {t('トスは飛ばす')}</label>
        </div>
      )}
    </>
  )
}

// Saved conditions: click one to put it back (it lights while the conditions are the same),
// right-click to remove it. Saving under a name already used replaces those conditions.
function SavedRow({ filter, onChange, saved, onSaved }: { filter: PlayFilter; onChange: (f: PlayFilter) => void; saved: SavedFilter[]; onSaved: (list: SavedFilter[]) => void }) {
  const [naming, setNaming] = useState<string | null>(null)
  const empty = sameFilter(filter, EMPTY_FILTER)
  const save = () => {
    const name = naming?.trim()
    setNaming(null)
    if (!name) return
    const same = saved.find(s => s.name === name)
    onSaved(same ? saved.map(s => (s === same ? { ...s, filter } : s)) : [...saved, { id: crypto.randomUUID(), name, filter }])
  }
  if (!saved.length && naming === null && empty) return null
  return (
    <div className="filter-row">
      <span className="field-label">{t('保存条件')}</span>
      <div className="chips">
        {saved.map(s => (
          <button key={s.id} className={`chip${sameFilter(filter, s.filter) ? ' on' : ''}`} aria-pressed={sameFilter(filter, s.filter)}
            title={t('クリックでこの条件にする（右クリックで外す）')} onClick={() => onChange(s.filter)}
            onContextMenu={e => { e.preventDefault(); onSaved(saved.filter(x => x !== s)) }}>{s.name}</button>
        ))}
        {naming === null
          ? <button className="chip" onClick={() => setNaming('')} disabled={empty} title={empty ? t('条件を選んでから保存してください') : t('今の条件に名前を付けて保存')}>{t('＋ 今の条件を保存')}</button>
          : <input className="saved-filter-name" autoFocus value={naming} placeholder={t('条件の名前')} aria-label={t('条件の名前')}
              onChange={e => setNaming(e.target.value)} onBlur={save}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(null) }} />}
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

function Chips<T extends string | number>({ label, values, selected, onChange, render, title }: {
  label: string; values: T[]; selected: T[]; onChange: (v: T[]) => void; render?: (v: T) => string; title?: (v: T) => string | null | undefined
}) {
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  return (
    <div className="filter-row">
      <span className="field-label">{label}</span>
      <div className="chips">
        {values.map(v => (
          <button key={String(v)} className={`chip${selected.includes(v) ? ' on' : ''}`} aria-pressed={selected.includes(v)} title={title?.(v) ?? undefined} onClick={() => toggle(v)}>
            {render ? render(v) : String(v)}
          </button>
        ))}
      </div>
    </div>
  )
}
