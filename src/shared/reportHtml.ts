// The match report as one A4 page of HTML, for the screen and for the PDF alike, laid out like a
// scouting program's report: the match and its sets, each team's players and set totals, and how each
// team scored (side-out, break points, rotations, the first attack after reception and after a dig).
import { pct, per, type AttackLine, type MatchReport, type PlayerLine, type SetLine, type StatLine, type TeamReport } from './report'
import { ourSide, type PlayFilter } from './filter'
import type { ParsedDVW, Side } from './types'

// On screen a number can be clicked to show its plays in the play list: its element carries the
// search (data-f, JSON of a ReportPick): the matches, and the conditions on top of an empty filter. The PDF has none.
export interface ReportPick { m: string[]; f: Partial<PlayFilter> }
// Each team's plays as a search (null: the team can't be told apart, e.g. neither team is the
// target), and which rotation condition is that team's.
export interface TeamLink { pick: Partial<PlayFilter> | null; rot: 'rots' | 'oppRots' }
export interface ReportLinks { matchIds: string[]; teams: [TeamLink, TeamLink]; rowMatches?: string[] } // rowMatches: several matches, each row's match
// A row's search (null: it can't be searched), and the attribute for one of its numbers.
type Ctx = ReportPick | null
type Mk = (f: Partial<PlayFilter> | null) => string
const maker = (ctx: Ctx): Mk => f => (ctx && f ? ` data-f="${esc(JSON.stringify({ m: ctx.m, f: { ...ctx.f, ...f } }))}"` : '')
const none: Mk = () => ''
// A cell, clickable unless it has nothing in it.
const td = (text: string, mk: Mk, f: Partial<PlayFilter> | null, cls = '') => `<td${cls ? ` class="${cls}"` : ''}${text === '.' || text === '' ? '' : mk(f)}>${text}</td>`
const SAB = { skills: ['S', 'A', 'B'], effects: ['#'] }

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

// The stat columns shared by players, totals and sets. mk: the row's search, for the numbers that
// are plays of one kind (break points, W-L, possibilities and BP% are not, and stay plain).
function cells(l: StatLine, points = true, mk: Mk = none): string {
  const r = l.rec, a = l.att
  return `${points ? `${td(n(l.points), mk, SAB)}<td>${n(l.bp)}</td><td>${signed(l.wl)}</td>` : ''}`
    + `${td(n(l.serve.tot), mk, { skills: ['S'] }, 'g')}${td(n(l.serve.err), mk, { skills: ['S'], effects: ['='] })}${td(n(l.serve.pts), mk, { skills: ['S'], effects: ['#'] })}<td>${n(l.serve.poss)}</td><td>${l.serve.tot ? pct(l.serve.brk, l.serve.tot) : '.'}</td>`
    + `${td(n(r.tot), mk, { skills: ['R'] }, 'g')}${td(n(r.err), mk, { skills: ['R'], effects: ['='] })}${td(n(r.ovr), mk, { skills: ['R'], effects: ['/'] })}${td(r.tot ? `${pct(r.pos, r.tot)} (${pct(r.exc, r.tot)})` : '.', mk, r.pos ? { skills: ['R'], effects: ['#', '+'] } : null, 'w')}`
    + `${td(n(a.tot), mk, { skills: ['A'] }, 'g')}${td(n(a.err), mk, { skills: ['A'], effects: ['='] })}${td(n(a.blo), mk, { skills: ['A'], effects: ['/'] })}${td(n(a.pts), mk, { skills: ['A'], effects: ['#'] })}${td(a.tot ? pct(a.pts, a.tot) : '.', mk, a.pts ? { skills: ['A'], effects: ['#'] } : null)}`
    + td(n(l.blk), mk, { skills: ['B'], effects: ['#'] }, 'g')
}

// A team's plays as a row's search (null when the team can't be told apart); m: other matches than the report's.
const teamCtx = (links: ReportLinks | undefined, i: 0 | 1, m?: string[]): Ctx => (links?.teams[i].pick ? { m: m ?? links.matchIds, f: links.teams[i].pick! } : null)

