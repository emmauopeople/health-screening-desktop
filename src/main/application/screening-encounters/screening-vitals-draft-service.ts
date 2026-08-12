import {
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  parseAuditActionCode,
  parseAuditEntityType,
  parseNullableScreeningEncounterText,
  parseScreeningVitalsDraftRowVersion,
  parseVitalsMeasurementSite,
  parseVitalsMeasurementTime,
  parseVitalsPatientPosition,
  readDataProperties,
  type AuditMetadata,
  type InstallationRecord,
  type ReplaceScreeningVitalsDraftReadingInput,
  type ScreeningEncounterRecord,
  type ScreeningSessionRecord,
  type ScreeningVitalsDraftRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  CompleteVitalsStepResult,
  GetVitalsDraftRequest,
  GetVitalsDraftResult,
  SaveVitalsDraftRequest,
  SaveVitalsDraftResult,
  ScreeningVitalsDraftService,
  ScreeningVitalsDraftServiceDependencies,
  VitalsDraftControlledStatus,
  VitalsDraftReadingSummary,
  VitalsDraftSummary
} from './screening-vitals-draft-service-types'

const savedAction = parseAuditActionCode('SCREENING_VITALS_DRAFT_SAVED')
const completedAction = parseAuditActionCode('SCREENING_VITALS_STEP_COMPLETED')
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const getRequestKeys = Object.freeze(['encounterId'] as const)
const saveRequestKeys = Object.freeze([
  'encounterId',
  'expectedVersion',
  'readings',
  'weightKg',
  'waistCm',
  'notes'
] as const)
const readingRequestKeys = Object.freeze([
  'id',
  'sequenceNumber',
  'systolic',
  'diastolic',
  'pulse',
  'measurementSite',
  'patientPosition',
  'measurementTime'
] as const)
const maximumReadingCount = 12

interface ValidatedActor {
  readonly userId: EntityId
}

interface ParsedGetCommand {
  readonly encounterId: EntityId
}

interface ParsedSaveCommand {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly readings: readonly ParsedSaveVitalsDraftReadingInput[]
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
}

interface ParsedSaveVitalsDraftReadingInput {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: ReplaceScreeningVitalsDraftReadingInput['measurementSite']
  readonly patientPosition: ReplaceScreeningVitalsDraftReadingInput['patientPosition']
  readonly measurementTime: ReplaceScreeningVitalsDraftReadingInput['measurementTime']
}

interface ValidatedEncounterContext {
  readonly installation: InstallationRecord
  readonly encounter: ScreeningEncounterRecord
  readonly session: ScreeningSessionRecord
}

type SaveOrCompleteVitalsDraftBaseInput = {
  readonly request: SaveVitalsDraftRequest
  readonly targetStatus: ScreeningVitalsDraftRecord['status']
  readonly auditAction: ReturnType<typeof parseAuditActionCode>
  readonly outboxOperation: 'SCREENING_VITALS_DRAFT_SAVED' | 'SCREENING_VITALS_STEP_COMPLETED'
  readonly outboxSchemaVersion:
    'screening-encounter.vitals-draft-saved.v1' | 'screening-encounter.vitals-step-completed.v1'
} & ScreeningVitalsDraftServiceDependencies

