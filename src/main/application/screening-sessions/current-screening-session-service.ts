import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  ScreeningSessionAlreadyExistsError,
  parseAuditActionCode,
  parseAuditEntityType,
  parseScreeningSessionDate,
  type AuditMetadata,
  type InstallationRecord,
  type LocationRecord,
  type ScreeningSessionOutboxPayload,
  type ScreeningSessionRecord
} from '@main/database'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { EntityIdGenerationError, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, UtcClockError, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  CurrentScreeningSessionLocation,
  CurrentScreeningSessionService,
  CurrentScreeningSessionServiceDependencies,
  CurrentScreeningSessionSummary,
  CurrentScreeningSessionTransactionInput,
  EnsureCurrentScreeningSessionResult,
  FindCurrentScreeningSessionResult
} from './current-screening-session-service-types'

const createdAction = parseAuditActionCode('SCREENING_SESSION_CREATED')
const screeningSessionEntityType = parseAuditEntityType('SCREENING_SESSION')
const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)

interface ValidatedActor {
  readonly userId: EntityId
}

type AuthenticationFailureResult = {
  readonly status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE'
}

export function createCurrentScreeningSessionService({
  authenticationSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  protocolVersionRepository,
  screeningSessionRepository,
  screeningSessionOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: CurrentScreeningSessionServiceDependencies): CurrentScreeningSessionService {
  return Object.freeze({
    ensureCurrentScreeningSession(): EnsureCurrentScreeningSessionResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)

      if (actorResult.status !== 'VALID') {
        return result(actorResult.result.status)
      }

      const configuredLocationResult =
        installationLocationService.resolveConfiguredInstallationLocation()

      if (configuredLocationResult.status !== 'RESOLVED') {
        return result(configuredLocationResult.status)
      }

      try {
        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const authorityResult = readCurrentSessionAuthority({
            connection: context.connection,
            occurredAt,
            configuredLocationId: configuredLocationResult.location.id,
            installationRepository,
            locationRepository,
            screeningSessionRepository
          })

          if (authorityResult.status !== 'VALID') {
            return result(authorityResult.status)
          }

          const { installation, sessionDate, location, session: existing } = authorityResult.context

          if (existing !== null) {
            return resolveCanonicalSession(existing, location)
          }

          const protocolVersion = protocolVersionRepository.getActiveForWrite(context.connection)

          if (protocolVersion === null) {
            return result('NO_ACTIVE_PROTOCOL')
          }

          const sessionId = context.newEntityId()
          const lifecycleHistoryId = context.newEntityId()
          let session: ScreeningSessionRecord

          try {
            session = screeningSessionRepository.insert(context.connection, {
              id: sessionId,
              lifecycleHistoryId,
              locationId: location.id,
              protocolVersionId: protocolVersion.id,
              sessionDate,
              notes: null,
              createdBy: actorResult.actor.userId,
              createdAt: occurredAt
            })
          } catch (error) {
            if (error instanceof ScreeningSessionAlreadyExistsError) {
              return recoverCanonicalSession({
                screeningSessionRepository,
                connection: context.connection,
                location,
                sessionDate
              })
            }

            throw error
          }

          insertAuditEvent({
            auditEventRepository,
            auditEventId: context.newEntityId(),
            installation,
            actor: actorResult.actor,
            session,
            occurredAt,
            connection: context.connection
          })
          insertOutboxEvent({
            screeningSessionOutboxRepository,
            session,
            createdAt: occurredAt,
            lifecycleHistoryId,
            changedBy: actorResult.actor.userId,
            changedAt: occurredAt,
            connection: context.connection,
            outboxId: context.newEntityId()
          })

          return sessionResult('CREATED', session, location)
        })
      } catch {
        return result('UNAVAILABLE')
      }
    },

    findCurrentScreeningSession(): FindCurrentScreeningSessionResult {
      try {
        return transactionExecutor.run((context) => {
          return findCurrentScreeningSessionInTransaction({
            connection: context.connection,
            occurredAt: context.nowUtc(),
            authenticationSessionService,
            installationLocationService,
            installationRepository,
            locationRepository,
            screeningSessionRepository
          })
        })
      } catch {
        return findResult('UNAVAILABLE')
      }
    },

    findCurrentScreeningSessionInTransaction(
      input: CurrentScreeningSessionTransactionInput
    ): FindCurrentScreeningSessionResult {
      try {
        return findCurrentScreeningSessionInTransaction({
          ...input,
          authenticationSessionService,
          installationLocationService,
          installationRepository,
          locationRepository,
          screeningSessionRepository
        })
      } catch {
        return findResult('UNAVAILABLE')
      }
    }
  })
}

