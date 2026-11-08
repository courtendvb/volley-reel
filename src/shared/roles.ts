// Player positions: from the DVW's roster, or set by hand in the project (ProjectSettings.roles)
// for rosters that don't say or say wrong. Keyed by the player key (Player.key, PlayRef.personKey).
import type { PlayerRole } from './types'
import { t } from './i18n'

export const ROLES: PlayerRole[] = ['OH', 'OP', 'MB', 'S', 'L']

export const roleName = (r: PlayerRole | null | undefined): string =>
  r === 'OH' ? t('アウトサイドヒッター') : r === 'OP' ? t('オポジット') : r === 'MB' ? t('ミドルブロッカー') : r === 'S' ? t('セッター') : r === 'L' ? t('リベロ') : t('その他')

// A project's positions read back from project.json: only known positions under string keys.
export function cleanRoles(v: unknown): Record<string, PlayerRole> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, PlayerRole> = {}
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) if (k && ROLES.includes(r as PlayerRole)) out[k] = r as PlayerRole
  return Object.keys(out).length ? out : undefined
}
