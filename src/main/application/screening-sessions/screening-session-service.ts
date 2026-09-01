import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  parseAuditActionCode,
  parseAuditEntityType,
  parseLocalUserRole,
  parseScreeningSessionCloseReason,
  parseScreeningSessionDate,
  parseScreeningSessionListInput,
  parseScreeningSessionNote,
  parseScreeningSessionReopenReason,
  parseScreeningSessionTransitionRowVersion,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  ScreeningSessionAlreadyExistsError,
  type AuditMetadata,
  type InstallationRecord,
  type LocalUserRole,
  type ScreeningSessionDate,
  type ScreeningSessionOutboxPayload,
  type ScreeningSessionRecord,
  type ScreeningSessionStatus
} from '@main/database'
import { EntityIdGenerationError, parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { getErrorType } from '@main/foundation/error-type'
import { parseUtcTimestamp, UtcClockError, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  getScreeningSessionServiceErrorType,
  isScreeningSessionServiceError,
  rebuildScreeningSessionServiceError,
  ScreeningSessionServiceAuthorizationError,
  ScreeningSessionServicePersistenceError,
  ScreeningSessionServiceStateIntegrityError,
  ScreeningSessionServiceValidationError
} from './screening-session-service-errors'
import type {
  CloseScreeningSessionRequest,
  CloseScreeningSessionResult,
  CreateScreeningSessionRequest,
  CreateScreeningSessionResult,
  GetScreeningSessionRequest,
  GetScreeningSessionResult,
  ListScreeningSessionsRequest,
  ListScreeningSessionsResult,
  ReopenScreeningSessionRequest,
  ReopenScreeningSessionResult,
  ScreeningSessionService,
  ScreeningSessionServiceActor,
  ScreeningSessionServiceDependencies
} from './screening-session-service-types'

const createdAction = parseAuditActionCode('SCREENING_SESSION_CREATED')
const closedAction = parseAuditActionCode('SCREENING_SESSION_CLOSED')
const reopenedAction = parseAuditActionCode('SCREENING_SESSION_REOPENED')
const screeningSessionEntityType = parseAuditEntityType('SCREENING_SESSION')
const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const reopenRoles = new Set<LocalUserRole>(['LOCAL_ADMIN', 'NURSE'])
const createRequestKeys = Object.freeze(['locationId', 'sessionDate', 'notes'] as const)
const closeRequestRequiredKeys = Object.freeze(['id', 'expectedRowVersion'] as const)
const closeRequestOptionalKeys = Object.freeze(['reason'] as const)
const reopenRequestKeys = Object.freeze(['id', 'expectedRowVersion', 'reason'] as const)
const getRequestKeys = Object.freeze(['id'] as const)

interface ValidatedActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

interface ParsedCreateCommand {
  readonly locationId: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly notes: string | null
}

interface ParsedTransitionCommand {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly reason: string | null
}

interface ParsedReopenCommand {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly reason: string
}

export function createScreeningSessionService({
  installationRepository,
  locationRepository,
  protocolVersionRepository,
  screeningSessionRepository,
  screeningSessionSummaryRepository,
  screeningSessionOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningSessionServiceDependencies): ScreeningSessionService {
  return Object.freeze({
    create(
      request: CreateScreeningSessionRequest,
      actor: ScreeningSessionServiceActor
    ): CreateScreeningSessionResult {
      try {
        const validatedActor = validateActor(actor)
        const command = parseCreateCommand(request)

        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const installation = readInitializedInstallation(installationRepository)
          const deploymentLocalDate = getDeploymentLocalDate(occurredAt, installation)

          if (command.sessionDate !== deploymentLocalDate) {
            return Object.freeze({ status: 'SESSION_DATE_NOT_CURRENT' as const })
          }

          const location = locationRepository.getByIdForWrite(
            context.connection,
            command.locationId
          )

          if (location === null) {
            return Object.freeze({ status: 'LOCATION_NOT_FOUND' as const })
          }

          if (!location.isActive) {
            return Object.freeze({ status: 'LOCATION_INACTIVE' as const })
          }

          const protocolVersion = protocolVersionRepository.getActiveForWrite(context.connection)

          if (protocolVersion === null) {
            return Object.freeze({ status: 'NO_ACTIVE_PROTOCOL' as const })
          }

          const sessionId = context.newEntityId()
          const lifecycleHistoryId = context.newEntityId()

          let session: ScreeningSessionRecord

          try {
            session = screeningSessionRepository.insert(context.connection, {
              id: sessionId,
              lifecycleHistoryId,
              locationId: command.locationId,
              protocolVersionId: protocolVersion.id,
              sessionDate: command.sessionDate,
              notes: command.notes,
              createdBy: validatedActor.userId,
              createdAt: occurredAt
            })
          } catch (error) {
            if (error instanceof ScreeningSessionAlreadyExistsError) {
              return Object.freeze({ status: 'ALREADY_EXISTS' as const })
            }

            throw error
          }

          insertAuditEvent({
            auditEventRepository,
            auditEventId: context.newEntityId(),
            installation,
            actor: validatedActor,
            session,
            action: createdAction,
            occurredAt,
            metadata: createLifecycleAuditMetadata({
              session,
              transition: 'CREATED',
              priorRowVersion: null,
              resultingRowVersion: session.rowVersion
            }),
            connection: context.connection
          })
          insertOutboxEvent({
            screeningSessionOutboxRepository,
            session,
            operation: 'SCREENING_SESSION_CREATED',
            createdAt: occurredAt,
            lifecycleHistoryId,
            transitionType: 'CREATED',
            fromStatus: null,
            toStatus: 'OPEN',
            reason: null,
            changedBy: validatedActor.userId,
            changedAt: occurredAt,
            priorRowVersion: null,
            resultingRowVersion: session.rowVersion,
            connection: context.connection,
            outboxId: context.newEntityId()
          })

          return Object.freeze({ status: 'CREATED' as const, session })
        })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    },

    close(
      request: CloseScreeningSessionRequest,
      actor: ScreeningSessionServiceActor
    ): CloseScreeningSessionResult {
      try {
        const validatedActor = validateActor(actor)
        const command = parseCloseCommand(request)

        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const lifecycleHistoryId = context.newEntityId()
          const result = screeningSessionRepository.close(context.connection, {
            id: command.id,
            lifecycleHistoryId,
            expectedRowVersion: command.expectedRowVersion,
            closedBy: validatedActor.userId,
            closedAt: occurredAt,
            reason: command.reason
          })

          if (result.status !== 'CLOSED') {
            return freezeCloseResult(result)
          }

          const installation = readInitializedInstallation(installationRepository)

          insertAuditEvent({
            auditEventRepository,
            auditEventId: context.newEntityId(),
            installation,
            actor: validatedActor,
            session: result.session,
            action: closedAction,
            occurredAt,
            metadata: createLifecycleAuditMetadata({
              session: result.session,
              transition: 'CLOSED',
              priorRowVersion: command.expectedRowVersion,
              resultingRowVersion: result.session.rowVersion
            }),
            connection: context.connection
          })
          insertOutboxEvent({
            screeningSessionOutboxRepository,
            session: result.session,
            operation: 'SCREENING_SESSION_CLOSED',
            createdAt: occurredAt,
            lifecycleHistoryId,
            transitionType: 'CLOSED',
            fromStatus: 'OPEN',
            toStatus: 'CLOSED',
            reason: command.reason,
            changedBy: validatedActor.userId,
            changedAt: occurredAt,
            priorRowVersion: command.expectedRowVersion,
            resultingRowVersion: result.session.rowVersion,
            connection: context.connection,
            outboxId: context.newEntityId()
          })

          return freezeCloseResult(result)
        })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    },

    reopen(
      request: ReopenScreeningSessionRequest,
      actor: ScreeningSessionServiceActor
    ): ReopenScreeningSessionResult {
      try {
        const validatedActor = validateActor(actor)
        const command = parseReopenCommand(request)

        if (!reopenRoles.has(validatedActor.role)) {
          return Object.freeze({ status: 'FORBIDDEN' as const })
        }

        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const lifecycleHistoryId = context.newEntityId()
          const result = screeningSessionRepository.reopen(context.connection, {
            id: command.id,
            lifecycleHistoryId,
            expectedRowVersion: command.expectedRowVersion,
            reopenedBy: validatedActor.userId,
            reopenedAt: occurredAt,
            reason: command.reason
          })

          if (result.status !== 'REOPENED') {
            return freezeReopenResult(result)
          }

          const installation = readInitializedInstallation(installationRepository)

          insertAuditEvent({
            auditEventRepository,
            auditEventId: context.newEntityId(),
            installation,
            actor: validatedActor,
            session: result.session,
            action: reopenedAction,
            occurredAt,
            metadata: createLifecycleAuditMetadata({
              session: result.session,
              transition: 'REOPENED',
              priorRowVersion: command.expectedRowVersion,
              resultingRowVersion: result.session.rowVersion
            }),
            connection: context.connection
          })
          insertOutboxEvent({
            screeningSessionOutboxRepository,
            session: result.session,
            operation: 'SCREENING_SESSION_REOPENED',
            createdAt: occurredAt,
            lifecycleHistoryId,
            transitionType: 'REOPENED',
            fromStatus: 'CLOSED',
            toStatus: 'OPEN',
            reason: command.reason,
            changedBy: validatedActor.userId,
            changedAt: occurredAt,
            priorRowVersion: command.expectedRowVersion,
            resultingRowVersion: result.session.rowVersion,
            connection: context.connection,
            outboxId: context.newEntityId()
          })

          return freezeReopenResult(result)
        })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    },

    getById(
      request: GetScreeningSessionRequest,
      actor: ScreeningSessionServiceActor
    ): GetScreeningSessionResult {
      try {
        validateActor(actor)
        const command = parseGetCommand(request)
        const session = screeningSessionRepository.getById(command.id)

        if (session === null) {
          return Object.freeze({ status: 'NOT_FOUND' as const })
        }

        return Object.freeze({ status: 'FOUND' as const, session })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    },

    list(
      request: ListScreeningSessionsRequest,
      actor: ScreeningSessionServiceActor
    ): ListScreeningSessionsResult {
      try {
        validateActor(actor)
        const parsed = parseScreeningSessionListInput(request)
        const result = screeningSessionRepository.list({
          locationId: parsed.locationId === null ? null : parseEntityId(parsed.locationId),
          status: parsed.status,
          dateFrom: parsed.dateFrom === null ? null : parseScreeningSessionDate(parsed.dateFrom),
          dateTo: parsed.dateTo === null ? null : parseScreeningSessionDate(parsed.dateTo),
          page: parsed.page,
          pageSize: parsed.pageSize
        })

        return Object.freeze({
          status: 'LISTED' as const,
          items: result.items,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total
        })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    },

    getSummary(request: GetScreeningSessionRequest, actor: ScreeningSessionServiceActor) {
      try {
        validateActor(actor)
        const command = parseGetCommand(request)
        if (screeningSessionSummaryRepository === undefined)
          throw new ScreeningSessionServicePersistenceError()
        const summary = screeningSessionSummaryRepository.getBySessionId(command.id)
        return summary === null
          ? Object.freeze({ status: 'NOT_FOUND' as const })
          : Object.freeze({ status: 'FOUND' as const, summary })
      } catch (error) {
        throw toScreeningSessionServiceBoundaryError(error)
      }
    }
  })
}

function validateActor(actor: ScreeningSessionServiceActor): ValidatedActor {
  try {
    const data = readDataProperties(actor, ['userId', 'role'])
    const userId = parseEntityId(data.userId)
    const role = parseLocalUserRole(data.role)

    if (!allowedRoles.includes(role)) {
      throw new ScreeningSessionServiceValidationError()
    }

    return Object.freeze({ userId, role })
  } catch (error) {
    if (error instanceof ScreeningSessionServiceValidationError) {
      throw new ScreeningSessionServiceValidationError(error.errorType)
    }

    throw new ScreeningSessionServiceValidationError(getErrorType(error))
  }
}

function parseCreateCommand(request: CreateScreeningSessionRequest): ParsedCreateCommand {
  try {
    const data = readDataProperties(request, createRequestKeys)

    return Object.freeze({
      locationId: parseEntityId(data.locationId),
      sessionDate: parseScreeningSessionDate(data.sessionDate),
      notes: parseScreeningSessionNote(data.notes)
    })
  } catch (error) {
    throw new ScreeningSessionServiceValidationError(getErrorType(error))
  }
}

function parseCloseCommand(request: CloseScreeningSessionRequest): ParsedTransitionCommand {
  try {
    const data = readDataProperties(request, closeRequestRequiredKeys, closeRequestOptionalKeys)
    const reason =
      Object.prototype.hasOwnProperty.call(data, 'reason') && data.reason !== undefined
        ? parseScreeningSessionCloseReason(data.reason)
        : null

    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parseScreeningSessionTransitionRowVersion(data.expectedRowVersion),
      reason
    })
  } catch (error) {
    throw new ScreeningSessionServiceValidationError(getErrorType(error))
  }
}