// several: a report of several matches: the share of the team's rallies each was on court for in place of the boxes.
function teamTable(t: TeamReport, several: boolean, i: 0 | 1, links?: ReportLinks): string {
  const head = `<tr class="h1"><th class="name" rowspan="2">${esc(t.name)}</th><th>${several ? 'Played' : 'Set'}</th><th colspan="3">Points</th><th colspan="5" class="g">Serve</th><th colspan="4" class="g">Reception</th><th colspan="5" class="g">Attack</th><th class="g">BK</th></tr>`
    + `<tr class="h2"><th>${several ? 'Rallies%' : `<span class="sets">${[1, 2, 3, 4, 5].map(s => `<em>${s}</em>`).join('')}</span>`}</th><th>Tot</th><th>BP</th><th>W-L</th><th class="g">Tot</th><th>Err</th><th>Pts</th><th>Poss</th><th>BP%</th><th class="g">Tot</th><th>Err</th><th>Ovr</th><th>Pos% (Exc%)</th><th class="g">Tot</th><th>Err</th><th>Blo</th><th>Pts</th><th>Pts%</th><th class="g">Pts</th></tr>`
  const rows = t.players.map(p => `<tr><td class="name"><span class="no">${String(p.jersey).padStart(2, '0')}</span>${p.libero ? '<span class="lib">L</span>' : '<span class="lib"></span>'}${esc(p.name)}</td><td>${p.played ? playedCell(p) : setBoxes(p.sets)}</td>${cells(p, true, links ? maker({ m: links.matchIds, f: { persons: [p.key] } }) : none)}</tr>`).join('')
  const total = `<tr class="total"><td class="name">Players total</td><td></td>${cells(t.total, true, maker(teamCtx(links, i)))}</tr>`
  const setHead = `<tr class="h2 sethead"><td class="name"></td><td colspan="4" class="won">Points won <span>Ser</span><span>Atk</span><span>Blo</span><span>Op.Er</span></td><td colspan="18"></td></tr>`
  // A set's row has the coaches beside it; a match's (several matches) its opponent.
  const staff = (i: number) => (i === 0 && t.coach ? `<span class="muted">Coach</span> ${esc(t.coach)}` : i === 1 && t.assistant ? `<span class="muted">Assistant</span> ${esc(t.assistant)}` : '')
  // A set's row searches that set; a match's row (several matches) that match.
  const rowMk = (s: SetLine, k: number): Mk => {
    const ctx = teamCtx(links, i, links?.rowMatches ? [links.rowMatches[k]] : undefined)
    return maker(ctx && !links?.rowMatches ? { ...ctx, f: { ...ctx.f, sets: [s.set] } } : ctx)
  }
  const span = (v: number, mk: Mk, f: Partial<PlayFilter>) => `<span${v ? mk(f) : ''}>${n(v)}</span>`
  const setRow = (s: SetLine, k: number) => {
    const mk = rowMk(s, k)
    return `<tr class="set"><td class="name">${s.label ? esc(s.label) : staff(k)}</td>`
      + `<td colspan="4" class="won"><b>${s.label ? '' : `Set ${s.set}`}</b>${span(s.won.ser, mk, { skills: ['S'], effects: ['#'] })}${span(s.won.atk, mk, { skills: ['A'], effects: ['#'] })}${span(s.won.blo, mk, { skills: ['B'], effects: ['#'] })}<span>${n(s.won.opErr)}</span></td>${cells(s, false, mk)}</tr>`
  }
  return `<table class="team">${head}${rows}${total}${setHead}${t.sets.map(setRow).join('')}</table>`
}

