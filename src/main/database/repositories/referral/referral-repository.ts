import type Database from 'better-sqlite3'

import {
  DatabaseTransactionStateError,
  type DatabaseTransactionConnection
} from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError,
  getRepositoryErrorType
} from '../repository-errors'
import type {
  AutomaticReferralReasonCode,
  CreateAutomaticReferralInput,
  CreateAutomaticReferralResult,
  ReferralRecord,
  ReferralRepository,
  ReferralUrgency
} from './referral-types'

interface ReferralRow {
  readonly id: unknown
  readonly patient_id: unknown
  readonly encounter_id: unknown
  readonly protocol_version_id: unknown
  readonly reason_codes_json: unknown
  readonly urgency: unknown
  readonly due_date: unknown
  readonly status: unknown
  readonly created_by: unknown
  readonly created_at: unknown
  readonly record_version: unknown
}

interface ParsedCreateAutomaticReferralInput {
  readonly id: CreateAutomaticReferralInput['id']
  readonly statusHistoryId: CreateAutomaticReferralInput['statusHistoryId']
  readonly outboxId: CreateAutomaticReferralInput['outboxId']
  readonly patientId: CreateAutomaticReferralInput['patientId']
  readonly encounterId: CreateAutomaticReferralInput['encounterId']
  readonly protocolVersionId: CreateAutomaticReferralInput['protocolVersionId']
  readonly reasonCode: AutomaticReferralReasonCode
  readonly urgency: ReferralUrgency
  readonly dueDate: string
  readonly actorId: CreateAutomaticReferralInput['actorId']
  readonly createdAt: CreateAutomaticReferralInput['createdAt']
}

const findByEncounterSql = `
SELECT id, patient_id, encounter_id, protocol_version_id, reason_codes_json, urgency,
       due_date, status, created_by, created_at, record_version
FROM referrals
WHERE encounter_id = ?
ORDER BY created_at, id
LIMIT 2;
`
const insertReferralSql = `
INSERT INTO referrals (
  id, patient_id, encounter_id, protocol_version_id, reason_codes_json, reason_text,
  urgency, destination_name, due_date, status, created_by, created_at, printed_at,
  closed_by, closed_at, closure_reason, record_version, updated_at
) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, 'OPEN', ?, ?, NULL, NULL, NULL, NULL, 1, ?);
`
const insertStatusHistorySql = `
INSERT INTO referral_status_history (
  id, referral_id, from_status, to_status, change_reason, changed_by, changed_at
) VALUES (?, ?, NULL, 'OPEN', 'AUTOMATIC_SCREENING_REFERRAL', ?, ?);
`
const insertOutboxSql = `
INSERT INTO sync_outbox (
  id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version,
  created_at, status, attempt_count, next_attempt_at, last_error_code,
  last_error_message, sent_at
) VALUES (?, 'REFERRAL', ?, 'REFERRAL_CREATED', ?, 'referral.created.v1', ?,
          'PENDING', 0, NULL, NULL, NULL, NULL);
`

export function createReferralRepository(connection: Database.Database): ReferralRepository {
  void connection
  return Object.freeze({
    createAutomaticReferral(
      scopedConnection: DatabaseTransactionConnection,
      input: CreateAutomaticReferralInput
    ): CreateAutomaticReferralResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const parsed = parseCreateAutomaticReferralInput(input)
      try {
        const existingRows = scopedConnection
          .prepare<[string], ReferralRow>(findByEncounterSql)
          .all(parsed.encounterId)
        if (existingRows.length > 1) throw new RepositoryDataIntegrityError()
        const existing = existingRows[0]
        if (existing !== undefined) {
          const referral = readReferral(existing)
          if (
            referral.patientId !== parsed.patientId ||
            referral.protocolVersionId !== parsed.protocolVersionId
          )
            throw new RepositoryDataIntegrityError()
          return Object.freeze({ status: 'EXISTING' as const, referral })
        }

        const reasonCodesJson = JSON.stringify([parsed.reasonCode])
        scopedConnection
          .prepare<
            [string, string, string, string, string, string, string, string, string, string]
          >(insertReferralSql)
          .run(
            parsed.id,
            parsed.patientId,
            parsed.encounterId,
            parsed.protocolVersionId,
            reasonCodesJson,
            parsed.urgency,
            parsed.dueDate,
            parsed.actorId,
            parsed.createdAt,
            parsed.createdAt
          )
        scopedConnection
          .prepare<[string, string, string, string]>(insertStatusHistorySql)
          .run(parsed.statusHistoryId, parsed.id, parsed.actorId, parsed.createdAt)
        scopedConnection
          .prepare<[string, string, string, string]>(insertOutboxSql)
          .run(parsed.outboxId, parsed.id, createOutboxPayload(parsed), parsed.createdAt)
        return Object.freeze({ status: 'CREATED' as const, referral: toReferralRecord(parsed) })
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError)
          throw new DatabaseTransactionStateError(error.errorType)
        if (
          error instanceof RepositoryValidationError ||
          error instanceof RepositoryDataIntegrityError
        )
          throw error
        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    }
  })
}

