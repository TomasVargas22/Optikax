import type { OptikaxApi } from '@shared/types'

declare global {
  interface Window {
    optikax: OptikaxApi
  }
}

export {}
