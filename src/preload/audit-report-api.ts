import {
  auditReportGetContextRequestSchema,
  auditReportGetContextResultSchema,
  auditReportSearchRequestSchema,
  auditReportSearchResultSchema,
  createIpcSuccess,
  ipcChannels,
  type AuditReportApi,
  type AuditReportGetContextResult,
  type AuditReportSearchRequest,
  type AuditReportSearchResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export function createAuditReportApi(invoke: IpcInvoke): AuditReportApi {
  return Object.freeze({
    getContext: () =>
      invokeAuditReport({
        invoke,
        channel: ipcChannels.auditReports.getContext,
        request: {},
        requestSchema: auditReportGetContextRequestSchema,
        resultSchema: auditReportGetContextResultSchema,
        unavailableResult: createIpcSuccess({
          status: 'UNAVAILABLE'
        }) as AuditReportGetContextResult
      }),
    search: (request: AuditReportSearchRequest) =>
      invokeAuditReport({
        invoke,
        channel: ipcChannels.auditReports.search,
        request,
        requestSchema: auditReportSearchRequestSchema,
        resultSchema: auditReportSearchResultSchema,
        unavailableResult: createIpcSuccess({ status: 'UNAVAILABLE' }) as AuditReportSearchResult
      })
  })
}

interface InvokeAuditReportOptions<TRequest, TResult> {
  readonly invoke: IpcInvoke
  readonly channel: string
  readonly request: TRequest
  readonly requestSchema: Schema<TRequest>
  readonly resultSchema: Schema<TResult>
  readonly unavailableResult: TResult
}

async function invokeAuditReport<TRequest, TResult>({
  invoke,
  channel,
  request,
  requestSchema,
  resultSchema,
  unavailableResult
}: InvokeAuditReportOptions<TRequest, TResult>): Promise<TResult> {
  const parsedRequest = safeParse(requestSchema, request)
  if (!parsedRequest.success) {
    return deepFreeze(createIpcSuccess({ status: 'VALIDATION_FAILED' }) as TResult)
  }

  try {
    const response = await invoke(channel, parsedRequest.data)
    const parsedResult = safeParse(resultSchema, response)
    return deepFreeze(parsedResult.success ? parsedResult.data : unavailableResult)
  } catch {
    return deepFreeze(unavailableResult)
  }
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

function safeParse<T>(
  schema: Schema<T>,
  value: unknown
): { success: true; data: T } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