export function createScreeningVitalsDraftService({
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  screeningVitalsDraftRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningVitalsDraftServiceDependencies): ScreeningVitalsDraftService {
  return Object.freeze({
    getVitalsDraft(request: GetVitalsDraftRequest): GetVitalsDraftResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)

      if (actorResult.status !== 'VALID') {
        return getStatus(actorResult.statusCode)
      }

      const commandResult = parseGetCommand(request)

      if (commandResult.status !== 'VALID') {
        return getStatus('VALIDATION_FAILED')
      }

      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()

      if (locationResult.status !== 'RESOLVED') {
        return getStatus(locationResult.status)
      }

      try {
        return transactionExecutor.run((context) => {
          const encounterContext = validateEncounterContext({
            command: commandResult.command,
            configuredLocationId: locationResult.location.id,
            dependencies: {
              installationRepository,
              locationRepository,
              screeningSessionRepository,
              screeningEncounterRepository
            },
            connection: context.connection
          })

          if (encounterContext.status !== 'VALID') {
            return getStatus(encounterContext.statusCode)
          }

          const draft = screeningVitalsDraftRepository.getByEncounterIdForWrite(
            context.connection,
            commandResult.command.encounterId
          )

          return Object.freeze({
            status: 'LOADED' as const,
            draft: draft === null ? null : toDraftSummary(draft)
          })
        })
      } catch {
        return getStatus('UNAVAILABLE')
      }
    },

    saveVitalsDraft(request: SaveVitalsDraftRequest): SaveVitalsDraftResult {
      return saveOrCompleteVitalsDraft({
        request,
        targetStatus: 'DRAFT',
        successStatus: 'SAVED',
        auditAction: savedAction,
        outboxOperation: 'SCREENING_VITALS_DRAFT_SAVED',
        outboxSchemaVersion: 'screening-encounter.vitals-draft-saved.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        screeningVitalsDraftRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    },

    completeVitalsStep(request: SaveVitalsDraftRequest): CompleteVitalsStepResult {
      return saveOrCompleteVitalsDraft({
        request,
        targetStatus: 'VITALS_COMPLETE',
        successStatus: 'COMPLETED',
        auditAction: completedAction,
        outboxOperation: 'SCREENING_VITALS_STEP_COMPLETED',
        outboxSchemaVersion: 'screening-encounter.vitals-step-completed.v1',
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        installationRepository,
        locationRepository,
        screeningSessionRepository,
        screeningEncounterRepository,
        screeningVitalsDraftRepository,
        screeningEncounterOutboxRepository,
        auditEventRepository,
        transactionExecutor
      })
    }
  })
}

function saveOrCompleteVitalsDraft(
  input: SaveOrCompleteVitalsDraftBaseInput & { readonly successStatus: 'SAVED' }
): SaveVitalsDraftResult
function saveOrCompleteVitalsDraft(
  input: SaveOrCompleteVitalsDraftBaseInput & { readonly successStatus: 'COMPLETED' }
): CompleteVitalsStepResult
function saveOrCompleteVitalsDraft({
  request,
  targetStatus,
  successStatus,
  auditAction,
  outboxOperation,
  outboxSchemaVersion,
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  screeningVitalsDraftRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: SaveOrCompleteVitalsDraftBaseInput & {
  readonly successStatus: 'SAVED' | 'COMPLETED'
}): SaveVitalsDraftResult | CompleteVitalsStepResult {
  const actorResult = resolveTrustedActor(authenticationSessionService)

  if (actorResult.status !== 'VALID') {
    return statusResult(actorResult.statusCode)
  }

  const commandResult = parseSaveCommand(request)

  if (commandResult.status !== 'VALID') {
    return statusResult('VALIDATION_FAILED')
  }

  if (targetStatus === 'VITALS_COMPLETE' && !isCompleteVitals(commandResult.command.readings)) {
    return statusResult('VALIDATION_FAILED')
  }

  const locationResult = installationLocationService.resolveConfiguredInstallationLocation()

  if (locationResult.status !== 'RESOLVED') {
    return statusResult(locationResult.status)
  }

  try {
    const persistedDraft = screeningVitalsDraftRepository.getByEncounterId(
      commandResult.command.encounterId
    )
    let firstDraftSessionId: EntityId | undefined

    if (persistedDraft === null) {
      const currentSessionResult = currentScreeningSessionService.ensureCurrentScreeningSession()

      if (currentSessionResult.status !== 'RESOLVED' && currentSessionResult.status !== 'CREATED') {
        return statusResult(mapCurrentSessionFailure(currentSessionResult.status))
      }

      firstDraftSessionId = currentSessionResult.session.id
    }

    return transactionExecutor.run((context) => {
      const occurredAt = context.nowUtc()
      const encounterContext = validateEncounterContext({
        command: commandResult.command,
        configuredLocationId: locationResult.location.id,
        dependencies: {
          installationRepository,
          locationRepository,
          screeningSessionRepository,
          screeningEncounterRepository
        },
        connection: context.connection
      })

      if (encounterContext.status !== 'VALID') {
        return statusResult(encounterContext.statusCode)
      }

      const existing = screeningVitalsDraftRepository.getByEncounterIdForWrite(
        context.connection,
        commandResult.command.encounterId
      )
      const ownershipResult = validateReadingOwnership(existing, commandResult.command.readings)

      if (ownershipResult !== 'VALID') {
        return statusResult(ownershipResult)
      }

      if (existing !== null && commandResult.command.expectedVersion !== existing.rowVersion) {
        if (isExistingDraftEquivalent(existing, commandResult.command, targetStatus)) {
          return successResult(successStatus, existing)
        }

        return statusResult('VERSION_CONFLICT')
      }

      if (existing === null && commandResult.command.expectedVersion !== null) {
        return statusResult('VERSION_CONFLICT')
      }

      if (
        existing === null &&
        (firstDraftSessionId === undefined ||
          encounterContext.context.encounter.screeningSessionId !== firstDraftSessionId)
      ) {
        return statusResult('SESSION_NOT_CURRENT')
      }

      if (
        existing !== null &&
        isExistingDraftEquivalent(existing, commandResult.command, targetStatus)
      ) {
        return successResult(successStatus, existing)
      }

      const readings = commandResult.command.readings.map((reading) =>
        toReplacementReading(reading, () => context.newEntityId())
      )
      const draft =
        existing === null
          ? screeningVitalsDraftRepository.insert(context.connection, {
              id: context.newEntityId(),
              encounterId: commandResult.command.encounterId,
              status: targetStatus,
              weightKg: commandResult.command.weightKg,
              waistCm: commandResult.command.waistCm,
              notes: commandResult.command.notes,
              createdBy: actorResult.actor.userId,
              createdAt: occurredAt,
              readings
            })
          : updateExistingDraft({
              screeningVitalsDraftRepository,
              existing,
              command: commandResult.command,
              targetStatus,
              actor: actorResult.actor,
              occurredAt,
              readings,
              connection: context.connection
            })

      if (draft === 'VERSION_CONFLICT') {
        return statusResult('VERSION_CONFLICT')
      }

      insertAuditEvent({
        auditEventRepository,
        auditEventId: context.newEntityId(),
        installation: encounterContext.context.installation,
        actor: actorResult.actor,
        encounter: encounterContext.context.encounter,
        draft,
        action: auditAction,
        occurredAt,
        connection: context.connection
      })
      insertOutboxEvent({
        screeningEncounterOutboxRepository,
        outboxId: context.newEntityId(),
        encounter: encounterContext.context.encounter,
        draft,
        operation: outboxOperation,
        payloadSchemaVersion: outboxSchemaVersion,
        createdAt: occurredAt,
        connection: context.connection
      })

      return successResult(successStatus, draft)
    })
  } catch {
    return statusResult('UNAVAILABLE')
  }
}

function updateExistingDraft({
  screeningVitalsDraftRepository,
  existing,
  command,
  targetStatus,
  actor,
  occurredAt,
  readings,
  connection
}: {
  readonly screeningVitalsDraftRepository: ScreeningVitalsDraftServiceDependencies['screeningVitalsDraftRepository']
  readonly existing: ScreeningVitalsDraftRecord
  readonly command: ParsedSaveCommand
  readonly targetStatus: ScreeningVitalsDraftRecord['status']
  readonly actor: ValidatedActor
  readonly occurredAt: UtcTimestamp
  readonly readings: readonly ReplaceScreeningVitalsDraftReadingInput[]
  readonly connection: Parameters<
    ScreeningVitalsDraftServiceDependencies['screeningVitalsDraftRepository']['update']
  >[0]
}): ScreeningVitalsDraftRecord | 'VERSION_CONFLICT' {
  if (isExistingDraftEquivalent(existing, command, targetStatus)) {
    return existing
  }

  const updateResult = screeningVitalsDraftRepository.update(connection, {
    id: existing.id,
    expectedRowVersion: existing.rowVersion,
    status: targetStatus,
    weightKg: command.weightKg,
    waistCm: command.waistCm,
    notes: command.notes,
    updatedBy: actor.userId,
    updatedAt: occurredAt,
    readings
  })

  if (updateResult.status === 'UPDATED') {
    return updateResult.draft
  }

  return 'VERSION_CONFLICT'
}

function validateEncounterContext({
  command,
  configuredLocationId,
  dependencies,
  connection
}: {
  readonly command: ParsedGetCommand
  readonly configuredLocationId: EntityId
  readonly dependencies: Pick<
    ScreeningVitalsDraftServiceDependencies,
    | 'installationRepository'
    | 'locationRepository'
    | 'screeningSessionRepository'
    | 'screeningEncounterRepository'
  >
  readonly connection: Parameters<
    ScreeningVitalsDraftServiceDependencies['screeningEncounterRepository']['getByIdForWrite']
  >[0]
}):
  | { readonly status: 'VALID'; readonly context: ValidatedEncounterContext }
  | { readonly status: 'INVALID'; readonly statusCode: VitalsDraftControlledStatus } {
  const installation = readInitializedInstallation(dependencies.installationRepository)
  const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
    connection,
    command.encounterId
  )

  if (encounter === null || encounter.amendmentOfEncounterId !== null) {
    return invalidContext('ENCOUNTER_NOT_FOUND')
  }

  if (encounter.status !== 'DRAFT') {
    return invalidContext('ENCOUNTER_NOT_EDITABLE')
  }

  const session = dependencies.screeningSessionRepository.getByIdForWrite(
    connection,
    encounter.screeningSessionId
  )

  if (session === null) {
    return invalidContext('SESSION_NOT_FOUND')
  }

  const location = dependencies.locationRepository.getByIdForWrite(connection, configuredLocationId)

  if (location === null) {
    return invalidContext('LOCATION_NOT_FOUND')
  }

  if (!location.isActive) {
    return invalidContext('LOCATION_INACTIVE')
  }

  if (session.status !== 'OPEN') {
    return invalidContext('SESSION_CLOSED')
  }

  if (
    session.locationId !== configuredLocationId ||
    encounter.locationId !== configuredLocationId ||
    encounter.screeningSessionId !== session.id
  ) {
    return invalidContext('SESSION_NOT_CURRENT')
  }

  return Object.freeze({
    status: 'VALID' as const,
    context: Object.freeze({ installation, encounter, session })
  })
}

function resolveTrustedActor(
  authenticationSessionService: ScreeningVitalsDraftServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly statusCode: VitalsDraftControlledStatus } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)

    return Object.freeze({
      status: 'VALID' as const,
      actor: Object.freeze({ userId: context.user.id })
    })
  } catch (error) {
    return Object.freeze({
      status: 'INVALID' as const,
      statusCode: mapAuthenticationFailure(error)
    })
  }
}

