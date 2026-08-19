import {
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  parseAuditActionCode,
  parseAuditEntityType,
  isRowPermittingOtcResponse,
  readDataProperties,
  type AuditMetadata,
  type InstallationRecord,
  type OtcDraftRecord,
  type OtcDraftRowInput,
  type OtcRepository,
  type ScreeningEncounterRecord,
  type ScreeningSessionRecord
} from '@main/database'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import {
  isLocalSessionError,
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '../authentication/session'
import type {
  GetOtcWorkspaceRequest,
  GetOtcWorkspaceResult,
  OtcDraftRowSummary,
  OtcDraftSummary,
  OtcServiceControlledStatus,
  OtcWorkspaceSummary,
  SaveOtcDraftRequest,
  SaveOtcDraftResult,
  ScreeningOtcService,
  ScreeningOtcServiceDependencies
} from './screening-otc-service-types'
import { toOtcRecentMedicationSuggestionSummary } from './screening-otc-service-types'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const draftSavedAction = parseAuditActionCode('SCREENING_OTC_DRAFT_SAVED')
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const getRequestKeys = Object.freeze(['encounterId'] as const)
const saveRequestKeys = Object.freeze([
  'encounterId',
  'expectedVersion',
  'otcResponse',
  'rows'
] as const)
const rowRequestKeys = Object.freeze([
  'id',
  'sequenceNumber',
  'productName',
  'reasonForUse',
  'doseText',
  'frequencyText',
  'durationText',
  'sourceOfMedication',
  'currentlyTakingResponse'
] as const)

type ServiceDependencies = ScreeningOtcServiceDependencies

interface ValidatedActor {
  readonly userId: EntityId
}

interface ValidatedContext {
  readonly installation: InstallationRecord
  readonly encounter: ScreeningEncounterRecord
  readonly session: ScreeningSessionRecord
}

interface ParsedGetCommand {
  readonly encounterId: EntityId
}

interface ParsedSaveCommand {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly otcResponse: SaveOtcDraftRequest['otcResponse']
  readonly rows: readonly ParsedSaveOtcRow[]
}

interface ParsedSaveOtcRow {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly productName: string | null
  readonly reasonForUse: string | null
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTakingResponse: OtcDraftRowInput['currentlyTakingResponse']
}

export function createScreeningOtcService({
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  otcRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningOtcServiceDependencies): ScreeningOtcService {
  return Object.freeze({
    getWorkspace(request: GetOtcWorkspaceRequest): GetOtcWorkspaceResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)
      const command = parseGetCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')
      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return transactionExecutor.run<GetOtcWorkspaceResult>((context) => {
          const encounterContext = validateEncounterContext(
            context.connection,
            command.encounterId,
            locationResult.location.id,
            {
              installationRepository,
              locationRepository,
              screeningSessionRepository,
              screeningEncounterRepository
            }
          )
          if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)
          return loadedWorkspaceResult(
            otcRepository,
            context.connection,
            command.encounterId,
            encounterContext.context
          )
        })
      } catch {
        return statusResult('UNAVAILABLE')
      }
    },

    saveDraft(request: SaveOtcDraftRequest): SaveOtcDraftResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)
      const command = parseSaveCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')
      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return transactionExecutor.run<SaveOtcDraftResult>((context) => {
          const occurredAt = context.nowUtc()
          const encounterContext = validateEncounterContext(
            context.connection,
            command.encounterId,
            locationResult.location.id,
            {
              installationRepository,
              locationRepository,
              screeningSessionRepository,
              screeningEncounterRepository
            }
          )
          if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

          let existing = otcRepository.findDraftByEncounterForWrite(
            context.connection,
            command.encounterId
          )
          let createdDraft = false
          if (existing !== null && !matchesContext(existing, encounterContext.context)) {
            return statusResult('UNAVAILABLE')
          }
          if (existing === null && command.expectedVersion !== null)
            return statusResult('VERSION_CONFLICT')
          if (existing !== null && command.expectedVersion === null)
            return statusResult('VERSION_CONFLICT')

          if (existing === null) {
            const currentSessionStatus = requireCurrentSession(
              currentScreeningSessionService,
              context.connection,
              occurredAt,
              encounterContext.context.encounter.screeningSessionId
            )
            if (currentSessionStatus !== null) return statusResult(currentSessionStatus)
            existing = createDraft(
              otcRepository,
              context.connection,
              encounterContext.context,
              actorResult.actor.userId,
              occurredAt,
              context.newEntityId()
            )
            createdDraft = true
          }

          const updateInput = {
            id: existing.id,
            expectedRowVersion: command.expectedVersion ?? existing.rowVersion,
            otcResponse: command.otcResponse,
            rows: isRowPermittingOtcResponse(command.otcResponse)
              ? command.rows.map((row) => ({
                  id: row.id ?? context.newEntityId(),
                  sequenceNumber: row.sequenceNumber,
                  productNameSnapshot: row.productName,
                  reasonForUse: row.reasonForUse,
                  doseText: row.doseText,
                  frequencyText: row.frequencyText,
                  durationText: row.durationText,
                  sourceOfMedication: row.sourceOfMedication,
                  currentlyTakingResponse: row.currentlyTakingResponse,
                  sourceType: 'PATIENT_REPORTED' as const
                }))
              : [],
            actorId: actorResult.actor.userId,
            occurredAt
          }

          const updateResult = otcRepository.updateDraft(context.connection, updateInput)
          if (updateResult.status === 'VERSION_CONFLICT') return statusResult('VERSION_CONFLICT')
          if (updateResult.status !== 'UPDATED' && updateResult.status !== 'UNCHANGED')
            return statusResult('VALIDATION_FAILED')

          if (updateResult.status === 'UPDATED' || createdDraft) {
            insertOtcEvents({
              dependencies: {
                screeningEncounterOutboxRepository,
                auditEventRepository
              },
              connection: context.connection,
              installation: encounterContext.context.installation,
              actorId: actorResult.actor.userId,
              encounter: encounterContext.context.encounter,
              draft: updateResult.draft,
              occurredAt,
              auditId: context.newEntityId(),
              outboxId: context.newEntityId()
            })
          }

          return savedWorkspaceResult(
            otcRepository,
            context.connection,
            command.encounterId,
            encounterContext.context
          )
        })
      } catch (error) {
        if (error instanceof RepositoryValidationError) return statusResult('VALIDATION_FAILED')
        return statusResult('UNAVAILABLE')
      }
    }
  })
}