function findCurrentScreeningSessionInTransaction({
  connection,
  occurredAt,
  authenticationSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository
}: CurrentScreeningSessionTransactionInput & {
  readonly authenticationSessionService: CurrentScreeningSessionServiceDependencies['authenticationSessionService']
  readonly installationLocationService: CurrentScreeningSessionServiceDependencies['installationLocationService']
  readonly installationRepository: CurrentScreeningSessionServiceDependencies['installationRepository']
  readonly locationRepository: CurrentScreeningSessionServiceDependencies['locationRepository']
  readonly screeningSessionRepository: CurrentScreeningSessionServiceDependencies['screeningSessionRepository']
}): FindCurrentScreeningSessionResult {
  const actorResult = resolveTrustedActor(authenticationSessionService)

  if (actorResult.status !== 'VALID') {
    return findResult(actorResult.result.status)
  }

  const configuredLocationResult =
    installationLocationService.resolveConfiguredInstallationLocation()

  if (configuredLocationResult.status !== 'RESOLVED') {
    return findResult(configuredLocationResult.status)
  }

  const authorityResult = readCurrentSessionAuthority({
    connection,
    occurredAt,
    configuredLocationId: configuredLocationResult.location.id,
    installationRepository,
    locationRepository,
    screeningSessionRepository
  })

  if (authorityResult.status !== 'VALID') {
    return findResult(authorityResult.status)
  }

  if (authorityResult.context.session === null) {
    return findResult('SESSION_NOT_FOUND')
  }

  if (authorityResult.context.session.status === 'CLOSED') {
    return findResult('SESSION_CLOSED')
  }

  return foundSessionResult(authorityResult.context.session, authorityResult.context.location)
}

type CurrentSessionAuthorityContext = {
  readonly installation: InstallationRecord
  readonly sessionDate: ReturnType<typeof parseScreeningSessionDate>
  readonly location: LocationRecord
  readonly session: ScreeningSessionRecord | null
}

function readCurrentSessionAuthority({
  connection,
  occurredAt,
  configuredLocationId,
  installationRepository,
  locationRepository,
  screeningSessionRepository
}: {
  readonly connection: DatabaseTransactionConnection
  readonly occurredAt: UtcTimestamp
  readonly configuredLocationId: EntityId
  readonly installationRepository: CurrentScreeningSessionServiceDependencies['installationRepository']
  readonly locationRepository: CurrentScreeningSessionServiceDependencies['locationRepository']
  readonly screeningSessionRepository: CurrentScreeningSessionServiceDependencies['screeningSessionRepository']
}):
  | { readonly status: 'VALID'; readonly context: CurrentSessionAuthorityContext }
  | {
      readonly status: 'LOCATION_NOT_FOUND' | 'LOCATION_INACTIVE'
    } {
  const installation = readInitializedInstallation(installationRepository)
  const sessionDate = getDeploymentLocalDate(occurredAt, installation)
  const location = locationRepository.getByIdForWrite(connection, configuredLocationId)

  if (location === null) {
    return { status: 'LOCATION_NOT_FOUND' }
  }

  if (!location.isActive) {
    return { status: 'LOCATION_INACTIVE' }
  }

  return {
    status: 'VALID',
    context: {
      installation,
      sessionDate,
      location,
      session: screeningSessionRepository.findByLocationAndDateForWrite(
        connection,
        location.id,
        sessionDate
      )
    }
  }
}

