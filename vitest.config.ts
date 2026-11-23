import { defineConfig } from 'vitest/config'

// The tests cover both editions' code: the internal edition's is in them too.
export default defineConfig({ define: { __INTERNAL__: 'true', __UPDATE_TOKEN__: '""' } })
