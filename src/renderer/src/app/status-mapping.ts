import type { AppHealth, AppInfo } from '@shared/ipc'

export type AppLoadState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo; health: AppHealth }
  | { status: 'error'; message: string }

export function getClinicalFeatureText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') return 'Loading'
  if (loadState.status === 'error') return 'Unavailable'
  return loadState.health.clinicalFeatures === 'not-implemented' ? 'Not implemented' : 'Unavailable'
}

export function getDatabaseText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') return 'Loading'
  if (loadState.status === 'error') return 'Unavailable'
  return loadState.health.database === 'ready' ? 'Ready' : 'Unavailable'
}

export function getIpcText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') return 'Loading'
  if (loadState.status === 'error') return 'Unavailable'
  return loadState.health.ipc === 'available' ? 'Available' : 'Unavailable'
}