function parseGetCommand(
  request: GetVitalsDraftRequest
):
  | { readonly status: 'VALID'; readonly command: ParsedGetCommand }
  | { readonly status: 'INVALID' } {
  try {
    const data = readDataProperties(request, getRequestKeys)

    return Object.freeze({
      status: 'VALID' as const,
      command: Object.freeze({ encounterId: parseEntityId(data.encounterId) })
    })
  } catch {
    return Object.freeze({ status: 'INVALID' as const })
  }
}

function parseSaveCommand(
  request: SaveVitalsDraftRequest
):
  | { readonly status: 'VALID'; readonly command: ParsedSaveCommand }
  | { readonly status: 'INVALID' } {
  try {
    const data = readDataProperties(request, saveRequestKeys)

    return Object.freeze({
      status: 'VALID' as const,
      command: Object.freeze({
        encounterId: parseEntityId(data.encounterId),
        expectedVersion: parseExpectedVersion(data.expectedVersion),
        readings: parseRequestReadings(data.readings),
        weightKg: parseOptionalPositiveReal(data.weightKg),
        waistCm: parseOptionalPositiveReal(data.waistCm),
        notes: parseNullableScreeningEncounterText(data.notes)
      })
    })
  } catch {
    return Object.freeze({ status: 'INVALID' as const })
  }
}

