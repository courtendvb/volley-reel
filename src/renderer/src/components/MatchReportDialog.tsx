import { useEffect, useMemo, useRef, useState } from 'react'
import { matchReport, seasonReport, type ReportMatch } from '../../../shared/report'
import { matchLinks, reportHtml, seasonLinks, type ReportPick } from '../../../shared/reportHtml'
import type { Match, ParsedDVW } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const api = window.api

// The match report of one of the project's matches, shown as its A4 page and saved as a PDF. The
// numbers come from the match's DVW (shared/report.ts); the page is the same for both (reportHtml.ts).
// ALL: every match of the project added up for the target team (設定の対象チーム).
const ALL = '__all'
// How large the page shows on screen (the PDF keeps A4): − / ＋ in steps, remembered on this computer.
const ZOOMS = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.5]
const loadZoom = () => { try { const z = Number(localStorage.getItem('vr.reportZoom')); return ZOOMS.includes(z) ? z : 1.3 } catch { return 1.3 } }

export function MatchReportDialog({ matches, dvws, initial, ourCodes, onClose, onPick }: {
  matches: Match[]; dvws: Record<string, ParsedDVW>; initial: string | null; onClose: () => void
  ourCodes: string[] // the target team's codes
  onPick: (p: ReportPick) => void // a number clicked: show its plays in the play list
}) {
  const [id, setId] = useState(initial && matches.some(m => m.id === initial) ? initial : matches[0]?.id ?? '')
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(loadZoom)
  useEffect(() => { try { localStorage.setItem('vr.reportZoom', String(zoom)) } catch { /* not kept */ } }, [zoom])
  const step = (d: number) => setZoom(z => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + d))])
  const match = matches.find(m => m.id === id) ?? null
  // The target team's side in each match it played, and the other team's name for the row.
  const ours = useMemo(() => {
    const codes = ourCodes.map(c => c.toUpperCase())
    return matches.flatMap((m): (ReportMatch & { id: string })[] => {
      const d = dvws[m.id], i = d ? d.teams.findIndex(t => codes.includes(t.code.toUpperCase())) : -1
      return d && i >= 0 ? [{ id: m.id, d, side: i === 0 ? '*' : 'a', label: `vs ${d.teams[1 - i].name || d.teams[1 - i].code}` }] : []
    })
  }, [matches, dvws, ourCodes])
  // The page twice: on screen with its numbers clickable, and plain for the PDF.
  const [html, screen] = useMemo(() => {
    if (id === ALL) { const r = seasonReport(ours); return r ? [reportHtml(r), reportHtml(r, seasonLinks(ours.map(o => o.id)))] : ['', ''] }
    const d = match ? dvws[match.id] : null
    if (!match || !d) return ['', '']
    const r = matchReport(d)
    return [reportHtml(r), reportHtml(r, matchLinks(match.id, d, ourCodes))]
  }, [id, ours, match, dvws, ourCodes])
  // A click on a number (its data-f, reportHtml.ts) searches its plays. The page has no scripts of
  // its own; the dialog listens on it, so the frame shares the app's origin but runs nothing.
  const frame = useRef<HTMLIFrameElement>(null)
  const pick = useRef(onPick)
  pick.current = onPick
  const listen = () => {
    frame.current?.contentDocument?.addEventListener('click', e => {
      const raw = (e.target as Element | null)?.closest?.('[data-f]')?.getAttribute('data-f')
      if (!raw) return
      try { pick.current(JSON.parse(raw) as ReportPick) } catch { /* not a search */ }
    })
  }
  const save = async () => {
    if (!html) return
    setBusy(true)
    try { setSaved(await api.saveReportPdf(html, id === ALL ? `${ourCodes[0] ?? ''} - Team report` : `${match?.name ?? ''} - Match report`)) } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report-dialog" role="dialog" aria-label={t('マッチレポート')} onClick={e => e.stopPropagation()}>
        <div className="report-bar">
          <h2>{t('マッチレポート')}</h2>
          <select value={id} aria-label={t('試合')} onChange={e => { setId(e.target.value); setSaved(null) }}>
            {matches.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value={ALL} disabled={!ours.length}>{ourCodes[0] ? t('全試合（{0} の合計）', ourCodes[0]) : t('全試合（設定で対象チームを決めると選べます）')}</option>
          </select>
          <span className="spacer" />
          <span className="report-zoom">
            <button onClick={() => step(-1)} disabled={zoom === ZOOMS[0]} aria-label={t('縮小')} title={t('縮小')}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => step(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label={t('拡大')} title={t('拡大（画面の表示だけ。PDF は A4 のまま）')}>＋</button>
          </span>
          {saved && <span className="muted small">{t('書き出しました: {0}', saved.split(/[\\/]/).pop() ?? '')}</span>}
          <button className="primary" disabled={!html || busy} onClick={() => void save()}>{busy ? t('書き出しています…') : t('PDF に書き出す…')}</button>
          <button onClick={onClose}>{t('閉じる')}</button>
        </div>
        {html ? <iframe ref={frame} className="report-page" title={t('マッチレポート')} srcDoc={screen.replace('</head>', `<style>html { zoom: ${zoom}; }</style></head>`)} sandbox="allow-same-origin" onLoad={listen} />
          : <p className="muted">{t('DVW を読み込んだ試合がありません')}</p>}
        <p className="hint">{t('数字をクリックすると、そのプレーだけをプレー一覧に出します')}　{t('数字は DVW から計算します。Vote（評点）は入りません。会場・観客数・審判は DVW に入っているときだけ出ます')}</p>
      </div>
    </div>
  )
}
