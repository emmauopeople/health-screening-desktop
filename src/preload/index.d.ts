import type { HealthScreeningApi } from '../shared/contracts/bootstrap'

declare global {
  interface Window {
    healthScreening: HealthScreeningApi
  }
}

export {}
