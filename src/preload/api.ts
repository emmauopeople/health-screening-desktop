import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  createIpcFailure,
  ipcChannels,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type HealthScreeningApi
} from '@shared/ipc'

export type IpcInvoke = (channel: string, request: unknown) => Promise<unknown>

export function createHealthScreeningApi(invoke: IpcInvoke): HealthScreeningApi {
  return {
    app: {
      getInfo: () =>
        invokeValidated<AppGetInfoResult>({
          invoke,
          channel: ipcChannels.app.getInfo,
          request: appGetInfoRequestSchema.parse({}),
          resultSchema: appGetInfoResultSchema
        }),
      getHealth: () =>
        invokeValidated<AppGetHealthResult>({
          invoke,
          channel: ipcChannels.app.getHealth,
          request: appGetHealthRequestSchema.parse({}),
          resultSchema: appGetHealthResultSchema
        })
    }
  }
}

interface InvokeValidatedInput<TResult> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  resultSchema: {
    safeParse(value: unknown): { success: true; data: TResult } | { success: false }
  }
}

async function invokeValidated<TResult>({
  invoke,
  channel,
  request,
  resultSchema
}: InvokeValidatedInput<TResult>): Promise<TResult> {
  try {
    const response = await invoke(channel, request)
    const result = resultSchema.safeParse(response)

    if (!result.success) {
      return createIpcFailure('IPC_UNAVAILABLE') as TResult
    }

    return result.data
  } catch {
    return createIpcFailure('IPC_UNAVAILABLE') as TResult
  }
}
