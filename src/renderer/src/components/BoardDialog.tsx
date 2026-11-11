import { useEffect, useMemo, useRef, useState } from 'react'
import { PaletteColor } from './PaletteColor'
import { MOST_PER_SLIDE, NOTE_FILLS, NOTE_SIZE, attackCodes, boardColumn, boardPlayers, type BoardConfig, type BoardPlayer, type BoardSkill, type SetView } from '../../../shared/board'
import { DEFAULT_CHART, LINE_OPACITY, type ChartDisplay, type ChartLook, type ChartStyle } from '../../../shared/chart'
import { BoardPreview } from './BoardPreview'
import { MARKERS, type Marker, type Reel } from '../../../shared/reel'
import type { ParsedDVW, Play } from '../../../shared/types'
import { t } from '../../../shared/i18n'

// What a chart shows: points, lines and a heatmap, any of them together, and how strong the lines are.
export function ChartShow({ value, skill, onChange }: { value: ChartDisplay & { colors?: ChartLook['colors'] }; skill?: BoardSkill; onChange: (patch: ChartDisplay) => void }) {
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

export interface BoardChoice { setView: SetView; display: ChartDisplay; skill: BoardSkill; columns: BoardPlayer[]; split: boolean; notes: boolean; noteSize: number; noteFills: [string, string]; photos: boolean; background: string; marker: Marker | 'head'; team: string; searched: boolean } // marker 'head': the scene's head, in no marker

interface Slot { key: string; code: string; attention?: boolean } // '': no one, or all their attacks

// Sets out a comparison card: how many players, then who goes in each place, from left to right.
export function BoardDialog({ dvws, results, ourTeam, scene, initial, chartStyle, onCreate, onImport, onClose }: {
  dvws: ParsedDVW[]
  results: Play[] // the search
  ourTeam: string
  scene: Reel | null // the open scene, whose marker it goes in
  initial?: BoardConfig // changing a card already made
  chartStyle?: (skill: BoardSkill) => ChartStyle | undefined // the charts' look from the 表示 tab, for the preview
  onCreate: (c: BoardChoice) => void
  onImport: (marker: Marker | 'head') => void // a PDF or pictures as cards instead
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
  const [slots, setSlots] = useState<Slot[]>(() => (initial?.columns ?? []).map(c => ({ key: c.key, code: c.code ?? '', ...(c.attention ? { attention: true } : {}) })))
  const [split, setSplit] = useState(initial?.split ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? false)
  const [noteSize, setNoteSize] = useState(initial?.noteSize ?? 1)
  const [noteFills, setNoteFills] = useState<[string, string]>(initial?.noteFills ?? NOTE_FILLS)
  const [photos, setPhotos] = useState(initial?.photos ?? true)
  const [background, setBackground] = useState(initial?.background ?? '#FFFFFF')
  const [inMarker, setInMarker] = useState<Marker>(scene?.groupOrder[0] ?? MARKERS[0])
  const [asCard, setAsCard] = useState(false) // a title card at the scene's head, outside the markers
  const marker: Marker | 'head' = asCard ? 'head' : inMarker
  const [setView, setSetView] = useState<SetView>(initial?.setView ?? 'both')
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
    return c ? [s.attention ? { ...c, attention: true } : c] : []
  })
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal board-dialog" role="dialog" aria-label={t('データスライド')} onClick={e => e.stopPropagation()}>
        <h2>{t('データスライド')}</h2>
        <div className="filter-row">
          <span className="field-label">{t('プレー')}</span>
          <div className="segmented" role="radiogroup">
            {([['S', t('サーブ')], ['A', t('アタック')], ['E', t('セット')]] as [BoardSkill, string][]).map(([k, label]) => (
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
                <label className="check board-attention" title={t('この選手に「Attention」の赤いマークを付けます（写真の上、写真がなければ名前の行の右）')}>
                  <input type="checkbox" checked={!!s.attention} disabled={!p} onChange={e => setSlot(i, { ...s, attention: e.target.checked })} /> Attention</label>
              </div>
            )
          })}
        </div>
        {!inTeam.length && <p className="muted">{t('このプレーがありません')}</p>}
        <BoardPreview columns={columns} skill={skill} photos={photos}
          opts={{ setView, split, notes, noteSize, noteFills, background, display, ...(chartStyle?.(skill) ? { style: chartStyle(skill) } : {}) }} />
        {skill === 'E' ? (
          <div className="filter-row" title={t('セッターのトスのあと、同じチームのアタックがどのゾーンから打たれたかの割合')}>
            <span className="field-label">{t('配分')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('配分の見せ方')}>
              {([['zones', t('ゾーンを塗る')], ['arrows', t('矢印')], ['both', t('両方')]] as [SetView, string][]).map(([k, label]) => (
                <button key={k} role="radio" aria-checked={setView === k} className={setView === k ? 'on' : ''} onClick={() => setSetView(k)}>{label}</button>
              ))}
            </div>
          </div>
        ) : <div className="filter-row"><ChartShow value={display} skill={skill} onChange={p => setDisplay({ ...display, ...p })} /></div>}
        <div className="filter-row">
          <label className="check" title={t('パックの写真を入れます。外すと写真なしの配置になります')}><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> {t('写真')}</label>
          <label className="check" title={t('スライド下部に選手ごとのメモ欄を入れます')}><input type="checkbox" checked={notes} onChange={e => setNotes(e.target.checked)} /> {t('ノート欄')}</label>
          {notes && <>
            <label className="check" title={t('ノート欄の高さ。文字の大きさも一緒に変わります')}>{t('高さ')}
              <input type="number" min={NOTE_SIZE.min * 100} max={NOTE_SIZE.max * 100} step={NOTE_SIZE.step * 100} value={Math.round(noteSize * 100)} style={{ width: 60 }} aria-label={t('ノート欄の高さ（%）')}
                onChange={e => { const n = +e.target.value / 100; if (n >= NOTE_SIZE.min && n <= NOTE_SIZE.max) setNoteSize(n) }} />%</label>
            <span className="check" title={t('ノート欄の行の色（交互）')}>{t('色')}
              <PaletteColor value={noteFills[0]} label={t('ノート欄の 1・3 行目の色')} onChange={c => setNoteFills([c, noteFills[1]])} />
              <PaletteColor value={noteFills[1]} label={t('ノート欄の 2・4 行目の色')} onChange={c => setNoteFills([noteFills[0], c])} /></span>
          </>}
          {skill === 'S' && count < 4 && <label className="check" title={t('2 番目に多いサーブの種類を小さいチャートに分けます')}><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> {t('サーブの種類で分ける')}</label>}
          <label className="check" title={t('スライドの背景色')}>{t('背景')} <PaletteColor value={background} label={t('スライドの背景色')} onChange={setBackground} /></label>
        </div>
        {!initial && <div className="filter-row">
          <span className="field-label">{t('入れる先')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('入れる先')}>
            <button role="radio" aria-checked={!asCard} className={!asCard ? 'on' : ''} onClick={() => setAsCard(false)}
              title={t('マーカーの先頭にスライドとして入ります。そのマーカーを流すときだけ出ます')}>{t('マーカーの中')}</button>
            <button role="radio" aria-checked={asCard} className={asCard ? 'on' : ''} onClick={() => setAsCard(true)}
              title={t('どのマーカーにも入れず、シーンの頭（シーンのタイトルカードのあと、マーカーより前）にタイトルカードのように入ります。マーカーのオン・オフにかかわらず流れます')}>{t('タイトルカード（マーカー外）')}</button>
          </div>
          {!asCard && (scene ? (
            <select id="board-marker" value={inMarker} aria-label={t('入れるマーカー')} title={t('マーカーの先頭に、タイトルカードのように入ります')} onChange={e => setInMarker(+e.target.value as Marker)}>
              {scene.groupOrder.map(m => <option key={m} value={m}>{scene.markerNames[m] || t('マーカー {0}', m)}</option>)}
            </select>
          ) : <span className="muted">{t('新しいシーンの先頭のマーカーに入ります')}</span>)}
          <button className="link" title={asCard ? t('PowerPoint から書き出した PDF や画像を、1 枚ずつカードとしてシーンの頭に入れます') : t('PowerPoint から書き出した PDF や画像を、1 枚ずつカードとしてこのマーカーの先頭に入れます')} onClick={() => onImport(marker)}>{t('PDF・画像を読み込む…')}</button>
        </div>}
        <p className="hint">{t('写真はパックから入れます。文字と写真はあとで動かせて、矢印や図形も足せます。チャートの位置は変えられません。')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!columns.length} onClick={() => onCreate({ setView, display, skill, columns, split, notes, noteSize, noteFills, photos, background, marker, team: open, searched })}>{initial ? t('更新') : t('作成')}</button>
        </div>
      </div>
    </div>
  )
}
