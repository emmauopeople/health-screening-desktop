import type Database from 'better-sqlite3'

import { DatabaseTransactionStateError } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import type { PatientAcknowledgmentStatus, PatientSex, PatientStatus } from '@shared/ipc'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  formatPatientCode,
  parsePatientCode,
  parsePatientEntityId,
  parsePatientRowVersion,
  parsePatientSearchText
} from './patient-validation'
import type {
  CreatePatientRepositoryInput,
  InsertPatientAuditOutboxInput,
  MarkNotDuplicateInput,
  NormalizedPatientFields,
  PatientCode,
  PatientDetailRecord,
  PatientDuplicateCandidateRecord,
  PatientDuplicatePairRecord,
  PatientRepository,
  PatientSearchInput,
  PatientSearchResultRecord,
  PatientSummaryRecord,
  PatientUpdateResultRecord,
  UpdatePatientRepositoryInput
} from './patient-types'

interface CountRow {
  total: unknown
}

interface SequenceRow {
  next_value: unknown
}

const maximumRecentPatientsPerUser = 25
const registryAcknowledgmentType = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'

const patientSummaryColumns = `
  p.id,
  p.patient_code,
  p.display_name,
  p.given_name,
  p.family_name,
  p.other_names,
  p.date_of_birth,
  p.approximate_age_years,
  p.age_as_of_date,
  p.sex,
  p.village,
  p.quarter,
  p.phone,
  p.status,
  p.row_version,
  p.updated_at
`

const patientDetailColumns = `
  ${patientSummaryColumns},
  p.alternate_contact_name,
  p.alternate_contact_phone,
  p.residence_notes,
  p.created_at,
  created_user.display_name AS created_by_display_name,
  updated_user.display_name AS updated_by_display_name,
  latest_ack.status AS acknowledgment_status,
  latest_ack.recorded_at AS acknowledgment_recorded_at,
  ack_user.display_name AS acknowledgment_recorded_by_display_name
`

const patientDetailJoins = `
JOIN users created_user ON created_user.id = p.created_by
JOIN users updated_user ON updated_user.id = p.updated_by
LEFT JOIN consent_records latest_ack
  ON latest_ack.id = (
    SELECT cr.id
    FROM consent_records cr
    WHERE cr.patient_id = p.id
      AND cr.consent_type = '${registryAcknowledgmentType}'
    ORDER BY cr.recorded_at DESC, cr.id DESC
    LIMIT 1
  )
LEFT JOIN users ack_user ON ack_user.id = latest_ack.recorded_by
`

const selectPatientByIdSql = `
SELECT
${patientDetailColumns}
FROM patients p
${patientDetailJoins}
WHERE p.id = ?;
`

const searchWhereSql = `
WHERE (
  @query = ''
  OR p.patient_code LIKE @likeQuery
  OR p.name_normalized LIKE @likeQuery
  OR p.phone_normalized LIKE @digitsLike
  OR p.date_of_birth LIKE @likeQuery
  OR CAST(p.approximate_age_years AS TEXT) = @query
  OR lower(p.sex) LIKE @likeQuery
  OR lower(COALESCE(p.village, '')) LIKE @likeQuery
  OR lower(COALESCE(p.quarter, '')) LIKE @likeQuery
)
`

const searchPatientsSql = `
SELECT
${patientSummaryColumns}
FROM patients p
${searchWhereSql}
ORDER BY
  CASE WHEN p.patient_code = @exactCode THEN 0 ELSE 1 END ASC,
  p.name_normalized ASC,
  p.date_of_birth ASC,
  p.patient_code ASC,
  p.id ASC
LIMIT @limit OFFSET @offset;
`

const countSearchPatientsSql = `
SELECT COUNT(*) AS total
FROM patients p
${searchWhereSql};
`

const selectRecentPatientsSql = `
SELECT
${patientSummaryColumns}
FROM patient_recent_access recent
JOIN patients p ON p.id = recent.patient_id
WHERE recent.user_id = ?
ORDER BY recent.last_viewed_at DESC, p.patient_code ASC, p.id ASC
LIMIT ?;
`

