import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { createHealthScreeningApi } from '@preload/api'

const healthScreeningApi = createHealthScreeningApi(
  (channel, request): Promise<unknown> => ipcRenderer.invoke(channel, request),
  (channel, listener): (() => void) => {
    const subscription = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload)
    }

    ipcRenderer.on(channel, subscription)

    return (): void => {
      ipcRenderer.removeListener(channel, subscription)
    }
  }
)

try {
  contextBridge.exposeInMainWorld('healthScreening', healthScreeningApi)
} catch (error) {
  console.error(error)
}
