// Which app this is: the one that is sold, or the team's own (src/internal/README.md). The installers
// carry the same names (electron-builder.yml, electron-builder.internal.yml).
export const APP_NAME = __INTERNAL__ ? 'SyncScout Video Editor Internal' : 'SyncScout Video Editor'

// What a lease's apps (shared/account.ts) carry for an account allowed the internal edition's features.
// The server puts it there for the teams it allows; without it the internal edition looks and works
// as the sold one, and says nothing about it.
export const INTERNAL_APP = 'editor-internal'