function parseRequestReadings(value: unknown): readonly ParsedSaveVitalsDraftReadingInput[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new RepositoryValidationError()
  }

  if (value.length < 1 || value.length > maximumReadingCount) {
    throw new RepositoryValidationError()
  }

  const ids = new Set<string>()
  const sequenceNumbers = new Set<number>()
  const readings = value.map(parseRequestReading)

  for (const reading of readings) {
    if (reading.id !== null) {
      if (ids.has(reading.id)) {
        throw new RepositoryValidationError()
      }
      ids.add(reading.id)
    }

    if (sequenceNumbers.has(reading.sequenceNumber)) {
      throw new RepositoryValidationError()
    }
    sequenceNumbers.add(reading.sequenceNumber)
  }

  for (let expectedSequence = 1; expectedSequence <= readings.length; expectedSequence += 1) {
    if (!sequenceNumbers.has(expectedSequence)) {
      throw new RepositoryValidationError()
    }
  }

  return Object.freeze(readings)
}

function parseRequestReading(value: unknown): ParsedSaveVitalsDraftReadingInput {
  const data = readDataProperties(value, readingRequestKeys)

  return Object.freeze({
    id: data.id === null ? null : parseEntityId(data.id),
    sequenceNumber: parseSequenceNumber(data.sequenceNumber),
    systolic: parseOptionalPositiveInteger(data.systolic),
    diastolic: parseOptionalPositiveInteger(data.diastolic),
    pulse: parseOptionalPositiveInteger(data.pulse),
    measurementSite:
      data.measurementSite === null ? null : parseVitalsMeasurementSite(data.measurementSite),
    patientPosition:
      data.patientPosition === null ? null : parseVitalsPatientPosition(data.patientPosition),
    measurementTime:
      data.measurementTime === null ? null : parseVitalsMeasurementTime(data.measurementTime)
  })
}

