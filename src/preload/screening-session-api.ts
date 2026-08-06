import {
  createScreeningSessionFailure,
  ipcChannels,
  screeningSessionCloseRequestSchema,
  screeningSessionCloseResultSchema,
  screeningSessionCreateRequestSchema,
  screeningSessionCreateResultSchema,
  screeningSessionGetByIdRequestSchema,
  screeningSessionGetByIdResultSchema,
  screeningSessionGetWorkspaceContextRequestSchema,
  screeningSessionGetWorkspaceContextResultSchema,
  screeningSessionListRequestSchema,
  screeningSessionListResultSchema,
  screeningSessionReopenRequestSchema,
  screeningSessionReopenResultSchema,
  type ScreeningSessionCloseRequest,
  type ScreeningSessionCloseResult,
  type ScreeningSessionCreateRequest,
  type ScreeningSessionCreateResult,
  type ScreeningSessionGetByIdRequest,
  type ScreeningSessionGetByIdResult,
  type ScreeningSessionGetWorkspaceContextResult,
  type ScreeningSessionListRequest,
  type ScreeningSessionListResult,
  type ScreeningSessionReopenRequest,
  type ScreeningSessionReopenResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface ScreeningSessionApi {
  getWorkspaceContext(): Promise<ScreeningSessionGetWorkspaceContextResult>
  create(request: ScreeningSessionCreateRequest): Promise<ScreeningSessionCreateResult>
  close(request: ScreeningSessionCloseRequest): Promise<ScreeningSessionCloseResult>
  reopen(request: ScreeningSessionReopenRequest): Promise<ScreeningSessionReopenResult>
  getById(request: ScreeningSessionGetByIdRequest): Promise<ScreeningSessionGetByIdResult>
  list(request: ScreeningSessionListRequest): Promise<ScreeningSessionListResult>
}

export function createScreeningSessionApi(invoke: IpcInvoke): ScreeningSessionApi {
  return Object.freeze({
    getWorkspaceContext: () =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.getWorkspaceContext,
        request: {},
        requestSchema: screeningSessionGetWorkspaceContextRequestSchema,
        resultSchema: screeningSessionGetWorkspaceContextResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionGetWorkspaceContextResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionGetWorkspaceContextResult
      }),
    create: (request: ScreeningSessionCreateRequest) =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.create,
        request,
        requestSchema: screeningSessionCreateRequestSchema,
        resultSchema: screeningSessionCreateResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionCreateResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionCreateResult
      }),
    close: (request: ScreeningSessionCloseRequest) =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.close,
        request,
        requestSchema: screeningSessionCloseRequestSchema,
        resultSchema: screeningSessionCloseResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionCloseResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionCloseResult
      }),
    reopen: (request: ScreeningSessionReopenRequest) =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.reopen,
        request,
        requestSchema: screeningSessionReopenRequestSchema,
        resultSchema: screeningSessionReopenResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionReopenResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionReopenResult
      }),
    getById: (request: ScreeningSessionGetByIdRequest) =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.getById,
        request,
        requestSchema: screeningSessionGetByIdRequestSchema,
        resultSchema: screeningSessionGetByIdResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionGetByIdResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionGetByIdResult
      }),
    list: (request: ScreeningSessionListRequest) =>
      invokeScreeningSession({
        invoke,
        channel: ipcChannels.screeningSessions.list,
        request,
        requestSchema: screeningSessionListRequestSchema,
        resultSchema: screeningSessionListResultSchema,
        validationFailure: createScreeningSessionFailure(
          'VALIDATION_FAILED'
        ) as ScreeningSessionListResult,
        unavailableFailure: createScreeningSessionFailure(
          'IPC_UNAVAILABLE'
        ) as ScreeningSessionListResult
      })
  })
}

interface InvokeScreeningSessionOptions<TRequest, TResult> {
  readonly invoke: IpcInvoke
  readonly channel: string
  readonly request: TRequest
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly validationFailure: TResult
  readonly unavailableFailure: TResult
}

async function invokeScreeningSession<TRequest, TResult>({
  invoke,
  channel,
  request,
  requestSchema,
  resultSchema,
  validationFailure,
  unavailableFailure
}: InvokeScreeningSessionOptions<TRequest, TResult>): Promise<TResult> {
  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    return deepFreeze(validationFailure)
  }

  try {
    const response = await invoke(channel, requestResult.data)
    const result = safeParseIpcValue(resultSchema, response)

    return deepFreeze(result.success ? result.data : unavailableFailure)
  } catch {
    return deepFreeze(unavailableFailure)
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
