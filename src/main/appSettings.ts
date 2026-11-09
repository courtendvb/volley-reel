// This computer's settings for the app (settings.json in the user data folder): where the library
// is, the recent projects, the interface language. A self-check never writes them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RecentProject } from '../shared/types'
import type { Lang } from '../shared/i18n'
import type { Project } from './project'

export interface AppSettings { libraryPath?: string; recentProjects?: RecentProject[]; lang?: Lang }

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function readSettings(): AppSettings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}

export function saveSettings(patch: Partial<AppSettings>): void {
  if (process.env.VR_SMOKE) return // smoke runs never touch the user's settings
  writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

export function recentProjects(): RecentProject[] {
  return (readSettings().recentProjects ?? []).filter(p => existsSync(join(p.path, 'project.json')))
}

export function rememberProject(p: Project): void {
  const rest = recentProjects().filter(r => r.path.toLowerCase() !== p.dir.toLowerCase())
  saveSettings({ recentProjects: [{ path: p.dir, name: p.name, openedAt: new Date().toISOString() }, ...rest].slice(0, 12) })
}