function parseReopenCommand(request: ReopenScreeningSessionRequest): ParsedReopenCommand {
  try {
    const data = readDataProperties(request, reopenRequestKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parseScreeningSessionTransitionRowVersion(data.expectedRowVersion),
      reason: parseScreeningSessionReopenReason(data.reason)
    })
  } catch (error) {
    throw new ScreeningSessionServiceValidationError(getErrorType(error))
  }
}

function parseGetCommand(request: GetScreeningSessionRequest): { readonly id: EntityId } {
  try {
    const data = readDataProperties(request, getRequestKeys)

    return Object.freeze({ id: parseEntityId(data.id) })
  } catch (error) {
    throw new ScreeningSessionServiceValidationError(getErrorType(error))
  }
}

function readInitializedInstallation(
  installationRepository: ScreeningSessionServiceDependencies['installationRepository']
): InstallationRecord {
  try {
    const installation = installationRepository.get()

    if (installation === null) {
      throw new ScreeningSessionServiceStateIntegrityError()
    }

    return installation
  } catch (error) {
    if (error instanceof ScreeningSessionServiceStateIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new ScreeningSessionServicePersistenceError(getErrorType(error))
    }

    throw error
  }
}

function getDeploymentLocalDate(
  utcTimestamp: UtcTimestamp,
  installation: InstallationRecord
): ScreeningSessionDate {
  try {
    const parsedTimestamp = parseUtcTimestamp(utcTimestamp)
    const instant = new Date(parsedTimestamp)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: installation.timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const parts = formatter.formatToParts(instant)
    const year = readDatePart(parts, 'year')
    const month = readDatePart(parts, 'month')
    const day = readDatePart(parts, 'day')

    return parseScreeningSessionDate(`${year}-${month}-${day}`)
  } catch (error) {
    if (error instanceof ScreeningSessionServiceStateIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    throw new ScreeningSessionServiceStateIntegrityError(getErrorType(error))
  }
}

function readDatePart(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  const part = parts.find((candidate) => candidate.type === type)

  if (part === undefined || !/^\d{2,4}$/u.test(part.value)) {
    throw new ScreeningSessionServiceStateIntegrityError()
  }

  return part.value
}

function insertAuditEvent({
  auditEventRepository,
  auditEventId,
  installation,
  actor,
  session,
  action,
  occurredAt,
  metadata,
  connection
}: {
  readonly auditEventRepository: ScreeningSessionServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly session: ScreeningSessionRecord
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly occurredAt: UtcTimestamp
  readonly metadata: AuditMetadata
  readonly connection: Parameters<
    ScreeningSessionServiceDependencies['auditEventRepository']['insert']
  >[0]
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action,
    entityType: screeningSessionEntityType,
    entityId: session.id,
    occurredAt,
    metadata
  })
}

