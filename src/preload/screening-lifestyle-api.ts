import {
  createIpcSuccess,
  ipcChannels,
  screeningLifestyleAlcoholBaselineRequestSchema,
  screeningLifestyleCompleteRequestSchema,
  screeningLifestyleCompleteResultSchema,
  screeningLifestyleGetWorkspaceRequestSchema,
  screeningLifestyleGetWorkspaceResultSchema,
  screeningLifestyleSaveAlcoholBaselineResultSchema,
  screeningLifestyleSaveDraftRequestSchema,
  screeningLifestyleSaveDraftResultSchema,
  screeningLifestyleSaveTobaccoBaselineRequestSchema,
  screeningLifestyleSaveTobaccoBaselineResultSchema,
  screeningLifestyleSaveWorkBaselineResultSchema,
  screeningLifestyleSaveWorkBaselineRequestSchema,
  type ScreeningLifestyleApi,
  type ScreeningLifestyleCompleteRequest,
  type ScreeningLifestyleCompleteResult,
  type ScreeningLifestyleGetWorkspaceRequest,
  type ScreeningLifestyleGetWorkspaceResult,
  type ScreeningLifestyleSaveAlcoholBaselineRequest,
  type ScreeningLifestyleSaveAlcoholBaselineResult,
  type ScreeningLifestyleSaveDraftRequest,
  type ScreeningLifestyleSaveDraftResult,
  type ScreeningLifestyleSaveTobaccoBaselineRequest,
  type ScreeningLifestyleSaveTobaccoBaselineResult,
  type ScreeningLifestyleSaveWorkBaselineRequest,
  type ScreeningLifestyleSaveWorkBaselineResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export function createScreeningLifestyleApi(invoke: IpcInvoke): ScreeningLifestyleApi {
  return Object.freeze({
    getWorkspace: (request: ScreeningLifestyleGetWorkspaceRequest) =>
      invokeLifestyle<ScreeningLifestyleGetWorkspaceRequest, ScreeningLifestyleGetWorkspaceResult>({
        invoke,
        request,
        requestSchema: screeningLifestyleGetWorkspaceRequestSchema,
        resultSchema: screeningLifestyleGetWorkspaceResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.getWorkspace
      }),
    saveAlcoholBaseline: (request: ScreeningLifestyleSaveAlcoholBaselineRequest) =>
      invokeLifestyle<
        ScreeningLifestyleSaveAlcoholBaselineRequest,
        ScreeningLifestyleSaveAlcoholBaselineResult
      >({
        invoke,
        request,
        requestSchema: screeningLifestyleAlcoholBaselineRequestSchema,
        resultSchema: screeningLifestyleSaveAlcoholBaselineResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline
      }),
    saveTobaccoBaseline: (request: ScreeningLifestyleSaveTobaccoBaselineRequest) =>
      invokeLifestyle<
        ScreeningLifestyleSaveTobaccoBaselineRequest,
        ScreeningLifestyleSaveTobaccoBaselineResult
      >({
        invoke,
        request,
        requestSchema: screeningLifestyleSaveTobaccoBaselineRequestSchema,
        resultSchema: screeningLifestyleSaveTobaccoBaselineResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline
      }),
    saveWorkBaseline: (request: ScreeningLifestyleSaveWorkBaselineRequest) =>
      invokeLifestyle<
        ScreeningLifestyleSaveWorkBaselineRequest,
        ScreeningLifestyleSaveWorkBaselineResult
      >({
        invoke,
        request,
        requestSchema: screeningLifestyleSaveWorkBaselineRequestSchema,
        resultSchema: screeningLifestyleSaveWorkBaselineResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline
      }),
    saveDraft: (request: ScreeningLifestyleSaveDraftRequest) =>
      invokeLifestyle<ScreeningLifestyleSaveDraftRequest, ScreeningLifestyleSaveDraftResult>({
        invoke,
        request,
        requestSchema: screeningLifestyleSaveDraftRequestSchema,
        resultSchema: screeningLifestyleSaveDraftResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.saveDraft
      }),
    complete: (request: ScreeningLifestyleCompleteRequest) =>
      invokeLifestyle<ScreeningLifestyleCompleteRequest, ScreeningLifestyleCompleteResult>({
        invoke,
        request,
        requestSchema: screeningLifestyleCompleteRequestSchema,
        resultSchema: screeningLifestyleCompleteResultSchema,
        channel: ipcChannels.screeningEncounters.lifestyle.complete
      })
  })
}

async function invokeLifestyle<TRequest, TResult>({
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
