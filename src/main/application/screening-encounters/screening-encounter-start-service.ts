import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  parseAuditActionCode,
  parseAuditEntityType,
  parseScreeningSessionDate,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type AuditMetadata,
  type InstallationRecord,
  type LocalUserRole,
  type ScreeningEncounterOutboxPayload,
  type ScreeningEncounterRecord
} from '@main/database'
import { EntityIdGenerationError, parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, UtcClockError, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  ScreeningEncounterStartService,
  ScreeningEncounterStartServiceDependencies,
  ScreeningEncounterStartSummary,
  StartScreeningEncounterRequest,
  StartScreeningEncounterResult
} from './screening-encounter-start-service-types'

const startedAction = parseAuditActionCode('SCREENING_ENCOUNTER_STARTED')
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const startRequestKeys = Object.freeze(['patientId', 'screeningSessionId'] as const)
const repeatStartRequestKeys = Object.freeze([
  'patientId',
  'screeningSessionId',
  'repeatConfirmed'
] as const)

interface ValidatedActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

interface ParsedStartCommand {
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly repeatConfirmed: boolean
}

export function createScreeningEncounterStartService({
  authenticationSessionService,
  installationRepository,
  patientRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningEncounterStartServiceDependencies): ScreeningEncounterStartService {
  return Object.freeze({
    start(request: StartScreeningEncounterRequest): StartScreeningEncounterResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)

      if (actorResult.status !== 'VALID') {
        return actorResult.result
      }

      const commandResult = parseStartCommand(request)

      if (commandResult.status !== 'VALID') {
        return commandResult.result
      }

      try {
        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const installation = readInitializedInstallation(installationRepository)
          const deploymentLocalDate = getDeploymentLocalDate(occurredAt, installation)
          const session = screeningSessionRepository.getByIdForWrite(
            context.connection,
            commandResult.command.screeningSessionId
          )

          if (session === null) {
            return result('SESSION_NOT_FOUND')
          }

          const location = locationRepository.getByIdForWrite(
            context.connection,
            session.locationId
          )

          if (location === null) {
            return result('LOCATION_NOT_FOUND')
          }

          if (!location.isActive) {
            return result('LOCATION_INACTIVE')
          }

          if (session.status !== 'OPEN') {
            return result('SESSION_CLOSED')
          }

          if (session.sessionDate !== deploymentLocalDate) {
            return result('SESSION_NOT_CURRENT')
          }

          const patient = patientRepository.getByIdForWrite(
            context.connection,
            commandResult.command.patientId
          )

          if (patient === null) {
            return result('PATIENT_NOT_FOUND')
          }

          if (patient.status !== 'ACTIVE') {
            return result('PATIENT_INELIGIBLE')
          }

          const existing = screeningEncounterRepository.findActiveDraftByPatientAndSessionForWrite(
            context.connection,
            commandResult.command.patientId,
            commandResult.command.screeningSessionId
          )

          if (existing !== null) {
            return encounterResult('ALREADY_EXISTS', existing)
          }

          const hasCompletedRoot =
            screeningEncounterRepository.hasCompletedRootByPatientAndSessionForWrite(
              context.connection,
              commandResult.command.patientId,
              commandResult.command.screeningSessionId
            )

          if (hasCompletedRoot && !commandResult.command.repeatConfirmed) {
            return result('REPEAT_CONFIRMATION_REQUIRED')
          }

          const insertResult = screeningEncounterRepository.insertCanonicalRoot(
            context.connection,
            {
              id: context.newEntityId(),
              patientId: commandResult.command.patientId,
              screeningSessionId: session.id,
              locationId: session.locationId,
              protocolVersionId: session.protocolVersionId,
              startedAt: occurredAt,
              recordedBy: actorResult.actor.userId
            }
          )

          if (insertResult.status === 'IDENTITY_CONFLICT') {
            const resolved =
              screeningEncounterRepository.findActiveDraftByPatientAndSessionForWrite(
                context.connection,
                commandResult.command.patientId,
                commandResult.command.screeningSessionId
              )

            if (resolved === null) {
              throw new RepositoryDataIntegrityError()
            }

            return encounterResult('ALREADY_EXISTS', resolved)
          }

          insertAuditEvent({
            auditEventRepository,
            auditEventId: context.newEntityId(),
            installation,
            actor: actorResult.actor,
            encounter: insertResult.encounter,
            occurredAt,
            connection: context.connection
          })
          insertOutboxEvent({
            screeningEncounterOutboxRepository,
            outboxId: context.newEntityId(),
            encounter: insertResult.encounter,
            createdAt: occurredAt,
            connection: context.connection
          })

          return encounterResult('STARTED', insertResult.encounter)
        })
      } catch {
        return result('UNAVAILABLE')
      }
    }
  })
}

function resolveTrustedActor(
  authenticationSessionService: ScreeningEncounterStartServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly result: StartScreeningEncounterResult } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)

    return {
      status: 'VALID',
      actor: Object.freeze({ userId: context.user.id, role: context.user.role })
    }
  } catch (error) {
    return { status: 'INVALID', result: mapAuthenticationFailure(error) }
  }
}

