import { useEffect, useMemo, useRef, useState } from 'react'
import { MOST_PER_SLIDE, attackCodes, boardColumn, boardPlayers, type BoardConfig, type BoardPlayer, type BoardSkill } from '../../../shared/board'
import { DEFAULT_CHART, LINE_OPACITY, type ChartDisplay } from '../../../shared/chart'
import { MARKERS, type Marker, type Reel } from '../../../shared/reel'
import type { ParsedDVW, Play } from '../../../shared/types'
import { t } from '../../../shared/i18n'

// What a chart shows: points, lines and a heatmap, any of them together, and how strong the lines are.
export function ChartShow({ value, onChange }: { value: ChartDisplay; onChange: (patch: ChartDisplay) => void }) {
  return (
    <>
      <span className="field-label">{t('チャート')}</span>
      <label className="check"><input type="checkbox" checked={value.points !== false} onChange={e => onChange({ points: e.target.checked })} /> {t('点')}</label>
      <label className="check"><input type="checkbox" checked={!!value.lines} onChange={e => onChange({ lines: e.target.checked })} /> {t('線')}</label>
      <label className="check"><input type="checkbox" checked={!!value.heat} onChange={e => onChange({ heat: e.target.checked })} /> {t('ヒートマップ')}</label>
      {value.lines && <label className="check">{t('線の濃さ')} <input type="range" min={0.1} max={1} step={0.05} value={value.lineOpacity ?? LINE_OPACITY} aria-label={t('線の濃さ')} onChange={e => onChange({ lineOpacity: +e.target.value })} /></label>}
    </>
  )
}

export interface BoardChoice { display: ChartDisplay; skill: BoardSkill; columns: BoardPlayer[]; split: boolean; notes: boolean; photos: boolean; background: string; marker: Marker; team: string; searched: boolean }

interface Slot { key: string; code: string } // '': no one, or all their attacks

