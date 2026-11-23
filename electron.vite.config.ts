import { createHash } from 'node:crypto'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Whom the team's own features open for (src/internal/README.md): the accounts' email addresses, from the
// building computer's environment (VR_INTERNAL_EMAILS, separated by commas), never from the repository.
// Only their hashes go into the app, which anyone can download and open.
const INTERNAL_EMAIL_HASHES = (process.env.VR_INTERNAL_EMAILS ?? '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  .map(s => createHash('sha256').update(s).digest('hex'))

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __INTERNAL_EMAIL_HASHES__: JSON.stringify(INTERNAL_EMAIL_HASHES) } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
})
