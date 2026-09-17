import type { z } from 'zod'
import type { BackupService } from '@main/application/backups/backup-service'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcFailure, createIpcSuccess } from '@shared/ipc/result'
import {
  backupActionResultSchema,
  backupRequestSchema,
  restoreCommitRequestSchema,
  restoreTokenRequestSchema,
  type BackupActionData,
  type BackupActionResult
} from '@shared/ipc/backup-contracts'

export interface BackupIpcDependencies {
  navigationPolicy: NavigationPolicy
  service: BackupService
}
export function createBackupHandlers({
  navigationPolicy,
  service
}: BackupIpcDependencies): Record<
  keyof BackupService,
  (event: IpcSenderValidationEvent, request: unknown) => Promise<BackupActionResult>
> {
  function handler<T>(schema: z.ZodType<T>, action: (request: T) => Promise<BackupActionData>) {
    return async (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<BackupActionResult> => {
      if (!isIpcSenderAllowed(event, navigationPolicy)) return createIpcFailure('IPC_FORBIDDEN')
      try {
        const parsed = schema.safeParse(request)
        if (!parsed.success) return createIpcSuccess({ status: 'VALIDATION_FAILED' })
        return backupActionResultSchema.parse(createIpcSuccess(await action(parsed.data)))
      } catch {
        return createIpcSuccess({ status: 'UNAVAILABLE' })
      }
    }
  }
  return Object.freeze({
    create: handler(backupRequestSchema, service.create),
    inspect: handler(backupRequestSchema, service.inspect),
    prepareRestore: handler(backupRequestSchema, service.prepareRestore),
    restore: handler(restoreCommitRequestSchema, service.restore),
    discardRestore: handler(restoreTokenRequestSchema, service.discardRestore)
  })
}