// The first attacks of a kind (f): the errors, the blocked, the kills and all of them.
const attackRow = (a: AttackLine, mk: Mk, f: Partial<PlayFilter>) => {
  const at = (v: number, effects?: string[]) => (v ? mk({ skills: ['A'], ...f, ...(effects ? { effects } : {}) }) : '')
  return `<td${at(a.err, ['='])}>${a.err}</td><td${at(a.blo, ['/'])}>${a.blo}</td><td${at(a.pts, ['#'])}>${pct(a.pts, a.tot) || '–'}</td><td${at(a.tot)}>${a.tot}</td>`
}
const KILL: Record<'pos' | 'neg' | 'dig', Partial<PlayFilter>> = { pos: { phase: 'reception', recEffects: ['#', '+'] }, neg: { phase: 'reception', recEffects: ['-', '!'] }, dig: { phase: 'transition' } }

function summary(r: MatchReport, links?: ReportLinks): string {
  const [h, v] = r.teams
  const mkOf = (i: 0 | 1) => maker(teamCtx(links, i))
  // A rotation's plays, whichever team made them.
  const rotMk = (i: 0 | 1, rot: number) => (links ? maker({ m: links.matchIds, f: { [links.teams[i].rot]: [rot] } })({}) : '')
  const side = (t: TeamReport, i: 0 | 1) => `<td class="rot"><div class="muted">Points<br>S in Diff</div>${t.rotations.map(x => `<div${rotMk(i, x.rot)}><span>${x.rot}</span><span>${signed(x.diff) === '.' ? '0' : signed(x.diff)}</span></div>`).join('')}</td>`
    + `<td class="eff"><div>Reception <b${t.so.receptions ? mkOf(i)({ skills: ['R'] }) : ''}>${t.so.receptions}</b></div><div>Points SO <b>${t.so.points}</b></div><div class="muted">Each ${per(t.so.receptions, t.so.points)} receptions<br>1 point</div>`
    + `<div class="gap">Serve <b${t.bp.serves ? mkOf(i)({ skills: ['S'] }) : ''}>${t.bp.serves}</b></div><div>Points BP <b>${t.bp.points}</b></div><div class="muted">Each ${per(t.bp.serves, t.bp.points)} serves<br>1 break point</div></td>`
  const block = (title: string, k: 'pos' | 'neg' | 'dig') => `<tr><th colspan="9" class="kt">${title}</th></tr>`
    + `<tr class="kh"><td>Errors</td><td>Blo</td><td>Pts%</td><td>Tot</td><td></td><td>Errors</td><td>Blo</td><td>Pts%</td><td>Tot</td></tr>`
    + `<tr class="kv">${attackRow(h.kill[k], mkOf(0), KILL[k])}<td></td>${attackRow(v.kill[k], mkOf(1), KILL[k])}</tr>`
  return `<table class="summary"><tr><th colspan="2">${esc(h.name)}</th><th>Kill on reception</th><th colspan="2">${esc(v.name)}</th><td rowspan="2" class="legend">`
    + `<div><b>BP</b> Break point</div><div><b>Err</b> Errors</div><div><b>Pos%</b> Positive +#</div><div><b>W-L</b> Won-Lost</div><div><b>Pts</b> Points</div><div><b>Blo</b> Blocked</div><div><b>Exc</b> Excellent</div><div><b>Poss</b> Possibility</div><div><b>Ovr</b> Overpass</div><div><b>BP%</b> Serve → point</div>${r.matches ? '<div><b>Rallies%</b> On court (L: sets)</div>' : ''}`
    + `<div class="gap"><span class="sets"><b class="sub"></b></span> Substitute</div><div><span class="sets"><b>n</b></span> Starting zone</div></td></tr>`
    + `<tr>${side(h, 0)}<td class="kill"><table>${block('1st Attack AFTER POSITIVE RECEPTION (+#)', 'pos')}${block('1st Attack AFTER NEGATIVE RECEPTION (-!)', 'neg')}${block('Attack on dig', 'dig')}</table></td>${side(v, 1).split('</td>').reverse().filter(Boolean).map(x => `${x}</td>`).join('')}</tr></table>`
}

