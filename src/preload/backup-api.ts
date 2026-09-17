import type { z } from 'zod'
import { ipcChannels } from '@shared/ipc/channels'
import { createIpcFailure } from '@shared/ipc/result'
import {
  backupActionResultSchema,
  backupRequestSchema,
  restoreCommitRequestSchema,
  restoreTokenRequestSchema,
  type BackupActionResult,
  type BackupApi
} from '@shared/ipc/backup-contracts'
import type { IpcInvoke } from './health-screening-api'

export function createBackupApi(invoke: IpcInvoke): BackupApi {
  function action<T>(channel: string, schema: z.ZodType<T>) {
    return async (request: T): Promise<BackupActionResult> => {
      try {
        const parsed = schema.safeParse(request)
        if (!parsed.success) return createIpcFailure('VALIDATION_FAILED')
        const result = backupActionResultSchema.safeParse(await invoke(channel, parsed.data))
        return result.success ? result.data : createIpcFailure('IPC_UNAVAILABLE')
      } catch {
        return createIpcFailure('IPC_UNAVAILABLE')
      }
    }
  }
  return Object.freeze({
    create: action(ipcChannels.backups.create, backupRequestSchema),
    inspect: action(ipcChannels.backups.inspect, backupRequestSchema),
    prepareRestore: action(ipcChannels.backups.prepareRestore, backupRequestSchema),
    restore: action(ipcChannels.backups.restore, restoreCommitRequestSchema),
    discardRestore: action(ipcChannels.backups.discardRestore, restoreTokenRequestSchema)
  })
}
