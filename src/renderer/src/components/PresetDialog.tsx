import { useMemo, useState } from 'react'
import type { PlayRef } from '../../../shared/filter'
import type { PlayDir } from '../../../shared/court'
import { MARKERS, MARKER_COLORS, type ClipMode } from '../../../shared/reel'
import { DEFAULT_HOW, HOW_OPTIONS, PRESET_KINDS, buildPreset, presetLabels, presetName, presetRefs, usesRoles, type PresetHow, type PresetKind, type PresetLookups, type PresetSource, type SceneSpec, type VideoPreset } from '../../../shared/presets'
import { ROLES, roleName } from '../../../shared/roles'
import { personOf, playerLabel } from '../../../shared/rotationSplit'
import type { PlayerRole } from '../../../shared/types'
import { t } from '../../../shared/i18n'

// prefix: put before each scene's name so the scene list tells this video's scenes from others'.
export interface PresetChoice { preset: VideoPreset; scenes: SceneSpec[]; name: string; prefix: string }

interface Props {
  results: PlayRef[] // the search's plays now
  scope: PlayRef[] // every play of the matches searched
  targetCode: string
  look: PresetLookups
  roles: Record<string, PlayerRole> // positions set by hand in the project, by player key
  rosterRoleOf: (r: PlayRef) => PlayerRole | undefined // the DVW roster's position
  onRoles: (roles: Record<string, PlayerRole>) => void
  onMake: (c: PresetChoice) => void
  onClose: () => void
}

// Side-out runs to the rally's end (the reception to the result); the rest show the play itself.
const DEFAULT_MODE: Record<PresetKind, ClipMode> = { sideout: 'toEnd', serve: 'keyplay', block: 'keyplay', attack: 'keyplay' }

const HINTS = (): Record<string, string> => ({
  'sideout:none': t('ローテーションごとのシーンに、レセプションから相手コートへ返すまでのアタックを入れます（回る順 1→6→5→4→3→2）。'),
  'sideout:reception': t('ローテーションごとのシーンで、マーカー 1 に良いレセプション（# +）から、マーカー 2 に悪いレセプション（- ! /）からの攻撃を入れます。'),
  'sideout:player': t('ローテーションごとのシーンで、打った本数の多い選手から順にマーカー 1〜5 を付けます。6 人目からはマーカーなしで最後に入ります。'),
  'sideout:zone': t('ローテーションごとのシーンで、打ったゾーンを本数の多い順にマーカー 1〜5 にします。ゾーンが分からないものはマーカーなしで最後に入ります。'),
  'sideout:result': t('ローテーションごとのシーンで、マーカー 1 に決定、2 にラリーを取ったもの（サイドアウト成功）、3 にラリーを落としたもの（サイドアウト失敗）を入れます。'),
  'serve:rotation': t('サーブした選手ごとのシーンを、いちばん多くサーブしたローテーションの回る順（1→6→5→4→3→2）に並べます。'),
  'serve:count': t('サーブした選手ごとのシーンを、本数の多い順に並べます。'),
  'serve:jersey': t('サーブした選手ごとのシーンを、背番号順に並べます。'),
  serve: t('中はマーカー 1 にサービスエース（#）、2 に崩した（+ /）、3 に返された（! -）、4 にサーブミス（=）を入れます。'),
  'block:middle': t('ミドルブロッカーごとに、そのミドルが前衛にいたときの相手のアタックを全部（ブロックに触ったかどうかに関係なく）シーンに入れ、本数の多い順に並べます。中は相手の攻撃で、マーカー 1 に良いレセプション（# +）から、2 に悪いレセプション（- ! /）から、3 にトランジションからのものを入れます。'),
  'block:rotation': t('ローテーションごとのシーンで、ブロックした選手に本数の多い順でマーカー 1〜5 を付けます。'),
  'attack:count': t('アタックした選手ごとのシーンを、本数の多い順に並べます。'),
  'attack:combo': t('アタックした選手ごとのシーンを本数の多い順に並べ、中はアタックコード（X5 など）を本数の多い順にマーカー 1〜5 にします。6 つ目からとコードのないものはマーカーなしで最後に入ります。'),
  'attack:position': t('アウトサイドヒッター・オポジット・ミドルブロッカー・セッター・その他のシーンに分け、中は選手別のマーカーにします。'),
})

