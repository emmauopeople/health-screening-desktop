import type { z } from 'zod'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { CentralHistoryService } from '@main/application/central-history/central-history-service'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '../sender-policy'
import { createIpcFailure, createIpcSuccess } from '@shared/ipc/result'
import {
  centralHistoryReadRequestSchema,
  centralHistoryRefreshRequestSchema,
  centralHistoryReadResultSchema,
  centralHistoryRefreshResultSchema,
  type CentralHistoryReadResult,
  type CentralHistoryRefreshResult
} from '@shared/ipc/central-history-contracts'

export interface CentralHistoryIpcDependencies {
  navigationPolicy: NavigationPolicy
  service: CentralHistoryService
}
type HistoryHandler<T> = (event: IpcSenderValidationEvent, request: unknown) => Promise<T>
export function createCentralHistoryHandlers({
  navigationPolicy,
  service
}: CentralHistoryIpcDependencies): {
  read: HistoryHandler<CentralHistoryReadResult>
  refresh: HistoryHandler<CentralHistoryRefreshResult>
} {
  function handler<T, R>(
    schema: z.ZodType<T>,
    result: z.ZodType<R>,
    action: (input: T) => unknown
  ): HistoryHandler<R> {
    return async (event: IpcSenderValidationEvent, request: unknown): Promise<R> => {
      if (!isIpcSenderAllowed(event, navigationPolicy))
        return result.parse(createIpcFailure('IPC_FORBIDDEN'))
      try {
        const parsed = schema.safeParse(request)
        if (!parsed.success) return result.parse(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
        return result.parse(createIpcSuccess(await action(parsed.data)))
      } catch {
        return result.parse(createIpcSuccess({ status: 'UNAVAILABLE' }))
      }
    }
  }
  return {
    read: handler(centralHistoryReadRequestSchema, centralHistoryReadResultSchema, service.read),
    refresh: handler(
      centralHistoryRefreshRequestSchema,
      centralHistoryRefreshResultSchema,
      service.refresh
    )
  }
}
