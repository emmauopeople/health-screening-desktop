import {
  createSyncAdministrationFailure,
  ipcChannels,
  syncAdministrationConfigureRequestSchema,
  syncAdministrationConfigureResultSchema,
  syncAdministrationGetStateRequestSchema,
  syncAdministrationGetStateResultSchema,
  type SyncAdministrationConfigureRequest,
  type SyncAdministrationConfigureResult,
  type SyncAdministrationGetStateResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface SyncAdministrationApi {
  getState(): Promise<SyncAdministrationGetStateResult>
  configure(request: SyncAdministrationConfigureRequest): Promise<SyncAdministrationConfigureResult>
}

export function createSyncAdministrationApi(invoke: IpcInvoke): SyncAdministrationApi {
  return Object.freeze({
    getState: () =>
      invokeValidated({
        invoke,
        channel: ipcChannels.syncAdministration.getState,
        request: {},
        requestSchema: syncAdministrationGetStateRequestSchema,
        resultSchema: syncAdministrationGetStateResultSchema,
        unavailable: createSyncAdministrationFailure('IPC_UNAVAILABLE')
      }),
    configure: (request: SyncAdministrationConfigureRequest) =>
      invokeValidated({
        invoke,
        channel: ipcChannels.syncAdministration.configure,
        request,
        requestSchema: syncAdministrationConfigureRequestSchema,
        resultSchema: syncAdministrationConfigureResultSchema,
        unavailable: createSyncAdministrationFailure('IPC_UNAVAILABLE')
      })
  })
}

async function invokeValidated<TResult>({
  invoke,
  channel,
  request,
  requestSchema,
  resultSchema,
  unavailable
}: {
  readonly invoke: IpcInvoke
  readonly channel: string
  readonly request: unknown
  readonly requestSchema: IpcSchema<unknown>
  readonly resultSchema: IpcSchema<TResult>
  readonly unavailable: TResult
}): Promise<TResult> {
  const parsedRequest = safeParse(requestSchema, request)
  if (!parsedRequest.success) {
    return createSyncAdministrationFailure('VALIDATION_FAILED') as TResult
  }
  try {
    const response = await invoke(channel, parsedRequest.data)
    const parsedResponse = safeParse(resultSchema, response)
    return parsedResponse.success ? parsedResponse.data : unavailable
  } catch {
    return unavailable
  }
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false }
}

function safeParse<TResult>(
  schema: IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
