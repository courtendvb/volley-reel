import { useEffect, useMemo, useState } from 'react'
import type { PlayRef } from '../../../shared/filter'
import type { ClipMode } from '../../../shared/reel'
import type { WonBy } from '../../../shared/rotationSplit'
import { findInsights, insightKindName, type Insight, type InsightReelOptions } from '../../../shared/insights'
import { t } from '../../../shared/i18n'

// What the dialog makes: the habits picked, in the order shown, and how their scenes are cut.
export interface InsightChoice extends InsightReelOptions { team: 'our' | 'opp'; insights: Insight[]; name: string }

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

interface Kept { team: 'our' | 'opp'; limit: number | null; withOthers: boolean; mode: ClipMode }
function readKept(): Kept {
  const d: Kept = { team: 'opp', limit: 10, withOthers: false, mode: 'keyplay' }
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Kept> | null
    if (!o) return d
    return {
      team: o.team === 'our' ? 'our' : 'opp',
      limit: LIMITS.some(([n]) => n === o.limit) ? o.limit ?? null : d.limit,
      withOthers: o.withOthers === true,
      mode: o.mode === 'toEnd' ? 'toEnd' : 'keyplay',
    }
  } catch { return d }
}

// How sure a habit is, as a word and a bar: by its z-score.
const sureness = (z: number): { word: string; level: number } => {
  const a = Math.abs(z)
  return a >= 4 ? { word: t('はっきり'), level: 3 } : a >= 3 ? { word: t('強い傾向'), level: 2 } : { word: t('傾向'), level: 1 }
}

// Habits of a team found by themselves over the matches searched (shared/insights.ts): each a line
// with its numbers, picked or not, made into a video with a scene each.
export function InsightDialog({ scope, targetCode, wonBy, onMake, onClose }: Props) {
  const [start] = useState(readKept)
  const [team, setTeam] = useState<'our' | 'opp'>(start.team)
  const [limit, setLimit] = useState<number | null>(start.limit)
  const [withOthers, setWithOthers] = useState(start.withOthers)
  const [mode, setMode] = useState<ClipMode>(start.mode)
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ team, limit, withOthers, mode })) } catch { /* not kept */ } }, [team, limit, withOthers, mode])

  const insights = useMemo(() => findInsights(scope, team, wonBy), [scope, team, wonBy])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => { setPicked(new Set(insights.slice(0, FIRST_PICKED).map(i => i.key))) }, [insights])
  const chosen = insights.filter(i => picked.has(i.key))

  // The team as the video's name calls it: our code, or the opponents' most common code.
  const who = useMemo(() => {
    if (team === 'our') return targetCode || t('対象チーム')
    const n = new Map<string, number>()
    for (const r of scope) if (r.teamRole === 'opp' && r.teamCode !== '—') n.set(r.teamCode, (n.get(r.teamCode) ?? 0) + 1)
    const codes = [...n].sort((a, b) => b[1] - a[1])
    return codes.length === 1 ? codes[0][0] : t('相手')
  }, [team, targetCode, scope])
  const name = t('{0} インサイト', who)
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
        <section>
          {seg(t('チーム'), team, setTeam, [['opp', t('相手')], ['our', targetCode || t('対象チーム')]])}
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
          {insights.length ? insights.map(i => {
            const s = sureness(i.z)
            return (
              <label key={i.key} role="listitem" className={`insight-row${picked.has(i.key) ? ' on' : ''}`}>
                <input type="checkbox" checked={picked.has(i.key)} onChange={() => toggle(i.key)} />
                <span className="insight-kind">{insightKindName(i.kind)}</span>
                <span className="insight-text">
                  <b>{i.headline}</b>
                  <span className="muted">{i.detail}</span>
                </span>
                <span className={`insight-sure l${s.level}`} title={t('偏りの確かさ（z = {0}）', Math.abs(i.z).toFixed(1))}><i /><i /><i />{s.word}</span>
              </label>
            )
          }) : <span className="muted">{t('はっきりした傾向は見つかりませんでした。試合を増やすと見つかりやすくなります。')}</span>}
        </div>
        <p className="hint">{chosen.length ? t('{0} シーン・{1} 本で、新しい動画「{2}」を作ります。', chosen.length, clips, name) : t('作る傾向を 1 つ以上チェックしてください。')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!chosen.length} onClick={() => onMake({ team, insights: chosen, name, mode, limit, withOthers, prefix: who })}>{t('作る')}</button>
        </div>
      </div>
    </div>
  )
}