function parseExpectedVersion(value: unknown): number | null {
  return value === null ? null : parseScreeningVitalsDraftRowVersion(value)
}

function parseSequenceNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseOptionalPositiveReal(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || Object.is(value, -0)) {
    throw new RepositoryValidationError()
  }

  return value
}

function validateReadingOwnership(
  existing: ScreeningVitalsDraftRecord | null,
  readings: readonly ParsedSaveVitalsDraftReadingInput[]
): 'VALID' | 'VALIDATION_FAILED' {
  if (existing === null) {
    return readings.some((reading) => reading.id !== null) ? 'VALIDATION_FAILED' : 'VALID'
  }

  const existingIds = new Set(existing.readings.map((reading) => reading.id))

  const firstReading = existing.readings.find((reading) => reading.sequenceNumber === 1)

  if (firstReading !== undefined && !readings.some((reading) => reading.id === firstReading.id)) {
    return 'VALIDATION_FAILED'
  }

  return readings.some((reading) => reading.id !== null && !existingIds.has(reading.id))
    ? 'VALIDATION_FAILED'
    : 'VALID'
}

function isCompleteVitals(readings: readonly ParsedSaveVitalsDraftReadingInput[]): boolean {
  const firstReading = readings.find((reading) => reading.sequenceNumber === 1)

  if (firstReading === undefined || isReadingEmpty(firstReading)) {
    return false
  }

  return readings.every(isReadingComplete)
}

