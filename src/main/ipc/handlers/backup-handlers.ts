import type { BackupService } from '@main/application/backups/backup-service'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcFailure, createIpcSuccess } from '@shared/ipc/result'
import {
  backupActionResultSchema,
  backupRequestSchema,
  type BackupActionResult
} from '@shared/ipc/backup-contracts'

export interface BackupIpcDependencies {
  navigationPolicy: NavigationPolicy
  service: BackupService
}
export function createBackupHandlers({ navigationPolicy, service }: BackupIpcDependencies): {
  create(event: IpcSenderValidationEvent, request: unknown): Promise<BackupActionResult>
  inspect(event: IpcSenderValidationEvent, request: unknown): Promise<BackupActionResult>
} {
  async function handle(
    event: IpcSenderValidationEvent,
    request: unknown,
    method: 'create' | 'inspect'
  ): Promise<BackupActionResult> {
    if (!isIpcSenderAllowed(event, navigationPolicy)) return createIpcFailure('IPC_FORBIDDEN')
    try {
      const parsed = backupRequestSchema.safeParse(request)
      if (!parsed.success) return createIpcSuccess({ status: 'VALIDATION_FAILED' })
      return backupActionResultSchema.parse(createIpcSuccess(await service[method](parsed.data)))
    } catch {
      return createIpcSuccess({ status: 'UNAVAILABLE' })
    }
  }
  return Object.freeze({
    create: (event: IpcSenderValidationEvent, request: unknown) => handle(event, request, 'create'),
    inspect: (event: IpcSenderValidationEvent, request: unknown) =>
      handle(event, request, 'inspect')
  })
}
