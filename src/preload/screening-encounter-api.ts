import {
  createIpcSuccess,
  ipcChannels,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  type ScreeningEncounterStartRequest,
  type ScreeningEncounterStartResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface ScreeningEncounterApi {
  start(request: ScreeningEncounterStartRequest): Promise<ScreeningEncounterStartResult>
}

export function createScreeningEncounterApi(invoke: IpcInvoke): ScreeningEncounterApi {
  return Object.freeze({
    start: (request: ScreeningEncounterStartRequest) =>
      invokeScreeningEncounterStart({ invoke, request })
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
