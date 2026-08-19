import {
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  parseAuditActionCode,
  parseAuditEntityType,
  readDataProperties,
  type AuditMetadata,
  type FoodDraftRecord,
  type FoodDraftRowInput,
  type FoodRepository,
  type InstallationRecord,
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
  FoodDraftRowSummary,
  FoodDraftSummary,
  FoodServiceControlledStatus,
  FoodWorkspaceSummary,
  GetFoodWorkspaceRequest,
  GetFoodWorkspaceResult,
  SaveFoodDraftRequest,
  SaveFoodDraftResult,
  ScreeningFoodService,
  ScreeningFoodServiceDependencies
} from './screening-food-service-types'
import {
  toFoodCatalogItemSummary,
  toFoodRecentSuggestionSummary
} from './screening-food-service-types'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const draftSavedAction = parseAuditActionCode('SCREENING_FOOD_DRAFT_SAVED')
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const getRequestKeys = Object.freeze(['encounterId'] as const)
const saveRequestKeys = Object.freeze([
  'encounterId',
  'expectedVersion',
  'foodResponse',
  'rows'
] as const)
const rowRequestKeys = Object.freeze([
  'id',
  'sequenceNumber',
  'catalogCode',
  'foodName',
  'frequencyCode',
  'preparationNote'
] as const)

type ServiceDependencies = ScreeningFoodServiceDependencies

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
  readonly foodResponse: SaveFoodDraftRequest['foodResponse']
  readonly rows: readonly ParsedSaveFoodRow[]
}

interface ParsedSaveFoodRow {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly catalogCode: string | null
  readonly foodName: string
  readonly frequencyCode: FoodDraftRowInput['frequencyCode']
  readonly preparationNote: string | null
}