function isReadingComplete(reading: ParsedSaveVitalsDraftReadingInput): boolean {
  return (
    reading.systolic !== null &&
    reading.diastolic !== null &&
    reading.pulse !== null &&
    reading.measurementSite !== null &&
    reading.patientPosition !== null &&
    reading.measurementTime !== null
  )
}

function isReadingEmpty(reading: ParsedSaveVitalsDraftReadingInput): boolean {
  return (
    reading.systolic === null &&
    reading.diastolic === null &&
    reading.pulse === null &&
    reading.measurementSite === null &&
    reading.patientPosition === null &&
    reading.measurementTime === null
  )
}

function toReplacementReading(
  reading: ParsedSaveVitalsDraftReadingInput,
  newEntityId: () => EntityId
): ReplaceScreeningVitalsDraftReadingInput {
  return Object.freeze({
    id: reading.id ?? newEntityId(),
    sequenceNumber: reading.sequenceNumber,
    systolic: reading.systolic,
    diastolic: reading.diastolic,
    pulse: reading.pulse,
    measurementSite: reading.measurementSite,
    patientPosition: reading.patientPosition,
    measurementTime: reading.measurementTime
  })
}

function isExistingDraftEquivalent(
  existing: ScreeningVitalsDraftRecord,
  command: ParsedSaveCommand,
  targetStatus: ScreeningVitalsDraftRecord['status']
): boolean {
  if (
    existing.status !== targetStatus ||
    existing.weightKg !== command.weightKg ||
    existing.waistCm !== command.waistCm ||
    existing.notes !== command.notes ||
    existing.readings.length !== command.readings.length
  ) {
    return false
  }

  return existing.readings.every((existingReading, index) => {
    const requested = command.readings[index]

    return (
      requested !== undefined &&
      requested.id === existingReading.id &&
      requested.sequenceNumber === existingReading.sequenceNumber &&
      requested.systolic === existingReading.systolic &&
      requested.diastolic === existingReading.diastolic &&
      requested.pulse === existingReading.pulse &&
      requested.measurementSite === existingReading.measurementSite &&
      requested.patientPosition === existingReading.patientPosition &&
      requested.measurementTime === existingReading.measurementTime
    )
  })
}

function readInitializedInstallation(
  installationRepository: ScreeningVitalsDraftServiceDependencies['installationRepository']
): InstallationRecord {
  const installation = installationRepository.get()

  if (installation === null) {
    throw new RepositoryDataIntegrityError()
  }

  return installation
}

function insertAuditEvent({
  auditEventRepository,
  auditEventId,
  installation,
  actor,
  encounter,
  draft,
  action,
  occurredAt,
  connection
}: {
  readonly auditEventRepository: ScreeningVitalsDraftServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly encounter: ScreeningEncounterRecord
  readonly draft: ScreeningVitalsDraftRecord
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly occurredAt: UtcTimestamp
  readonly connection: Parameters<
    ScreeningVitalsDraftServiceDependencies['auditEventRepository']['insert']
  >[0]
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action,
    entityType: screeningEncounterEntityType,
    entityId: encounter.id,
    occurredAt,
    metadata: createEventMetadata(draft)
  })
}

function insertOutboxEvent({
  screeningEncounterOutboxRepository,
  outboxId,
  encounter,
  draft,
  operation,
  payloadSchemaVersion,
  createdAt,
  connection
}: {
  readonly screeningEncounterOutboxRepository: ScreeningVitalsDraftServiceDependencies['screeningEncounterOutboxRepository']
  readonly outboxId: EntityId
  readonly encounter: ScreeningEncounterRecord
  readonly draft: ScreeningVitalsDraftRecord
  readonly operation: 'SCREENING_VITALS_DRAFT_SAVED' | 'SCREENING_VITALS_STEP_COMPLETED'
  readonly payloadSchemaVersion:
    'screening-encounter.vitals-draft-saved.v1' | 'screening-encounter.vitals-step-completed.v1'
  readonly createdAt: UtcTimestamp
  readonly connection: Parameters<
    ScreeningVitalsDraftServiceDependencies['screeningEncounterOutboxRepository']['insert']
  >[0]
}): void {
  screeningEncounterOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: encounter.id,
    operation,
    payloadSchemaVersion,
    createdAt,
    payload: createEventMetadata(draft)
  })
}