function insertOutboxEvent({
  screeningSessionOutboxRepository,
  session,
  operation,
  createdAt,
  lifecycleHistoryId,
  transitionType,
  fromStatus,
  toStatus,
  reason,
  changedBy,
  changedAt,
  priorRowVersion,
  resultingRowVersion,
  connection,
  outboxId
}: {
  readonly screeningSessionOutboxRepository: ScreeningSessionServiceDependencies['screeningSessionOutboxRepository']
  readonly session: ScreeningSessionRecord
  readonly operation:
    'SCREENING_SESSION_CREATED' | 'SCREENING_SESSION_CLOSED' | 'SCREENING_SESSION_REOPENED'
  readonly createdAt: UtcTimestamp
  readonly lifecycleHistoryId: EntityId
  readonly transitionType: 'CREATED' | 'CLOSED' | 'REOPENED'
  readonly fromStatus: ScreeningSessionStatus | null
  readonly toStatus: ScreeningSessionStatus
  readonly reason: string | null
  readonly changedBy: EntityId
  readonly changedAt: UtcTimestamp
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number
  readonly connection: Parameters<
    ScreeningSessionServiceDependencies['screeningSessionOutboxRepository']['insert']
  >[0]
  readonly outboxId: EntityId
}): void {
  screeningSessionOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: session.id,
    operation,
    payloadSchemaVersion: 'screening-session.lifecycle.v1',
    createdAt,
    payload: createLifecycleOutboxPayload({
      session,
      lifecycleHistoryId,
      transitionType,
      fromStatus,
      toStatus,
      reason,
      changedBy,
      changedAt,
      priorRowVersion,
      resultingRowVersion
    })
  })
}