export function createScreeningFoodService({
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  installationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  foodRepository,
  screeningEncounterOutboxRepository,
  auditEventRepository,
  transactionExecutor
}: ScreeningFoodServiceDependencies): ScreeningFoodService {
  return Object.freeze({
    getWorkspace(request: GetFoodWorkspaceRequest): GetFoodWorkspaceResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)
      const command = parseGetCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')
      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return transactionExecutor.run<GetFoodWorkspaceResult>((context) => {
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
            foodRepository,
            context.connection,
            command.encounterId,
            encounterContext.context
          )
        })
      } catch {
        return statusResult('UNAVAILABLE')
      }
    },

    saveDraft(request: SaveFoodDraftRequest): SaveFoodDraftResult {
      const actorResult = resolveTrustedActor(authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)
      const command = parseSaveCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')
      const locationResult = installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return transactionExecutor.run<SaveFoodDraftResult>((context) => {
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

          let existing = foodRepository.findDraftByEncounterForWrite(
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
              foodRepository,
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
            foodResponse: command.foodResponse,
            rows: command.rows.map((row) => ({
              id: row.id ?? context.newEntityId(),
              sequenceNumber: row.sequenceNumber,
              catalogCode: row.catalogCode,
              foodNameSnapshot: row.foodName,
              frequencyCode: row.frequencyCode,
              preparationNote: row.preparationNote,
              sourceType: 'PATIENT_REPORTED' as const
            })),
            actorId: actorResult.actor.userId,
            occurredAt
          }

          const updateResult = foodRepository.updateDraft(context.connection, updateInput)
          if (updateResult.status === 'VERSION_CONFLICT') return statusResult('VERSION_CONFLICT')
          if (updateResult.status !== 'UPDATED' && updateResult.status !== 'UNCHANGED')
            return statusResult('VALIDATION_FAILED')

          if (updateResult.status === 'UPDATED' || createdDraft) {
            insertFoodEvents({
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
            foodRepository,
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
  | { readonly status: 'INVALID'; readonly statusCode: FoodServiceControlledStatus } {
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
): FoodServiceControlledStatus | null {
  const result = service.findCurrentScreeningSessionInTransaction({ connection, occurredAt })
  if (result.status === 'FOUND')
    return result.session.id === encounterSessionId ? null : 'SESSION_NOT_CURRENT'
  if (result.status === 'SESSION_CLOSED') return 'SESSION_CLOSED'
  if (result.status === 'SESSION_NOT_FOUND') return 'SESSION_NOT_CURRENT'
  return result.status
}

function createDraft(
  repository: FoodRepository,
  connection: DatabaseTransactionConnection,
  context: ValidatedContext,
  actorId: EntityId,
  occurredAt: UtcTimestamp,
  id: EntityId
): FoodDraftRecord {
  const periodEnd = context.session.sessionDate as unknown as FoodDraftRecord['periodEnd']
  const periodStart = shiftFoodDate(periodEnd, -6)
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
  repository: FoodRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): GetFoodWorkspaceResult {
  return Object.freeze({
    status: 'LOADED' as const,
    workspace: loadWorkspace(repository, connection, encounterId, context)
  })
}

function savedWorkspaceResult(
  repository: FoodRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): SaveFoodDraftResult {
  return Object.freeze({
    status: 'SAVED' as const,
    workspace: loadWorkspace(repository, connection, encounterId, context)
  })
}

function loadWorkspace(
  repository: FoodRepository,
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  context: ValidatedContext
): FoodWorkspaceSummary {
  const draft = repository.findDraftByEncounterForWrite(connection, encounterId)
  return Object.freeze({
    encounterId,
    draft: draft === null ? null : toDraftSummary(draft),
    catalogItems: Object.freeze(
      repository.listActiveCatalogItemsForWrite(connection).map(toFoodCatalogItemSummary)
    ),
    recentFoods: Object.freeze(
      repository
        .listRecentPatientFoodsForWrite(connection, context.encounter.patientId, encounterId)
        .map(toFoodRecentSuggestionSummary)
    )
  })
}

function toDraftSummary(draft: FoodDraftRecord): FoodDraftSummary {
  return Object.freeze({
    id: draft.id,
    encounterId: draft.encounterId,
    foodResponse: draft.foodResponse,
    rowVersion: draft.rowVersion,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    rows: Object.freeze(draft.rows.map(toRowSummary)),
    updatedAt: draft.updatedAt
  })
}

function toRowSummary(row: FoodDraftRecord['rows'][number]): FoodDraftRowSummary {
  return Object.freeze({
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    catalogCode: row.catalogCode,
    foodNameSnapshot: row.foodNameSnapshot,
    foodNameNormalized: row.foodNameNormalized,
    frequencyCode: row.frequencyCode,
    preparationNote: row.preparationNote,
    updatedAt: row.updatedAt
  })
}

function insertFoodEvents({
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
  readonly draft: FoodDraftRecord
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
    operation: 'SCREENING_FOOD_DRAFT_SAVED',
    payloadSchemaVersion: 'screening-encounter.food-draft-saved.v1',
    createdAt: occurredAt,
    payload: metadata
  })
}

function createEventMetadata(draft: FoodDraftRecord): AuditMetadata {
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
      foodResponse: parseFoodResponse(data.foodResponse),
      rows: parseRows(data.rows)
    })
  } catch {
    return null
  }
}

function parseRows(value: unknown): readonly ParsedSaveFoodRow[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  return Object.freeze(value.map(parseRow))
}

function parseRow(value: unknown): ParsedSaveFoodRow {
  const data = readDataProperties(value, rowRequestKeys)
  return Object.freeze({
    id: data.id === null ? null : parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    catalogCode: data.catalogCode === null ? null : parseCatalogCode(data.catalogCode),
    foodName: parseText(data.foodName),
    frequencyCode: parseFrequencyCode(data.frequencyCode),
    preparationNote: data.preparationNote === null ? null : parseText(data.preparationNote)
  })
}

function parseFoodResponse(value: unknown): ParsedSaveCommand['foodResponse'] {
  if (value === null) return null
  if (
    value === 'REPORTED' ||
    value === 'UNKNOWN' ||
    value === 'DECLINED' ||
    value === 'PREFER_NOT_TO_ANSWER'
  )
    return value
  throw new RepositoryValidationError()
}

function parseFrequencyCode(value: unknown): FoodDraftRowInput['frequencyCode'] {
  if (value === null) return null
  if (
    value === '1_DAY' ||
    value === '2_TO_3_DAYS' ||
    value === '4_TO_6_DAYS' ||
    value === 'EVERY_DAY'
  )
    return value
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

function parseCatalogCode(value: unknown): string {
  const text = parseText(value)
  if (!/^[A-Z][A-Z0-9_]*$/u.test(text)) throw new RepositoryValidationError()
  return text
}

function parseText(value: unknown): string {
  if (typeof value !== 'string') throw new RepositoryValidationError()
  return value
}

function matchesContext(draft: FoodDraftRecord, context: ValidatedContext): boolean {
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
  | { readonly status: 'INVALID'; readonly statusCode: FoodServiceControlledStatus } {
  try {
    const context = authenticationSessionService.requireAnyRole(allowedRoles)
    return { status: 'VALID', actor: { userId: context.user.id } }
  } catch (error) {
    return { status: 'INVALID', statusCode: mapAuthenticationFailure(error) }
  }
}

function mapAuthenticationFailure(error: unknown): FoodServiceControlledStatus {
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

function invalidContext(statusCode: FoodServiceControlledStatus): {
  readonly status: 'INVALID'
  readonly statusCode: FoodServiceControlledStatus
} {
  return { status: 'INVALID', statusCode }
}

function statusResult(status: FoodServiceControlledStatus): {
  readonly status: FoodServiceControlledStatus
} {
  return Object.freeze({ status })
}

function shiftFoodDate(value: string, days: number): FoodDraftRecord['periodStart'] {
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
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as FoodDraftRecord['periodStart']
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
