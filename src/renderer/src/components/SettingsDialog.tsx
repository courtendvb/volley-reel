import { useMemo, useState } from 'react'
import { ChartPreview } from './ChartPreview'
import { PaletteColor } from './PaletteColor'
import { POINT_SCALE, cleanLineColors, cleanPointScale, type ChartLineColors } from '../../../shared/chart'
import { LineColors } from './LineColors'
import { HEADLINE_SIZE, type HeadlineStyle } from '../../../shared/annotation'
import type { OverlayTheme } from '../../../shared/overlay'
import type { ProjectSettings } from '../../../shared/types'
import { ACCENTS, applyAppearance, loadAppearance, type Appearance, type ThemeMode } from '../appearance'
import { AddonPacks } from './AddonPacks'
import { TeamLogos } from './TeamLogos'
import { ThemePicker } from './ThemePicker'
import { LANGS, getLang, t, type Lang } from '../../../shared/i18n'
import { IS_MAC } from '../../../shared/keys'
import { arrowSec, ctrlArrowSec, setArrowSec, setCtrlArrowSec } from '../keys'

// Fonts every computer of its kind has; the list a project's headline can pick from.
const FONTS = IS_MAC ? ['Hiragino Sans', 'Hiragino Mincho ProN', 'Helvetica Neue', 'Georgia', 'Impact'] : ['Yu Gothic UI', 'Meiryo', 'BIZ UDPGothic', 'Yu Mincho', 'Arial', 'Georgia', 'Impact']

interface Props {
  settings: ProjectSettings
  theme: OverlayTheme // the overlay colors in use now
  teams: { code: string; name: string }[] // the teams in the project's matches, opponents first
  onSave: (s: ProjectSettings) => Promise<void>
  onClose: () => void
  onLanguage: (l: Lang) => void // saves the edits, then shows the app in that language
}

