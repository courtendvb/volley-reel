import { Fragment, useEffect, useMemo, useState } from 'react'
import type { PlayRef } from '../../../shared/filter'
import type { ClipMode } from '../../../shared/reel'
import type { WonBy } from '../../../shared/rotationSplit'
import { INSIGHT_SKILLS, findInsights, insightKindName, rankOf, type Insight, type InsightFocus, type InsightReelOptions, type InsightSkill } from '../../../shared/insights'
import { personOf, playerLabel } from '../../../shared/rotationSplit'
import { skillName } from '../../../shared/labels'
import { CheckPicker } from './CheckPicker'
import { t } from '../../../shared/i18n'

// What the dialog makes: the habits picked, in the order shown, and how their scenes are cut.
export interface InsightChoice extends InsightReelOptions { team: 'our' | 'opp'; insights: Insight[]; name: string; focus: InsightFocus }

interface Props {
  scope: PlayRef[] // every play of the matches searched
  targetCode: string
  wonBy: WonBy
  onMake: (c: InsightChoice) => void
  onClose: () => void
}

const STORE_KEY = 'vr.insightDialog'
const LIMITS: [number | null, string][] = [[5, '5'], [10, '10'], [null, '']]
// The ones picked when the list is new: the surest few.
const FIRST_PICKED = 8

// The habits are always the project's team's (its target team): the opponents change from match to match.
const team = 'our'

// The players picked are not kept: they belong to the project open.
interface Kept { limit: number | null; withOthers: boolean; mode: ClipMode; skills: InsightSkill[] }
function readKept(): Kept {
  const d: Kept = { limit: 10, withOthers: false, mode: 'keyplay', skills: [] }
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Kept> | null
    if (!o) return d
    return {
      limit: LIMITS.some(([n]) => n === o.limit) ? o.limit ?? null : d.limit,
      withOthers: o.withOthers === true,
      mode: o.mode === 'toEnd' ? 'toEnd' : 'keyplay',
      skills: Array.isArray(o.skills) ? INSIGHT_SKILLS.filter(k => o.skills!.includes(k)) : [],
    }
  } catch { return d }
}

// How sure a habit is, as a word and a bar: by rankOf (3: one in a thousand by luck, all told).
const sureness = (i: Insight): { word: string; level: number } => {
  if (i.tentative) return { word: t('参考'), level: 0 }
  const a = rankOf(i)
  return a >= 3 ? { word: t('はっきり'), level: 3 } : a >= 2 ? { word: t('強い傾向'), level: 2 } : { word: t('傾向'), level: 1 }
}