function createLifecycleAuditMetadata({
  session,
  transition,
  priorRowVersion,
  resultingRowVersion
}: {
  readonly session: ScreeningSessionRecord
  readonly transition: 'CREATED' | 'CLOSED' | 'REOPENED'
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number
}): AuditMetadata {
  return Object.freeze({
    lifecycle_transition: transition,
    location_id: session.locationId,
    prior_row_version: priorRowVersion,
    resulting_row_version: resultingRowVersion,
    session_id: session.id
  })
}

function createLifecycleOutboxPayload({
  session,
  lifecycleHistoryId,
  transitionType,
  fromStatus,
  toStatus,
  reason,
  changedBy,
  changedAt,
  priorRowVersion,
  resultingRowVersion
}: {
  readonly session: ScreeningSessionRecord
  readonly lifecycleHistoryId: EntityId
  readonly transitionType: 'CREATED' | 'CLOSED' | 'REOPENED'
  readonly fromStatus: ScreeningSessionStatus | null
  readonly toStatus: ScreeningSessionStatus
  readonly reason: string | null
  readonly changedBy: EntityId
  readonly changedAt: UtcTimestamp
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number
}): ScreeningSessionOutboxPayload {
  return Object.freeze({
    screening_session_id: session.id,
    location_id: session.locationId,
    protocol_version_id: session.protocolVersionId,
    session_date: session.sessionDate,
    lifecycle_history_id: lifecycleHistoryId,
    transition_type: transitionType,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    notes: session.notes,
    changed_by: changedBy,
    changed_at: changedAt,
    prior_row_version: priorRowVersion,
    resulting_row_version: resultingRowVersion
  })
}

