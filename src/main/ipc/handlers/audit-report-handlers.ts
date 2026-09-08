import type { AuditReportService } from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  auditReportGetContextRequestSchema,
  auditReportGetContextResultSchema,
  auditReportSearchRequestSchema,
  auditReportSearchResultSchema,
  createIpcFailure,
  createIpcSuccess,
  ipcChannels,
  type AuditReportGetContextResult,
  type AuditReportSearchResult
} from '@shared/ipc'

export interface AuditReportIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly auditReportService: AuditReportService
  readonly logger?: Pick<Console, 'warn' | 'error'>
}

export interface AuditReportIpcHandlers {
  getContext(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<AuditReportGetContextResult>
  search(event: IpcSenderValidationEvent, request: unknown): Promise<AuditReportSearchResult>
}

export function createAuditReportIpcHandlers({
  navigationPolicy,
  auditReportService,
  logger = console
}: AuditReportIpcHandlerDependencies): AuditReportIpcHandlers {
  const handle = async <TRequest, TResult>(
    event: IpcSenderValidationEvent,
    request: unknown,
    channel: string,
    requestSchema: Schema<TRequest>,
    resultSchema: Schema<TResult>,
    invoke: (request: TRequest) => unknown
  ): Promise<TResult> => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      logger.warn(`IPC handler result event=audit-report; channel=${channel}; code=IPC_FORBIDDEN`)
      return createIpcFailure('IPC_FORBIDDEN') as TResult
    }

    const parsed = safeParse(requestSchema, request)
    if (!parsed.success) return createIpcSuccess({ status: 'VALIDATION_FAILED' }) as TResult

    try {
      const result = createIpcSuccess(invoke(parsed.data))
      const validated = safeParse(resultSchema, result)
      if (validated.success) return validated.data
    } catch {
      // The renderer receives only the controlled result below.
    }

    logger.error(`IPC handler result event=audit-report; channel=${channel}; code=INTERNAL_ERROR`)
    return createIpcSuccess({ status: 'UNAVAILABLE' }) as TResult
  }

  return Object.freeze({
    getContext: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<AuditReportGetContextResult> =>
      handle(
        event,
        request,
        ipcChannels.auditReports.getContext,
        auditReportGetContextRequestSchema,
        auditReportGetContextResultSchema,
        () => auditReportService.getContext()
      ),
    search: (event: IpcSenderValidationEvent, request: unknown): Promise<AuditReportSearchResult> =>
      handle(
        event,
        request,
        ipcChannels.auditReports.search,
        auditReportSearchRequestSchema,
        auditReportSearchResultSchema,
        (data) => auditReportService.search(data)
      )
  })
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