// Habits of a team found by themselves over the matches searched (shared/insights.ts): each a line
// with its numbers, picked or not, made into a video with a scene each.
export function InsightDialog({ scope, targetCode, wonBy, onMake, onClose }: Props) {
  const [start] = useState(readKept)
  const [limit, setLimit] = useState<number | null>(start.limit)
  const [withOthers, setWithOthers] = useState(start.withOthers)
  const [mode, setMode] = useState<ClipMode>(start.mode)
  const [skills, setSkills] = useState<InsightSkill[]>(start.skills)
  const [persons, setPersons] = useState<string[]>([])
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ limit, withOthers, mode, skills })) } catch { /* not kept */ } }, [limit, withOthers, mode, skills])

  // The team's players who made a set, serve, reception or attack, by jersey.
  const people = useMemo(() => {
    const seen = new Map<string, PlayRef>()
    for (const r of scope) if (r.teamRole === team && 'ESRA'.includes(r.play.skill) && !seen.has(personOf(r))) seen.set(personOf(r), r)
    return [...seen].sort((a, b) => a[1].play.jersey - b[1].play.jersey).map(([key, r]) => ({ key, label: playerLabel(r) }))
  }, [scope])
  const focus = useMemo<InsightFocus>(() => ({ skills, persons }), [skills, persons])
  const matches = useMemo(() => new Set(scope.map(r => r.matchId)).size, [scope])

  const insights = useMemo(() => findInsights(scope, team, wonBy, 20, focus), [scope, wonBy, focus])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Those for reference are not picked at first.
  useEffect(() => { setPicked(new Set(insights.filter(i => !i.tentative).slice(0, FIRST_PICKED).map(i => i.key))) }, [insights])
  const firstRef = insights.findIndex(i => i.tentative)
  const chosen = insights.filter(i => picked.has(i.key))

  // The team as the video's name calls it.
  const who = targetCode || t('対象チーム')
  // The name says the focus: one player, and the skills when not all.
  const focusName = [persons.length === 1 ? people.find(p => p.key === persons[0])?.label : null, skills.length && skills.length < INSIGHT_SKILLS.length ? skills.map(skillName).join('・') : null].filter(Boolean).join(' ')
  const name = t('{0} インサイト', [who, focusName].filter(Boolean).join(' '))
  const clips = chosen.reduce((s, i) => s + (limit ? Math.min(limit, i.refs.length) + (withOthers ? Math.min(limit, i.others.length) : 0) : i.refs.length + (withOthers ? i.others.length : 0)), 0)
  const toggle = (key: string) => setPicked(p => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n })

  const seg = <T,>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <div className="filter-row">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{l}</button>)}
      </div>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal preset-dialog insight-dialog" role="dialog" aria-label={t('インサイトから作る')} onClick={e => e.stopPropagation()}>
        <h2>{t('インサイトから作る')}</h2>
        <p className="hint">{t('「検索する試合」のプレーから、チーム全体と比べてはっきり偏っている傾向を自動で探し、確かなものから並べます。選んだ傾向ごとに、それを示すプレーを集めたシーンを作ります（タイトルカードに数字が入ります）。')}</p>
        <p className="hint">{t('いま {0} 試合のプレーから探しています（試合は左上の「検索する試合」で選びます。試合が多いほど、確かな傾向が見つかります）。', matches)}{persons.length > 0 && t('選手を選ぶと、その選手についての傾向だけを出します（ローテーションの傾向は出ません）。')}</p>
        <section>
          <div className="filter-row">
            <span className="field-label">{t('スキル')}</span>
            <div className="preset-checks" role="group" aria-label={t('スキル')}>
              {INSIGHT_SKILLS.map(k => (
                <label key={k}>
                  <input type="checkbox" checked={!skills.length || skills.includes(k)}
                    onChange={e => {
                      const now = skills.length ? skills : INSIGHT_SKILLS
                      const next = e.target.checked ? INSIGHT_SKILLS.filter(x => x === k || now.includes(x)) : now.filter(x => x !== k)
                      setSkills(next.length === INSIGHT_SKILLS.length ? [] : next.length ? next : skills)
                    }} />
                  {skillName(k)}
                </label>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="field-label">{t('選手')}</span>
            <CheckPicker label={t('選手')} all={t('すべての選手')} options={people} selected={persons} onChange={setPersons} />
          </div>
          {seg(t('1 シーンの本数'), limit, setLimit, LIMITS.map(([n, l]) => [n, n ? t('{0} 本まで', l) : t('すべて')]))}
          {seg(t('切り出し'), mode, setMode, [['keyplay', t('プレー前後')], ['toEnd', t('ラリー終わりまで')]])}
          <div className="filter-row">
            <span className="field-label" />
            <label className="insight-others" title={t('マーカー 2 に、同じ場面で傾向に当てはまらなかったプレーを入れて見比べられるようにします')}>
              <input type="checkbox" checked={withOthers} onChange={e => setWithOthers(e.target.checked)} /> {t('それ以外のプレーもマーカー 2 に入れる')}
            </label>
          </div>
        </section>
        <div className="preset-preview insight-list" role="list">
          {insights.length ? insights.map((i, n) => {
            const s = sureness(i)
            return (
              <Fragment key={i.key}>
              {n === firstRef && <p className="insight-ref-head muted" role="presentation">{t('参考: それだけを見れば偏っているが、たくさんの組み合わせを調べた中では偶然の範囲かもしれないもの')}</p>}
              <label role="listitem" className={`insight-row${picked.has(i.key) ? ' on' : ''}`}>
                <input type="checkbox" checked={picked.has(i.key)} onChange={() => toggle(i.key)} />
                <span className="insight-kind">{insightKindName(i.kind)}</span>
                <span className="insight-text">
                  <b>{i.headline}</b>
                  <span className="muted">{i.detail}</span>
                </span>
                <span className={`insight-sure l${s.level}`} title={t('偏りの確かさ（z = {0}）', Math.abs(i.z).toFixed(1))}><i /><i /><i />{s.word}</span>
              </label>
              </Fragment>
            )
          }) : <span className="muted">{t('はっきりした傾向は見つかりませんでした。試合を増やすと見つかりやすくなります。')}</span>}
        </div>
        <p className="hint">{chosen.length ? t('{0} シーン・{1} 本で、新しい動画「{2}」を作ります。', chosen.length, clips, name) : t('作る傾向を 1 つ以上チェックしてください。')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!chosen.length} onClick={() => onMake({ team, focus, insights: chosen, name, mode, limit, withOthers, prefix: who })}>{t('作る')}</button>
        </div>
      </div>
    </div>
  )
}