function validateEncounterContext(
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  configuredLocationId: EntityId,
  dependencies: Pick<
    ServiceDependencies,
    | 'installationRepository'
    | 'locationRepository'
    | 'screeningSessionRepository'
    | 'screeningEncounterRepository'
  >
):
  | { readonly status: 'VALID'; readonly context: ValidatedContext }
  | { readonly status: 'INVALID'; readonly statusCode: OtcServiceControlledStatus } {
  const installation = dependencies.installationRepository.get()
  if (installation === null) return invalidContext('UNAVAILABLE')
  const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
    connection,
    encounterId
  )
  if (encounter === null || encounter.amendmentOfEncounterId !== null)
    return invalidContext('ENCOUNTER_NOT_FOUND')
  if (encounter.status !== 'DRAFT') return invalidContext('ENCOUNTER_NOT_EDITABLE')
  const session = dependencies.screeningSessionRepository.getByIdForWrite(
    connection,
    encounter.screeningSessionId
  )
  if (session === null) return invalidContext('SESSION_NOT_FOUND')
  const location = dependencies.locationRepository.getByIdForWrite(connection, configuredLocationId)
  if (location === null) return invalidContext('LOCATION_NOT_FOUND')
  if (!location.isActive) return invalidContext('LOCATION_INACTIVE')
  if (session.status !== 'OPEN') return invalidContext('SESSION_CLOSED')
  if (
    encounter.locationId !== configuredLocationId ||
    session.locationId !== configuredLocationId ||
    encounter.screeningSessionId !== session.id
  )
    return invalidContext('SESSION_NOT_CURRENT')
  return { status: 'VALID', context: { installation, encounter, session } }
}

function requireCurrentSession(
  service: ServiceDependencies['currentScreeningSessionService'],
  connection: DatabaseTransactionConnection,
  occurredAt: UtcTimestamp,
  encounterSessionId: EntityId
): OtcServiceControlledStatus | null {
  const result = service.findCurrentScreeningSessionInTransaction({ connection, occurredAt })
  if (result.status === 'FOUND')
    return result.session.id === encounterSessionId ? null : 'SESSION_NOT_CURRENT'
  if (result.status === 'SESSION_CLOSED') return 'SESSION_CLOSED'
  if (result.status === 'SESSION_NOT_FOUND') return 'SESSION_NOT_CURRENT'
  return result.status
}

