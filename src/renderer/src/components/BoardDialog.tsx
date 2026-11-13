import { useEffect, useMemo, useRef, useState } from 'react'
import { PaletteColor } from './PaletteColor'
import { MOST_PER_SLIDE, NOTE_FILLS, NOTE_SIZE, attackCodes, boardColumn, boardPlayers, type BoardConfig, type BoardPlayer, type BoardSkill, type SetLayout, type SetView } from '../../../shared/board'
import { DEFAULT_CHART, LINE_OPACITY, type ChartDisplay, type ChartLook, type ChartStyle } from '../../../shared/chart'
import { BoardPreview } from './BoardPreview'
import { MARKERS, type Marker, type Reel } from '../../../shared/reel'
import { ATTACKER_CARDS, ROTATIONS, ROTATION_TABLES, TEAM_COLOR, discLine as darker, type RotationTables } from '../../../shared/rotationBoard'
import { logoColor } from '../assets'
import type { ParsedDVW, Play } from '../../../shared/types'
import { t } from '../../../shared/i18n'

// What a chart shows: points, lines and a heatmap, any of them together, and how strong the lines are;
// on a serve's, whether the points and heatmap take in where it was served from as well.
export function ChartShow({ value, skill, onChange }: { value: ChartDisplay & { colors?: ChartLook['colors'] }; skill?: BoardSkill; onChange: (patch: ChartDisplay) => void }) {
  return (
    <>
      <span className="field-label">{t('チャート')}</span>
      <label className="check"><input type="checkbox" checked={value.points !== false} onChange={e => onChange({ points: e.target.checked })} /> {t('点')}</label>
      <label className="check"><input type="checkbox" checked={!!value.lines} onChange={e => onChange({ lines: e.target.checked })} /> {t('線')}</label>
      <label className="check"><input type="checkbox" checked={!!value.heat} onChange={e => onChange({ heat: e.target.checked })} /> {t('ヒートマップ')}</label>
      {skill === 'S' && <label className="check" title={t('サーブを打った位置も、点（四角）とヒートマップで出します')}><input type="checkbox" checked={!!value.starts} disabled={value.points === false && !value.heat} onChange={e => onChange({ starts: e.target.checked })} /> {t('始点')}</label>}
      {value.lines && <label className="check">{t('線の濃さ')} <input type="range" min={0.1} max={1} step={0.05} value={value.lineOpacity ?? LINE_OPACITY} aria-label={t('線の濃さ')} onChange={e => onChange({ lineOpacity: +e.target.value })} /></label>}
    </>
  )
}

export interface BoardChoice { setView: SetView; setLayout: SetLayout; rotations: number[]; display: ChartDisplay; skill: BoardSkill; columns: BoardPlayer[]; split: boolean; notes: boolean; noteSize: number; noteFills: [string, string]; photos: boolean; background: string; marker: Marker | 'head'; team: string; searched: boolean; teamColor: string; discLine: string; cones: boolean; tables: RotationTables; attackers: number } // marker 'head': the scene's head, in no marker

