/// <reference types="vite/client" />
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
    // Dev-only hook the main process calls with a JSON options object (see smoke.ts SmokeOpts).
    __smoke: (opts: never) => Promise<unknown>
  }
}