const selectDuplicateCandidatesSql = `
SELECT
${patientSummaryColumns}
FROM patients p
WHERE p.status = 'ACTIVE'
  AND (@excludePatientId IS NULL OR p.id <> @excludePatientId)
  AND (
    (@phoneNormalized IS NOT NULL AND p.phone_normalized = @phoneNormalized)
    OR (
      @dateOfBirth IS NOT NULL
      AND p.date_of_birth = @dateOfBirth
      AND p.sex = @sex
      AND p.name_normalized LIKE @namePrefix
    )
    OR (
      @nameNormalized <> ''
      AND p.name_normalized = @nameNormalized
      AND lower(COALESCE(p.village, '')) = @villageNormalized
    )
    OR (
      @approximateAgeYears IS NOT NULL
      AND p.approximate_age_years BETWEEN @ageLow AND @ageHigh
      AND p.sex = @sex
      AND p.name_normalized = @nameNormalized
    )
  )
ORDER BY p.name_normalized ASC, p.date_of_birth ASC, p.patient_code ASC, p.id ASC
LIMIT @limit;
`

const duplicateIdentityKeySql = (alias: string): string => `
  lower(COALESCE(${alias}.name_normalized, '')) || '|' ||
  COALESCE(${alias}.date_of_birth, '') || '|' ||
  COALESCE(CAST(${alias}.approximate_age_years AS TEXT), '') || '|' ||
  COALESCE(${alias}.age_as_of_date, '') || '|' ||
  COALESCE(${alias}.sex, '') || '|' ||
  COALESCE(${alias}.phone_normalized, '') || '|' ||
  lower(COALESCE(${alias}.village, '')) || '|' ||
  lower(COALESCE(${alias}.quarter, ''))
`

const listPossibleDuplicatePairsSql = `
SELECT
  first_patient.id AS first_id,
  first_patient.patient_code AS first_patient_code,
  first_patient.display_name AS first_display_name,
  first_patient.given_name AS first_given_name,
  first_patient.family_name AS first_family_name,
  first_patient.other_names AS first_other_names,
  first_patient.date_of_birth AS first_date_of_birth,
  first_patient.approximate_age_years AS first_approximate_age_years,
  first_patient.age_as_of_date AS first_age_as_of_date,
  first_patient.sex AS first_sex,
  first_patient.village AS first_village,
  first_patient.quarter AS first_quarter,
  first_patient.phone AS first_phone,
  first_patient.status AS first_status,
  first_patient.row_version AS first_row_version,
  first_patient.updated_at AS first_updated_at,
  second_patient.id AS second_id,
  second_patient.patient_code AS second_patient_code,
  second_patient.display_name AS second_display_name,
  second_patient.given_name AS second_given_name,
  second_patient.family_name AS second_family_name,
  second_patient.other_names AS second_other_names,
  second_patient.date_of_birth AS second_date_of_birth,
  second_patient.approximate_age_years AS second_approximate_age_years,
  second_patient.age_as_of_date AS second_age_as_of_date,
  second_patient.sex AS second_sex,
  second_patient.village AS second_village,
  second_patient.quarter AS second_quarter,
  second_patient.phone AS second_phone,
  second_patient.status AS second_status,
  second_patient.row_version AS second_row_version,
  second_patient.updated_at AS second_updated_at
FROM patients first_patient
JOIN patients second_patient
  ON first_patient.id < second_patient.id
LEFT JOIN patient_duplicate_reviews review
  ON review.pair_key = first_patient.id || ':' || second_patient.id
  AND review.status = 'NOT_DUPLICATE'
  AND review.patient_a_identity_key = ${duplicateIdentityKeySql('first_patient')}
  AND review.patient_b_identity_key = ${duplicateIdentityKeySql('second_patient')}
WHERE first_patient.status = 'ACTIVE'
  AND second_patient.status = 'ACTIVE'
  AND review.id IS NULL
  AND (
    (
      first_patient.phone_normalized IS NOT NULL
      AND first_patient.phone_normalized = second_patient.phone_normalized
    )
    OR (
      first_patient.date_of_birth IS NOT NULL
      AND first_patient.date_of_birth = second_patient.date_of_birth
      AND first_patient.sex = second_patient.sex
      AND first_patient.name_normalized = second_patient.name_normalized
    )
    OR (
      first_patient.name_normalized = second_patient.name_normalized
      AND lower(COALESCE(first_patient.village, '')) = lower(COALESCE(second_patient.village, ''))
    )
  )
ORDER BY first_patient.name_normalized ASC, second_patient.name_normalized ASC, first_patient.id ASC
LIMIT ?;
`

