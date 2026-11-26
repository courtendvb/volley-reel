// The league the インサイト dialog sets a team's habits beside (shared/insightSituations.ts leagueOf):
// the other teams of the season in the library, each in the matches it played. Loaded when it is
// first wanted (reading every match of the season takes a few seconds) and kept until the library,
// the season or the project's team changes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildRefs } from '../../../shared/filter'
import { leagueOf, type League } from '../../../shared/insights'
import { presetLookups } from '../../../shared/presets'
import type { LibraryInfo, Match, ParsedDVW, ProjectSettings } from '../../../shared/types'

const api = window.api

export type LeagueStatus = 'off' | 'loading' | 'ready' | 'none'

// A volleyball season runs from summer to summer: a date's season is the year it began (July on).
const seasonOf = (date: string | null): number | null => {
  const m = date && /^(\d{4})-(\d{2})/.exec(date)
  return m ? (+m[2] >= 7 ? +m[1] : +m[1] - 1) : null
}

// want: the dialog wants the league now. projectMatches: the matches searched (the season is theirs).
export function useLeague(want: boolean, library: LibraryInfo | null, projectMatches: Match[], settings: ProjectSettings | null): { league: League | null; status: LeagueStatus } {
  const season = useMemo(() => Math.max(-1, ...projectMatches.map(m => seasonOf(m.date) ?? -1)), [projectMatches])
  const own = settings?.ourTeamCodes ?? []
  // The season's matches in the library with a team other than the project's.
  const matches = useMemo(() => (library?.matches ?? []).filter(m => seasonOf(m.date) === season && m.teams.some(tm => !own.includes(tm.code))), [library, season, own.join('|')])
  const key = `${season}|${own.join(',')}|${matches.map(m => m.id).sort().join(',')}`
  const [state, setState] = useState<{ key: string; league: League | null; status: LeagueStatus }>({ key: '', league: null, status: 'off' })
  const parsed = useRef(new Map<string, ParsedDVW>())

  useEffect(() => {
    if (!want || !settings || state.key === key) return
    let gone = false
    setState({ key, league: null, status: 'loading' })
    void (async () => {
      const dvws: Record<string, ParsedDVW> = {}
      for (const m of matches) {
        try { dvws[m.id] = parsed.current.get(m.id) ?? await api.parseMatch(m.id); parsed.current.set(m.id, dvws[m.id]) } catch { /* a match that can't be read stays out */ }
        if (gone) return
      }
      const read = matches.filter(m => dvws[m.id]).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      const codes = [...new Set(read.flatMap(m => m.teams.map(tm => tm.code)))].filter(c => !own.includes(c))
      // Let the dialog show it is loading before the work that follows.
      await new Promise(r => setTimeout(r, 0))
      const teams = codes.map(code => {
        const ms = read.filter(m => m.teams.some(tm => tm.code === code))
        return { scope: ms.flatMap(m => buildRefs(m.id, dvws[m.id], { ...settings, ourTeamCodes: [code] }, m.court)), look: presetLookups(dvws, settings.roles, ms.map(m => m.id)) }
      })
      const league = teams.length ? leagueOf(teams, read.length) : null
      if (!gone) setState({ key, league, status: league && league.shift.size ? 'ready' : 'none' })
    })()
    return () => { gone = true }
  }, [want, key, settings])

  return state.key === key ? { league: state.league, status: state.status } : { league: null, status: want ? 'loading' : 'off' }
}
