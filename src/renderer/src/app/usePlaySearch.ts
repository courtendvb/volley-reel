// The left list: every match's plays as search rows, the ones in scope (the picked matches, or all
// when none is picked, in the chosen match order), and what the filter leaves of them.
import { useMemo } from 'react'
import { applyFilter, buildRefs, detailOptions, listPeople, type PlayFilter, type PlayRef } from '../../../shared/filter'
import type { ParsedDVW, ProjectInfo } from '../../../shared/types'
import { labelMatches } from './appState'

export function usePlaySearch(project: ProjectInfo | null, dvws: Record<string, ParsedDVW>, matchIds: string[], matchOrder: 'old' | 'new', filter: PlayFilter) {
  const settings = project?.settings
  const refsByMatch = useMemo(() => {
    const out: Record<string, PlayRef[]> = {}
    if (settings) for (const m of project!.matches) if (dvws[m.id]) out[m.id] = buildRefs(m.id, dvws[m.id], settings, m.court)
    return out
  }, [dvws, settings, project])

  const scopeRefs = useMemo(() => {
    const ms = (project?.matches ?? []).filter(m => !matchIds.length || matchIds.includes(m.id)) // oldest first
    return (matchOrder === 'new' ? [...ms].reverse() : ms).flatMap(m => refsByMatch[m.id] ?? [])
  }, [matchIds, refsByMatch, project, matchOrder])
  const results = useMemo(() => applyFilter(scopeRefs, filter), [scopeRefs, filter])
  const people = useMemo(() => listPeople(scopeRefs), [scopeRefs])
  // Detailed search choices: those found in the plays in scope (of the chosen skills, when any).
  const details = useMemo(() => detailOptions(filter.skills.length ? scopeRefs.filter(r => filter.skills.includes(r.play.skill)) : scopeRefs), [scopeRefs, filter.skills])
  const teamFilterLimited = useMemo(() => scopeRefs.some(r => r.teamRole === null), [scopeRefs])
  const dirUnknown = useMemo(() => scopeRefs.filter(r => r.dir === null).length, [scopeRefs])
  // Where each match comes in the play list (old or new matches first): clips without a marker, and
  // clips just marked, go in this order too, so the scene reads like the list it was picked from.
  const matchRank = useMemo(() => {
    const ms = project?.matches ?? [] // oldest first
    const list = matchOrder === 'new' ? [...ms].reverse() : ms
    return Object.fromEntries(list.map((m, i) => [m.id, String(i).padStart(4, '0')]))
  }, [project, matchOrder])
  const matchLabels = useMemo(() => labelMatches(project?.matches ?? [], settings?.ourTeamCodes ?? []), [project, settings])

  return { refsByMatch, scopeRefs, results, people, details, teamFilterLimited, dirUnknown, matchRank, matchLabels }
}