function parseCreateAutomaticReferralInput(
  input: CreateAutomaticReferralInput
): ParsedCreateAutomaticReferralInput {
  const reasonCode = parseReasonCode(input.reasonCode)
  const urgency = parseUrgency(input.urgency)
  if (
    (reasonCode === 'BP_SCREENING_URGENT_REFERRAL' && urgency !== 'URGENT') ||
    (reasonCode === 'BP_SCREENING_REFERRAL' && urgency !== 'STANDARD')
  )
    throw new RepositoryValidationError()
  return Object.freeze({
    id: parseEntityId(input.id),
    statusHistoryId: parseEntityId(input.statusHistoryId),
    outboxId: parseEntityId(input.outboxId),
    patientId: parseEntityId(input.patientId),
    encounterId: parseEntityId(input.encounterId),
    protocolVersionId: parseEntityId(input.protocolVersionId),
    reasonCode,
    urgency,
    dueDate: parseDate(input.dueDate),
    actorId: parseEntityId(input.actorId),
    createdAt: parseUtcTimestamp(input.createdAt)
  })
}

function parseReasonCode(value: unknown): AutomaticReferralReasonCode {
  if (value !== 'BP_SCREENING_REFERRAL' && value !== 'BP_SCREENING_URGENT_REFERRAL')
    throw new RepositoryValidationError()
  return value
}

function parseUrgency(value: unknown): ReferralUrgency {
  if (value !== 'STANDARD' && value !== 'URGENT') throw new RepositoryValidationError()
  return value
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new RepositoryValidationError()
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new RepositoryValidationError()
  return value
}

function readReferral(row: ReferralRow): ReferralRecord {
  if (row.status !== 'OPEN' || row.record_version !== 1) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row.id),
    patientId: parseEntityId(row.patient_id),
    encounterId: parseEntityId(row.encounter_id),
    protocolVersionId: parseEntityId(row.protocol_version_id),
    reasonCodes: parseReasonCodesJson(row.reason_codes_json),
    urgency: parseUrgency(row.urgency),
    dueDate: parseDate(row.due_date),
    status: 'OPEN',
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    recordVersion: 1
  })
}

function parseReasonCodesJson(value: unknown): readonly AutomaticReferralReasonCode[] {
  if (typeof value !== 'string') throw new RepositoryDataIntegrityError()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length !== 1) throw new RepositoryDataIntegrityError()
    return Object.freeze([parseReasonCode(parsed[0])])
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) throw error
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function createOutboxPayload(input: ReturnType<typeof parseCreateAutomaticReferralInput>): string {
  return JSON.stringify({
    referral_id: input.id,
    patient_id: input.patientId,
    encounter_id: input.encounterId,
    protocol_version_id: input.protocolVersionId,
    reason_code: input.reasonCode,
    urgency: input.urgency,
    due_date: input.dueDate,
    status: 'OPEN',
    record_version: 1
  })
}

function toReferralRecord(
  input: ReturnType<typeof parseCreateAutomaticReferralInput>
): ReferralRecord {
  return Object.freeze({
    id: input.id,
    patientId: input.patientId,
    encounterId: input.encounterId,
    protocolVersionId: input.protocolVersionId,
    reasonCodes: Object.freeze([input.reasonCode]),
    urgency: input.urgency,
    dueDate: input.dueDate,
    status: 'OPEN',
    createdBy: input.actorId,
    createdAt: input.createdAt,
    recordVersion: 1
  })
}
