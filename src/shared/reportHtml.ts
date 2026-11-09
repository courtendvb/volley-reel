// The match report as one A4 page of HTML, for the screen and for the PDF alike, laid out like a
// scouting program's report: the match and its sets, each team's players and set totals, and how each
// team scored (side-out, break points, rotations, the first attack after reception and after a dig).
import { pct, per, type AttackLine, type MatchReport, type PlayerLine, type SetLine, type StatLine, type TeamReport } from './report'

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const n = (v: number) => (v ? String(v) : '.')
const signed = (v: number) => (v > 0 ? `+${v}` : v ? String(v) : '.')
const dateOf = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')

// The five set boxes: the starting zone in a box, an empty box for coming on, nothing for not playing.
function setBoxes(sets: PlayerLine['sets']): string {
  return `<span class="sets">${[0, 1, 2, 3, 4].map(i => {
    const v = sets[i]
    return v === null || v === undefined ? '<i></i>' : v === '*' ? '<b class="sub"></b>' : `<b>${v}</b>`
  }).join('')}</span>`
}

// Several matches: the share of the rallies they were on court for; a libero (whom the lineups leave
// out) by the sets they played instead, as a count of the team's sets.
const playedCell = (p: PlayerLine) => {
  const q = p.played!
  return p.libero ? (q.sets ? `${q.sets}/${q.setsOf} sets` : '.') : (pct(q.rallies, q.of) || '.')
}

// The stat columns shared by players, totals and sets.
function cells(l: StatLine, points = true): string {
  const r = l.rec, a = l.att
  return `${points ? `<td>${n(l.points)}</td><td>${n(l.bp)}</td><td>${signed(l.wl)}</td>` : ''}`
    + `<td class="g">${n(l.serve.tot)}</td><td>${n(l.serve.err)}</td><td>${n(l.serve.pts)}</td><td>${n(l.serve.poss)}</td><td>${l.serve.tot ? pct(l.serve.brk, l.serve.tot) : '.'}</td>`
    + `<td class="g">${n(r.tot)}</td><td>${n(r.err)}</td><td>${n(r.ovr)}</td><td class="w">${r.tot ? `${pct(r.pos, r.tot)} (${pct(r.exc, r.tot)})` : '.'}</td>`
    + `<td class="g">${n(a.tot)}</td><td>${n(a.err)}</td><td>${n(a.blo)}</td><td>${n(a.pts)}</td><td>${a.tot ? pct(a.pts, a.tot) : '.'}</td>`
    + `<td class="g">${n(l.blk)}</td>`
}

// several: a report of several matches: the share of the team's rallies each was on court for in place of the boxes.
function teamTable(t: TeamReport, several: boolean): string {
  const head = `<tr class="h1"><th class="name" rowspan="2">${esc(t.name)}</th><th>${several ? 'Played' : 'Set'}</th><th colspan="3">Points</th><th colspan="5" class="g">Serve</th><th colspan="4" class="g">Reception</th><th colspan="5" class="g">Attack</th><th class="g">BK</th></tr>`
    + `<tr class="h2"><th>${several ? 'Rallies%' : `<span class="sets">${[1, 2, 3, 4, 5].map(s => `<em>${s}</em>`).join('')}</span>`}</th><th>Tot</th><th>BP</th><th>W-L</th><th class="g">Tot</th><th>Err</th><th>Pts</th><th>Poss</th><th>BP%</th><th class="g">Tot</th><th>Err</th><th>Ovr</th><th>Pos% (Exc%)</th><th class="g">Tot</th><th>Err</th><th>Blo</th><th>Pts</th><th>Pts%</th><th class="g">Pts</th></tr>`
  const rows = t.players.map(p => `<tr><td class="name"><span class="no">${String(p.jersey).padStart(2, '0')}</span>${p.libero ? '<span class="lib">L</span>' : '<span class="lib"></span>'}${esc(p.name)}</td><td>${p.played ? playedCell(p) : setBoxes(p.sets)}</td>${cells(p)}</tr>`).join('')
  const total = `<tr class="total"><td class="name">Players total</td><td></td>${cells(t.total)}</tr>`
  const setHead = `<tr class="h2 sethead"><td class="name"></td><td colspan="4" class="won">Points won <span>Ser</span><span>Atk</span><span>Blo</span><span>Op.Er</span></td><td colspan="18"></td></tr>`
  // A set's row has the coaches beside it; a match's (several matches) its opponent.
  const staff = (i: number) => (i === 0 && t.coach ? `<span class="muted">Coach</span> ${esc(t.coach)}` : i === 1 && t.assistant ? `<span class="muted">Assistant</span> ${esc(t.assistant)}` : '')
  const setRow = (s: SetLine, i: number) => `<tr class="set"><td class="name">${s.label ? esc(s.label) : staff(i)}</td>`
    + `<td colspan="4" class="won"><b>${s.label ? '' : `Set ${s.set}`}</b><span>${n(s.won.ser)}</span><span>${n(s.won.atk)}</span><span>${n(s.won.blo)}</span><span>${n(s.won.opErr)}</span></td>${cells(s, false)}</tr>`
  return `<table class="team">${head}${rows}${total}${setHead}${t.sets.map(setRow).join('')}</table>`
}