const selectSequenceSql = `
SELECT next_value
FROM patient_local_sequence
WHERE singleton_id = 1;
`

const updateSequenceSql = `
UPDATE patient_local_sequence
SET next_value = ?, updated_at = ?
WHERE singleton_id = 1;
`

const selectPatientCodeExistsSql = `
SELECT 1 AS exists_value
FROM patients
WHERE patient_code = ?
LIMIT 1;
`

const insertPatientSql = `
INSERT INTO patients (
  id,
  patient_code,
  display_name,
  given_name,
  family_name,
  other_names,
  name_normalized,
  sex,
  date_of_birth,
  approximate_age_years,
  age_as_of_date,
  phone,
  phone_normalized,
  alternate_contact_name,
  alternate_contact_phone,
  village,
  quarter,
  residence_notes,
  status,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);
`

const insertIdentifierSql = `
INSERT INTO patient_identifiers (
  id,
  patient_id,
  identifier_type,
  issuer,
  identifier_value,
  is_primary,
  valid_from,
  valid_to,
  created_by,
  created_at,
  status
) VALUES (?, ?, 'LOCAL_PATIENT_CODE', 'LOCAL', ?, 1, ?, NULL, ?, ?, 'ACTIVE');
`

const insertAcknowledgmentSql = `
INSERT INTO consent_records (
  id,
  patient_id,
  consent_type,
  status,
  source_type,
  effective_at,
  withdrawn_at,
  notes,
  recorded_by,
  recorded_at
) VALUES (?, ?, '${registryAcknowledgmentType}', ?, 'LOCAL', ?, NULL, NULL, ?, ?);
`

const updatePatientSql = `
UPDATE patients
SET
  display_name = ?,
  given_name = ?,
  family_name = ?,
  other_names = ?,
  name_normalized = ?,
  sex = ?,
  date_of_birth = ?,
  approximate_age_years = ?,
  age_as_of_date = ?,
  phone = ?,
  phone_normalized = ?,
  alternate_contact_name = ?,
  alternate_contact_phone = ?,
  village = ?,
  quarter = ?,
  residence_notes = ?,
  status = ?,
  updated_by = ?,
  updated_at = ?,
  row_version = row_version + 1
WHERE id = ? AND row_version = ?;
`

const upsertRecentAccessSql = `
INSERT INTO patient_recent_access (user_id, patient_id, last_viewed_at)
VALUES (?, ?, ?)
ON CONFLICT(user_id, patient_id) DO UPDATE SET
  last_viewed_at = excluded.last_viewed_at;
`

const pruneRecentAccessSql = `
DELETE FROM patient_recent_access
WHERE user_id = ?
  AND patient_id NOT IN (
    SELECT patient_id
    FROM patient_recent_access
    WHERE user_id = ?
    ORDER BY last_viewed_at DESC, patient_id ASC
    LIMIT ?
  );
`

const insertDuplicateReviewSql = `
INSERT OR IGNORE INTO patient_duplicate_reviews (
  id,
  patient_id_a,
  patient_id_b,
  pair_key,
  patient_a_row_version,
  patient_b_row_version,
  patient_a_identity_key,
  patient_b_identity_key,
  status,
  reason_codes_json,
  reviewed_by,
  reviewed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NOT_DUPLICATE', ?, ?, ?);
`

