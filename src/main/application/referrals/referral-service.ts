import type Database from 'better-sqlite3'
import type { DatabaseTransactionConnection } from '@main/database/transaction'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  parseAuditActionCode,
  parseAuditEntityType,
  RepositoryValidationError,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'
import { parseEntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import {
  referralGetDetailRequestSchema,
  referralRecordFollowupRequestSchema,
  referralSearchRequestSchema,
  referralUpdateStatusRequestSchema,
  type PublicReferralDetail,
  type PublicReferralSummary,
  type ReferralGetDetailRequest,
  type ReferralGetDetailResult,
  type ReferralRecordFollowupRequest,
  type ReferralRecordFollowupResult,
  type ReferralSearchRequest,
  type ReferralSearchResult,
  type ReferralStatus,
  type ReferralUpdateStatusRequest,
  type ReferralUpdateStatusResult
} from '@shared/ipc'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const referralEntityType = parseAuditEntityType('REFERRAL')
const statusUpdatedAction = parseAuditActionCode('REFERRAL_STATUS_UPDATED')
const followupRecordedAction = parseAuditActionCode('REFERRAL_FOLLOWUP_RECORDED')

type ControlledStatus =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'LOCATION_NOT_CONFIGURED'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_INACTIVE'
  | 'REFERRAL_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'UNAVAILABLE'

export interface ReferralService {
  search(request: ReferralSearchRequest): Extract<ReferralSearchResult, { ok: true }>['data']
  getDetail(
    request: ReferralGetDetailRequest
  ): Extract<ReferralGetDetailResult, { ok: true }>['data']
  updateStatus(
    request: ReferralUpdateStatusRequest
  ): Extract<ReferralUpdateStatusResult, { ok: true }>['data']
  recordFollowup(
    request: ReferralRecordFollowupRequest
  ): Extract<ReferralRecordFollowupResult, { ok: true }>['data']
}

interface Dependencies {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationLocationService: InstallationLocationService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionReferralService({
  connection,
  authenticationSessionService,
  installationLocationService,
  logger
}: Dependencies): ReferralService {
  const installationRepository = createInstallationRepository(connection)
  const auditRepository = createAuditEventRepository(connection)
  const clock = createSystemUtcClock()
  const transactionExecutor = createDatabaseTransactionExecutor({
    connection,
    clock,
    idGenerator: createSystemEntityIdGenerator(),
    logger
  })

  function authority():
    | { status: 'VALID'; actorId: string; locationId: string }
    | { status: 'INVALID'; code: ControlledStatus } {
    try {
      const actor = authenticationSessionService.requireAnyRole(allowedRoles)
      const location = installationLocationService.resolveConfiguredInstallationLocation()
      if (location.status !== 'RESOLVED') return { status: 'INVALID', code: location.status }
      return { status: 'VALID', actorId: actor.user.id, locationId: location.location.id }
    } catch (error) {
      if (
        error instanceof LocalSessionUnauthenticatedError ||
        error instanceof LocalSessionLockedError ||
        error instanceof LocalSessionPasswordChangeRequiredError
      )
        return { status: 'INVALID', code: 'AUTHENTICATION_REQUIRED' }
      if (error instanceof LocalSessionAuthorizationError)
        return { status: 'INVALID', code: 'FORBIDDEN' }
      return { status: 'INVALID', code: 'UNAVAILABLE' }
    }
  }

  function getDetailForLocation(
    referralId: string,
    locationId: string
  ): PublicReferralDetail | null {
    const summaryRow = connection.prepare(detailSql).get(referralId, locationId) as
      Record<string, unknown> | undefined
    if (summaryRow === undefined) return null
    return readDetail(connection, summaryRow)
  }

  const service: ReferralService = {
    search(request: ReferralSearchRequest) {
      const auth = authority()
      if (auth.status === 'INVALID') return { status: auth.code }
      const parsed = referralSearchRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      if (parsed.data.dueFrom && parsed.data.dueTo && parsed.data.dueFrom > parsed.data.dueTo)
        return { status: 'VALIDATION_FAILED' }
      try {
        const statuses =
          parsed.data.statuses.length === 0 ? null : JSON.stringify(parsed.data.statuses)
        const values = {
          locationId: auth.locationId,
          query: `%${escapeLike(parsed.data.query.toLowerCase())}%`,
          emptyQuery: parsed.data.query === '' ? 1 : 0,
          statuses,
          urgency: parsed.data.urgency,
          dueFrom: parsed.data.dueFrom,
          dueTo: parsed.data.dueTo,
          limit: parsed.data.pageSize,
          offset: (parsed.data.page - 1) * parsed.data.pageSize
        }
        const items = connection
          .prepare(searchSql)
          .all(values)
          .map((row) => readSummary(row as Record<string, unknown>))
        const count = connection.prepare(countSql).get(values) as { total: number }
        return Object.freeze({
          status: 'LOADED' as const,
          items,
          total: count.total,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize
        })
      } catch {
        return { status: 'UNAVAILABLE' }
      }
    },

    getDetail(request: ReferralGetDetailRequest) {
      const auth = authority()
      if (auth.status === 'INVALID') return { status: auth.code }
      const parsed = referralGetDetailRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      try {
        const detail = getDetailForLocation(parsed.data.referralId, auth.locationId)
        return detail === null ? { status: 'REFERRAL_NOT_FOUND' } : { status: 'LOADED', detail }
      } catch {
        return { status: 'UNAVAILABLE' }
      }
    },

    updateStatus(request: ReferralUpdateStatusRequest) {
      const auth = authority()
      if (auth.status === 'INVALID') return { status: auth.code }
      const parsed = referralUpdateStatusRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      if (parsed.data.status === 'CLOSED' && parsed.data.reason === null)
        return { status: 'VALIDATION_FAILED' }
      try {
        const installation = installationRepository.get()
        if (installation === null) return { status: 'UNAVAILABLE' }
        const outcome = transactionExecutor.run((context) => {
          const current = context.connection
            .prepare(currentSql)
            .get(parsed.data.referralId, auth.locationId) as
            { status: ReferralStatus; record_version: number } | undefined
          if (current === undefined) return { status: 'REFERRAL_NOT_FOUND' as const }
          if (current.record_version !== parsed.data.expectedVersion)
            return { status: 'VERSION_CONFLICT' as const }
          assertStatusTransition(current.status, parsed.data.status)
          const occurredAt = context.nowUtc()
          const nextVersion = current.record_version + 1
          context.connection.prepare(updateStatusSql).run({
            id: parsed.data.referralId,
            expectedVersion: current.record_version,
            status: parsed.data.status,
            closureReason: parsed.data.status === 'CLOSED' ? parsed.data.reason : null,
            closedBy: parsed.data.status === 'CLOSED' ? auth.actorId : null,
            closedAt: parsed.data.status === 'CLOSED' ? occurredAt : null,
            occurredAt,
            nextVersion
          })
          context.connection
            .prepare(insertHistorySql)
            .run(
              context.newEntityId(),
              parsed.data.referralId,
              current.status,
              parsed.data.status,
              parsed.data.reason,
              auth.actorId,
              occurredAt
            )
          writeMutationEffects({
            connection: context.connection,
            auditRepository,
            installationId: installation.id,
            newId: context.newEntityId,
            actorId: auth.actorId,
            referralId: parsed.data.referralId,
            occurredAt,
            action: statusUpdatedAction,
            operation: 'REFERRAL_STATUS_UPDATED',
            schemaVersion: 'referral.status-updated.v1',
            payload: {
              referral_id: parsed.data.referralId,
              from_status: current.status,
              to_status: parsed.data.status,
              record_version: nextVersion
            }
          })
          return { status: 'UPDATED' as const }
        })
        if (outcome.status !== 'UPDATED') return outcome
        const detail = getDetailForLocation(parsed.data.referralId, auth.locationId)
        return detail === null ? { status: 'UNAVAILABLE' } : { status: 'UPDATED', detail }
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    },

    recordFollowup(request: ReferralRecordFollowupRequest) {
      const auth = authority()
      if (auth.status === 'INVALID') return { status: auth.code }
      const parsed = referralRecordFollowupRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      if (parsed.data.newStatus === 'CLOSED' && parsed.data.statusReason === null)
        return { status: 'VALIDATION_FAILED' }
      try {
        const installation = installationRepository.get()
        if (installation === null) return { status: 'UNAVAILABLE' }
        const outcome = transactionExecutor.run((context) => {
          const current = context.connection
            .prepare(currentSql)
            .get(parsed.data.referralId, auth.locationId) as
            { status: ReferralStatus; record_version: number } | undefined
          if (current === undefined) return { status: 'REFERRAL_NOT_FOUND' as const }
          if (current.record_version !== parsed.data.expectedVersion)
            return { status: 'VERSION_CONFLICT' as const }
          if (current.status === 'CLOSED') throw new RepositoryValidationError()
          if (parsed.data.newStatus !== null)
            assertStatusTransition(current.status, parsed.data.newStatus)
          const occurredAt = context.nowUtc()
          const followupId = context.newEntityId()
          const nextVersion = current.record_version + 1
          context.connection
            .prepare(insertFollowupSql)
            .run(
              followupId,
              parsed.data.referralId,
              parsed.data.contactDate,
              parsed.data.contactMethod,
              parsed.data.informationSource,
              parsed.data.providerSeen === null ? null : parsed.data.providerSeen ? 1 : 0,
              parsed.data.facilityName,
              parsed.data.dateSeen,
              parsed.data.reportedOutcome,
              parsed.data.reportedMedicationsOrAdvice,
              parsed.data.nextAction,
              parsed.data.nextFollowupDate,
              parsed.data.sourceType,
              auth.actorId,
              occurredAt
            )
          const nextStatus = parsed.data.newStatus ?? current.status
          context.connection.prepare(updateStatusSql).run({
            id: parsed.data.referralId,
            expectedVersion: current.record_version,
            status: nextStatus,
            closureReason: nextStatus === 'CLOSED' ? parsed.data.statusReason : null,
            closedBy: nextStatus === 'CLOSED' ? auth.actorId : null,
            closedAt: nextStatus === 'CLOSED' ? occurredAt : null,
            occurredAt,
            nextVersion
          })
          if (nextStatus !== current.status)
            context.connection
              .prepare(insertHistorySql)
              .run(
                context.newEntityId(),
                parsed.data.referralId,
                current.status,
                nextStatus,
                parsed.data.statusReason,
                auth.actorId,
                occurredAt
              )
          writeMutationEffects({
            connection: context.connection,
            auditRepository,
            installationId: installation.id,
            newId: context.newEntityId,
            actorId: auth.actorId,
            referralId: parsed.data.referralId,
            occurredAt,
            action: followupRecordedAction,
            operation: 'REFERRAL_FOLLOWUP_RECORDED',
            schemaVersion: 'referral.followup-recorded.v1',
            payload: {
              referral_id: parsed.data.referralId,
              followup_id: followupId,
              status: nextStatus,
              record_version: nextVersion
            }
          })
          return { status: 'UPDATED' as const }
        })
        if (outcome.status !== 'UPDATED') return outcome
        const detail = getDetailForLocation(parsed.data.referralId, auth.locationId)
        return detail === null ? { status: 'UNAVAILABLE' } : { status: 'UPDATED', detail }
      } catch (error) {
        return {
          status: error instanceof RepositoryValidationError ? 'VALIDATION_FAILED' : 'UNAVAILABLE'
        }
      }
    }
  }
  return Object.freeze(service)
}

const summaryColumns = `
 referral.id, referral.patient_id, referral.encounter_id, patient.patient_code,
 patient.display_name AS patient_display_name, referral.urgency, referral.due_date,
 referral.status, referral.record_version, referral.created_at, referral.updated_at,
 (SELECT MAX(contact_date) FROM followups WHERE referral_id = referral.id) AS last_contact_date`
const searchWhere = `WHERE encounter.location_id = @locationId
 AND (@emptyQuery = 1 OR lower(patient.display_name) LIKE @query ESCAPE '\\'
      OR lower(patient.patient_code) LIKE @query ESCAPE '\\')
 AND (@statuses IS NULL OR referral.status IN (SELECT value FROM json_each(@statuses)))
 AND (@urgency IS NULL OR referral.urgency = @urgency)
 AND (@dueFrom IS NULL OR referral.due_date >= @dueFrom)
 AND (@dueTo IS NULL OR referral.due_date <= @dueTo)`
const searchSql = `SELECT ${summaryColumns} FROM referrals referral
 JOIN patients patient ON patient.id = referral.patient_id
 JOIN screening_encounters encounter ON encounter.id = referral.encounter_id
 ${searchWhere} ORDER BY referral.due_date, referral.created_at DESC, referral.id LIMIT @limit OFFSET @offset;`
const countSql = `SELECT COUNT(*) AS total FROM referrals referral
 JOIN patients patient ON patient.id = referral.patient_id
 JOIN screening_encounters encounter ON encounter.id = referral.encounter_id ${searchWhere};`
const detailSql = `SELECT ${summaryColumns}, referral.reason_codes_json, referral.reason_text,
 referral.destination_name, referral.closure_reason, referral.closed_at FROM referrals referral
 JOIN patients patient ON patient.id = referral.patient_id
 JOIN screening_encounters encounter ON encounter.id = referral.encounter_id
 WHERE referral.id = ? AND encounter.location_id = ?;`
const currentSql = `SELECT referral.status, referral.record_version FROM referrals referral
 JOIN screening_encounters encounter ON encounter.id = referral.encounter_id
 WHERE referral.id = ? AND encounter.location_id = ?;`
const updateStatusSql = `UPDATE referrals SET status=@status, closure_reason=@closureReason,
 closed_by=@closedBy, closed_at=@closedAt,
 record_version=@nextVersion, updated_at=@occurredAt WHERE id=@id AND record_version=@expectedVersion;`
const insertHistorySql = `INSERT INTO referral_status_history
 (id, referral_id, from_status, to_status, change_reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?);`
const insertFollowupSql = `INSERT INTO followups
 (id, referral_id, contact_date, contact_method, information_source, provider_seen, facility_name,
 date_seen, reported_outcome, reported_medications_or_advice, next_action, next_followup_date,
 source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`

function readSummary(row: Record<string, unknown>): PublicReferralSummary {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    encounterId: String(row.encounter_id),
    patientCode: String(row.patient_code),
    patientDisplayName: String(row.patient_display_name),
    urgency: row.urgency as PublicReferralSummary['urgency'],
    dueDate: String(row.due_date),
    status: row.status as ReferralStatus,
    lastContactDate: row.last_contact_date === null ? null : String(row.last_contact_date),
    recordVersion: Number(row.record_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function readDetail(
  connection: Database.Database,
  row: Record<string, unknown>
): PublicReferralDetail {
  const id = String(row.id)
  const history = connection
    .prepare(
      `SELECT history.id, history.from_status, history.to_status,
    history.change_reason, user.display_name AS changed_by_display_name, history.changed_at
    FROM referral_status_history history JOIN users user ON user.id=history.changed_by
    WHERE history.referral_id=? ORDER BY history.changed_at, history.id`
    )
    .all(id) as Record<string, unknown>[]
  const followups = connection
    .prepare(
      `SELECT followup.*, user.display_name AS recorded_by_display_name
    FROM followups followup JOIN users user ON user.id=followup.recorded_by
    WHERE followup.referral_id=? ORDER BY followup.contact_date DESC, followup.recorded_at DESC`
    )
    .all(id) as Record<string, unknown>[]
  return {
    ...readSummary(row),
    reasonCodes: JSON.parse(String(row.reason_codes_json)) as string[],
    reasonText: nullable(row.reason_text),
    destinationName: nullable(row.destination_name),
    closureReason: nullable(row.closure_reason),
    closedAt: nullable(row.closed_at),
    statusHistory: history.map((item) => ({
      id: String(item.id),
      fromStatus: item.from_status as ReferralStatus | null,
      toStatus: item.to_status as ReferralStatus,
      changeReason: nullable(item.change_reason),
      changedByDisplayName: String(item.changed_by_display_name),
      changedAt: String(item.changed_at)
    })),
    followups: followups.map((item) => ({
      id: String(item.id),
      contactDate: String(item.contact_date),
      contactMethod: String(item.contact_method),
      informationSource: String(item.information_source),
      providerSeen: item.provider_seen === null ? null : item.provider_seen === 1,
      facilityName: nullable(item.facility_name),
      dateSeen: nullable(item.date_seen),
      reportedOutcome: nullable(item.reported_outcome),
      reportedMedicationsOrAdvice: nullable(item.reported_medications_or_advice),
      nextAction: nullable(item.next_action),
      nextFollowupDate: nullable(item.next_followup_date),
      sourceType: String(item.source_type),
      recordedByDisplayName: String(item.recorded_by_display_name),
      recordedAt: String(item.recorded_at)
    }))
  }
}

function nullable(value: unknown): string | null {
  return value === null ? null : String(value)
}
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`)
}

function assertStatusTransition(current: ReferralStatus, next: ReferralStatus): void {
  if (current === 'CLOSED' || next === 'OPEN' || current === next)
    throw new RepositoryValidationError()
}

interface MutationEffectsInput {
  readonly connection: DatabaseTransactionConnection
  readonly auditRepository: ReturnType<typeof createAuditEventRepository>
  readonly installationId: ReturnType<typeof parseEntityId>
  readonly newId: () => ReturnType<typeof parseEntityId>
  readonly actorId: string
  readonly referralId: string
  readonly occurredAt: UtcTimestamp
  readonly action: ReturnType<typeof parseAuditActionCode>
  readonly operation: string
  readonly schemaVersion: string
  readonly payload: Readonly<Record<string, string | number>>
}

function writeMutationEffects(input: MutationEffectsInput): void {
  input.auditRepository.insert(input.connection, {
    id: input.newId(),
    installationId: input.installationId,
    userId: parseEntityId(input.actorId),
    action: input.action,
    entityType: referralEntityType,
    entityId: parseEntityId(input.referralId),
    occurredAt: input.occurredAt,
    metadata: input.payload
  })
  input.connection
    .prepare(
      `INSERT INTO sync_outbox
   (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version, created_at,
    status, attempt_count, next_attempt_at, last_error_code, last_error_message, sent_at)
   VALUES (?, 'REFERRAL', ?, ?, ?, ?, ?, 'PENDING', 0, NULL, NULL, NULL, NULL)`
    )
    .run(
      input.newId(),
      input.referralId,
      input.operation,
      JSON.stringify(input.payload),
      input.schemaVersion,
      input.occurredAt
    )
}