function parseStartCommand(
  request: StartScreeningEncounterRequest
):
  | { readonly status: 'VALID'; readonly command: ParsedStartCommand }
  | { readonly status: 'INVALID'; readonly result: StartScreeningEncounterResult } {
  try {
    let data: Record<string, unknown>

    try {
      data = readDataProperties(request, startRequestKeys)
    } catch {
      data = readDataProperties(request, repeatStartRequestKeys)
    }

    const repeatConfirmed = data.repeatConfirmed ?? false

    if (typeof repeatConfirmed !== 'boolean') {
      throw new RepositoryValidationError()
    }

    return {
      status: 'VALID',
      command: Object.freeze({
        patientId: parseEntityId(data.patientId),
        screeningSessionId: parseEntityId(data.screeningSessionId),
        repeatConfirmed
      })
    }
  } catch {
    return { status: 'INVALID', result: result('VALIDATION_FAILED') }
  }
}

function readInitializedInstallation(
  installationRepository: ScreeningEncounterStartServiceDependencies['installationRepository']
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
  encounter,
  occurredAt,
  connection
}: {
  readonly auditEventRepository: ScreeningEncounterStartServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly encounter: ScreeningEncounterRecord
  readonly occurredAt: UtcTimestamp
  readonly connection: Parameters<
    ScreeningEncounterStartServiceDependencies['auditEventRepository']['insert']
  >[0]
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action: startedAction,
    entityType: screeningEncounterEntityType,
    entityId: encounter.id,
    occurredAt,
    metadata: createStartAuditMetadata(encounter)
  })
}

function insertOutboxEvent({
  screeningEncounterOutboxRepository,
  outboxId,
  encounter,
  createdAt,
  connection
}: {
  readonly screeningEncounterOutboxRepository: ScreeningEncounterStartServiceDependencies['screeningEncounterOutboxRepository']
  readonly outboxId: EntityId
  readonly encounter: ScreeningEncounterRecord
  readonly createdAt: UtcTimestamp
  readonly connection: Parameters<
    ScreeningEncounterStartServiceDependencies['screeningEncounterOutboxRepository']['insert']
  >[0]
}): void {
  screeningEncounterOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: encounter.id,
    operation: 'SCREENING_ENCOUNTER_STARTED',
    payloadSchemaVersion: 'screening-encounter.start.v1',
    createdAt,
    payload: createStartOutboxPayload(encounter)
  })
}

function createStartAuditMetadata(encounter: ScreeningEncounterRecord): AuditMetadata {
  return Object.freeze({
    encounter_id: encounter.id,
    location_id: encounter.locationId,
    patient_id: encounter.patientId,
    record_version: encounter.recordVersion,
    screening_session_id: encounter.screeningSessionId,
    status: encounter.status
  })
}

function createStartOutboxPayload(
  encounter: ScreeningEncounterRecord
): ScreeningEncounterOutboxPayload {
  return Object.freeze({
    encounter_id: encounter.id,
    location_id: encounter.locationId,
    patient_id: encounter.patientId,
    protocol_version_id: encounter.protocolVersionId,
    record_version: encounter.recordVersion,
    recorded_by: encounter.recordedBy,
    screening_session_id: encounter.screeningSessionId,
    started_at: encounter.startedAt,
    status: encounter.status
  })
}

function encounterResult(
  status: 'STARTED' | 'ALREADY_EXISTS',
  encounter: ScreeningEncounterRecord
): StartScreeningEncounterResult {
  return Object.freeze({
    status,
    encounter: toStartSummary(encounter)
  })
}

function toStartSummary(encounter: ScreeningEncounterRecord): ScreeningEncounterStartSummary {
  return Object.freeze({
    id: encounter.id,
    patientId: encounter.patientId,
    screeningSessionId: encounter.screeningSessionId,
    status: encounter.status,
    startedAt: encounter.startedAt,
    recordVersion: encounter.recordVersion
  })
}

function result(
  status: Exclude<StartScreeningEncounterResult['status'], 'STARTED' | 'ALREADY_EXISTS'>
): StartScreeningEncounterResult {
  return Object.freeze({ status }) as StartScreeningEncounterResult
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  let isArray: boolean

  try {
    isArray = Array.isArray(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (typeof value !== 'object' || value === null || isArray) {
    throw new RepositoryValidationError()
  }

  let prototype: unknown
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function mapAuthenticationFailure(error: unknown): StartScreeningEncounterResult {
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  ) {
    return result('AUTHENTICATION_REQUIRED')
  }

  if (error instanceof LocalSessionAuthorizationError) {
    return result('FORBIDDEN')
  }

  if (isLocalSessionError(error)) {
    return result('UNAVAILABLE')
  }

  return result('UNAVAILABLE')
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
    error instanceof UtcClockError
  )
}