const attackRow = (a: AttackLine) => `<td>${a.err}</td><td>${a.blo}</td><td>${pct(a.pts, a.tot) || '–'}</td><td>${a.tot}</td>`

function summary(r: MatchReport): string {
  const [h, v] = r.teams
  const side = (t: TeamReport) => `<td class="rot"><div class="muted">Points<br>S in Diff</div>${t.rotations.map(x => `<div><span>${x.rot}</span><span>${signed(x.diff) === '.' ? '0' : signed(x.diff)}</span></div>`).join('')}</td>`
    + `<td class="eff"><div>Reception <b>${t.so.receptions}</b></div><div>Points SO <b>${t.so.points}</b></div><div class="muted">Each ${per(t.so.receptions, t.so.points)} receptions<br>1 point</div>`
    + `<div class="gap">Serve <b>${t.bp.serves}</b></div><div>Points BP <b>${t.bp.points}</b></div><div class="muted">Each ${per(t.bp.serves, t.bp.points)} serves<br>1 break point</div></td>`
  const block = (title: string, k: 'pos' | 'neg' | 'dig') => `<tr><th colspan="9" class="kt">${title}</th></tr>`
    + `<tr class="kh"><td>Errors</td><td>Blo</td><td>Pts%</td><td>Tot</td><td></td><td>Errors</td><td>Blo</td><td>Pts%</td><td>Tot</td></tr>`
    + `<tr class="kv">${attackRow(h.kill[k])}<td></td>${attackRow(v.kill[k])}</tr>`
  return `<table class="summary"><tr><th colspan="2">${esc(h.name)}</th><th>Kill on reception</th><th colspan="2">${esc(v.name)}</th><td rowspan="2" class="legend">`
    + `<div><b>BP</b> Break point</div><div><b>Err</b> Errors</div><div><b>Pos%</b> Positive +#</div><div><b>W-L</b> Won-Lost</div><div><b>Pts</b> Points</div><div><b>Blo</b> Blocked</div><div><b>Exc</b> Excellent</div><div><b>Poss</b> Possibility</div><div><b>Ovr</b> Overpass</div><div><b>BP%</b> Serve → point</div>${r.matches ? '<div><b>Rallies%</b> On court (L: sets)</div>' : ''}`
    + `<div class="gap"><span class="sets"><b class="sub"></b></span> Substitute</div><div><span class="sets"><b>n</b></span> Starting zone</div></td></tr>`
    + `<tr>${side(h)}<td class="kill"><table>${block('1st Attack AFTER POSITIVE RECEPTION (+#)', 'pos')}${block('1st Attack AFTER NEGATIVE RECEPTION (-!)', 'neg')}${block('Attack on dig', 'dig')}</table></td>${side(v).split('</td>').reverse().filter(Boolean).map(x => `${x}</td>`).join('')}</tr></table>`
}

