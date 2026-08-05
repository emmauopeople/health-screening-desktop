import type Database from 'better-sqlite3'

import { DatabaseTransactionStateError } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseUserDisplayName } from '@main/database/repositories/local-user'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import type {
  PatientAcknowledgmentHistoryInput,
  PatientAcknowledgmentHistoryResult,
  PatientAcknowledgmentRecord,
  PatientAcknowledgmentRepository,
  PatientAcknowledgmentSourceType
} from './patient-acknowledgment-types'
import {
  normalizePatientAcknowledgmentNote,
  parseInsertPatientAcknowledgmentInput,
  parsePatientAcknowledgmentHistoryInput,
  parsePatientAcknowledgmentHistoryStatus,
  parsePatientAcknowledgmentRowVersion
} from './patient-acknowledgment-validation'

interface CountRow {
  total: unknown
}

const registryAcknowledgmentType = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
const localSourceType = 'LOCAL'

const acknowledgmentRowKeys = Object.freeze([
  'id',
  'patient_id',
  'status',
  'source_type',
  'effective_at',
  'withdrawn_at',
  'notes',
  'recorded_by',
  'recorded_by_display_name',
  'recorded_at',
  'patient_prior_row_version',
  'patient_resulting_row_version'
] as const)

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
  recorded_at,
  patient_prior_row_version,
  patient_resulting_row_version
) VALUES (?, ?, '${registryAcknowledgmentType}', ?, '${localSourceType}', ?, NULL, ?, ?, ?, ?, ?);
`

const countAcknowledgmentsByPatientSql = `
SELECT COUNT(*) AS total
FROM consent_records
WHERE patient_id = ?
  AND consent_type = '${registryAcknowledgmentType}';
`

const selectAcknowledgmentsByPatientSql = `
SELECT
  acknowledgment.id,
  acknowledgment.patient_id,
  acknowledgment.status,
  acknowledgment.source_type,
  acknowledgment.effective_at,
  acknowledgment.withdrawn_at,
  acknowledgment.notes,
  acknowledgment.recorded_by,
  recorded_user.display_name AS recorded_by_display_name,
  acknowledgment.recorded_at,
  acknowledgment.patient_prior_row_version,
  acknowledgment.patient_resulting_row_version
FROM consent_records acknowledgment
JOIN users recorded_user ON recorded_user.id = acknowledgment.recorded_by
WHERE acknowledgment.patient_id = ?
  AND acknowledgment.consent_type = '${registryAcknowledgmentType}'
ORDER BY acknowledgment.recorded_at DESC, acknowledgment.id DESC
LIMIT ? OFFSET ?;
`

const selectLatestAcknowledgmentByPatientSql = `
SELECT
  acknowledgment.id,
  acknowledgment.patient_id,
  acknowledgment.status,
  acknowledgment.source_type,
  acknowledgment.effective_at,
  acknowledgment.withdrawn_at,
  acknowledgment.notes,
  acknowledgment.recorded_by,
  recorded_user.display_name AS recorded_by_display_name,
  acknowledgment.recorded_at,
  acknowledgment.patient_prior_row_version,
  acknowledgment.patient_resulting_row_version
FROM consent_records acknowledgment
JOIN users recorded_user ON recorded_user.id = acknowledgment.recorded_by
WHERE acknowledgment.patient_id = ?
  AND acknowledgment.consent_type = '${registryAcknowledgmentType}'
