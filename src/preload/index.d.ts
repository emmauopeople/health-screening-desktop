import type { HealthScreeningApi } from '@shared/ipc'

declare global {
  interface Window {
    healthScreening: HealthScreeningApi
  }
}

export {}
