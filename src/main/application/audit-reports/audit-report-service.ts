import {
  createAuditReportRepository,
  type AuditReportRepository,
  type AuditReportSearchInput
} from '@main/database'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  type LocalAuthenticationSessionService
} from '@main/application/authentication/session'
import {
  auditReportSearchRequestSchema,
  type AuditReportGetContextResult,
  type AuditReportSearchRequest,
  type AuditReportSearchResult
} from '@shared/ipc'
import type Database from 'better-sqlite3'

const adminRoles = Object.freeze(['LOCAL_ADMIN'] as const)

type AuditReportContextData = Extract<AuditReportGetContextResult, { ok: true }>['data']
type AuditReportSearchData = Extract<AuditReportSearchResult, { ok: true }>['data']
type ControlledStatus = Exclude<AuditReportContextData['status'], 'LOADED'>

export interface AuditReportService {
  getContext(): AuditReportContextData
  search(request: AuditReportSearchRequest): AuditReportSearchData
}

export interface AuditReportServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly auditReportRepository: AuditReportRepository
}

export function createAuditReportService({
  authenticationSessionService,
  auditReportRepository
}: AuditReportServiceDependencies): AuditReportService {
  return Object.freeze({
    getContext(): AuditReportContextData {
      const authority = authorize(authenticationSessionService)
      if (authority !== null) return Object.freeze({ status: authority })

      try {
        const context = auditReportRepository.getContext()
        return Object.freeze({
          status: 'LOADED' as const,
          deployment: context.deployment,
          actors: [...context.actors],
          actions: [...context.actions],
          entityTypes: [...context.entityTypes],
          hasSystemEvents: context.hasSystemEvents
        })
      } catch {
        return Object.freeze({ status: 'UNAVAILABLE' as const })
      }
    },

    search(request: AuditReportSearchRequest): AuditReportSearchData {
      const authority = authorize(authenticationSessionService)
      if (authority !== null) return Object.freeze({ status: authority })

      const parsed = safeParseSearchRequest(request)
      if (parsed === null) return Object.freeze({ status: 'VALIDATION_FAILED' as const })

      try {
        const result = auditReportRepository.search(toRepositoryInput(parsed))
        return Object.freeze({
          status: 'LOADED' as const,
          items: result.items.map((item) => ({
            ...item,
            actor: item.actor === null ? null : { ...item.actor },
            deployment: { ...item.deployment },
            metadata: { ...item.metadata }
          })),
          page: result.page,
          pageSize: result.pageSize,
          total: result.total
        })
      } catch {
        return Object.freeze({ status: 'UNAVAILABLE' as const })
      }
    }
  })
}

export interface ProductionAuditReportServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
}

export function createProductionAuditReportService({
  connection,
  authenticationSessionService
}: ProductionAuditReportServiceOptions): AuditReportService {
  return createAuditReportService({
    authenticationSessionService,
    auditReportRepository: createAuditReportRepository(connection)
  })
}

function authorize(service: LocalAuthenticationSessionService): ControlledStatus | null {
  try {
    service.requireAnyRole(adminRoles)
    return null
  } catch (error) {
    if (
      error instanceof LocalSessionUnauthenticatedError ||
      error instanceof LocalSessionLockedError ||
      error instanceof LocalSessionPasswordChangeRequiredError
    ) {
      return 'AUTHENTICATION_REQUIRED'
    }
    if (error instanceof LocalSessionAuthorizationError) return 'FORBIDDEN'
    return 'UNAVAILABLE'
  }
}

function safeParseSearchRequest(
  request: AuditReportSearchRequest
): AuditReportSearchRequest | null {
  try {
    const result = auditReportSearchRequestSchema.safeParse(request)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function toRepositoryInput(request: AuditReportSearchRequest): AuditReportSearchInput {
  return Object.freeze({
    query: request.query,
    occurredFromInclusive: request.occurredFromInclusive,
    occurredToExclusive: request.occurredToExclusive,
    actor:
      request.actor.kind === 'USER'
        ? Object.freeze({ kind: 'USER' as const, userId: request.actor.userId })
        : Object.freeze({ kind: request.actor.kind }),
    action: request.action,
    entityType: request.entityType,
    entityId: request.entityId,
    page: request.page,
    pageSize: request.pageSize
  })
}
