import {
  createReportDocumentFailure,
  ipcChannels,
  reportDocumentActionResultSchema,
  reportDocumentRequestSchema,
  type ReportDocumentActionResult,
  type ReportDocumentApi,
  type ReportDocumentRequest
} from '@shared/ipc'

import type { IpcInvoke } from './health-screening-api'

export function createReportDocumentApi(invoke: IpcInvoke): ReportDocumentApi {
  const invokeAction = (
    channel: string,
    request: ReportDocumentRequest
  ): Promise<ReportDocumentActionResult> => {
    const parsedRequest = safeParse(reportDocumentRequestSchema, request)
    if (!parsedRequest.success) {
      return Promise.resolve(createReportDocumentFailure('VALIDATION_FAILED'))
    }

    return invoke(channel, parsedRequest.data)
      .then((response) => {
        const parsedResult = safeParse(reportDocumentActionResultSchema, response)
        return parsedResult.success
          ? parsedResult.data
          : createReportDocumentFailure('IPC_UNAVAILABLE')
      })
      .catch(() => createReportDocumentFailure('IPC_UNAVAILABLE'))
  }

  return Object.freeze({
    savePdf: (request: ReportDocumentRequest) =>
      invokeAction(ipcChannels.reportDocuments.savePdf, request),
    print: (request: ReportDocumentRequest) =>
      invokeAction(ipcChannels.reportDocuments.print, request)
  })
}

function safeParse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown
): { success: true; data: T } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
