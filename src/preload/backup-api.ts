import { ipcChannels } from '@shared/ipc/channels'
import { createIpcFailure } from '@shared/ipc/result'
import {
  backupActionResultSchema,
  backupRequestSchema,
  type BackupActionResult,
  type BackupApi,
  type BackupRequest
} from '@shared/ipc/backup-contracts'
import type { IpcInvoke } from './health-screening-api'

export function createBackupApi(invoke: IpcInvoke): BackupApi {
  async function action(channel: string, request: BackupRequest): Promise<BackupActionResult> {
    try {
      const parsed = backupRequestSchema.safeParse(request)
      if (!parsed.success) return createIpcFailure('VALIDATION_FAILED')
      const result = backupActionResultSchema.safeParse(await invoke(channel, parsed.data))
      return result.success ? result.data : createIpcFailure('IPC_UNAVAILABLE')
    } catch {
      return createIpcFailure('IPC_UNAVAILABLE')
    }
  }
  return Object.freeze({
    create: (request: BackupRequest) => action(ipcChannels.backups.create, request),
    inspect: (request: BackupRequest) => action(ipcChannels.backups.inspect, request)
  })
}
