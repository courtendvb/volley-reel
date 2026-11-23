import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Two editions from the same code (src/internal/README.md): VR_EDITION=internal builds the team's own app,
// anything else the one that is sold. __INTERNAL__ is a constant at build time, so in the sold app the
// code behind `if (__INTERNAL__)` is not there at all (scripts/edition-guard.mjs checks).
const INTERNAL = process.env.VR_EDITION === 'internal'
const define = { __INTERNAL__: JSON.stringify(INTERNAL) }
// The internal edition's updates come from a private repository (src/main/updater.ts): a token that may
// only read it, from the environment of the computer that builds, never from the repository. The sold
// edition gets none.
const UPDATE_TOKEN = INTERNAL ? process.env.VR_INTERNAL_UPDATE_TOKEN ?? '' : ''
// Whom its features open for: the accounts' email addresses, from the building computer's environment too
// (VR_INTERNAL_EMAILS, separated by commas), so they are in neither the repository nor the sold edition.
const INTERNAL_EMAILS = INTERNAL ? (process.env.VR_INTERNAL_EMAILS ?? '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : []

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { ...define, __UPDATE_TOKEN__: JSON.stringify(UPDATE_TOKEN), __INTERNAL_EMAILS__: JSON.stringify(INTERNAL_EMAILS) } },
  preload: { plugins: [externalizeDepsPlugin()], define },
  renderer: { plugins: [react()], define },
})