function createDraft(
  repository: OtcRepository,
  connection: DatabaseTransactionConnection,
  context: ValidatedContext,
  actorId: EntityId,
  occurredAt: UtcTimestamp,
  id: EntityId
): OtcDraftRecord {
  const periodEnd = context.session.sessionDate as unknown as OtcDraftRecord['periodEnd']
  const periodStart = shiftOtcDate(periodEnd, -6)
  return repository.insertDraft(connection, {
    id,
    encounterId: context.encounter.id,
    patientId: context.encounter.patientId,
    screeningSessionId: context.encounter.screeningSessionId,
    locationId: context.encounter.locationId,
    installationId: context.installation.id,
    periodStart,
    periodEnd,
    actorId,
    occurredAt
  })
}

function loadedWorkspaceResult(
  repository: OtcRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): GetOtcWorkspaceResult {
  return Object.freeze({
    status: 'LOADED' as const,
    workspace: loadWorkspace(repository, connection, encounterId, context)
  })
}

function savedWorkspaceResult(
  repository: OtcRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): SaveOtcDraftResult {
  return Object.freeze({
    status: 'SAVED' as const,
    workspace: loadWorkspace(repository, connection, encounterId, context)
  })
}

function loadWorkspace(
  repository: OtcRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): OtcWorkspaceSummary {
  const draft = repository.findDraftByEncounterForWrite(connection, encounterId)
  return Object.freeze({
    encounterId,
    draft: draft === null ? null : toDraftSummary(draft),
    recentMedications: Object.freeze(
      repository
        .listRecentPatientMedicationsForWrite(connection, context.encounter.patientId, encounterId)
        .map(toOtcRecentMedicationSuggestionSummary)
    )
  })
}

function toDraftSummary(draft: OtcDraftRecord): OtcDraftSummary {
  return Object.freeze({
    id: draft.id,
    encounterId: draft.encounterId,
    otcResponse: draft.otcResponse,
    rowVersion: draft.rowVersion,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    rows: Object.freeze(draft.rows.map(toRowSummary)),
    updatedAt: draft.updatedAt
  })
}

function toRowSummary(row: OtcDraftRecord['rows'][number]): OtcDraftRowSummary {
  return Object.freeze({
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    productNameSnapshot: row.productNameSnapshot,
    productNameNormalized: row.productNameNormalized,
    reasonForUse: row.reasonForUse,
    doseText: row.doseText,
    frequencyText: row.frequencyText,
    durationText: row.durationText,
    sourceOfMedication: row.sourceOfMedication,
    currentlyTakingResponse: row.currentlyTakingResponse,
    updatedAt: row.updatedAt
  })
}

function insertOtcEvents({
  dependencies,
  connection,
  installation,
  actorId,
  encounter,
  draft,
  occurredAt,
  auditId,
  outboxId
}: {
  readonly dependencies: Pick<
    ServiceDependencies,
    'screeningEncounterOutboxRepository' | 'auditEventRepository'
  >
  readonly connection: DatabaseTransactionConnection
  readonly installation: InstallationRecord
  readonly actorId: EntityId
  readonly encounter: ScreeningEncounterRecord
  readonly draft: OtcDraftRecord
  readonly occurredAt: UtcTimestamp
  readonly auditId: EntityId
  readonly outboxId: EntityId
}): void {
  const metadata = createEventMetadata(draft)
  dependencies.auditEventRepository.insert(connection, {
    id: auditId,
    installationId: installation.id,
    userId: actorId,
    action: draftSavedAction,
    entityType: screeningEncounterEntityType,
    entityId: encounter.id,
    occurredAt,
    metadata
  })
  dependencies.screeningEncounterOutboxRepository.insert(connection, {
    id: outboxId,
    aggregateId: encounter.id,
    operation: 'SCREENING_OTC_DRAFT_SAVED',
    payloadSchemaVersion: 'screening-encounter.otc-draft-saved.v1',
    createdAt: occurredAt,
    payload: metadata
  })
}

function createEventMetadata(draft: OtcDraftRecord): AuditMetadata {
  return Object.freeze({
    draft_id: draft.id,
    encounter_id: draft.encounterId,
    row_version: draft.rowVersion,
    row_count: draft.rows.length
  })
}

function parseGetCommand(request: unknown): ParsedGetCommand | null {
  try {
    const data = readDataProperties(request, getRequestKeys)
    return { encounterId: parseEntityId(data.encounterId) }
  } catch {
    return null
  }
}