function freezeCloseResult(result: CloseScreeningSessionResult): CloseScreeningSessionResult {
  if (result.status === 'NOT_FOUND') {
    return Object.freeze({ status: 'NOT_FOUND' as const })
  }

  return Object.freeze({ ...result })
}

function freezeReopenResult(result: ReopenScreeningSessionResult): ReopenScreeningSessionResult {
  if (result.status === 'NOT_FOUND') {
    return Object.freeze({ status: 'NOT_FOUND' as const })
  }

  return Object.freeze({ ...result })
}

function readDataProperties(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> {
  let isArray: boolean

  try {
    isArray = Array.isArray(value)
  } catch {
    throw new ScreeningSessionServiceValidationError()
  }

  if (typeof value !== 'object' || value === null || isArray) {
    throw new ScreeningSessionServiceValidationError()
  }

  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new ScreeningSessionServiceValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new ScreeningSessionServiceValidationError()
  }

  const allowedKeys = new Set<string>([...requiredKeys, ...optionalKeys])
  const keys = Reflect.ownKeys(descriptors)

  for (const key of keys) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new ScreeningSessionServiceValidationError()
    }
  }

  for (const key of requiredKeys) {
    if (!keys.includes(key)) {
      throw new ScreeningSessionServiceValidationError()
    }
  }

  const data: Record<string, unknown> = {}

  for (const key of keys) {
    const propertyName = key as string
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new ScreeningSessionServiceValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function toScreeningSessionServiceBoundaryError(error: unknown): Error {
  if (isScreeningSessionServiceError(error)) {
    return rebuildScreeningSessionServiceError(error)
  }

  if (error instanceof RepositoryValidationError) {
    return new ScreeningSessionServiceValidationError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new ScreeningSessionServiceStateIntegrityError(error.errorType)
  }

  if (
    error instanceof RepositoryReadError ||
    error instanceof RepositoryWriteError ||
    error instanceof AuditEventAlreadyExistsError ||
    error instanceof ScreeningSessionAlreadyExistsError ||
    error instanceof DatabaseTransactionStateError ||
    error instanceof DatabaseTransactionAsyncWorkError ||
    error instanceof EntityIdGenerationError ||
    error instanceof UtcClockError
  ) {
    return new ScreeningSessionServicePersistenceError(getScreeningSessionServiceErrorType(error))
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return mapTransactionExecutionError(error)
  }

  return new ScreeningSessionServicePersistenceError(getErrorType(error))
}

function mapTransactionExecutionError(error: DatabaseTransactionExecutionError): Error {
  switch (error.errorType) {
    case 'ScreeningSessionServiceValidationError':
    case 'RepositoryValidationError':
      return new ScreeningSessionServiceValidationError(error.errorType)
    case 'ScreeningSessionServiceAuthorizationError':
      return new ScreeningSessionServiceAuthorizationError(error.errorType)
    case 'ScreeningSessionServiceStateIntegrityError':
    case 'RepositoryDataIntegrityError':
      return new ScreeningSessionServiceStateIntegrityError(error.errorType)
    case 'EntityIdGenerationError':
    case 'UtcClockError':
      return new ScreeningSessionServicePersistenceError(error.errorType)
    default:
      return new ScreeningSessionServicePersistenceError(error.errorType)
  }
}
