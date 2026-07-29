import type { App } from 'electron'

import type { AppHealth, AppInfo } from '@shared/ipc'

export interface ApplicationInfoProvider {
  getVersion(): string
  getPlatform(): string
  getArchitecture(): string
  isPackaged(): boolean
}

export function createElectronApplicationInfoProvider(
  application: Pick<App, 'getVersion' | 'isPackaged'>,
  runtime: Pick<NodeJS.Process, 'platform' | 'arch'> = process
): ApplicationInfoProvider {
  return {
    getVersion: () => application.getVersion(),
    getPlatform: () => runtime.platform,
    getArchitecture: () => runtime.arch,
    isPackaged: () => application.isPackaged
  }
}

export function getApplicationInfo(provider: ApplicationInfoProvider): AppInfo {
  return {
    applicationName: 'Health Screening Offline Desktop',
    applicationVersion: provider.getVersion(),
    platform: provider.getPlatform(),
    architecture: provider.getArchitecture(),
    packaged: provider.isPackaged()
  }
}

export function getApplicationHealth(): AppHealth {
  return {
    status: 'ready',
    ipc: 'available',
    database: 'not-configured',
    clinicalFeatures: 'not-implemented'
  }
}
