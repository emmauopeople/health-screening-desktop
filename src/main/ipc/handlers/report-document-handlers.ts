import type { LocalAuthenticationSessionService } from '@main/application/authentication/session/local-session-types'
import type {
  ReportDocumentRenderer,
  ReportDocumentService
} from '@main/application/report-documents/report-document-service'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { getErrorType } from '@main/foundation/error-type'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createReportDocumentFailure,
  ipcChannels,
  reportDocumentActionResultSchema,
  reportDocumentRequestSchema,
  type AuthenticationFailure,
  type ReportDocumentActionResult,
  type ReportDocumentErrorCode,
  type ReportDocumentIpcChannel,
  type ReportDocumentRequest
} from '@shared/ipc'

export interface ReportDocumentIpcEvent extends IpcSenderValidationEvent {
  readonly sender: IpcSenderValidationEvent['sender'] & ReportDocumentRenderer
}

export interface ReportDocumentIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly reportDocumentService: ReportDocumentService
  readonly logger?: Pick<Console, 'warn' | 'error'>
}

export interface ReportDocumentIpcHandlers {
  savePdf(event: ReportDocumentIpcEvent, request: unknown): Promise<ReportDocumentActionResult>
  print(event: ReportDocumentIpcEvent, request: unknown): Promise<ReportDocumentActionResult>
}

type ReportDocumentFailure = Extract<ReportDocumentActionResult, { ok: false }>

export function createReportDocumentIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  reportDocumentService,
  logger = console
}: ReportDocumentIpcHandlerDependencies): ReportDocumentIpcHandlers {
  const authorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy,
    authenticationSessionService,
    logger
  })

  const handle = async (
    event: ReportDocumentIpcEvent,
    request: unknown,
    channel: ReportDocumentIpcChannel,
    invoke: (renderer: ReportDocumentRenderer, parsed: ReportDocumentRequest) => Promise<unknown>
  ): Promise<ReportDocumentActionResult> => {
    const authorized = authorization.requireActiveSession(event)
    if (!authorized.ok) {
      const failure = mapAuthorizationFailure(authorized.failure)
      logFailure(logger, channel, failure.error.code)
      return failure
    }

    const parsed = safeParse(reportDocumentRequestSchema, request)
    if (!parsed.success) {
      const failure = createReportDocumentFailure('VALIDATION_FAILED')
      logFailure(logger, channel, failure.error.code)
      return failure
    }

    try {
      const result = createIpcSuccess(await invoke(event.sender, parsed.data))
      const validated = safeParse(reportDocumentActionResultSchema, result)
      if (validated.success) return validated.data
    } catch (error) {
      logFailure(logger, channel, 'INTERNAL_ERROR', error)
      return createReportDocumentFailure('INTERNAL_ERROR')
    }

    logFailure(logger, channel, 'INTERNAL_ERROR')
    return createReportDocumentFailure('INTERNAL_ERROR')
  }

  return Object.freeze({
    savePdf: (event: ReportDocumentIpcEvent, request: unknown) =>
      handle(event, request, ipcChannels.reportDocuments.savePdf, (renderer, parsed) =>
        reportDocumentService.savePdf(renderer, parsed)
      ),
    print: (event: ReportDocumentIpcEvent, request: unknown) =>
      handle(event, request, ipcChannels.reportDocuments.print, (renderer, parsed) =>
        reportDocumentService.print(renderer, parsed)
      )
  })
}

function mapAuthorizationFailure(failure: AuthenticationFailure): ReportDocumentFailure {
  switch (failure.error.code) {
    case 'IPC_FORBIDDEN':
      return createReportDocumentFailure('IPC_FORBIDDEN')
    case 'AUTH_UNAUTHENTICATED':
      return createReportDocumentFailure('AUTH_UNAUTHENTICATED')
    case 'AUTH_LOCKED':
      return createReportDocumentFailure('AUTH_LOCKED')
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return createReportDocumentFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
    case 'AUTHORIZATION_FAILED':
      return createReportDocumentFailure('AUTHORIZATION_FAILED')
    case 'VALIDATION_FAILED':
      return createReportDocumentFailure('VALIDATION_FAILED')
    default:
      return createReportDocumentFailure('INTERNAL_ERROR')
  }
}

function logFailure(
  logger: Pick<Console, 'warn' | 'error'>,
  channel: ReportDocumentIpcChannel,
  code: ReportDocumentErrorCode,
  error?: unknown
): void {
  const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
  const message = `IPC handler result event=report-document; channel=${channel}; code=${code}${errorType}`
  if (code === 'INTERNAL_ERROR') logger.error(message)
  else logger.warn(message)
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
