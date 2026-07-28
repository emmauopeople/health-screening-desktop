import { contextBridge } from 'electron'
import { applicationStatus, type HealthScreeningApi } from '../shared/contracts/bootstrap'

const healthScreeningApi: HealthScreeningApi = {
  getApplicationStatus: () => ({ ...applicationStatus })
}

try {
  contextBridge.exposeInMainWorld('healthScreening', healthScreeningApi)
} catch (error) {
  console.error(error)
}