// The choices of tables on a rotation slide.
const TABLE_NAMES: Record<RotationTables, string> = {
  all: t('すべて表示'), hash: t('# のみ'), hashPlus: t('# と + のみ'), passes: t('パスのみ'), calls: t('セッターコールのみ'), attackers: t('アタッカー（サイドアウトの打数上位）'), none: t('表示しない'),
}

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
  const [count0, setCount] = useState(initial?.columns.length ?? 3)
  const oneSetter = skill === 'E' || skill === 'R' // a set or rotation slide is one setter's
  const count = oneSetter ? 1 : count0
  // A rotation slide per rotation picked (all six by default; a slide made again: its own).
  const [rotations, setRotations] = useState<number[]>(initial?.rotation ? [initial.rotation] : ROTATIONS)
  // The team's colour on a rotation slide: chosen here, else the main colour of its logo in the library.
  const [pickedColor, setPickedColor] = useState<string | null>(initial?.teamColor ?? null)
  const [logoTint, setLogoTint] = useState<string | null>(null)
  const teamColor = pickedColor ?? logoTint ?? TEAM_COLOR
  // Their outline: chosen here, else a darker shade of the fill.
  const [pickedLine, setPickedLine] = useState<string | null>(initial?.discLine ?? null)
  const discLine = pickedLine ?? darker(teamColor)
  // The spikers' cones on the court, and which tables go at the bottom right.
  const [cones, setCones] = useState(initial?.cones !== false)
  const [tables, setTables] = useState<RotationTables>(initial?.tables ?? 'all')
  const [attackers, setAttackers] = useState(initial?.attackers ?? ATTACKER_CARDS) // with the attackers' cards: how many
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
  const setView: SetView = initial?.setView ?? 'zones' // set slides paint the zones only (no arrows); kept for cards made before
  const [setLayout, setSetLayout] = useState<SetLayout>(initial?.setLayout ?? 'reception')
  const [display, setDisplay] = useState<ChartDisplay>(() => initial?.display ?? { points: true, lines: DEFAULT_CHART.lines, heat: false, starts: true, lineOpacity: LINE_OPACITY })
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
  useEffect(() => {
    if (skill !== 'R' || !open) return
    let live = true
    setLogoTint(null)
    void logoColor(open).then(c => { if (live) setLogoTint(c) })
    return () => { live = false }
  }, [skill, open])
  const shown = fill(slots, count)
  const setSlot = (i: number, s: Slot) => setSlots(shown.map((x, k) => (k === i ? s : x)))
  // A serve target: the team's receivers, all of them (the slide keeps those who received enough).
  const columns = skill === 'T' ? inTeam : shown.flatMap(s => {
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
            {([['S', t('サーブ')], ['A', t('アタック')], ['E', t('セット')], ['R', t('ローテーション')], ['T', t('サーブの狙い')]] as [BoardSkill, string][]).map(([k, label]) => (
              <button key={k} role="radio" aria-checked={skill === k} className={skill === k ? 'on' : ''} onClick={() => setSkill(k)}>{label}</button>
            ))}
          </div>
          <label className="check" title={t('左の絞り込みの結果だけで作ります')}><input type="checkbox" checked={searched} onChange={e => setSearched(e.target.checked)} /> {t('絞り込みの結果だけ')}</label>
        </div>
        <div className="filter-row">
          <label className="field-label" htmlFor="board-team">{t('チーム')}</label>
          <select id="board-team" value={open} onChange={e => { setTeam(e.target.value); setPickedColor(null); setPickedLine(null) }}>
            {teams.map(([code, name]) => <option key={code} value={code}>{`${code} — ${name}`}</option>)}
          </select>
          {!oneSetter && skill !== 'T' && <>
            <label className="field-label" htmlFor="board-count">{t('人数')}</label>
            <select id="board-count" value={count} onChange={e => { setSlots(shown); setCount(+e.target.value) }}>
              {Array.from({ length: MOST_PER_SLIDE }, (_, i) => i + 1).map(n => <option key={n} value={n}>{t('{0} 人', n)}</option>)}
            </select>
          </>}
        </div>
        {skill === 'R' && (
          <div className="filter-row" title={t('ローテーション（セッターの位置）ごとに 1 枚。大きな P 番号、コートにそのローテの並びと # + ! レセプションからの攻撃配分、右に # ・ + ・ ! パス別と、そのローテで多いセッターコール順に 3 つまでの配分の表')}>
            <span className="field-label">{t('ローテ')}</span>
            {ROTATIONS.map(r => (
              <label key={r} className="check"><input type="checkbox" checked={rotations.includes(r)}
                onChange={e => setRotations(ROTATIONS.filter(x => (x === r ? e.target.checked : rotations.includes(x))))} /> P{r}</label>
            ))}
            <span className="check" title={t('選手の円の色。最初はライブラリにあるチームのロゴの色です')}>{t('チームカラー')} <PaletteColor value={teamColor} label={t('チームカラー')} onChange={setPickedColor} /></span>
            <span className="check" title={t('リベロ以外の 5 人の円の線の色。最初はチームカラーを暗くした色です')}>{t('線')} <PaletteColor value={discLine} label={t('選手の円の線の色')} onChange={setPickedLine} /></span>
          </div>
        )}
        {skill === 'R' && (
          <div className="filter-row">
            <span className="field-label">{t('表示')}</span>
            <label className="check" title={t('アタッカーごとのよく打つコースの扇形')}><input type="checkbox" checked={cones} onChange={e => setCones(e.target.checked)} /> {t('コーン')}</label>
            <label className="check" title={t('右下の配分の表。数が少ないほど大きく出ます')}>{t('表')}{' '}
              <select value={tables} onChange={e => setTables(e.target.value as RotationTables)} aria-label={t('右下の表')}>
                {ROTATION_TABLES.map(v => <option key={v} value={v}>{TABLE_NAMES[v]}</option>)}
              </select></label>
            {tables === 'attackers' && <label className="check" title={t('サイドアウト（レセプションからの攻撃）の打数が多い順に、何人まで出すか')}>{t('人数')}{' '}
              <select value={attackers} onChange={e => setAttackers(+e.target.value)} aria-label={t('アタッカーの人数')}>
                {Array.from({ length: ATTACKER_CARDS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{t('{0} 人', n)}</option>)}
              </select></label>}
          </div>
        )}
        {skill === 'E' && (
          <div className="filter-row">
            <span className="field-label">{t('スライド')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('セットのスライドの中身')}>
              <button role="radio" aria-checked={setLayout === 'reception'} className={setLayout === 'reception' ? 'on' : ''} onClick={() => setSetLayout('reception')}
                title={t('上の段に # ・ + ・ ! レセプションからの配球、下の段に # + レセプションからの配球をセッターコールの多い順に 3 つ')}>{t('レセプション・コール別')}</button>
              <button role="radio" aria-checked={setLayout === 'rotation'} className={setLayout === 'rotation' ? 'on' : ''} onClick={() => setSetLayout('rotation')}
                title={t('6 つのローテーション（上の段 S1・S6・S5、下の段 S4・S3・S2）ごとの、# + ! レセプションからのサイドアウトの攻撃配分')}>{t('ローテ別サイドアウト')}</button>
            </div>
          </div>
        )}
        {skill === 'T' && <p className="hint">{t('このチームのレセプションを、受けた選手（写真付き）とサーブの種類（ジャンプ・フローター）ごと、サーブが入ったゾーンごとに並べます。チーム全体より 10 ポイント以上良い数字を青、悪い数字を赤で示します')}</p>}
        {skill !== 'T' && <div className="board-slots" title={t('場所ごとに選手を選びます。左から順にカードに並びます')}>
          {shown.map((s, i) => {
            const p = inTeam.find(x => x.key === s.key)
            const codes = skill === 'A' && p ? attackCodes([p]) : []
            return (
              <div key={i} className="board-slot">
                <span className="board-slot-no">{oneSetter ? t('セッター') : t('{0} 番目', i + 1)}</span>
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
                {!oneSetter && <label className="check board-attention" title={t('この選手に「Attention」の赤いマークを付けます（写真の上、写真がなければ名前の行の右）')}>
                  <input type="checkbox" checked={!!s.attention} disabled={!p} onChange={e => setSlot(i, { ...s, attention: e.target.checked })} /> Attention</label>}
              </div>
            )
          })}
        </div>}
        {!inTeam.length && <p className="muted">{t('このプレーがありません')}</p>}
        <BoardPreview columns={columns} skill={skill} photos={photos}
          opts={{ setView, setLayout, rotation: rotations[0] ?? 1, teamColor, discLine, cones, tables, attackers, split, notes: notes && !oneSetter, noteSize, noteFills, background, display, ...(chartStyle?.(skill) ? { style: chartStyle(skill) } : {}) }} />
        {!oneSetter && skill !== 'T' && <div className="filter-row"><ChartShow value={display} skill={skill} onChange={p => setDisplay({ ...display, ...p })} /></div>}
        <div className="filter-row">
          <label className="check" title={t('パックの写真を入れます。外すと写真なしの配置になります')}><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> {t('写真')}</label>
          {!oneSetter && skill !== 'T' && <label className="check" title={t('スライド下部に選手ごとのメモ欄を入れます')}><input type="checkbox" checked={notes} onChange={e => setNotes(e.target.checked)} /> {t('ノート欄')}</label>}
          {notes && !oneSetter && skill !== 'T' && <>
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
          <button className="primary" disabled={!columns.length || (skill === 'R' && !rotations.length)} onClick={() => onCreate({ setView, setLayout, rotations, display, skill, columns, split, notes: notes && !oneSetter, noteSize, noteFills, photos, background, marker, team: open, searched, teamColor, discLine, cones, tables, attackers })}>{initial ? t('更新') : t('作成')}</button>
        </div>
      </div>
    </div>
  )
}
