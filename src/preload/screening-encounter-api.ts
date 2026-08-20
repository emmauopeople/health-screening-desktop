import {
  createIpcSuccess,
  encounterManagementAddAddendumRequestSchema,
  encounterManagementAddAddendumResultSchema,
  encounterManagementGetDetailRequestSchema,
  encounterManagementGetDetailResultSchema,
  encounterManagementOpenFlagRequestSchema,
  encounterManagementOpenFlagResultSchema,
  encounterManagementResolveFlagRequestSchema,
  encounterManagementResolveFlagResultSchema,
  encounterManagementSearchRequestSchema,
  encounterManagementSearchResultSchema,
  ipcChannels,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  screeningEncounterCompleteRequestSchema,
  screeningEncounterCompleteResultSchema,
  screeningVitalsCompleteStepResultSchema,
  screeningVitalsGetDraftRequestSchema,
  screeningVitalsGetDraftResultSchema,
  screeningVitalsSaveDraftRequestSchema,
  screeningVitalsSaveDraftResultSchema,
  type ScreeningEncounterStartRequest,
  type EncounterManagementAddAddendumRequest,
  type EncounterManagementAddAddendumResult,
  type EncounterManagementGetDetailRequest,
  type EncounterManagementGetDetailResult,
  type EncounterManagementOpenFlagRequest,
  type EncounterManagementOpenFlagResult,
  type EncounterManagementResolveFlagRequest,
  type EncounterManagementResolveFlagResult,
  type EncounterManagementSearchRequest,
  type EncounterManagementSearchResult,
  type ScreeningEncounterStartResult,
  type ScreeningEncounterCompleteRequest,
  type ScreeningEncounterCompleteResult,
  type ScreeningVitalsCompleteStepResult,
  type ScreeningVitalsGetDraftRequest,
  type ScreeningVitalsGetDraftResult,
  type ScreeningVitalsSaveDraftRequest,
  type ScreeningVitalsSaveDraftResult
} from '@shared/ipc'
import { createScreeningFoodApi } from './screening-food-api'
import { createScreeningLifestyleApi } from './screening-lifestyle-api'
import { createScreeningOtcApi } from './screening-otc-api'
import type { ScreeningFoodApi, ScreeningLifestyleApi, ScreeningOtcApi } from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface ScreeningEncounterApi {
  start(request: ScreeningEncounterStartRequest): Promise<ScreeningEncounterStartResult>
  complete(request: ScreeningEncounterCompleteRequest): Promise<ScreeningEncounterCompleteResult>
  management: {
    search(request: EncounterManagementSearchRequest): Promise<EncounterManagementSearchResult>
    getDetail(
      request: EncounterManagementGetDetailRequest
    ): Promise<EncounterManagementGetDetailResult>
    addAddendum(
      request: EncounterManagementAddAddendumRequest
    ): Promise<EncounterManagementAddAddendumResult>
    openFlag(
      request: EncounterManagementOpenFlagRequest
    ): Promise<EncounterManagementOpenFlagResult>
    resolveFlag(
      request: EncounterManagementResolveFlagRequest
    ): Promise<EncounterManagementResolveFlagResult>
  }
  vitals: {
    getDraft(request: ScreeningVitalsGetDraftRequest): Promise<ScreeningVitalsGetDraftResult>
    saveDraft(request: ScreeningVitalsSaveDraftRequest): Promise<ScreeningVitalsSaveDraftResult>
    completeStep(
      request: ScreeningVitalsSaveDraftRequest
    ): Promise<ScreeningVitalsCompleteStepResult>
  }
  lifestyle: ScreeningLifestyleApi
  food: ScreeningFoodApi
  otc: ScreeningOtcApi
}

