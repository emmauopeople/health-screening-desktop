import {
  createIpcSuccess,
  ipcChannels,
  screeningFoodGetWorkspaceRequestSchema,
  screeningFoodGetWorkspaceResultSchema,
  screeningFoodSaveDraftRequestSchema,
  screeningFoodSaveDraftResultSchema,
  type ScreeningFoodApi,
  type ScreeningFoodGetWorkspaceRequest,
  type ScreeningFoodGetWorkspaceResult,
  type ScreeningFoodSaveDraftRequest,
  type ScreeningFoodSaveDraftResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export function createScreeningFoodApi(invoke: IpcInvoke): ScreeningFoodApi {
  return Object.freeze({
    getWorkspace: (request: ScreeningFoodGetWorkspaceRequest) =>
      invokeFood<ScreeningFoodGetWorkspaceRequest, ScreeningFoodGetWorkspaceResult>({
        invoke,
        request,
        requestSchema: screeningFoodGetWorkspaceRequestSchema,
        resultSchema: screeningFoodGetWorkspaceResultSchema,
        channel: ipcChannels.screeningEncounters.food.getWorkspace
      }),
    saveDraft: (request: ScreeningFoodSaveDraftRequest) =>
      invokeFood<ScreeningFoodSaveDraftRequest, ScreeningFoodSaveDraftResult>({
        invoke,
        request,
        requestSchema: screeningFoodSaveDraftRequestSchema,
        resultSchema: screeningFoodSaveDraftResultSchema,
        channel: ipcChannels.screeningEncounters.food.saveDraft
      })
  })
}

async function invokeFood<TRequest, TResult>({
  invoke,
  request,
  requestSchema,
  resultSchema,
  channel
}: {
  readonly invoke: IpcInvoke
  readonly request: TRequest
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly channel: string
}): Promise<TResult> {
  const parsedRequest = safeParse(requestSchema, request)
  if (!parsedRequest.success)
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const })) as TResult

  try {
    const response = await invoke(channel, parsedRequest.data)
    const parsedResponse = safeParse(resultSchema, response)
    return deepFreeze(
      parsedResponse.success
        ? parsedResponse.data
        : createIpcSuccess({ status: 'UNAVAILABLE' as const })
    ) as TResult
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const })) as TResult
  }
}

interface IpcSchema<TValue> {
  safeParse(value: unknown): { success: true; data: TValue } | { success: false }
}

function safeParse<TValue>(
  schema: IpcSchema<TValue>,
  value: unknown
): { success: true; data: TValue } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const propertyName of Object.getOwnPropertyNames(value))
    deepFreeze((value as Record<string, unknown>)[propertyName])
  return Object.freeze(value)
}