const insertOutboxSql = `
INSERT INTO sync_outbox (
  id,
  aggregate_type,
  aggregate_id,
  operation,
  payload_json,
  payload_schema_version,
  created_at,
  status,
  attempt_count,
  next_attempt_at,
  last_error_code,
  last_error_message,
  sent_at
) VALUES (?, 'PATIENT', ?, ?, ?, 'patient.registry.v1', ?, 'PENDING', 0, NULL, NULL, NULL, NULL);
`

export function createPatientRepository(connection: Database.Database): PatientRepository {
  const repository: PatientRepository = Object.freeze({
    nextPatientCode(
      scopedConnection: DatabaseTransactionConnection,
      updatedAt: UtcTimestamp
    ): PatientCode {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const row = scopedConnection.prepare<[], unknown>(selectSequenceSql).get()
        const nextValue = decodeSequenceValue(row)
        let sequenceValue = nextValue
        let code = formatPatientCode(sequenceValue)

        while (patientCodeExists(scopedConnection, code)) {
          sequenceValue += 1
          code = formatPatientCode(sequenceValue)
        }

        scopedConnection
          .prepare<[number, string]>(updateSequenceSql)
          .run(sequenceValue + 1, updatedAt)

        return code
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    },

    search(input: PatientSearchInput): PatientSearchResultRecord {
      const parsedQuery = parsePatientSearchText(input.query)
      const page = parsePositiveInteger(input.page)
      const pageSize = parsePageSize(input.pageSize)
      const bind = createSearchBind(parsedQuery, page, pageSize)

      try {
        const items = decodeSummaryRows(connection.prepare(searchPatientsSql).all(bind))
        const row = connection.prepare(countSearchPatientsSql).get(bind) as CountRow | undefined
        const total = decodeTotal(row)

        return Object.freeze({
          items,
          page,
          pageSize,
          total
        })
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getById(id: EntityId): PatientDetailRecord | null {
      const parsedId = parsePatientEntityId(id)

      try {
        const row = connection.prepare(selectPatientByIdSql).get(parsedId)

        return row === undefined ? null : decodeDetailRow(row)
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    insert(
      scopedConnection: DatabaseTransactionConnection,
      input: CreatePatientRepositoryInput
    ): PatientDetailRecord {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        scopedConnection
          .prepare<
            [
              string,
              string,
              string,
              string | null,
              string | null,
              string | null,
              string,
              string,
              string | null,
              number | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string,
              string,
              string,
              string,
              string
            ]
          >(insertPatientSql)
          .run(
            input.id,
            input.patientCode,
            input.fields.displayName,
            input.fields.givenName,
            input.fields.familyName,
            input.fields.otherNames,
            input.fields.nameNormalized,
            input.fields.sex,
            input.fields.dateOfBirth,
            input.fields.approximateAgeYears,
            input.fields.ageAsOfDate,
            input.fields.phone,
            input.fields.phoneNormalized,
            input.fields.alternateContactName,
            input.fields.alternateContactPhone,
            input.fields.village,
            input.fields.quarter,
            input.fields.residenceNotes,
            input.fields.status,
            input.createdBy,
            input.createdAt,
            input.createdBy,
            input.createdAt
          )

        scopedConnection
          .prepare<[string, string, string, string, string, string]>(insertIdentifierSql)
          .run(
            createScopedEntityId(scopedConnection),
            input.id,
            input.patientCode,
            input.createdAt,
            input.createdBy,
            input.createdAt
          )
        insertAcknowledgment(scopedConnection, {
          id: createScopedEntityId(scopedConnection),
          patientId: input.id,
          status: input.fields.acknowledgmentStatus,
          recordedBy: input.createdBy,
          recordedAt: input.createdAt
        })

        const created = readPatientAfterWrite(scopedConnection, input.id)

        if (created === null) {
          throw new RepositoryWriteError()
        }

        return created
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryWriteError) {
          throw new RepositoryWriteError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    },

    update(
      scopedConnection: DatabaseTransactionConnection,
      input: UpdatePatientRepositoryInput
    ): PatientUpdateResultRecord {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const current = readPatientAfterWrite(scopedConnection, input.id)

        if (current === null) {
          return Object.freeze({ status: 'NOT_FOUND' as const })
        }

        const result = scopedConnection
          .prepare<
            [
              string,
              string | null,
              string | null,
              string | null,
              string,
              string,
              string | null,
              number | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string | null,
              string,
              string,
              string,
              string,
              number
            ]
          >(updatePatientSql)
          .run(
            input.fields.displayName,
            input.fields.givenName,
            input.fields.familyName,
            input.fields.otherNames,
            input.fields.nameNormalized,
            input.fields.sex,
            input.fields.dateOfBirth,
            input.fields.approximateAgeYears,
            input.fields.ageAsOfDate,
            input.fields.phone,
            input.fields.phoneNormalized,
            input.fields.alternateContactName,
            input.fields.alternateContactPhone,
            input.fields.village,
            input.fields.quarter,
            input.fields.residenceNotes,
            input.fields.status,
            input.updatedBy,
            input.updatedAt,
            input.id,
            input.expectedRowVersion
          )

        if (result.changes === 0) {
          return Object.freeze({
            status: 'PATIENT_VERSION_CONFLICT' as const,
            patient: current
          })
        }

        if (input.fields.acknowledgmentStatus !== current.acknowledgmentStatus) {
          insertAcknowledgment(scopedConnection, {
            id: createScopedEntityId(scopedConnection),
            patientId: input.id,
            status: input.fields.acknowledgmentStatus,
            recordedBy: input.updatedBy,
            recordedAt: input.updatedAt
          })
        }

        const updated = readPatientAfterWrite(scopedConnection, input.id)

        if (updated === null) {
          throw new RepositoryWriteError()
        }

        return Object.freeze({
          status: 'UPDATED' as const,
          patient: updated
        })
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryWriteError) {
          throw new RepositoryWriteError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    },

    recordRecentAccess(
      scopedConnection: DatabaseTransactionConnection,
      userId: EntityId,
      patientId: EntityId,
      viewedAt: UtcTimestamp
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        scopedConnection
          .prepare<[string, string, string]>(upsertRecentAccessSql)
          .run(userId, patientId, viewedAt)
        scopedConnection
          .prepare<[string, string, number]>(pruneRecentAccessSql)
          .run(userId, userId, maximumRecentPatientsPerUser)
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    },

    listRecent(userId: EntityId, limit: number): readonly PatientSummaryRecord[] {
      const parsedUserId = parsePatientEntityId(userId)
      const parsedLimit = Math.min(parsePositiveInteger(limit), maximumRecentPatientsPerUser)

      try {
        return decodeSummaryRows(
          connection.prepare(selectRecentPatientsSql).all(parsedUserId, parsedLimit)
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    findDuplicateCandidates(
      fields: NormalizedPatientFields,
      options: { readonly excludePatientId: EntityId | null; readonly limit: number }
    ): readonly PatientDuplicateCandidateRecord[] {
      const bind = createDuplicateBind(fields, options)

      try {
        return Object.freeze(
          decodeSummaryRows(connection.prepare(selectDuplicateCandidatesSql).all(bind)).map(
            (patient) =>
              Object.freeze({
                patient,
                matchedOn: Object.freeze(getMatchedFields(fields, patient)),
                score: getDuplicateScore(fields, patient)
              })
          )
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    listPossibleDuplicatePairs(limit: number): readonly PatientDuplicatePairRecord[] {
      const parsedLimit = Math.min(parsePositiveInteger(limit), 100)

      try {
        return Object.freeze(
          (connection.prepare(listPossibleDuplicatePairsSql).all(parsedLimit) as unknown[]).map(
            decodeDuplicatePairRow
          )
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    markNotDuplicate(
      scopedConnection: DatabaseTransactionConnection,
      input: MarkNotDuplicateInput
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        scopedConnection
          .prepare<
            [string, string, string, string, number, number, string, string, string, string, string]
          >(insertDuplicateReviewSql)
          .run(
            input.id,
            input.patientIdA,
            input.patientIdB,
            input.pairKey,
            input.patientARowVersion,
            input.patientBRowVersion,
            input.patientAIdentityKey,
            input.patientBIdentityKey,
            JSON.stringify(input.reasonCodes),
            input.reviewedBy,
            input.reviewedAt
          )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    },

    insertOutbox(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertPatientAuditOutboxInput
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        scopedConnection
          .prepare<[string, string, string, string, string]>(insertOutboxSql)
          .run(
            input.id,
            input.aggregateId,
            input.operation,
            JSON.stringify(input.payload),
            input.createdAt
          )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    }
  })

  return repository
}

function createScopedEntityId(connection: DatabaseTransactionConnection): EntityId {
  const randomUuidRow = connection
    .prepare<[], { id: string }>('SELECT lower(hex(randomblob(16))) AS id')
    .get()

  if (randomUuidRow === undefined) {
    throw new RepositoryWriteError()
  }

  const raw = randomUuidRow.id
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(
    17,
    20
  )}-${raw.slice(20, 32)}`

  return parseEntityId(uuid)
}

function decodeSequenceValue(row: unknown): number {
  if (typeof row !== 'object' || row === null) {
    throw new RepositoryDataIntegrityError()
  }

  const value = (row as SequenceRow).next_value

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function patientCodeExists(connection: DatabaseTransactionConnection, code: PatientCode): boolean {
  return connection.prepare<[string], unknown>(selectPatientCodeExistsSql).get(code) !== undefined
}

function readPatientAfterWrite(
  connection: DatabaseTransactionConnection,
  id: EntityId
): PatientDetailRecord | null {
  const row = connection.prepare<[string], unknown>(selectPatientByIdSql).get(id)

  return row === undefined ? null : decodeDetailRow(row)
}

function insertAcknowledgment(
  connection: DatabaseTransactionConnection,
  input: {
    readonly id: EntityId
    readonly patientId: EntityId
    readonly status: PatientAcknowledgmentStatus
    readonly recordedBy: EntityId
    readonly recordedAt: UtcTimestamp
  }
): void {
  connection
    .prepare<[string, string, string, string, string, string]>(insertAcknowledgmentSql)
    .run(
      input.id,
      input.patientId,
      input.status,
      input.recordedAt,
      input.recordedBy,
      input.recordedAt
    )
}

function createSearchBind(
  query: string,
  page: number,
  pageSize: 25 | 50 | 100
): Record<string, unknown> {
  const queryLower = query.toLowerCase()
  const phoneDigits = query.replace(/\D/gu, '')
  const offset = (page - 1) * pageSize

  return {
    query: queryLower,
    likeQuery: `%${escapeLike(queryLower)}%`,
    digitsLike: phoneDigits.length > 0 ? `%${phoneDigits}%` : '__NO_PHONE_MATCH__',
    exactCode: query.toUpperCase(),
    limit: pageSize,
    offset
  }
}

function createDuplicateBind(
  fields: NormalizedPatientFields,
  options: { readonly excludePatientId: EntityId | null; readonly limit: number }
): Record<string, unknown> {
  const approximateAgeYears = fields.approximateAgeYears
  const ageLow = approximateAgeYears === null ? null : Math.max(0, approximateAgeYears - 1)
  const ageHigh = approximateAgeYears === null ? null : Math.min(120, approximateAgeYears + 1)

  return {
    excludePatientId: options.excludePatientId,
    phoneNormalized: fields.phoneNormalized,
    dateOfBirth: fields.dateOfBirth,
    sex: fields.sex,
    namePrefix: `${escapeLike(fields.nameNormalized.split(' ')[0] ?? fields.nameNormalized)}%`,
    nameNormalized: fields.nameNormalized,
    villageNormalized: (fields.village ?? '').toLowerCase(),
    approximateAgeYears,
    ageLow,
    ageHigh,
    limit: Math.min(parsePositiveInteger(options.limit), 25)
  }
}

function decodeSummaryRows(rows: unknown): readonly PatientSummaryRecord[] {
  if (!Array.isArray(rows)) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze(rows.map(decodeSummaryRow))
}

function decodeSummaryRow(row: unknown): PatientSummaryRecord {
  const data = requireRecord(row)

  return Object.freeze({
    id: parseEntityId(readString(data, 'id')),
    patientCode: parsePatientCode(readString(data, 'patient_code')),
    displayName: readString(data, 'display_name') as PatientSummaryRecord['displayName'],
    givenName: readNullableString(data, 'given_name'),
    familyName: readNullableString(data, 'family_name'),
    otherNames: readNullableString(data, 'other_names'),
    dateOfBirth: readNullableString(data, 'date_of_birth'),
    approximateAgeYears: readNullableInteger(data, 'approximate_age_years'),
    ageAsOfDate: readNullableString(data, 'age_as_of_date'),
    sex: readSex(data, 'sex'),
    village: readNullableString(data, 'village'),
    quarter: readNullableString(data, 'quarter'),
    phone: readNullableString(data, 'phone'),
    status: readStatus(data, 'status'),
    rowVersion: parsePatientRowVersion(readInteger(data, 'row_version')),
    updatedAt: parseUtcTimestamp(readString(data, 'updated_at'))
  })
}

function decodeDetailRow(row: unknown): PatientDetailRecord {
  const data = requireRecord(row)
  const summary = decodeSummaryRow(row)

  return Object.freeze({
    ...summary,
    alternateContactName: readNullableString(data, 'alternate_contact_name'),
    alternateContactPhone: readNullableString(data, 'alternate_contact_phone'),
    residenceNotes: readNullableString(data, 'residence_notes'),
    acknowledgmentStatus: readAcknowledgmentStatus(data, 'acknowledgment_status'),
    acknowledgmentRecordedAt: readNullableTimestamp(data, 'acknowledgment_recorded_at'),
    acknowledgmentRecordedByDisplayName: readNullableString(
      data,
      'acknowledgment_recorded_by_display_name'
    ),
    createdAt: parseUtcTimestamp(readString(data, 'created_at')),
    createdByDisplayName: readString(data, 'created_by_display_name'),
    updatedByDisplayName: readString(data, 'updated_by_display_name')
  })
}

function decodeDuplicatePairRow(row: unknown): PatientDuplicatePairRecord {
  const data = requireRecord(row)
  const first = decodePrefixedSummaryRow(data, 'first')
  const second = decodePrefixedSummaryRow(data, 'second')
  const matchedOn = getPairMatchedFields(first, second)

  return Object.freeze({
    pairKey: `${first.id}:${second.id}`,
    first,
    second,
    matchedOn: Object.freeze(matchedOn),
    score: getPairDuplicateScore(matchedOn)
  })
}

function decodePrefixedSummaryRow(
  data: Record<string, unknown>,
  prefix: 'first' | 'second'
): PatientSummaryRecord {
  const repacked = {
    id: data[`${prefix}_id`],
    patient_code: data[`${prefix}_patient_code`],
    display_name: data[`${prefix}_display_name`],
    given_name: data[`${prefix}_given_name`],
    family_name: data[`${prefix}_family_name`],
    other_names: data[`${prefix}_other_names`],
    date_of_birth: data[`${prefix}_date_of_birth`],
    approximate_age_years: data[`${prefix}_approximate_age_years`],
    age_as_of_date: data[`${prefix}_age_as_of_date`],
    sex: data[`${prefix}_sex`],
    village: data[`${prefix}_village`],
    quarter: data[`${prefix}_quarter`],
    phone: data[`${prefix}_phone`],
    status: data[`${prefix}_status`],
    row_version: data[`${prefix}_row_version`],
    updated_at: data[`${prefix}_updated_at`]
  }

  return decodeSummaryRow(repacked)
}

function getMatchedFields(
  fields: NormalizedPatientFields,
  patient: PatientSummaryRecord
): readonly string[] {
  const matched = new Set<string>()

  if (
    fields.phoneNormalized !== null &&
    normalizePhoneDigitsForComparison(patient.phone) === fields.phoneNormalized
  ) {
    matched.add('phone')
  }

  if (fields.dateOfBirth !== null && fields.dateOfBirth === patient.dateOfBirth) {
    matched.add('date_of_birth')
  }

  if (fields.sex === patient.sex) {
    matched.add('sex')
  }

  if (fields.village !== null && fields.village === patient.village) {
    matched.add('village')
  }

  if (patient.displayName.toLowerCase() === fields.nameNormalized) {
    matched.add('name')
  }

  if (
    fields.approximateAgeYears !== null &&
    fields.approximateAgeYears === patient.approximateAgeYears
  ) {
    matched.add('approximate_age')
  }

  return Object.freeze([...matched].sort())
}

function getDuplicateScore(fields: NormalizedPatientFields, patient: PatientSummaryRecord): number {
  return getPairDuplicateScore(getMatchedFields(fields, patient))
}

function getPairMatchedFields(
  first: PatientSummaryRecord,
  second: PatientSummaryRecord
): readonly string[] {
  const matched = new Set<string>()

  const firstPhone = normalizePhoneDigitsForComparison(first.phone)
  const secondPhone = normalizePhoneDigitsForComparison(second.phone)

  if (firstPhone !== null && firstPhone === secondPhone) {
    matched.add('phone')
  }

  if (first.dateOfBirth !== null && first.dateOfBirth === second.dateOfBirth) {
    matched.add('date_of_birth')
  }

  if (first.sex === second.sex) {
    matched.add('sex')
  }

  if (first.village !== null && first.village === second.village) {
    matched.add('village')
  }

  if (first.displayName.toLowerCase() === second.displayName.toLowerCase()) {
    matched.add('name')
  }

  return Object.freeze([...matched].sort())
}

function getPairDuplicateScore(matchedOn: readonly string[]): number {
  const weighted = matchedOn.reduce((score, field) => {
    switch (field) {
      case 'phone':
        return score + 45
      case 'date_of_birth':
        return score + 25
      case 'name':
        return score + 20
      case 'sex':
      case 'village':
      case 'approximate_age':
        return score + 5
      default:
        return score
    }
  }, 0)

  return Math.max(1, Math.min(100, weighted))
}

function normalizePhoneDigitsForComparison(phone: string | null): string | null {
  const digits = phone?.replace(/\D/gu, '') ?? ''

  return digits.length === 0 ? null : digits
}

function decodeTotal(row: CountRow | undefined): number {
  if (row === undefined || typeof row.total !== 'number' || !Number.isSafeInteger(row.total)) {
    throw new RepositoryDataIntegrityError()
  }

  return row.total
}

function readAcknowledgmentStatus(
  data: Record<string, unknown>,
  key: string
): PatientAcknowledgmentStatus {
  const value = readNullableString(data, key)

  if (value === null) {
    return 'NOT_REQUESTED'
  }

  if (value === 'ACKNOWLEDGED' || value === 'DECLINED' || value === 'NOT_REQUESTED') {
    return value
  }

  throw new RepositoryDataIntegrityError()
}

function readSex(data: Record<string, unknown>, key: string): PatientSex {
  const value = readString(data, key)

  if (value === 'FEMALE' || value === 'MALE' || value === 'OTHER' || value === 'UNKNOWN') {
    return value
  }

  throw new RepositoryDataIntegrityError()
}

function readStatus(data: Record<string, unknown>, key: string): PatientStatus {
  const value = readString(data, key)

  if (value === 'ACTIVE' || value === 'INACTIVE') {
    return value
  }

  throw new RepositoryDataIntegrityError()
}

function readNullableTimestamp(data: Record<string, unknown>, key: string): UtcTimestamp | null {
  const value = readNullableString(data, key)

  return value === null ? null : parseUtcTimestamp(value)
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]

  if (typeof value !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function readNullableString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function readInteger(data: Record<string, unknown>, key: string): number {
  const value = data[key]

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function readNullableInteger(data: Record<string, unknown>, key: string): number | null {
  const value = data[key]

  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryDataIntegrityError()
  }

  return value as Record<string, unknown>
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePageSize(value: unknown): 25 | 50 | 100 {
  if (value === 25 || value === 50 || value === 100) {
    return value
  }

  throw new RepositoryValidationError()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}
