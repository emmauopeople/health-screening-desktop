import { contextBridge, ipcRenderer } from 'electron'

import { createHealthScreeningApi } from '@preload/api'

const healthScreeningApi = createHealthScreeningApi((channel, request) =>
  ipcRenderer.invoke(channel, request)
)

try {
  contextBridge.exposeInMainWorld('healthScreening', healthScreeningApi)
} catch (error) {
  console.error(error)
}
