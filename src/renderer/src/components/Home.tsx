import { useMemo, useState } from 'react'
import type { LibraryInfo, Match, MissingPart, RecentProject } from '../../../shared/types'
import { formatTime } from '../format'
import { t } from '../../../shared/i18n'

interface Props {
  library: LibraryInfo | null
  recent: RecentProject[]
  busy: boolean
  onChooseLibrary: () => void
  onScan: () => void
  onImportOne: () => void
  onNewProject: () => void
  onOpenProject: (path?: string) => void
  onRelocate: (id: string, part: MissingPart) => void
}

// Entry point (v3): the library on the left — every match, filterable by team code — and
// projects on the right. A project is made by picking matches out of the library.
export function Home({ library, recent, busy, onChooseLibrary, onScan, onImportOne, onNewProject, onOpenProject, onRelocate }: Props) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => filterMatches(library?.matches ?? [], q), [library, q])

  return (
    <main className="home">
      <section className="home-library">
        <header className="home-head">
          <h2>{t('倉庫')}</h2>
          {library && <span className="muted path" title={library.path}>{library.path}</span>}
          <span className="spacer" />
          <button onClick={onChooseLibrary}>{library ? t('倉庫を変更') : t('倉庫を選ぶ')}</button>
        </header>
        {!library ? (
          <div className="empty"><h2>{t('まず倉庫のフォルダを選んでください')}</h2>
            <p className="muted">{t('試合（動画と DVW の組）を登録しておく場所です。動画と DVW はコピーせず、元の場所を参照します。')}</p>
            <button className="primary" onClick={onChooseLibrary}>{t('倉庫を選ぶ')}</button></div>
        ) : (
          <>
            <div className="filter-row home-tools">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('チームコードや日付で絞り込み（例: HTH SMT 2026-10）')} aria-label={t('試合の絞り込み')} />
              <button className="primary" onClick={onScan} disabled={busy} title={t('フォルダを選ぶと、動画と DVW を日付とチームコードで組にします')}>{t('フォルダから一括取り込み')}</button>
              <button onClick={onImportOne} disabled={busy}>{t('1試合を取り込む')}</button>
            </div>
            <p className="count">{shown.length} / {library.matches.length} {t('試合')}</p>
            <div className="match-table" role="list">
              {shown.map(m => <MatchRow key={m.id} m={m} missing={library.missing[m.id]} busy={busy} onRelocate={part => onRelocate(m.id, part)} />)}
              {!library.matches.length && <p className="muted pad">{t('まだ試合がありません。「フォルダから一括取り込み」で、動画と DVW のあるフォルダを選んでください。')}</p>}
            </div>
          </>
        )}
      </section>

      <section className="home-projects">
        <header className="home-head"><h2>{t('プロジェクト')}</h2></header>
        <div className="home-actions">
          <button className="primary" onClick={onNewProject} disabled={!library?.matches.length} title={library?.matches.length ? '' : t('先に倉庫に試合を入れてください')}>{t('新しいプロジェクト')}</button>
          <button onClick={() => onOpenProject()} disabled={!library}>{t('開く…')}</button>
        </div>
        <h3 className="muted small-head">{t('最近のプロジェクト')}</h3>
        {recent.length ? recent.map(r => (
          <button key={r.path} className="recent" onClick={() => onOpenProject(r.path)} title={r.path}>
            <b>{r.name}</b><span className="muted">{r.path}</span>
          </button>
        )) : <p className="muted">{t('まだありません')}</p>}
      </section>
    </main>
  )
}

function MatchRow({ m, missing, busy, onRelocate }: { m: Match; missing?: MissingPart[]; busy: boolean; onRelocate: (part: MissingPart) => void }) {
  return (
    <div className={`match-row${missing ? ' lost' : ''}`} role="listitem" title={`${m.sourceVideoPath}\n${m.dvwPath}`}>
      <span className="date">{m.date ?? '—'}</span>
      <span className="teams"><b>{m.teams[0].code}</b> – <b>{m.teams[1].code}</b></span>
      <span className="muted names">{m.teams[0].name} / {m.teams[1].name}</span>
      <span className="muted dur">{formatTime(m.durationSec)}</span>
      {m.warnings.length > 0 && <span className="warn-dot" title={m.warnings.join('\n')}>⚠</span>}
      {missing && <MissingNote parts={missing} busy={busy} onRelocate={onRelocate} />}
    </div>
  )
}

// "動画が見つかりません [場所を指定…]": shown on a library row and above the project's workspace.
export function MissingNote({ parts, busy, onRelocate }: { parts: MissingPart[]; busy: boolean; onRelocate: (part: MissingPart) => void }) {
  return (
    <span className="missing-note">
      {parts.map(p => (
        <span key={p}>{p === 'video' ? t('動画') : 'DVW'}{t('が見つかりません')}
          <button className="small" disabled={busy} onClick={e => { e.stopPropagation(); onRelocate(p) }} title={t('移動したファイルを選び直します')}>{t('場所を指定…')}</button></span>
      ))}
    </span>
  )
}

// Every word must appear in the date, a team code or a team name (case-insensitive).
export function filterMatches(ms: Match[], q: string): Match[] {
  const words = q.toUpperCase().split(/\s+/).filter(Boolean)
  if (!words.length) return ms
  return ms.filter(m => {
    const hay = `${m.date ?? ''} ${m.teams[0].code} ${m.teams[1].code} ${m.teams[0].name} ${m.teams[1].name}`.toUpperCase()
    return words.every(w => hay.includes(w))
  })
}
