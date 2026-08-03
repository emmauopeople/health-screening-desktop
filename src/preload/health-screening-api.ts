import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  createFirstRunFailure,
  createIpcFailure,
  firstRunGetStateRequestSchema,
  firstRunGetStateResultSchema,
  firstRunInitializeRequestSchema,
  firstRunInitializeResultSchema,
  ipcChannels,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type FirstRunGetStateResult,
  type FirstRunInitializeRequest,
  type FirstRunInitializeResult,
  type HealthScreeningApi
} from '@shared/ipc'

import { createAuthenticationApi, type IpcInvoke, type IpcSubscribe } from './authentication-api'
import { createPatientApi } from './patient-api'

export type { IpcInvoke, IpcSubscribe }

export function createHealthScreeningApi(
  invoke: IpcInvoke,
  subscribe?: IpcSubscribe
): HealthScreeningApi {
  return Object.freeze({
    app: Object.freeze({
      getInfo: () =>
        invokeValidated<AppGetInfoResult>({
          invoke,
          channel: ipcChannels.app.getInfo,
          request: appGetInfoRequestSchema.parse({}),
          resultSchema: appGetInfoResultSchema,
          unavailableResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetInfoResult
        }),
      getHealth: () =>
        invokeValidated<AppGetHealthResult>({
          invoke,
          channel: ipcChannels.app.getHealth,
          request: appGetHealthRequestSchema.parse({}),
          resultSchema: appGetHealthResultSchema,
          unavailableResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetHealthResult
        })
    }),
    firstRun: Object.freeze({
      getState: () =>
        invokeValidated<FirstRunGetStateResult>({
          invoke,
          channel: ipcChannels.firstRun.getState,
          request: firstRunGetStateRequestSchema.parse({}),
          resultSchema: firstRunGetStateResultSchema,
          unavailableResult: createFirstRunFailure('IPC_UNAVAILABLE') as FirstRunGetStateResult
        }),
      initialize: (request: FirstRunInitializeRequest) => {
        const requestResult = safeParseIpcValue(firstRunInitializeRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createFirstRunFailure('VALIDATION_FAILED') as FirstRunInitializeResult
          )
        }

        return invokeValidated<FirstRunInitializeResult>({
          invoke,
          channel: ipcChannels.firstRun.initialize,
          request: requestResult.data,
          resultSchema: firstRunInitializeResultSchema,
          unavailableResult: createFirstRunFailure('IPC_UNAVAILABLE') as FirstRunInitializeResult
        })
      }
    }),
    auth: createAuthenticationApi({ invoke, subscribe }),
    patient: createPatientApi(invoke)
  })
}

interface InvokeValidatedInput<TResult> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  resultSchema: {
    safeParse(value: unknown): { success: true; data: TResult } | { success: false }
  }
  unavailableResult: TResult
}

async function invokeValidated<TResult>({
  invoke,
  channel,
  request,
  resultSchema,
  unavailableResult
}: InvokeValidatedInput<TResult>): Promise<TResult> {
  try {
    const response = await invoke(channel, request)
    const result = safeParseIpcValue(resultSchema, response)

    if (!result.success) {
      return unavailableResult
    }

    return result.data
  } catch {
    return unavailableResult
  }
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false }
}

function safeParseIpcValue<TResult>(
  schema: IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