export function createScreeningEncounterApi(invoke: IpcInvoke): ScreeningEncounterApi {
  return Object.freeze({
    start: (request: ScreeningEncounterStartRequest) =>
      invokeScreeningEncounterStart({ invoke, request }),
    complete: (request: ScreeningEncounterCompleteRequest) =>
      invokeScreeningEncounterComplete({ invoke, request }),
    management: Object.freeze({
      search: (request: EncounterManagementSearchRequest) =>
        invokeManaged<EncounterManagementSearchRequest, EncounterManagementSearchResult>(
          invoke,
          ipcChannels.screeningEncounters.management.search,
          encounterManagementSearchRequestSchema,
          encounterManagementSearchResultSchema,
          request
        ),
      getDetail: (request: EncounterManagementGetDetailRequest) =>
        invokeManaged<EncounterManagementGetDetailRequest, EncounterManagementGetDetailResult>(
          invoke,
          ipcChannels.screeningEncounters.management.getDetail,
          encounterManagementGetDetailRequestSchema,
          encounterManagementGetDetailResultSchema,
          request
        ),
      addAddendum: (request: EncounterManagementAddAddendumRequest) =>
        invokeManaged<EncounterManagementAddAddendumRequest, EncounterManagementAddAddendumResult>(
          invoke,
          ipcChannels.screeningEncounters.management.addAddendum,
          encounterManagementAddAddendumRequestSchema,
          encounterManagementAddAddendumResultSchema,
          request
        ),
      openFlag: (request: EncounterManagementOpenFlagRequest) =>
        invokeManaged<EncounterManagementOpenFlagRequest, EncounterManagementOpenFlagResult>(
          invoke,
          ipcChannels.screeningEncounters.management.openFlag,
          encounterManagementOpenFlagRequestSchema,
          encounterManagementOpenFlagResultSchema,
          request
        ),
      resolveFlag: (request: EncounterManagementResolveFlagRequest) =>
        invokeManaged<EncounterManagementResolveFlagRequest, EncounterManagementResolveFlagResult>(
          invoke,
          ipcChannels.screeningEncounters.management.resolveFlag,
          encounterManagementResolveFlagRequestSchema,
          encounterManagementResolveFlagResultSchema,
          request
        )
    }),
    vitals: Object.freeze({
      getDraft: (request: ScreeningVitalsGetDraftRequest) =>
        invokeVitalsGetDraft({ invoke, request }),
      saveDraft: (request: ScreeningVitalsSaveDraftRequest) =>
        invokeVitalsSaveDraft({ invoke, request }),
      completeStep: (request: ScreeningVitalsSaveDraftRequest) =>
        invokeVitalsCompleteStep({ invoke, request })
    }),
    lifestyle: createScreeningLifestyleApi(invoke),
    food: createScreeningFoodApi(invoke),
    otc: createScreeningOtcApi(invoke)
  })

  async function invokeScreeningEncounterComplete({
    invoke,
    request
  }: {
    readonly invoke: IpcInvoke
    readonly request: ScreeningEncounterCompleteRequest
  }): Promise<ScreeningEncounterCompleteResult> {
    const requestResult = safeParseIpcValue(screeningEncounterCompleteRequestSchema, request)

    if (!requestResult.success) {
      return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
    }

    try {
      const response = await invoke(ipcChannels.screeningEncounters.complete, requestResult.data)
      const result = safeParseIpcValue(screeningEncounterCompleteResultSchema, response)

      return deepFreeze(
        result.success ? result.data : createIpcSuccess({ status: 'UNAVAILABLE' as const })
      )
    } catch {
      return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
    }
  }
}

async function invokeManaged<TRequest, TResult>(
  invoke: IpcInvoke,
  channel: string,
  requestSchema: IpcSchema<TRequest>,
  resultSchema: IpcSchema<TResult>,
  request: TRequest
): Promise<TResult> {
  const parsedRequest = safeParseIpcValue(requestSchema, request)
  if (!parsedRequest.success)
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' })) as TResult
  try {
    const response = await invoke(channel, parsedRequest.data)
    const parsedResult = safeParseIpcValue(resultSchema, response)
    return deepFreeze(
      parsedResult.success ? parsedResult.data : createIpcSuccess({ status: 'UNAVAILABLE' })
    ) as TResult
  } catch {
    return deepFreeze(createIpcSuccess({ status: 'UNAVAILABLE' })) as TResult
  }
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