// 自チームのチームコード、オーバーレイの配色、チームのロゴ (design §3.2), add-on packs, and the app's own look.
export function SettingsDialog({ settings, theme: themeNow, teams, onSave, onClose, onLanguage }: Props) {
  const [code, setCode] = useState(settings.ourTeamCodes[0] ?? '') // one target team per project
  const [theme, setTheme] = useState<OverlayTheme>(settings.theme ?? themeNow)
  // The app's look shows at once and is kept at once, like the logos (it isn't part of the project).
  const [look, setLook] = useState<Appearance>(loadAppearance)
  const changeLook = (a: Appearance) => { setLook(a); applyAppearance(a) }
  const [headline, setHeadline] = useState<HeadlineStyle>(settings.headline ?? {})
  const head = (patch: HeadlineStyle) => setHeadline({ ...headline, ...patch })
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<ChartLineColors>(settings.lineColors ?? {})
  const [points, setPoints] = useState<ChartLineColors>(settings.pointColors ?? {})
  const [pointScale, setPointScale] = useState(settings.pointScale ?? 1)
  const preview = useMemo(() => ({ lines, points, pointScale }), [lines, points, pointScale])
  // The list on the left picks the one setting shown on the right.
  const [here, setHere] = useState('team')
  const page = (id: string) => ({ 'data-section': id, hidden: here !== id })
  const NAV: [string, [string, string][]][] = [
    [t('このプロジェクト'), [['team', t('対象チーム')], ['theme', t('配色')], ['headline', t('見出し')], ['lines', t('チャートの色と点')]]],
    [t('倉庫'), [['logos', t('チームのロゴ')], ['addons', t('アドオン')]]],
    [t('このパソコン'), [['lang', 'Language / 言語'], ['keys', t('キー操作')], ['look', t('アプリの見た目')]]],
  ]

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ ...settings, ourTeamCodes: code ? [code] : [], theme, headline, lineColors: cleanLineColors(lines), pointColors: cleanLineColors(points), pointScale: cleanPointScale(pointScale) })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label={t('設定')} onClick={e => e.stopPropagation()}>
        <h2>{t('設定')}</h2>

        <div className="settings-body">
        <nav className="settings-nav" aria-label={t('設定の項目')}>
          {NAV.map(([group, items]) => (
            <div key={group} className="settings-nav-group">
              <span className="settings-nav-title">{group}</span>
              {items.map(([id, label]) => <button key={id} className={here === id ? 'on' : ''} aria-current={here === id ? 'true' : undefined} onClick={() => setHere(id)}>{label}</button>)}
            </div>
          ))}
        </nav>
        <div className="settings-pane">
        <section {...page('team')}>
          <label className="field-label wide" htmlFor="our-code">{t('対象チーム（自チーム）')}</label>
          <select id="our-code" value={code} onChange={e => setCode(e.target.value)}>
            {!teams.some(t => t.code === code) && <option value={code}>{code || t('（なし）')}</option>}
            {teams.map(t => <option key={t.code} value={t.code}>{`${t.code} — ${t.name}`}</option>)}
          </select>
          <p className="hint">{t('プロジェクトの中では、ホームでもアウェイでもこのチームが「自チーム」です（検索のチーム、スコアボードの左側）。')}</p>
        </section>

        <section {...page('theme')}>
          <span className="field-label wide">{t('配色（プロジェクト全体）')}</span>
          <ThemePicker value={theme} onChange={setTheme} />
          <p className="hint">{t('スコアボード・テロップ・タイトルカードの色。プロジェクトのすべての動画に使います。')}</p>
        </section>

        <section {...page('headline')}>
          <span className="field-label wide">{t('見出し')}</span>
          <div className="filter-row">
            <label className="field-label" htmlFor="headline-font">{t('フォント')}</label>
            <select id="headline-font" value={headline.font ?? ''} onChange={e => { const { font: _f, ...rest } = headline; setHeadline(e.target.value ? { ...rest, font: e.target.value } : rest) }}>
              <option value="">{t('標準')}</option>
              {[...new Set([...FONTS, ...(headline.font ? [headline.font] : [])])].map(f => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
            </select>
            <label className="field-label" htmlFor="headline-size">{t('サイズ')}</label>
            <input id="headline-size" type="number" min={12} max={200} step={2} value={headline.size ?? HEADLINE_SIZE} style={{ width: 64 }}
              onChange={e => { const n = +e.target.value; if (n >= 12 && n <= 200) head({ size: n }) }} />
          </div>
          <div className="filter-row">
            <label className="field-label" htmlFor="headline-color">{t('色')}</label>
            <PaletteColor value={headline.color ?? '#FFFFFF'} label={t('色')} onChange={c => head({ color: c })} />
            <label className="check"><input type="checkbox" checked={headline.bold !== false} onChange={e => head({ bold: e.target.checked })} /> {t('太字')}</label>
            <label className="check"><input type="checkbox" checked={headline.outline !== false} onChange={e => head({ outline: e.target.checked })} /> {t('黒縁')}</label>
            <label className="check"><input type="checkbox" checked={!!headline.box} onChange={e => { const { box: _b, ...rest } = headline; setHeadline(e.target.checked ? { ...rest, box: '#0F172A' } : rest) }} /> {t('背景')}</label>
            {headline.box && <PaletteColor value={headline.box} label={t('背景の色')} onChange={c => head({ box: c })} />}
            <button className="link" onClick={() => setHeadline({})}>{t('標準に戻す')}</button>
          </div>
          <p className="hint">{t('これから入れる見出しの見た目。プロジェクトのすべての動画に使います。入れた見出しは変わりません（書式から個別に変えられます）。')}</p>
        </section>

        <section {...page('lines')}>
          <span className="field-label wide">{t('チャートの色と点')}</span>
          {(['S', 'A'] as const).map(skill => (
            <div key={skill} className="chart-colors">
              <b>{skill === 'S' ? t('サーブ') : t('アタック')}</b>
              <div className="filter-row"><span className="field-label">{t('線')}</span>
                <LineColors value={lines[skill]} skill={skill} onChange={v => setLines({ ...lines, [skill]: v })} /></div>
              <div className="filter-row"><span className="field-label">{t('点')}</span>
                <LineColors value={points[skill]} skill={skill} of="point" onChange={v => setPoints({ ...points, [skill]: v })} /></div>
            </div>
          ))}
          <div className="filter-row">
            <label className="field-label" htmlFor="point-scale">{t('点の大きさ')}</label>
            <input id="point-scale" type="range" min={POINT_SCALE.min} max={POINT_SCALE.max} step={POINT_SCALE.step} value={pointScale} onChange={e => setPointScale(+e.target.value)} />
            <span className="muted">{`${Math.round(pointScale * 100)}%`}</span>
          </div>
          <div><button className="link" onClick={() => { setLines({}); setPoints({}); setPointScale(1) }}>{t('既定に戻す')}</button></div>
          <ChartPreview colors={preview} />
          <p className="hint">{t('ディレクションチャートの線と点の色を評価（# + ! - / =）ごとに、点の大きさとあわせて決めます。動画のチャートとデータスライドのすべてに使います（プロジェクトごと）。')}</p>
        </section>

        <section {...page('logos')}>
          <span className="field-label wide">{t('チームのロゴ（タイトルカード）')}</span>
          <TeamLogos teams={teams} />
          <p className="hint">{t('1 試合のクリップだけのタイトルカードに、相手チームのロゴを出します。倉庫に保存し、すべてのプロジェクトで使います（すぐ保存されます）。')}</p>
        </section>

        <section {...page('addons')}>
          <span className="field-label wide">{t('アドオン')}</span>
          <AddonPacks />
          <p className="hint">{t('リーグの選手写真などを別ファイル（.vrpack）で足します。倉庫に保存し、すべてのプロジェクトで使います（すぐ保存されます）。写真は右の「選手写真」から入れます。')}</p>
        </section>

        <section {...page('lang')}>
          {/* Both names, so it can be found whichever language is showing. */}
          <label className="field-label wide" htmlFor="app-lang">Language / 言語</label>
          <select id="app-lang" value={getLang()} onChange={e => onLanguage(e.target.value as Lang)}>
            {LANGS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <p className="hint">{t('アプリの表示の言語。このパソコンのすべてのプロジェクトに使います（変えると画面を読み直します。編集中の内容は保存されます）。')}</p>
        </section>

        <section {...page('keys')}>
          <span className="field-label wide">{t('キー操作')}</span>
          <div className="filter-row">
            <label className="field-label" htmlFor="arrow-sec">{t('← →')}</label>
            <input id="arrow-sec" type="number" min={0.1} max={60} step={0.1} defaultValue={arrowSec()}
              onChange={e => { const n = +e.target.value; if (n > 0 && n <= 60) setArrowSec(n) }} />
            <label className="field-label" htmlFor="ctrl-arrow-sec">{t('Ctrl + ← →')}</label>
            <input id="ctrl-arrow-sec" type="number" min={0.1} max={60} step={0.5} defaultValue={ctrlArrowSec()}
              onChange={e => { const n = +e.target.value; if (n > 0 && n <= 60) setCtrlArrowSec(n) }} />
          </div>
          <p className="hint">{t('動画が動く秒数。このパソコンのすべてのプロジェクトに使います（すぐ保存されます）。Shift + ← → は 1 フレームのままです。')}</p>
        </section>

        <section {...page('look')}>
          <span className="field-label wide">{t('アプリの見た目')}</span>
          <div className="filter-row">
            <span className="field-label">{t('画面')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('ライト・ダーク')}>
              {([['light', t('ライト')], ['dark', t('ダーク')], ['system', IS_MAC ? t('Mac に合わせる') : t('Windows に合わせる')]] as [ThemeMode, string][]).map(([m, l]) => (
                <button key={m} role="radio" aria-checked={look.mode === m} className={look.mode === m ? 'on' : ''} onClick={() => changeLook({ ...look, mode: m })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="field-label">{t('アクセント')}</span>
            <div className="accent-swatches" role="radiogroup" aria-label={t('アクセントの色')}>
              {ACCENTS.map(a => (
                <button key={a.color} role="radio" aria-checked={look.accent === a.color} aria-label={a.name} title={a.name}
                  className={`accent-swatch${look.accent === a.color ? ' on' : ''}`} style={{ background: a.color }}
                  onClick={() => changeLook({ ...look, accent: a.color })} />
              ))}
            </div>
          </div>
          <p className="hint">{t('ボタンや選択中の行の色と、画面の明るさ。このパソコンのすべてのプロジェクトに使います（すぐ反映・保存されます）。書き出す動画には影響しません。')}</p>
        </section>
        </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" onClick={save} disabled={saving}>{t('保存')}</button>
        </div>
      </div>
    </div>
  )
}
