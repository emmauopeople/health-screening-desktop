import type { IpcMain } from 'electron'

import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import { ipcChannels } from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void

export function registerApplicationIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: AppIpcHandlerDependencies
): ApplicationIpcDisposer {
  disposeApplicationIpcHandlers(applicationIpcMain)

  const handlers = createAppIpcHandlers(dependencies)

  applicationIpcMain.handle(ipcChannels.app.getInfo, handlers.getInfo)
  applicationIpcMain.handle(ipcChannels.app.getHealth, handlers.getHealth)

  return () => {
    disposeApplicationIpcHandlers(applicationIpcMain)
  }
}

export function disposeApplicationIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  applicationIpcMain.removeHandler(ipcChannels.app.getInfo)
  applicationIpcMain.removeHandler(ipcChannels.app.getHealth)
}