function createEventMetadata(draft: ScreeningVitalsDraftRecord): AuditMetadata {
  return Object.freeze({
    draft_id: draft.id,
    encounter_id: draft.encounterId,
    draft_status: draft.status,
    reading_count: draft.readings.length,
    row_version: draft.rowVersion
  })
}

function toDraftSummary(draft: ScreeningVitalsDraftRecord): VitalsDraftSummary {
  return Object.freeze({
    id: draft.id,
    encounterId: draft.encounterId,
    status: draft.status,
    readings: Object.freeze(draft.readings.map(toReadingSummary)),
    weightKg: draft.weightKg,
    waistCm: draft.waistCm,
    notes: draft.notes,
    rowVersion: draft.rowVersion,
    updatedAt: draft.updatedAt
  })
}

function toReadingSummary(
  reading: ScreeningVitalsDraftRecord['readings'][number]
): VitalsDraftReadingSummary {
  return Object.freeze({
    id: reading.id,
    sequenceNumber: reading.sequenceNumber,
    systolic: reading.systolic,
    diastolic: reading.diastolic,
    pulse: reading.pulse,
    measurementSite: reading.measurementSite,
    patientPosition: reading.patientPosition,
    measurementTime: reading.measurementTime
  })
}

function successResult(
  status: 'SAVED' | 'COMPLETED',
  draft: ScreeningVitalsDraftRecord
): SaveVitalsDraftResult | CompleteVitalsStepResult {
  return Object.freeze({ status, draft: toDraftSummary(draft) }) as
    SaveVitalsDraftResult | CompleteVitalsStepResult
}

function statusResult(status: VitalsDraftControlledStatus): {
  readonly status: VitalsDraftControlledStatus
} {
  return Object.freeze({ status })
}

function getStatus(status: VitalsDraftControlledStatus): GetVitalsDraftResult {
  return Object.freeze({ status })
}

function invalidContext(statusCode: VitalsDraftControlledStatus): {
  readonly status: 'INVALID'
  readonly statusCode: VitalsDraftControlledStatus
} {
  return Object.freeze({ status: 'INVALID', statusCode })
}

function mapAuthenticationFailure(error: unknown): VitalsDraftControlledStatus {
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  ) {
    return 'AUTHENTICATION_REQUIRED'
  }

  if (error instanceof LocalSessionAuthorizationError) {
    return 'FORBIDDEN'
  }

  if (isLocalSessionError(error)) {
    return 'UNAVAILABLE'
  }

  return 'UNAVAILABLE'
}

function mapCurrentSessionFailure(
  status:
    | 'AUTHENTICATION_REQUIRED'
    | 'FORBIDDEN'
    | 'LOCATION_NOT_CONFIGURED'
    | 'LOCATION_NOT_FOUND'
    | 'LOCATION_INACTIVE'
    | 'SESSION_CLOSED'
    | 'SESSION_CONFLICT'
    | 'NO_ACTIVE_PROTOCOL'
    | 'UNAVAILABLE'
): VitalsDraftControlledStatus {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'AUTHENTICATION_REQUIRED'
    case 'FORBIDDEN':
      return 'FORBIDDEN'
    case 'LOCATION_NOT_CONFIGURED':
      return 'LOCATION_NOT_CONFIGURED'
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_NOT_FOUND'
    case 'LOCATION_INACTIVE':
      return 'LOCATION_INACTIVE'
    case 'SESSION_CLOSED':
      return 'SESSION_CLOSED'
    case 'SESSION_CONFLICT':
    case 'NO_ACTIVE_PROTOCOL':
    case 'UNAVAILABLE':
      return 'UNAVAILABLE'
  }
}
