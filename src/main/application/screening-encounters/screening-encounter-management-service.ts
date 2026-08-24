import {
  parseAuditActionCode,
  parseAuditEntityType,
  RepositoryValidationError,
  type AuditMetadata,
  type EncounterReviewFlagCategory,
  type ScreeningEncounterRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '../authentication/session'
import type { ResolveConfiguredInstallationLocationResult } from '../installation-location'
import type {
  EncounterCancellationReasonCode,
  EncounterManagementControlledStatus,
  ScreeningEncounterManagementService,
  ScreeningEncounterManagementServiceDependencies,
  SearchManagedEncountersRequest
} from './screening-encounter-management-service-types'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const entityType = parseAuditEntityType('SCREENING_ENCOUNTER')
const addendumAction = parseAuditActionCode('SCREENING_ENCOUNTER_ADDENDUM_ADDED')
const flagOpenedAction = parseAuditActionCode('SCREENING_ENCOUNTER_REVIEW_FLAG_OPENED')
const flagUpdatedAction = parseAuditActionCode('SCREENING_ENCOUNTER_REVIEW_FLAG_UPDATED')
const encounterVoidedAction = parseAuditActionCode('SCREENING_ENCOUNTER_VOIDED')
const cancellationReasonLabels = Object.freeze({
  PATIENT_CHOSE_NOT_TO_CONTINUE: 'Patient chose not to continue',
  CREATED_IN_ERROR: 'Screening created in error',
  UNABLE_TO_COMPLETE_TODAY: 'Unable to complete screening today',
  OTHER: 'Other cancellation reason'
} satisfies Record<EncounterCancellationReasonCode, string>)
const categories = new Set<EncounterReviewFlagCategory>([
  'POSSIBLE_DATA_ERROR',
  'MISSING_INFORMATION',
  'WRONG_PATIENT',
  'DUPLICATE_ENCOUNTER',
  'OTHER'
])

export function createScreeningEncounterManagementService(
  dependencies: ScreeningEncounterManagementServiceDependencies
): ScreeningEncounterManagementService {
  const service: ScreeningEncounterManagementService = {
    search(request) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      const resumableSessionId = resolveResumableSessionId(dependencies)
      try {
        return Object.freeze({
          status: 'LOADED' as const,
          result: dependencies.managementRepository.search({
            ...parseSearchRequest(request),
            locationId: location.location.id,
            resumableSessionId
          })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    getDetail(encounterId) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      const resumableSessionId = resolveResumableSessionId(dependencies)
      try {
        const detail = dependencies.managementRepository.getDetail(
          parseEntityId(encounterId),
          location.location.id,
          resumableSessionId
        )
        return detail === null ? { status: 'ENCOUNTER_NOT_FOUND' } : { status: 'LOADED', detail }
      } catch {
        return { status: 'UNAVAILABLE' }
      }
    },

    addAddendum(encounterId, noteText) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      try {
        const parsedEncounterId = parseEntityId(encounterId)
        const parsedNote = parseText(noteText, 2000)
        return dependencies.transactionExecutor.run((context) => {
          const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            parsedEncounterId
          )
          const invalid = validateManageableEncounter(encounter, location.location.id)
          if (invalid !== null) return { status: invalid }
          const occurredAt = context.nowUtc()
          const addendum = dependencies.managementRepository.insertAddendum(context.connection, {
            id: context.newEntityId(),
            encounterId: parsedEncounterId,
            noteText: parsedNote,
            createdBy: actor.actorId,
            createdAt: occurredAt
          })
          writeEvent(
            dependencies,
            context,
            actor.actorId,
            parsedEncounterId,
            occurredAt,
            addendumAction,
            'SCREENING_ENCOUNTER_ADDENDUM_ADDED',
            'screening-encounter.addendum-added.v1',
            {
              encounter_id: parsedEncounterId,
              addendum_id: addendum.id
            }
          )
          return Object.freeze({ status: 'ADDED' as const, addendum })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    openFlag(encounterId, category, description) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      try {
        const parsedEncounterId = parseEntityId(encounterId)
        if (!categories.has(category)) throw new RepositoryValidationError()
        const parsedDescription = parseText(description, 1000)
        return dependencies.transactionExecutor.run((context) => {
          const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            parsedEncounterId
          )
          const invalid = validateManageableEncounter(encounter, location.location.id)
          if (invalid !== null) return { status: invalid }
          const occurredAt = context.nowUtc()
          const flag = dependencies.managementRepository.insertFlag(context.connection, {
            id: context.newEntityId(),
            encounterId: parsedEncounterId,
            category,
            description: parsedDescription,
            openedBy: actor.actorId,
            openedAt: occurredAt
          })
          writeEvent(
            dependencies,
            context,
            actor.actorId,
            parsedEncounterId,
            occurredAt,
            flagOpenedAction,
            'SCREENING_ENCOUNTER_REVIEW_FLAG_OPENED',
            'screening-encounter.review-flag-opened.v1',
            {
              encounter_id: parsedEncounterId,
              flag_id: flag.id,
              category
            }
          )
          return Object.freeze({ status: 'OPENED' as const, flag })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    resolveFlag(encounterId, flagId, status, resolutionNote) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      try {
        const parsedEncounterId = parseEntityId(encounterId)
        const parsedFlagId = parseEntityId(flagId)
        if (status !== 'RESOLVED' && status !== 'DISMISSED') throw new RepositoryValidationError()
        const parsedNote = parseText(resolutionNote, 1000)
        return dependencies.transactionExecutor.run((context) => {
          const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            parsedEncounterId
          )
          const invalid = validateManageableEncounter(encounter, location.location.id)
          if (invalid !== null) return { status: invalid }
          const occurredAt = context.nowUtc()
          const flag = dependencies.managementRepository.resolveFlag(context.connection, {
            id: parsedFlagId,
            encounterId: parsedEncounterId,
            status,
            resolutionNote: parsedNote,
            resolvedBy: actor.actorId,
            resolvedAt: occurredAt
          })
          if (flag === null) return { status: 'FLAG_NOT_FOUND' as const }
          writeEvent(
            dependencies,
            context,
            actor.actorId,
            parsedEncounterId,
            occurredAt,
            flagUpdatedAction,
            'SCREENING_ENCOUNTER_REVIEW_FLAG_UPDATED',
            'screening-encounter.review-flag-updated.v1',
            {
              encounter_id: parsedEncounterId,
              flag_id: flag.id,
              status
            }
          )
          return Object.freeze({ status: 'UPDATED' as const, flag })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    voidEmptyDraft(encounterId, expectedVersion, reason) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      try {
        const parsedEncounterId = parseEntityId(encounterId)
        const parsedVersion = parsePositiveInteger(expectedVersion)
        const parsedReason = parseText(reason, 500)
        return dependencies.transactionExecutor.run((context) => {
          const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            parsedEncounterId
          )
          if (encounter === null || encounter.locationId !== location.location.id)
            return { status: 'ENCOUNTER_NOT_FOUND' as const }
          if (encounter.status !== 'DRAFT') return { status: 'ENCOUNTER_NOT_MANAGEABLE' as const }
          if (encounter.recordVersion !== parsedVersion)
            return { status: 'VERSION_CONFLICT' as const }

          const occurredAt = context.nowUtc()
          const result = dependencies.managementRepository.voidEmptyDraft(context.connection, {
            encounterId: parsedEncounterId,
            expectedVersion: parsedVersion,
            reason: parsedReason,
            updatedAt: occurredAt
          })
          if (result === 'NOT_EMPTY') return { status: 'ENCOUNTER_NOT_EMPTY' as const }
          if (result === 'VERSION_CONFLICT') return { status: 'VERSION_CONFLICT' as const }
          if (result === 'NOT_FOUND') return { status: 'ENCOUNTER_NOT_FOUND' as const }
          if (result !== 'VOIDED') return { status: 'ENCOUNTER_NOT_MANAGEABLE' as const }

          const resultingVersion = parsedVersion + 1
          writeEvent(
            dependencies,
            context,
            actor.actorId,
            parsedEncounterId,
            occurredAt,
            encounterVoidedAction,
            'SCREENING_ENCOUNTER_VOIDED',
            'screening-encounter.voided.v1',
            { encounter_id: parsedEncounterId, record_version: resultingVersion }
          )
          return Object.freeze({ status: 'VOIDED' as const, recordVersion: resultingVersion })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    cancelDraft(encounterId, expectedVersion, reasonCode, note) {
      const actor = resolveActor(dependencies)
      if (actor.status !== 'VALID') return { status: actor.statusCode }
      const location = resolveLocation(dependencies)
      if (location.status !== 'RESOLVED') return { status: location.status }
      try {
        const parsedEncounterId = parseEntityId(encounterId)
        const parsedVersion = parsePositiveInteger(expectedVersion)
        const parsedReasonCode = parseCancellationReasonCode(reasonCode)
        const parsedNote = parseOptionalText(note, 500)
        if (parsedReasonCode === 'OTHER' && parsedNote === null)
          throw new RepositoryValidationError()
        if (parsedReasonCode !== 'OTHER' && parsedNote !== null)
          throw new RepositoryValidationError()
        const displayReason = `${cancellationReasonLabels[parsedReasonCode]}${
          parsedNote === null ? '' : `: ${parsedNote}`
        }`

        return dependencies.transactionExecutor.run((context) => {
          const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            parsedEncounterId
          )
          if (encounter === null || encounter.locationId !== location.location.id)
            return { status: 'ENCOUNTER_NOT_FOUND' as const }
          if (encounter.status !== 'DRAFT') return { status: 'ENCOUNTER_NOT_MANAGEABLE' as const }
          if (encounter.recordVersion !== parsedVersion)
            return { status: 'VERSION_CONFLICT' as const }

          const occurredAt = context.nowUtc()
          const result = dependencies.managementRepository.voidDraft(context.connection, {
            encounterId: parsedEncounterId,
            expectedVersion: parsedVersion,
            reason: displayReason,
            updatedAt: occurredAt
          })
          if (result === 'VERSION_CONFLICT') return { status: 'VERSION_CONFLICT' as const }
          if (result === 'NOT_FOUND') return { status: 'ENCOUNTER_NOT_FOUND' as const }
          if (result !== 'VOIDED') return { status: 'ENCOUNTER_NOT_MANAGEABLE' as const }

          const resultingVersion = parsedVersion + 1
          writeEvent(
            dependencies,
            context,
            actor.actorId,
            parsedEncounterId,
            occurredAt,
            encounterVoidedAction,
            'SCREENING_ENCOUNTER_VOIDED',
            'screening-encounter.voided.v1',
            {
              encounter_id: parsedEncounterId,
              record_version: resultingVersion,
              reason_code: parsedReasonCode
            }
          )
          return Object.freeze({ status: 'VOIDED' as const, recordVersion: resultingVersion })
        })
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    }
  }
  return Object.freeze(service)
}

function resolveResumableSessionId(
  dependencies: ScreeningEncounterManagementServiceDependencies
): EntityId | null {
  try {
    const result = dependencies.currentScreeningSessionService.findCurrentScreeningSession()
    return result.status === 'FOUND' ? result.session.id : null
  } catch {
    return null
  }
}

function validateManageableEncounter(
  encounter: ScreeningEncounterRecord | null,
  locationId: EntityId
): EncounterManagementControlledStatus | null {
  if (encounter === null || encounter.locationId !== locationId) return 'ENCOUNTER_NOT_FOUND'
  return encounter.status === 'COMPLETED' || encounter.status === 'AMENDED'
    ? null
    : 'ENCOUNTER_NOT_MANAGEABLE'
}

function writeEvent(
  dependencies: ScreeningEncounterManagementServiceDependencies,
  context: Parameters<
    Parameters<ScreeningEncounterManagementServiceDependencies['transactionExecutor']['run']>[0]
  >[0],
  actorId: EntityId,
  encounterId: EntityId,
  occurredAt: ReturnType<typeof context.nowUtc>,
  action: ReturnType<typeof parseAuditActionCode>,
  operation:
    | 'SCREENING_ENCOUNTER_ADDENDUM_ADDED'
    | 'SCREENING_ENCOUNTER_REVIEW_FLAG_OPENED'
    | 'SCREENING_ENCOUNTER_REVIEW_FLAG_UPDATED'
    | 'SCREENING_ENCOUNTER_VOIDED',
  schema:
    | 'screening-encounter.addendum-added.v1'
    | 'screening-encounter.review-flag-opened.v1'
    | 'screening-encounter.review-flag-updated.v1'
    | 'screening-encounter.voided.v1',
  metadata: AuditMetadata
): void {
  const installation = dependencies.installationRepository.get()
  if (installation === null) throw new RepositoryValidationError()
  dependencies.auditEventRepository.insert(context.connection, {
    id: context.newEntityId(),
    installationId: installation.id,
    userId: actorId,
    action,
    entityType,
    entityId: encounterId,
    occurredAt,
    metadata
  })
  dependencies.screeningEncounterOutboxRepository.insert(context.connection, {
    id: context.newEntityId(),
    aggregateId: encounterId,
    operation,
    payloadSchemaVersion: schema,
    createdAt: occurredAt,
    payload: metadata
  })
}

function resolveActor(
  dependencies: ScreeningEncounterManagementServiceDependencies
):
  | { readonly status: 'VALID'; readonly actorId: EntityId }
  | { readonly status: 'INVALID'; readonly statusCode: EncounterManagementControlledStatus } {
  try {
    return {
      status: 'VALID',
      actorId: dependencies.authenticationSessionService.requireAnyRole(allowedRoles).user.id
    }
  } catch (error) {
    if (error instanceof LocalSessionAuthorizationError)
      return { status: 'INVALID', statusCode: 'FORBIDDEN' }
    if (
      error instanceof LocalSessionUnauthenticatedError ||
      error instanceof LocalSessionLockedError ||
      error instanceof LocalSessionPasswordChangeRequiredError
    )
      return { status: 'INVALID', statusCode: 'AUTHENTICATION_REQUIRED' }
    return { status: 'INVALID', statusCode: 'UNAVAILABLE' }
  }
}

function resolveLocation(
  dependencies: ScreeningEncounterManagementServiceDependencies
): ResolveConfiguredInstallationLocationResult {
  return dependencies.installationLocationService.resolveConfiguredInstallationLocation()
}
function parseSearchRequest(
  request: SearchManagedEncountersRequest
): SearchManagedEncountersRequest {
  if (
    typeof request.query !== 'string' ||
    request.query.trim().length > 120 ||
    !Number.isSafeInteger(request.page) ||
    request.page < 1 ||
    ![25, 50, 100].includes(request.pageSize)
  )
    throw new RepositoryValidationError()
  return Object.freeze({ ...request, query: request.query.trim() })
}
function parseText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const text = value.trim()
  if (text.length === 0 || text.length > maximum) throw new RepositoryValidationError()
  return text
}
function parseOptionalText(value: unknown, maximum: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const text = value.trim()
  if (text.length === 0) return null
  if (Array.from(text).length > maximum) throw new RepositoryValidationError()
  return text
}
function parseCancellationReasonCode(value: unknown): EncounterCancellationReasonCode {
  if (typeof value !== 'string' || !(value in cancellationReasonLabels))
    throw new RepositoryValidationError()
  return value as EncounterCancellationReasonCode
}
function parsePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RepositoryValidationError()
  return value
}