// Videos made from a preset in one go: one kind of play for a team, laid out as scenes with marker
// groups named for what they hold, put together in a new video.
export function PresetDialog({ results, scope, targetCode, look, roles, rosterRoleOf, onRoles, onMake, onClose }: Props) {
  const [kind, setKind] = useState<PresetKind>('sideout')
  const [how, setHow] = useState<PresetHow>(DEFAULT_HOW)
  const [source, setSource] = useState<PresetSource>('our')
  const [modes, setModes] = useState(DEFAULT_MODE)
  const [dir, setDir] = useState<'all' | PlayDir>('all')
  const refs = useMemo(() => presetRefs(kind, how, source, scope, results, dir), [kind, how, source, scope, results, dir])
  // With a way picked: the plays left out because their match has no fitted court.
  const unknownDir = useMemo(() => (dir === 'all' ? 0 : presetRefs(kind, how, source, scope, results).filter(r => r.dir === null).length), [kind, how, source, scope, results, dir])
  const made = useMemo(() => buildPreset(kind, how, refs, look), [kind, how, refs, look])
  const team = targetCode || t('対象チーム')
  const preset: VideoPreset = { kind, how, source, dir, mode: modes[kind] }
  const { name, prefix } = presetLabels(preset, targetCode)
  const plays = made.scenes.reduce((n, s) => n + s.items.length, 0)

  // The players of the team picked (both teams from the results), to set positions by hand.
  const people = useMemo(() => {
    const seen = new Map<string, PlayRef>()
    for (const r of source === 'results' ? scope : scope.filter(r => r.teamRole === source)) if (!seen.has(personOf(r))) seen.set(personOf(r), r)
    return [...seen.values()].sort((a, b) => (a.teamRole === b.teamRole ? a.play.jersey - b.play.jersey : a.teamRole === 'opp' ? 1 : -1))
  }, [scope, source])
  const needRoles = usesRoles(kind, how)
  // Nothing to go by: no middle blocker (block video), or no position at all (attack video).
  const noRoles = needRoles && people.length > 0 && !people.some(r => (kind === 'block' ? look.roleOf(r) === 'MB' : !!look.roleOf(r)))
  const [rolesOpen, setRolesOpen] = useState(false)
  const setRole = (key: string, role: PlayerRole | '') => {
    const { [key]: _old, ...rest } = roles
    onRoles(role ? { ...rest, [key]: role } : rest)
  }

  const seg = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <div className="filter-row">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{l}</button>)}
      </div>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal preset-dialog" role="dialog" aria-label={t('プリセットから作る')} onClick={e => e.stopPropagation()}>
        <h2>{t('プリセットから作る')}</h2>
        <section>
          {seg(t('ビデオ'), kind, setKind, PRESET_KINDS.map(k => [k, presetName(k)]))}
          {seg(t('チーム'), source, setSource, [['our', team], ['opp', t('相手')], ['results', t('今の検索結果から')]])}
          {seg(kind === 'sideout' ? t('中の分け方') : t('作り方'), how[kind] as string, v => setHow({ ...how, [kind]: v }), HOW_OPTIONS()[kind] as [string, string][])}
          {seg(t('コートの向き'), dir, setDir, [['all', t('すべて')], ['up', t('↑ 下から上')], ['down', t('↓ 上から下')]])}
          {seg(t('切り出し'), modes[kind], m => setModes({ ...modes, [kind]: m }), [['keyplay', t('プレー前後')], ['toEnd', t('ラリー終わりまで')]])}
        </section>
        <p className="hint">
          {HINTS()[`${kind}:${how[kind]}`]}
          {source === 'results' ? t('今の検索結果のうち、このビデオに入るプレーだけを使います。') : t('「検索する試合」で選んでいる試合から集めます。')}
          {dir !== 'all' && t('向きは、サーブ・アタックは打った側から、ブロックは相手側から見ます。')}
          {unknownDir > 0 && t('コートのグリッドを合わせていない試合のプレー {0} 件は、向きが分からないため除いています', unknownDir)}
        </p>
        {kind === 'serve' && <p className="hint">{HINTS().serve}</p>}
        {needRoles && (
          <details className="preset-roles" open={rolesOpen || noRoles} onToggle={e => setRolesOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t('ポジション（{0} 人）', people.length)}</summary>
            {noRoles && <p className="hint warning">{kind === 'block' ? t('ミドルブロッカーが分かりません。DVW の選手表にポジションがないときは、ここで選んでください。') : t('ポジションが分かりません。DVW の選手表にポジションがないときは、ここで選んでください。')}</p>}
            <p className="hint">{t('ここで選んだポジションはこのプロジェクトに保存され、DVW の選手表より優先されます（データスライドの背番号の色にも使います）。')}</p>
            <div className="preset-role-list">
              {people.map(r => {
                const roster = rosterRoleOf(r)
                return (
                  <label key={personOf(r)} className="preset-role">
                    <span>{source === 'results' && r.teamRole === 'opp' ? `${t('相手')} ` : ''}{playerLabel(r)}</span>
                    <select value={roles[r.personKey] ?? ''} onChange={e => setRole(r.personKey, e.target.value as PlayerRole | '')}>
                      <option value="">{roster ? t('DVW のまま（{0}）', roleName(roster)) : t('未設定')}</option>
                      {ROLES.map(x => <option key={x} value={x}>{roleName(x)}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          </details>
        )}
        <div className="preset-preview">
          {made.scenes.length ? made.scenes.map((s, i) => (
            <div key={i} className="preset-row">
              <b>{s.title}</b>
              <span className="preset-total">{t('{0} 本', s.items.length)}</span>
              <span className="preset-markers">
                {MARKERS.filter(m => s.counts[m]).map(m => (
                  <span key={m} className="preset-marker"><i style={{ background: MARKER_COLORS[m] }} />{s.names[m]} {s.counts[m]}</span>
                ))}
                {Object.keys(s.counts).length > 0 && s.rest > 0 && <span className="preset-marker muted">{t('マーカーなし')} {s.rest}</span>}
              </span>
            </div>
          )) : <span className="muted">{t('当てはまるプレーがありません')}</span>}
          {made.skipped > 0 && <span className="muted">{t('ローテーションが分からない {0} 本は入りません', made.skipped)}</span>}
        </div>
        <p className="hint">{t('{0} シーン・{1} 本で、新しい動画「{2}」を作ります。シーンにはタイトルカードが付きます。', made.scenes.length, plays, name)}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('キャンセル')}</button>
          <button className="primary" disabled={!made.scenes.length} onClick={() => onMake({ preset, scenes: made.scenes, name, prefix })}>{t('作る')}</button>
        </div>
      </div>
    </div>
  )
}