export function reportHtml(r: MatchReport): string {
  if (r.matches) return severalHtml(r)
  const [h, v] = r.teams, info = r.info, more = info?.more
  const sets = (info?.sets ?? []).map((s, i) => `<tr><td>${i + 1}</td><td>${s.minutes ? `0:${String(s.minutes).padStart(2, '0')}` : ''}</td><td>${s.partials.join(' ')}</td><td><b>${s.score}</b></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Match report</title><style>${CSS}</style></head><body><div class="page">
<header><div><div class="date">${dateOf(r.date)}</div><h1>Match report</h1></div></header>
<section class="top"><div class="score"><div class="teams"><span>${esc(h.name)}</span><b>${h.setsWon}</b><b>${v.setsWon}</b><span>${esc(v.name)}</span></div>
<div class="meta"><div><span class="muted">Hall</span> ${esc(more?.hall ?? '')}</div><div><span class="muted">Date</span> ${dateOf(r.date)}</div><div><span class="muted">Spectators</span> ${esc(more?.spectators ?? '')}</div>
<div><span class="muted">City</span> ${esc(more?.city ?? '')}</div><div><span class="muted">Time</span> ${esc(r.time ?? '')}</div><div><span class="muted">Referees</span> ${esc(more?.referees ?? '')}</div></div></div>
<table class="sets-table"><tr><th>Set</th><th>Duration</th><th>Partial score</th><th>Score</th></tr>${sets}</table></section>
${teamTable(h, false)}${teamTable(v, false)}${summary(r)}
</div></body></html>`
}

// One team over several matches: their results at the top, the team's players (with the share of
// the sets they played) and a row per match, the opponents' rows, and how the team scored.
function severalHtml(r: MatchReport): string {
  const [h, v] = r.teams, ms = r.matches!
  const rows = ms.map(m => `<tr><td>${dateOf(m.date)}</td><td class="lbl">${esc(m.label)}</td><td><b class="${m.won ? 'win' : 'loss'}">${m.score}</b></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Team report</title><style>${CSS}</style></head><body><div class="page">
<header><div><div class="date">${ms.length} ${ms.length === 1 ? 'match' : 'matches'}</div><h1>Team report</h1></div></header>
<section class="top"><div class="score"><div class="teams"><span>${esc(h.name)}</span><b>${h.setsWon}</b><b>${v.setsWon}</b><span class="muted">Won – Lost</span></div></div>
<table class="sets-table"><tr><th>Date</th><th>Match</th><th>Sets</th></tr>${rows}</table></section>
${teamTable(h, true)}${teamTable(v, true)}${summary(r)}
</div></body></html>`
}

const CSS = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 8.6px/1.35 "Segoe UI", "Yu Gothic UI", "Hiragino Sans", Arial, sans-serif; color: #0F172A; background: #FFFFFF; }
.page { width: 194mm; margin: 0 auto; padding: 4mm 0; }
header .date { font-size: 10px; } h1 { margin: 0 0 4px; font-size: 17px; }
.muted { color: #64748B; }
.top { display: grid; grid-template-columns: 1fr 64mm; gap: 6px; background: #F1F5F9; padding: 6px; border-radius: 4px; margin-bottom: 8px; }
.teams { display: grid; grid-template-columns: 1fr auto auto 1fr; gap: 10px; align-items: center; font-size: 12px; font-weight: 600; text-align: center; padding: 4px 0 8px; border-bottom: 1px solid #CBD5E1; }
.teams b { font-size: 20px; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 10px; padding-top: 6px; }
.sets-table { border-collapse: collapse; width: 100%; } .sets-table th, .sets-table td { padding: 1px 4px; text-align: center; border-bottom: 1px solid #E2E8F0; }
.sets-table td:last-child b { color: #2563EB; } .sets-table b.win { color: #2563EB; } .sets-table b.loss { color: #DC2626; } .sets-table td.lbl { text-align: left; }
table.team { width: 100%; border-collapse: collapse; margin-bottom: 8px; border: 1px solid #CBD5E1; }
table.team th, table.team td { padding: 1px 3px; text-align: center; white-space: nowrap; }
table.team .name { text-align: left; width: 34mm; max-width: 34mm; overflow: hidden; text-overflow: ellipsis; }
table.team tr.h1 th { background: #F1F5F9; font-size: 9px; } table.team tr.h1 th.name { font-size: 10.5px; white-space: normal; line-height: 1.15; }
table.team tr.h2 th { background: #F1F5F9; font-weight: 500; color: #475569; border-bottom: 1px solid #CBD5E1; }
table.team td.g, table.team th.g { border-left: 1px solid #E2E8F0; }
table.team tr:nth-child(even):not(.total):not(.set) td { background: #FAFBFC; }
.no { display: inline-block; width: 16px; } .lib { display: inline-block; width: 10px; font-weight: 700; }
.sets { display: inline-flex; gap: 1px; } .sets b, .sets i, .sets em { display: inline-block; width: 11px; height: 11px; line-height: 10px; font-size: 8px; font-style: normal; text-align: center; }
.sets b { border: 1px solid #64748B; background: #E2E8F0; } .sets b.sub { background: #FFFFFF; } .sets em { color: #475569; }
tr.total td { font-weight: 700; border-top: 1px solid #94A3B8; border-bottom: 1px solid #94A3B8; }
tr.set td { color: #334155; } td.won { text-align: left !important; } td.won b { display: inline-block; width: 32px; } td.won span { display: inline-block; width: 22px; text-align: center; }
tr.sethead td.won span { color: #64748B; } tr.sethead td.won { color: #475569; }
table.summary { width: 100%; border-collapse: collapse; background: #F8FAFC; border: 1px solid #CBD5E1; }
table.summary > tbody > tr > th { background: #E2E8F0; padding: 3px; font-size: 10px; }
table.summary td { vertical-align: top; padding: 4px; }
td.rot div { display: flex; gap: 12px; } td.rot span:first-child { width: 10px; }
td.eff div { display: flex; justify-content: space-between; gap: 8px; } td.eff .muted { display: block; } .gap { margin-top: 8px; }
td.kill table { width: 100%; border-collapse: collapse; } td.kill td { text-align: center; padding: 0 2px; }
th.kt { font-size: 9px; padding-top: 4px; } tr.kh td { color: #64748B; } tr.kv td { font-weight: 600; }
td.legend { font-size: 8px; width: 30mm; border-left: 1px solid #CBD5E1; } td.legend b { display: inline-block; min-width: 26px; margin-right: 3px; }
`
