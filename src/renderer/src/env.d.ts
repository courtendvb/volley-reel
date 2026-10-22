/// <reference types="vite/client" />
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
    __smoke: (opts: { play: number; filter: object | null; scope: 'match' | 'all'; settings?: boolean }) => Promise<unknown>
  }
}
