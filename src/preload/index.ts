import { contextBridge } from 'electron'
import { getApplicationStatus, type HealthScreeningApi } from '@shared/contracts/bootstrap'

const healthScreeningApi: HealthScreeningApi = {
  getApplicationStatus
}

try {
  contextBridge.exposeInMainWorld('healthScreening', healthScreeningApi)
} catch (error) {
  console.error(error)
}