function parseSaveCommand(request: unknown): ParsedSaveCommand | null {
  try {
    const data = readDataProperties(request, saveRequestKeys)
    return Object.freeze({
      encounterId: parseEntityId(data.encounterId),
      expectedVersion: parseExpectedVersion(data.expectedVersion),
      otcResponse: parseOtcResponse(data.otcResponse),
      rows: parseRows(data.rows)
    })
  } catch {
    return null
  }
}

function parseRows(value: unknown): readonly ParsedSaveOtcRow[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  return Object.freeze(value.map(parseRow))
}

function parseRow(value: unknown): ParsedSaveOtcRow {
  const data = readDataProperties(value, rowRequestKeys)
  return Object.freeze({
    id: data.id === null ? null : parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    productName: parseNullableText(data.productName),
    reasonForUse: parseNullableText(data.reasonForUse),
    doseText: parseNullableText(data.doseText),
    frequencyText: parseNullableText(data.frequencyText),
    durationText: parseNullableText(data.durationText),
    sourceOfMedication: parseNullableText(data.sourceOfMedication),
    currentlyTakingResponse: parseCurrentlyTakingResponse(data.currentlyTakingResponse)
  })
}

function parseOtcResponse(value: unknown): ParsedSaveCommand['otcResponse'] {
  if (value === null) return null
  if (
    value === 'REPORTED' ||
    value === 'NONE_REPORTED' ||
    value === 'UNKNOWN' ||
    value === 'DECLINED' ||
    value === 'PREFER_NOT_TO_ANSWER'
  )
    return value
  throw new RepositoryValidationError()
}

function parseCurrentlyTakingResponse(value: unknown): ParsedSaveOtcRow['currentlyTakingResponse'] {
  if (value === null) return null
  if (value === 'YES' || value === 'NO' || value === 'UNKNOWN') return value
  throw new RepositoryValidationError()
}

function parseExpectedVersion(value: unknown): number | null {
  return value === null ? null : parsePositiveInteger(value)
}

function parsePositiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    Object.is(value, -0)
  )
    throw new RepositoryValidationError()
  return value
}

function parseNullableText(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new RepositoryValidationError()
  return value
}

function matchesContext(draft: OtcDraftRecord, context: ValidatedContext): boolean {
  return (
    draft.patientId === context.encounter.patientId &&
    draft.screeningSessionId === context.encounter.screeningSessionId &&
    draft.locationId === context.encounter.locationId &&
    draft.installationId === context.installation.id
  )
}

function resolveTrustedActor(
  authenticationSessionService: ServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly statusCode: OtcServiceControlledStatus } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)
    return { status: 'VALID', actor: { userId: context.user.id } }
  } catch (error) {
    return { status: 'INVALID', statusCode: mapAuthenticationFailure(error) }
  }
}

function mapAuthenticationFailure(error: unknown): OtcServiceControlledStatus {
  if (error instanceof LocalSessionAuthorizationError) return 'FORBIDDEN'
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  )
    return 'AUTHENTICATION_REQUIRED'
  if (isLocalSessionError(error)) return 'AUTHENTICATION_REQUIRED'
  return 'UNAVAILABLE'
}

function invalidContext(statusCode: OtcServiceControlledStatus): {
  readonly status: 'INVALID'
  readonly statusCode: OtcServiceControlledStatus
} {
  return { status: 'INVALID', statusCode }
}

function statusResult(status: OtcServiceControlledStatus): {
  readonly status: OtcServiceControlledStatus
} {
  return Object.freeze({ status })
}

function shiftOtcDate(value: string, days: number): OtcDraftRecord['periodStart'] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) throw new RepositoryDataIntegrityError()
  let year = Number(match[1])
  let month = Number(match[2])
  let day = Number(match[3])
  if (!isValidCalendarDate(year, month, day)) throw new RepositoryDataIntegrityError()
  let remaining = Math.abs(days)
  const direction = days < 0 ? -1 : 1
  while (remaining > 0) {
    day += direction
    if (day < 1) {
      month -= 1
      if (month < 1) {
        month = 12
        year -= 1
      }
      day = daysInMonth(year, month)
    } else if (day > daysInMonth(year, month)) {
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    remaining -= 1
  }
  if (year < 1 || year > 9999) throw new RepositoryDataIntegrityError()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as OtcDraftRecord['periodStart']
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
