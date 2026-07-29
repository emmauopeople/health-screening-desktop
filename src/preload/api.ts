import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  createIpcFailure,
  ipcChannels,
  type AppHealth,
  type AppInfo,
  type HealthScreeningApi,
  type IpcResult
} from '@shared/ipc'

export type IpcInvoke = (channel: string, request: unknown) => Promise<unknown>

export function createHealthScreeningApi(invoke: IpcInvoke): HealthScreeningApi {
  return {
    app: {
      getInfo: () =>
        invokeValidated<AppInfo>({
          invoke,
          channel: ipcChannels.app.getInfo,
          request: appGetInfoRequestSchema.parse({}),
          resultSchema: appGetInfoResultSchema
        }),
      getHealth: () =>
        invokeValidated<AppHealth>({
          invoke,
          channel: ipcChannels.app.getHealth,
          request: appGetHealthRequestSchema.parse({}),
          resultSchema: appGetHealthResultSchema
        })
    }
  }
}

interface InvokeValidatedInput<TData> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  resultSchema: {
    safeParse(value: unknown): { success: true; data: IpcResult<TData> } | { success: false }
  }
}

async function invokeValidated<TData>({
  invoke,
  channel,
  request,
  resultSchema
}: InvokeValidatedInput<TData>): Promise<IpcResult<TData>> {
  try {
    const response = await invoke(channel, request)
    const result = resultSchema.safeParse(response)

    if (!result.success) {
      return createIpcFailure('IPC_UNAVAILABLE')
    }

    return result.data
  } catch {
    return createIpcFailure('IPC_UNAVAILABLE')
  }
}