function resolveTrustedActor(
  authenticationSessionService: CurrentScreeningSessionServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly result: AuthenticationFailureResult } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)

    return {
      status: 'VALID',
      actor: Object.freeze({ userId: context.user.id })
    }
  } catch (error) {
    return { status: 'INVALID', result: mapAuthenticationFailure(error) }
  }
}

function recoverCanonicalSession({
  screeningSessionRepository,
  connection,
  location,
  sessionDate
}: {
  readonly screeningSessionRepository: CurrentScreeningSessionServiceDependencies['screeningSessionRepository']
  readonly connection: Parameters<
    CurrentScreeningSessionServiceDependencies['screeningSessionRepository']['findByLocationAndDateForWrite']
  >[0]
  readonly location: LocationRecord
  readonly sessionDate: ReturnType<typeof parseScreeningSessionDate>
}): EnsureCurrentScreeningSessionResult {
  const canonical = screeningSessionRepository.findByLocationAndDateForWrite(
    connection,
    location.id,
    sessionDate
  )

  if (canonical === null) {
    return result('SESSION_CONFLICT')
  }

  return resolveCanonicalSession(canonical, location)
}

function resolveCanonicalSession(
  session: ScreeningSessionRecord,
  location: LocationRecord
): EnsureCurrentScreeningSessionResult {
  if (session.status === 'CLOSED') {
    return result('SESSION_CLOSED')
  }

  return sessionResult('RESOLVED', session, location)
}

function readInitializedInstallation(
  installationRepository: CurrentScreeningSessionServiceDependencies['installationRepository']
): InstallationRecord {
  const installation = installationRepository.get()

  if (installation === null) {
    throw new RepositoryDataIntegrityError()
  }

  return installation
}

function getDeploymentLocalDate(
  utcTimestamp: UtcTimestamp,
  installation: InstallationRecord
): ReturnType<typeof parseScreeningSessionDate> {
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
    if (isControlledInfrastructureError(error)) {
      throw error
    }

    throw new RepositoryDataIntegrityError()
  }
}

function readDatePart(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  const part = parts.find((candidate) => candidate.type === type)

  if (part === undefined || !/^\d{2,4}$/u.test(part.value)) {
    throw new RepositoryDataIntegrityError()
  }

  return part.value
}

function insertAuditEvent({
  auditEventRepository,
  auditEventId,
  installation,
  actor,
  session,
  occurredAt,
  connection
}: {
  readonly auditEventRepository: CurrentScreeningSessionServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly session: ScreeningSessionRecord
  readonly occurredAt: UtcTimestamp
  readonly connection: Parameters<
    CurrentScreeningSessionServiceDependencies['auditEventRepository']['insert']
  >[0]
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action: createdAction,
    entityType: screeningSessionEntityType,
    entityId: session.id,
    occurredAt,
    metadata: createLifecycleAuditMetadata(session)
  })
}

function insertOutboxEvent({
  screeningSessionOutboxRepository,
  session,
  createdAt,
  lifecycleHistoryId,
  changedBy,
  changedAt,
  connection,
  outboxId
}: {
  readonly screeningSessionOutboxRepository: CurrentScreeningSessionServiceDependencies['screeningSessionOutboxRepository']
  readonly session: ScreeningSessionRecord
  readonly createdAt: UtcTimestamp
  readonly lifecycleHistoryId: EntityId
  readonly changedBy: EntityId
  readonly changedAt: UtcTimestamp
  readonly connection: Parameters<
    CurrentScreeningSessionServiceDependencies['screeningSessionOutboxRepository']['insert']
  >[0]
  readonly outboxId: EntityId
}): void {
  screeningSessionOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: session.id,
    operation: 'SCREENING_SESSION_CREATED',
    payloadSchemaVersion: 'screening-session.lifecycle.v1',
    createdAt,
    payload: createLifecycleOutboxPayload({
      session,
      lifecycleHistoryId,
      changedBy,
      changedAt
    })
  })
}