// links: on screen, the plays behind each number (see ReportPick); left out for the PDF.
export function reportHtml(r: MatchReport, links?: ReportLinks): string {
  if (r.matches) return severalHtml(r, links)
  const [h, v] = r.teams, info = r.info, more = info?.more
  const sets = (info?.sets ?? []).map((s, i) => `<tr><td>${i + 1}</td><td>${s.minutes ? `0:${String(s.minutes).padStart(2, '0')}` : ''}</td><td>${s.partials.join(' ')}</td><td><b>${s.score}</b></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Match report</title><style>${CSS}</style></head><body><div class="page">
<header><div><div class="date">${dateOf(r.date)}</div><h1>Match report</h1></div></header>
<section class="top"><div class="score"><div class="teams"><span>${esc(h.name)}</span><b>${h.setsWon}</b><b>${v.setsWon}</b><span>${esc(v.name)}</span></div>
<div class="meta"><div><span class="muted">Hall</span> ${esc(more?.hall ?? '')}</div><div><span class="muted">Date</span> ${dateOf(r.date)}</div><div><span class="muted">Spectators</span> ${esc(more?.spectators ?? '')}</div>
<div><span class="muted">City</span> ${esc(more?.city ?? '')}</div><div><span class="muted">Time</span> ${esc(r.time ?? '')}</div><div><span class="muted">Referees</span> ${esc(more?.referees ?? '')}</div></div></div>
<table class="sets-table"><tr><th>Set</th><th>Duration</th><th>Partial score</th><th>Score</th></tr>${sets}</table></section>
${teamTable(h, false, 0, links)}${teamTable(v, false, 1, links)}${summary(r, links)}
</div></body></html>`
}

// One team over several matches: their results at the top, the team's players (with the share of
// the sets they played) and a row per match, the opponents' rows, and how the team scored.
function severalHtml(r: MatchReport, links?: ReportLinks): string {
  const [h, v] = r.teams, ms = r.matches!
  const rows = ms.map(m => `<tr><td>${dateOf(m.date)}</td><td class="lbl">${esc(m.label)}</td><td><b class="${m.won ? 'win' : 'loss'}">${m.score}</b></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Team report</title><style>${CSS}</style></head><body><div class="page">
<header><div><div class="date">${ms.length} ${ms.length === 1 ? 'match' : 'matches'}</div><h1>Team report</h1></div></header>
<section class="top"><div class="score"><div class="teams"><span>${esc(h.name)}</span><b>${h.setsWon}</b><b>${v.setsWon}</b><span class="muted">Won – Lost</span></div></div>
<table class="sets-table"><tr><th>Date</th><th>Match</th><th>Sets</th></tr>${rows}</table></section>
${teamTable(h, true, 0, links)}${teamTable(v, true, 1, links)}${summary(r, links)}
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
[data-f] { cursor: pointer; } [data-f]:hover { background: #DBEAFE !important; color: #1D4ED8; text-decoration: underline; }
td.legend { font-size: 8px; width: 30mm; border-left: 1px solid #CBD5E1; } td.legend b { display: inline-block; min-width: 26px; margin-right: 3px; }
`

// One match's report: each team by the target team's side, as the play list tells teams apart
// (filter.ts buildRefs). All-home input has only the home team's plays, so they need no team condition.
export function matchLinks(matchId: string, d: ParsedDVW, ourCodes: string[]): ReportLinks {
  const our = d.allHome ? null : ourSide(d.teams, ourCodes)
  const link = (s: Side): TeamLink => ({
    pick: our ? { team: s === our ? 'our' : 'opp' } : d.allHome && s === '*' ? {} : null,
    rot: (our ?? '*') === s ? 'rots' : 'oppRots', // with no target team the play list counts home's rotation as ours
  })
  return { matchIds: [matchId], teams: [link('*'), link('a')] }
}

// Several matches of the target team (matchIds: each row's, in order): the team, and its opponents.
export function seasonLinks(matchIds: string[]): ReportLinks {
  return { matchIds, rowMatches: matchIds, teams: [{ pick: { team: 'our' }, rot: 'rots' }, { pick: { team: 'opp' }, rot: 'oppRots' }] }
}
