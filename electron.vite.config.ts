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

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { ...define, __UPDATE_TOKEN__: JSON.stringify(UPDATE_TOKEN) } },
  preload: { plugins: [externalizeDepsPlugin()], define },
  renderer: { plugins: [react()], define },
})