ORDER BY acknowledgment.recorded_at DESC, acknowledgment.id DESC
LIMIT 1;
`

export function createPatientAcknowledgmentRepository(
  connection: Database.Database
): PatientAcknowledgmentRepository {
  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: Parameters<PatientAcknowledgmentRepository['insert']>[1]
  ): void => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const parsedInput = parseInsertPatientAcknowledgmentInput(input)

    try {
      scopedConnection
        .prepare<[string, string, string, string, string | null, string, string, number, number]>(
          insertAcknowledgmentSql
        )
        .run(
          parsedInput.id,
          parsedInput.patientId,
          parsedInput.status,
          parsedInput.recordedAt,
          parsedInput.note,
          parsedInput.recordedBy,
          parsedInput.recordedAt,
          parsedInput.priorRowVersion,
          parsedInput.resultingRowVersion
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }
  }

  const getLatestByPatient = (
    patientId: Parameters<PatientAcknowledgmentRepository['getLatestByPatient']>[0]
  ): PatientAcknowledgmentRecord | null => {
    let parsedPatientId: string

    try {
      parsedPatientId = parseEntityId(patientId)
    } catch (error) {
      throw new RepositoryValidationError(getRepositoryErrorType(error))
    }

    let row: unknown

    try {
      row = connection.prepare(selectLatestAcknowledgmentByPatientSql).get(parsedPatientId)
    } catch (error) {
      throw new RepositoryReadError(getRepositoryErrorType(error))
    }

    if (row === undefined) {
      return null
    }

    return decodeAcknowledgmentRecord(row)
  }

  const listByPatient = (
    input: PatientAcknowledgmentHistoryInput
  ): PatientAcknowledgmentHistoryResult => {
    const parsedInput = parsePatientAcknowledgmentHistoryInput(input)
    const offset = calculateOffset(parsedInput)
    const total = countAcknowledgmentsByPatient(connection, parsedInput.patientId)
    const items = readAcknowledgmentsByPatient(
      connection,
      parsedInput.patientId,
      parsedInput.pageSize,
      offset
    )

    return Object.freeze({
      items,
      page: parsedInput.page,
      pageSize: parsedInput.pageSize,
      total
    })
  }

  return Object.freeze({
    insert,
    getLatestByPatient,
    listByPatient
  })
}

function countAcknowledgmentsByPatient(connection: Database.Database, patientId: string): number {
  let row: unknown

  try {
    row = connection.prepare(countAcknowledgmentsByPatientSql).get(patientId)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }

  return decodeTotal(row)
}

function readAcknowledgmentsByPatient(
  connection: Database.Database,
  patientId: string,
  pageSize: number,
  offset: number
): readonly PatientAcknowledgmentRecord[] {
  let rows: unknown

  try {
    rows = connection.prepare(selectAcknowledgmentsByPatientSql).all(patientId, pageSize, offset)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }

  return decodeAcknowledgmentRows(rows)
}

function decodeAcknowledgmentRows(rows: unknown): readonly PatientAcknowledgmentRecord[] {
  try {
    if (!Array.isArray(rows)) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze(rows.map(decodeAcknowledgmentRecord))
  } catch (error) {
    throw toDataIntegrityError(error)
  }
}

function decodeAcknowledgmentRecord(row: unknown): PatientAcknowledgmentRecord {
  try {
    const data = readRowDataProperties(row, acknowledgmentRowKeys)
    const note = normalizePatientAcknowledgmentNote(data.notes)
    const recordedAt = parseUtcTimestamp(data.recorded_at)
    const effectiveAt = parseUtcTimestamp(data.effective_at)
    const displayName = parseUserDisplayName(data.recorded_by_display_name)
    const { priorRowVersion, resultingRowVersion } = decodeRowVersionMetadata(
      data.patient_prior_row_version,
      data.patient_resulting_row_version
    )

    if (data.notes !== note) {
      throw new RepositoryDataIntegrityError()
    }

    if (data.source_type !== localSourceType) {
      throw new RepositoryDataIntegrityError()
    }

    if (effectiveAt !== recordedAt || data.withdrawn_at !== null) {
      throw new RepositoryDataIntegrityError()
    }

    if (displayName !== data.recorded_by_display_name) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patient_id),
      status: parsePatientAcknowledgmentHistoryStatus(data.status),
      sourceType: localSourceType as PatientAcknowledgmentSourceType,
      note,
      recordedBy: parseEntityId(data.recorded_by),
      recordedByDisplayName: displayName,
      recordedAt,
      priorRowVersion,
      resultingRowVersion
    })
  } catch (error) {
    throw toDataIntegrityError(error)
  }
}

function decodeRowVersionMetadata(
  priorValue: unknown,
  resultingValue: unknown
): {
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number | null
} {
  if (priorValue === null && resultingValue === null) {
    return Object.freeze({
      priorRowVersion: null,
      resultingRowVersion: null
    })
  }

  if (priorValue === null || resultingValue === null) {
    throw new RepositoryDataIntegrityError()
  }

  const priorRowVersion = parsePatientAcknowledgmentRowVersion(priorValue)
  const resultingRowVersion = parsePatientAcknowledgmentRowVersion(resultingValue)

  if (resultingRowVersion !== priorRowVersion + 1) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    priorRowVersion,
    resultingRowVersion
  })
}

function decodeTotal(row: unknown): number {
  try {
    const data = readRowDataProperties(row, ['total'])
    const total = (data as unknown as CountRow).total

    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
      throw new RepositoryDataIntegrityError()
    }

    return total
  } catch (error) {
    throw toDataIntegrityError(error)
  }
}

function calculateOffset({
  page,
  pageSize
}: ReturnType<typeof parsePatientAcknowledgmentHistoryInput>): number {
  const offset = (page - 1) * pageSize

  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RepositoryValidationError()
  }

  return offset
}

function readRowDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryDataIntegrityError()
  }

  let descriptors: PropertyDescriptorMap

  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryDataIntegrityError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryDataIntegrityError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function toDataIntegrityError(error: unknown): RepositoryDataIntegrityError {
  if (error instanceof RepositoryDataIntegrityError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }

  return new RepositoryDataIntegrityError(getRepositoryErrorType(error))
}
