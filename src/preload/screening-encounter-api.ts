import {
  createIpcSuccess,
  ipcChannels,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  screeningVitalsCompleteStepResultSchema,
  screeningVitalsGetDraftRequestSchema,
  screeningVitalsGetDraftResultSchema,
  screeningVitalsSaveDraftRequestSchema,
  screeningVitalsSaveDraftResultSchema,
  type ScreeningEncounterStartRequest,
  type ScreeningEncounterStartResult,
  type ScreeningVitalsCompleteStepResult,
  type ScreeningVitalsGetDraftRequest,
  type ScreeningVitalsGetDraftResult,
  type ScreeningVitalsSaveDraftRequest,
  type ScreeningVitalsSaveDraftResult
} from '@shared/ipc'
import { createScreeningFoodApi } from './screening-food-api'
import { createScreeningLifestyleApi } from './screening-lifestyle-api'
import type { ScreeningFoodApi, ScreeningLifestyleApi } from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface ScreeningEncounterApi {
  start(request: ScreeningEncounterStartRequest): Promise<ScreeningEncounterStartResult>
  vitals: {
    getDraft(request: ScreeningVitalsGetDraftRequest): Promise<ScreeningVitalsGetDraftResult>
    saveDraft(request: ScreeningVitalsSaveDraftRequest): Promise<ScreeningVitalsSaveDraftResult>
    completeStep(
      request: ScreeningVitalsSaveDraftRequest
    ): Promise<ScreeningVitalsCompleteStepResult>
  }
  lifestyle: ScreeningLifestyleApi
  food: ScreeningFoodApi
}

export function createScreeningEncounterApi(invoke: IpcInvoke): ScreeningEncounterApi {
  return Object.freeze({
    start: (request: ScreeningEncounterStartRequest) =>
      invokeScreeningEncounterStart({ invoke, request }),
    vitals: Object.freeze({
      getDraft: (request: ScreeningVitalsGetDraftRequest) =>
        invokeVitalsGetDraft({ invoke, request }),
      saveDraft: (request: ScreeningVitalsSaveDraftRequest) =>
        invokeVitalsSaveDraft({ invoke, request }),
      completeStep: (request: ScreeningVitalsSaveDraftRequest) =>
        invokeVitalsCompleteStep({ invoke, request })
    }),
    lifestyle: createScreeningLifestyleApi(invoke),
    food: createScreeningFoodApi(invoke)
  })
}

async function invokeScreeningEncounterStart({
  invoke,
  request
}: {
  readonly invoke: IpcInvoke
  readonly request: ScreeningEncounterStartRequest
}): Promise<ScreeningEncounterStartResult> {
  const requestResult = safeParseIpcValue(screeningEncounterStartRequestSchema, request)

  if (!requestResult.success) {
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
  }

  try {
    const response = await invoke(ipcChannels.screeningEncounters.start, requestResult.data)
    const result = safeParseIpcValue(screeningEncounterStartResultSchema, response)

    return deepFreeze(
      result.success ? result.data : createIpcSuccess({ status: 'UNAVAILABLE' as const })
    )
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
  }
}

async function invokeVitalsGetDraft({
  invoke,
  request
}: {
  readonly invoke: IpcInvoke
  readonly request: ScreeningVitalsGetDraftRequest
}): Promise<ScreeningVitalsGetDraftResult> {
  const requestResult = safeParseIpcValue(screeningVitalsGetDraftRequestSchema, request)

  if (!requestResult.success) {
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
  }

  try {
    const response = await invoke(
      ipcChannels.screeningEncounters.getVitalsDraft,
      requestResult.data
    )
    const result = safeParseIpcValue(screeningVitalsGetDraftResultSchema, response)

    return deepFreeze(
      result.success ? result.data : createIpcSuccess({ status: 'UNAVAILABLE' as const })
    )
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
  }
}

async function invokeVitalsSaveDraft({
  invoke,
  request
}: {
  readonly invoke: IpcInvoke
  readonly request: ScreeningVitalsSaveDraftRequest
}): Promise<ScreeningVitalsSaveDraftResult> {
  const requestResult = safeParseIpcValue(screeningVitalsSaveDraftRequestSchema, request)

  if (!requestResult.success) {
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
  }

  try {
    const response = await invoke(
      ipcChannels.screeningEncounters.saveVitalsDraft,
      requestResult.data
    )
    const result = safeParseIpcValue(screeningVitalsSaveDraftResultSchema, response)

    return deepFreeze(
      result.success ? result.data : createIpcSuccess({ status: 'UNAVAILABLE' as const })
    )
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
  }
}

async function invokeVitalsCompleteStep({
  invoke,
  request
}: {
  readonly invoke: IpcInvoke
  readonly request: ScreeningVitalsSaveDraftRequest
}): Promise<ScreeningVitalsCompleteStepResult> {
  const requestResult = safeParseIpcValue(screeningVitalsSaveDraftRequestSchema, request)

  if (!requestResult.success) {
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
  }

  try {
    const response = await invoke(
      ipcChannels.screeningEncounters.completeVitalsStep,
      requestResult.data
    )
    const result = safeParseIpcValue(screeningVitalsCompleteStepResultSchema, response)

    return deepFreeze(
      result.success ? result.data : createIpcSuccess({ status: 'UNAVAILABLE' as const })
    )
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
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

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const propertyName of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[propertyName])
  }

  return Object.freeze(value)
}