// Sets out a comparison card: how many players, then who goes in each place, from left to right.
export function BoardDialog({ dvws, results, ourTeam, scene, initial, onCreate, onImport, onClose }: {
  dvws: ParsedDVW[]
  results: Play[] // the search
  ourTeam: string
  scene: Reel | null // the open scene, whose marker it goes in
  initial?: BoardConfig // changing a card already made
  onCreate: (c: BoardChoice) => void
  onImport: (marker: Marker) => void // a PDF or pictures as cards instead
  onClose: () => void
}) {
  const [skill, setSkill] = useState<BoardSkill>(initial?.skill ?? 'S')
  const [searched, setSearched] = useState(initial?.searched ?? false)
  const keep = useMemo(() => { const s = new Set(results); return searched ? (p: Play) => s.has(p) : undefined }, [results, searched])
  const everyone = useMemo(() => boardPlayers(dvws, skill, keep), [dvws, skill, keep])
  const teams = useMemo(() => [...new Map(everyone.map(p => [p.team, p.teamName])).entries()].sort(), [everyone])
  const [team, setTeam] = useState(initial?.team ?? '')
  const open = teams.some(([c]) => c === team) ? team : teams.find(([c]) => c === ourTeam.toUpperCase())?.[0] ?? teams[0]?.[0] ?? ''
  const inTeam = useMemo(() => everyone.filter(p => p.team === open), [everyone, open])
  const names = useMemo(() => Object.assign({}, ...dvws.map(d => d.codeNames)) as Record<string, string>, [dvws])
  const [count, setCount] = useState(initial?.columns.length ?? 3)
  const [slots, setSlots] = useState<Slot[]>(() => (initial?.columns ?? []).map(c => ({ key: c.key, code: c.code ?? '' })))
  const [split, setSplit] = useState(initial?.split ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? false)
  const [photos, setPhotos] = useState(initial?.photos ?? true)
  const [background, setBackground] = useState(initial?.background ?? '#FFFFFF')
  const [marker, setMarker] = useState<Marker>(scene?.groupOrder[0] ?? MARKERS[0])
  const [display, setDisplay] = useState<ChartDisplay>(() => initial?.display ?? { points: true, lines: DEFAULT_CHART.lines, heat: false, lineOpacity: LINE_OPACITY })
  // A place keeps its player as the count changes; a new place takes whoever has the most plays and has
  // no place yet. A change of team or skill starts again.
  const fill = (list: Slot[], n: number) => {
    const free = inTeam.filter(p => !list.some(s => s.key === p.key))
    return Array.from({ length: n }, (_, i) => list[i] ?? { key: free.shift()?.key ?? '', code: '' })
  }
  const keepFirst = useRef(!!initial)
  useEffect(() => {
    if (keepFirst.current) { keepFirst.current = false; return }
    setSlots(fill([], count))
  }, [open, skill, searched]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = fill(slots, count)
  const setSlot = (i: number, s: Slot) => setSlots(shown.map((x, k) => (k === i ? s : x)))
  const columns = shown.flatMap(s => {
    const p = inTeam.find(x => x.key === s.key), c = p ? boardColumn(p, s.code || null, names) : null
    return c ? [c] : []
  })
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal board-dialog" role="dialog" aria-label={t('データスライド')} onClick={e => e.stopPropagation()}>
        <h2>{t('データスライド')}</h2>
        <div className="filter-row">
          <span className="field-label">{t('プレー')}</span>
          <div className="segmented" role="radiogroup">
            {([['S', t('サーブ')], ['A', t('アタック')]] as [BoardSkill, string][]).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={skill === k} className={skill === k ? 'on' : ''} onClick={() => setSkill(k)}>{label}</button>
            ))}
          </div>
          <label className="check" title={t('左の絞り込みの結果だけで作ります')}><input type="checkbox" checked={searched} onChange={e => setSearched(e.target.checked)} /> {t('絞り込みの結果だけ')}</label>
        </div>
        <div className="filter-row">
          <label className="field-label" htmlFor="board-team">{t('チーム')}</label>
          <select id="board-team" value={open} onChange={e => setTeam(e.target.value)}>
            {teams.map(([code, name]) => <option key={code} value={code}>{`${code} — ${name}`}</option>)}
          </select>
          <label className="field-label" htmlFor="board-count">{t('人数')}</label>
          <select id="board-count" value={count} onChange={e => { setSlots(shown); setCount(+e.target.value) }}>
            {Array.from({ length: MOST_PER_SLIDE }, (_, i) => i + 1).map(n => <option key={n} value={n}>{t('{0} 人', n)}</option>)}
          </select>
        </div>
        <div className="board-slots" title={t('場所ごとに選手を選びます。左から順にカードに並びます')}>
          {shown.map((s, i) => {
            const p = inTeam.find(x => x.key === s.key)
            const codes = skill === 'A' && p ? attackCodes([p]) : []
            return (
              <div key={i} className="board-slot">
                <span className="board-slot-no">{t('{0} 番目', i + 1)}</span>
                <select value={s.key} aria-label={t('{0} 番目', i + 1)} onChange={e => setSlot(i, { key: e.target.value, code: '' })}>
                  <option value="">{t('（なし）')}</option>
                  {inTeam.map(x => <option key={x.key} value={x.key}>{`#${x.player.jersey} ${x.player.lastName}`}</option>)}
                </select>
                {skill === 'A' && (
                  <select value={s.code} aria-label={t('アタックコード')} disabled={!p} onChange={e => setSlot(i, { ...s, code: e.target.value })}>
                    <option value="">{t('全アタック')}</option>
                    {codes.map(c => <option key={c.code} value={c.code}>{`${c.code} (${c.count})${names[c.code] ? ` ${names[c.code]}` : ''}`}</option>)}
                  </select>
                )}
                <div className="board-slot-court" aria-hidden />
              </div>
            )
          })}
        </div>
        {!inTeam.length && <p className="muted">{t('このプレーがありません')}</p>}
        <div className="filter-row"><ChartShow value={display} onChange={p => setDisplay({ ...display, ...p })} /></div>
        <div className="filter-row">
          <label className="check" title={t('パックの写真を入れます。外すと写真なしの配置になります')}><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> {t('写真')}</label>
          <label className="check" title={t('スライド下部に選手ごとのメモ欄を入れます')}><input type="checkbox" checked={notes} onChange={e => setNotes(e.target.checked)} /> {t('ノート欄')}</label>
          {skill === 'S' && count < 4 && <label className="check" title={t('2 番目に多いサーブの種類を小さいチャートに分けます')}><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> {t('サーブの種類で分ける')}</label>}
          <label className="check" title={t('スライドの背景色')}>{t('背景')} <input type="color" aria-label={t('スライドの背景色')} value={background} onChange={e => setBackground(e.target.value.toUpperCase())} /></label>
        </div>
        {!initial && <div className="filter-row">
          <label className="field-label" htmlFor="board-marker">{t('入れる先')}</label>
          {scene ? (
            <select id="board-marker" value={marker} title={t('マーカーの先頭に、タイトルカードのように入ります')} onChange={e => setMarker(+e.target.value as Marker)}>
              {scene.groupOrder.map(m => <option key={m} value={m}>{scene.markerNames[m] || t('マーカー {0}', m)}</option>)}
            </select>
          ) : <span className="muted">{t('新しいシーンの先頭のマーカーに入ります')}</span>}
          <button className="link" title={t('PowerPoint から書き出した PDF や画像を、1 枚ずつカードとしてこのマーカーの先頭に入れます')} onClick={() => onImport(marker)}>{t('PDF・画像を読み込む…')}</button>
        </div>}
        <p className="hint">{t('写真はパックから入れます。文字と写真はあとで動かせて、矢印や図形も足せます。チャートの位置は変えられません。')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!columns.length} onClick={() => onCreate({ display, skill, columns, split, notes, photos, background, marker, team: open, searched })}>{initial ? t('更新') : t('作成')}</button>
        </div>
      </div>
    </div>
  )
}