function createLifecycleAuditMetadata(session: ScreeningSessionRecord): AuditMetadata {
  return Object.freeze({
    lifecycle_transition: 'CREATED',
    location_id: session.locationId,
    prior_row_version: null,
    resulting_row_version: session.rowVersion,
    session_id: session.id
  })
}

function createLifecycleOutboxPayload({
  session,
  lifecycleHistoryId,
  changedBy,
  changedAt
}: {
  readonly session: ScreeningSessionRecord
  readonly lifecycleHistoryId: EntityId
  readonly changedBy: EntityId
  readonly changedAt: UtcTimestamp
}): ScreeningSessionOutboxPayload {
  return Object.freeze({
    screening_session_id: session.id,
    location_id: session.locationId,
    protocol_version_id: session.protocolVersionId,
    session_date: session.sessionDate,
    lifecycle_history_id: lifecycleHistoryId,
    transition_type: 'CREATED',
    from_status: null,
    to_status: 'OPEN',
    reason: null,
    notes: session.notes,
    changed_by: changedBy,
    changed_at: changedAt,
    prior_row_version: null,
    resulting_row_version: session.rowVersion
  })
}

function sessionResult(
  status: 'RESOLVED' | 'CREATED',
  session: ScreeningSessionRecord,
  location: LocationRecord
): EnsureCurrentScreeningSessionResult {
  return Object.freeze({
    status,
    session: toCurrentSessionSummary(session),
    location: toCurrentSessionLocation(location)
  })
}

function foundSessionResult(
  session: ScreeningSessionRecord,
  location: LocationRecord
): FindCurrentScreeningSessionResult {
  return Object.freeze({
    status: 'FOUND' as const,
    session: toCurrentSessionSummary(session),
    location: toCurrentSessionLocation(location)
  })
}

function toCurrentSessionSummary(session: ScreeningSessionRecord): CurrentScreeningSessionSummary {
  if (session.status !== 'OPEN' || session.closedAt !== null) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id: session.id,
    locationId: session.locationId,
    protocolVersionId: session.protocolVersionId,
    sessionDate: session.sessionDate,
    status: session.status,
    notes: null,
    openedAt: session.openedAt,
    closedAt: null,
    createdAt: session.createdAt,
    rowVersion: session.rowVersion
  })
}

function toCurrentSessionLocation(location: LocationRecord): CurrentScreeningSessionLocation {
  return Object.freeze({
    id: location.id,
    displayName: location.name
  })
}

function result(
  status: Exclude<EnsureCurrentScreeningSessionResult['status'], 'RESOLVED' | 'CREATED'>
): EnsureCurrentScreeningSessionResult {
  return Object.freeze({ status }) as EnsureCurrentScreeningSessionResult
}

function findResult(
  status: Exclude<FindCurrentScreeningSessionResult['status'], 'FOUND'>
): FindCurrentScreeningSessionResult {
  return Object.freeze({ status })
}

function mapAuthenticationFailure(error: unknown): AuthenticationFailureResult {
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  ) {
    return Object.freeze({ status: 'AUTHENTICATION_REQUIRED' })
  }

  if (error instanceof LocalSessionAuthorizationError) {
    return Object.freeze({ status: 'FORBIDDEN' })
  }

  if (isLocalSessionError(error)) {
    return Object.freeze({ status: 'UNAVAILABLE' })
  }

  return Object.freeze({ status: 'UNAVAILABLE' })
}

function isControlledInfrastructureError(error: unknown): boolean {
  return (
    error instanceof AuditEventAlreadyExistsError ||
    error instanceof DatabaseTransactionAsyncWorkError ||
    error instanceof DatabaseTransactionExecutionError ||
    error instanceof DatabaseTransactionStateError ||
    error instanceof EntityIdGenerationError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof RepositoryReadError ||
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryWriteError ||
    error instanceof ScreeningSessionAlreadyExistsError ||
    error instanceof UtcClockError
  )
}
