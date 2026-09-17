import type { z } from 'zod'
import { ipcChannels } from '@shared/ipc/channels'
import { createIpcFailure } from '@shared/ipc/result'
import {
  centralHistoryReadRequestSchema,
  centralHistoryRefreshRequestSchema,
  centralHistoryReadResultSchema,
  centralHistoryRefreshResultSchema,
  type CentralHistoryApi,
  type CentralHistoryReadRequest,
  type CentralHistoryRefreshRequest
} from '@shared/ipc/central-history-contracts'
import type { IpcInvoke } from './authentication-api'

export function createCentralHistoryApi(invoke: IpcInvoke): CentralHistoryApi {
  async function request<T, R>(
    channel: string,
    input: unknown,
    schema: z.ZodType<T>,
    resultSchema: z.ZodType<R>
  ): Promise<R> {
    try {
      const parsed = schema.safeParse(input)
      if (!parsed.success) return resultSchema.parse(createIpcFailure('VALIDATION_FAILED'))
      return resultSchema.parse(await invoke(channel, parsed.data))
    } catch {
      return resultSchema.parse(createIpcFailure('IPC_UNAVAILABLE'))
    }
  }
  return Object.freeze({
    read: (input: CentralHistoryReadRequest) =>
      request(
        ipcChannels.centralHistory.read,
        input,
        centralHistoryReadRequestSchema,
        centralHistoryReadResultSchema
      ),
    refresh: (input: CentralHistoryRefreshRequest) =>
      request(
        ipcChannels.centralHistory.refresh,
        input,
        centralHistoryRefreshRequestSchema,
        centralHistoryRefreshResultSchema
      )
  })
}
