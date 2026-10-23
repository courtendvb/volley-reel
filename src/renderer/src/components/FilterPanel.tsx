import { EFFECTS, SKILLS } from '../../../shared/labels'
import { EMPTY_FILTER, type Person, type PlayFilter } from '../../../shared/filter'
import type { ClipMode } from '../../../shared/reel'

export type Scope = 'match' | 'all' // picked with the match select above the filters

interface Props {
  filter: PlayFilter
  onChange: (f: PlayFilter) => void
  people: Person[]
  extract: ClipMode // how plays added from here are cut
  onExtract: (m: ClipMode) => void
  shown: number
  total: number
  teamFilterLimited: boolean // some plays in scope have no known team (all-home input)
  onAddAll: () => void
}

const EFFECT_KEYS = ['#', '+', '!', '-', '/', '=']

export function FilterPanel({ filter: f, onChange, people, extract, onExtract, shown, total, teamFilterLimited, onAddAll }: Props) {
  const set = (patch: Partial<PlayFilter>) => onChange({ ...f, ...patch })
  const effectHint = f.skills.length === 1 ? EFFECTS[f.skills[0]] : null

  return (
    <div className="filters">
      <div className="filter-row">
        <label className="field-label">チーム</label>
        <Segmented value={f.team} onChange={team => set({ team })} options={[['all', 'すべて'], ['home', 'home'], ['away', 'away']]} />
      </div>
      <div className="filter-row" title="シーンに入れるときの長さ。秒数はシーンの設定（キープレーの前後、ラリーの最後のプレーの後）">
        <label className="field-label">切り出し</label>
        <Segmented value={extract} onChange={onExtract} options={[['keyplay', 'プレー前後'], ['toEnd', 'ラリー終わりまで']]} />
      </div>
      {teamFilterLimited && f.team !== 'all' && (
        <p className="hint">全部ホーム入力の試合はチームを区別できないため、全プレーを含めています</p>
      )}

      <div className="filter-row">
        <label className="field-label" htmlFor="f-person">選手</label>
        <select id="f-person" value={f.person ?? ''} onChange={e => set({ person: e.target.value || null })}>
          <option value="">すべての選手</option>
          {people.map(p => (
            <option key={p.key} value={p.key}>
              {`#${p.jerseys.join('/')} ${p.name}${p.teamCodes.length ? ` (${p.teamCodes.join('/')})` : ''} — ${p.plays}`}
            </option>
          ))}
        </select>
      </div>

      <Chips label="スキル" values={Object.keys(SKILLS)} selected={f.skills} onChange={skills => set({ skills })} render={k => SKILLS[k]} />
      <Chips label="評価" values={EFFECT_KEYS} selected={f.effects} onChange={effects => set({ effects })}
        render={k => effectHint ? `${k} ${effectHint[k]}` : k} />
      <div className="filter-row two">
        <Chips label="セット" values={[1, 2, 3, 4, 5]} selected={f.sets} onChange={sets => set({ sets })} />
        <Chips label="ローテ" values={[1, 2, 3, 4, 5, 6]} selected={f.rots} onChange={rots => set({ rots })} />
      </div>
      <div className="filter-row">
        <label className="field-label">ゾーン</label>
        <ZoneSelect label="開始" value={f.startZone} onChange={startZone => set({ startZone })} />
        <ZoneSelect label="終了" value={f.endZone} onChange={endZone => set({ endZone })} />
        <span className="spacer" />
        <button className="link" onClick={() => onChange(EMPTY_FILTER)} disabled={f === EMPTY_FILTER}>条件をクリア</button>
      </div>
      <div className="filter-row">
        <p className="count"><b>{shown.toLocaleString()}</b> / {total.toLocaleString()} プレー</p>
        <span className="spacer" />
        <button onClick={onAddAll} disabled={!shown || shown === total}
          title={shown === total ? '条件で絞り込んでから追加してください' : undefined}>結果をシーンに追加</button>
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

function Chips<T extends string | number>({ label, values, selected, onChange, render }: {
  label: string; values: T[]; selected: T[]; onChange: (v: T[]) => void; render?: (v: T) => string
}) {
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  return (
    <div className="filter-row">
      <span className="field-label">{label}</span>
      <div className="chips">
        {values.map(v => (
          <button key={String(v)} className={`chip${selected.includes(v) ? ' on' : ''}`} aria-pressed={selected.includes(v)} onClick={() => toggle(v)}>
            {render ? render(v) : String(v)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ZoneSelect({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select aria-label={`${label}ゾーン`} value={value ?? ''} onChange={e => onChange(e.target.value ? +e.target.value : null)}>
      <option value="">{label} —</option>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(z => <option key={z} value={z}>{label} {z}</option>)}
    </select>
  )
}
