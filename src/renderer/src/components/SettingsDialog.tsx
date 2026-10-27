import { useState } from 'react'
import type { OverlayTheme } from '../../../shared/overlay'
import type { ProjectSettings } from '../../../shared/types'
import { ACCENTS, applyAppearance, loadAppearance, type Appearance, type ThemeMode } from '../appearance'
import { TeamLogos } from './TeamLogos'
import { ThemePicker } from './ThemePicker'

interface Props {
  settings: ProjectSettings
  theme: OverlayTheme // the overlay colors in use now
  teams: { code: string; name: string }[] // the teams in the project's matches, opponents first
  onSave: (s: ProjectSettings) => Promise<void>
  onClose: () => void
}

// 自チームのチームコード、オーバーレイの配色、チームのロゴ (design §3.2), and the app's own look.
export function SettingsDialog({ settings, theme: themeNow, teams, onSave, onClose }: Props) {
  const [code, setCode] = useState(settings.ourTeamCodes[0] ?? '') // one target team per project
  const [theme, setTheme] = useState<OverlayTheme>(settings.theme ?? themeNow)
  // The app's look shows at once and is kept at once, like the logos (it isn't part of the project).
  const [look, setLook] = useState<Appearance>(loadAppearance)
  const changeLook = (a: Appearance) => { setLook(a); applyAppearance(a) }
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ ...settings, ourTeamCodes: code ? [code] : [], theme })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="設定" onClick={e => e.stopPropagation()}>
        <h2>設定</h2>

        <section>
          <label className="field-label wide" htmlFor="our-code">対象チーム（自チーム）</label>
          <select id="our-code" value={code} onChange={e => setCode(e.target.value)}>
            {!teams.some(t => t.code === code) && <option value={code}>{code || '（なし）'}</option>}
            {teams.map(t => <option key={t.code} value={t.code}>{`${t.code} — ${t.name}`}</option>)}
          </select>
          <p className="hint">プロジェクトの中では、ホームでもアウェイでもこのチームが「自チーム」です（検索のチーム、スコアボードの左側）。</p>
        </section>

        <section>
          <span className="field-label wide">配色（プロジェクト全体）</span>
          <ThemePicker value={theme} onChange={setTheme} />
          <p className="hint">スコアボード・テロップ・タイトルカードの色。プロジェクトのすべての動画に使います。</p>
        </section>

        <section>
          <span className="field-label wide">チームのロゴ（タイトルカード）</span>
          <TeamLogos teams={teams} />
          <p className="hint">1 試合のクリップだけのタイトルカードに、相手チームのロゴを出します。倉庫に保存し、すべてのプロジェクトで使います（すぐ保存されます）。</p>
        </section>

        <section>
          <span className="field-label wide">アプリの見た目</span>
          <div className="filter-row">
            <span className="field-label">画面</span>
            <div className="segmented" role="radiogroup" aria-label="ライト・ダーク">
              {([['light', 'ライト'], ['dark', 'ダーク'], ['system', 'Windows に合わせる']] as [ThemeMode, string][]).map(([m, l]) => (
                <button key={m} role="radio" aria-checked={look.mode === m} className={look.mode === m ? 'on' : ''} onClick={() => changeLook({ ...look, mode: m })}>{l}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="field-label">アクセント</span>
            <div className="accent-swatches" role="radiogroup" aria-label="アクセントの色">
              {ACCENTS.map(a => (
                <button key={a.color} role="radio" aria-checked={look.accent === a.color} aria-label={a.name} title={a.name}
                  className={`accent-swatch${look.accent === a.color ? ' on' : ''}`} style={{ background: a.color }}
                  onClick={() => changeLook({ ...look, accent: a.color })} />
              ))}
            </div>
          </div>
          <p className="hint">ボタンや選択中の行の色と、画面の明るさ。このパソコンのすべてのプロジェクトに使います（すぐ反映・保存されます）。書き出す動画には影響しません。</p>
        </section>

        <div className="modal-actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={save} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  )
}
