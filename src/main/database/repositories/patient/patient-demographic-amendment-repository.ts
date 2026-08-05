import type Database from 'better-sqlite3'

import { DatabaseTransactionStateError } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
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
  PatientDemographicAmendmentChangeRecord,
  PatientDemographicAmendmentFieldName,
  PatientDemographicAmendmentHistoryInput,
  PatientDemographicAmendmentHistoryResult,
  PatientDemographicAmendmentRecord,
  PatientDemographicAmendmentRepository,
  PatientDemographicAmendmentValue
} from './patient-demographic-amendment-types'
import {
  canonicalizePatientDemographicAmendmentValue,
  comparePatientDemographicAmendmentFields,
  normalizePatientDemographicAmendmentReasonNote,
  parseInsertPatientDemographicAmendmentInput,
  parsePatientDemographicAmendmentFieldName,
  parsePatientDemographicAmendmentHistoryInput,
  parsePatientDemographicAmendmentReasonCode,
  parsePatientDemographicAmendmentRowVersion,
  parsePatientDemographicAmendmentValueForField
} from './patient-demographic-amendment-validation'

interface CountRow {
  total: unknown
}

const amendmentHeaderRowKeys = Object.freeze([
  'id',
  'patient_id',
  'prior_row_version',
  'resulting_row_version',
  'reason_code',
  'reason_note',
  'amended_by',
  'amended_by_display_name',
  'amended_at'
] as const)

const amendmentChangeRowKeys = Object.freeze([
  'amendment_id',
  'field_name',
  'previous_value_json',
  'new_value_json'
] as const)

const insertAmendmentHeaderSql = `
INSERT INTO patient_demographic_amendments (
  id,
  patient_id,
  prior_row_version,
  resulting_row_version,
  reason_code,
  reason_note,
  amended_by,
  amended_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`

const insertAmendmentChangeSql = `
INSERT INTO patient_demographic_amendment_changes (
  amendment_id,
  field_name,
  previous_value_json,
  new_value_json
) VALUES (?, ?, ?, ?);
`

const countAmendmentsByPatientSql = `
SELECT COUNT(*) AS total
FROM patient_demographic_amendments
WHERE patient_id = ?;
`

const selectAmendmentsByPatientSql = `
SELECT
  amendment.id,
  amendment.patient_id,
  amendment.prior_row_version,
  amendment.resulting_row_version,
  amendment.reason_code,
  amendment.reason_note,
  amendment.amended_by,
  amended_user.display_name AS amended_by_display_name,
  amendment.amended_at
FROM patient_demographic_amendments amendment
JOIN users amended_user ON amended_user.id = amendment.amended_by
WHERE amendment.patient_id = ?
ORDER BY amendment.amended_at DESC, amendment.id DESC
LIMIT ? OFFSET ?;
`

export function createPatientDemographicAmendmentRepository(
  connection: Database.Database
): PatientDemographicAmendmentRepository {
  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: Parameters<PatientDemographicAmendmentRepository['insert']>[1]
  ): void => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const parsedInput = parseInsertPatientDemographicAmendmentInput(input)

    try {
      scopedConnection
        .prepare<[string, string, number, number, string, string | null, string, string]>(
          insertAmendmentHeaderSql
        )
        .run(
          parsedInput.id,
          parsedInput.patientId,
          parsedInput.priorRowVersion,
          parsedInput.resultingRowVersion,
          parsedInput.reasonCode,
          parsedInput.reasonNote,
          parsedInput.amendedBy,
          parsedInput.amendedAt
        )

      const insertChangeStatement =
        scopedConnection.prepare<[string, string, string, string]>(insertAmendmentChangeSql)

      for (const change of parsedInput.changes) {
        insertChangeStatement.run(
          parsedInput.id,
          change.fieldName,
          change.previousValueJson,
          change.newValueJson
        )
      }
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }
  }

  const listByPatient = (
    input: PatientDemographicAmendmentHistoryInput
  ): PatientDemographicAmendmentHistoryResult => {
    const parsedInput = parsePatientDemographicAmendmentHistoryInput(input)
    const offset = calculateOffset(parsedInput)
    const total = countAmendmentsByPatient(connection, parsedInput.patientId)
    const headers = readAmendmentHeaders(
      connection,
      parsedInput.patientId,
      parsedInput.pageSize,
      offset
    )
    const changesByAmendmentId = readAmendmentChangesForPage(
      connection,
      headers.map((header) => header.id)
    )

    return Object.freeze({
      items: Object.freeze(
        headers.map((header) => createAmendmentRecord(header, changesByAmendmentId))
      ),
      page: parsedInput.page,
      pageSize: parsedInput.pageSize,
      total
    })
  }

  return Object.freeze({
    insert,
    listByPatient
  })
}

interface DecodedAmendmentHeader {
  readonly id: ReturnType<typeof parseEntityId>
  readonly patientId: ReturnType<typeof parseEntityId>
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
  readonly reasonCode: ReturnType<typeof parsePatientDemographicAmendmentReasonCode>
  readonly reasonNote: string | null
  readonly amendedBy: ReturnType<typeof parseEntityId>
  readonly amendedByDisplayName: string
  readonly amendedAt: ReturnType<typeof parseUtcTimestamp>
}

function countAmendmentsByPatient(connection: Database.Database, patientId: string): number {
  try {
    return decodeTotal(connection.prepare(countAmendmentsByPatientSql).get(patientId))
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function readAmendmentHeaders(
  connection: Database.Database,
  patientId: string,
  pageSize: number,
  offset: number
): readonly DecodedAmendmentHeader[] {
  let rows: unknown

  try {
    rows = connection.prepare(selectAmendmentsByPatientSql).all(patientId, pageSize, offset)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }

  return decodeAmendmentHeaders(rows)
}

function readAmendmentChangesForPage(
  connection: Database.Database,
  amendmentIds: readonly string[]
): ReadonlyMap<string, readonly PatientDemographicAmendmentChangeRecord[]> {
  if (amendmentIds.length === 0) {
    return new Map()
  }

  const placeholders = amendmentIds.map(() => '?').join(', ')
  const sql = `
SELECT
  amendment_id,
  field_name,
  previous_value_json,
  new_value_json
FROM patient_demographic_amendment_changes
WHERE amendment_id IN (${placeholders});
`

  let rows: unknown

  try {
    rows = connection.prepare(sql).all(...amendmentIds)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }

  return decodeAmendmentChanges(rows)
}

function createAmendmentRecord(
  header: DecodedAmendmentHeader,
  changesByAmendmentId: ReadonlyMap<string, readonly PatientDemographicAmendmentChangeRecord[]>
): PatientDemographicAmendmentRecord {
  const changes = changesByAmendmentId.get(header.id) ?? Object.freeze([])

  if (changes.length === 0) {
    throw new RepositoryDataIntegrityError()
  }

  if (header.reasonNote === null && changes.some((change) => change.fieldName === 'status')) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id: header.id,
    patientId: header.patientId,
    priorRowVersion: header.priorRowVersion,
    resultingRowVersion: header.resultingRowVersion,
    reasonCode: header.reasonCode,
    reasonNote: header.reasonNote,
    amendedBy: header.amendedBy,
    amendedByDisplayName: header.amendedByDisplayName,
    amendedAt: header.amendedAt,
    changes
  })
}

function decodeAmendmentHeaders(rows: unknown): readonly DecodedAmendmentHeader[] {
  try {
    if (!Array.isArray(rows)) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze(rows.map(decodeAmendmentHeader))
  } catch (error) {
    throw toDataIntegrityError(error)
  }
}

function decodeAmendmentHeader(row: unknown): DecodedAmendmentHeader {
  const data = readRowDataProperties(row, amendmentHeaderRowKeys)
  const priorRowVersion = parsePatientDemographicAmendmentRowVersion(data.prior_row_version)
  const resultingRowVersion = parsePatientDemographicAmendmentRowVersion(data.resulting_row_version)
  const reasonCode = parsePatientDemographicAmendmentReasonCode(data.reason_code)
  const reasonNote = normalizePatientDemographicAmendmentReasonNote(data.reason_note)

  if (resultingRowVersion !== priorRowVersion + 1) {
    throw new RepositoryDataIntegrityError()
  }

  if (reasonCode === 'OTHER' && reasonNote === null) {
    throw new RepositoryDataIntegrityError()
  }

  if (reasonNote !== data.reason_note) {
    throw new RepositoryDataIntegrityError()
  }

  if (typeof data.amended_by_display_name !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id: parseEntityId(data.id),
    patientId: parseEntityId(data.patient_id),
    priorRowVersion,
    resultingRowVersion,
    reasonCode,
    reasonNote,
    amendedBy: parseEntityId(data.amended_by),
    amendedByDisplayName: data.amended_by_display_name,
    amendedAt: parseUtcTimestamp(data.amended_at)
  })
}

function decodeAmendmentChanges(
  rows: unknown
): ReadonlyMap<string, readonly PatientDemographicAmendmentChangeRecord[]> {
  try {
    if (!Array.isArray(rows)) {
      throw new RepositoryDataIntegrityError()
    }

    const changesByAmendmentId = new Map<string, PatientDemographicAmendmentChangeRecord[]>()
    const seenFieldsByAmendmentId = new Map<string, Set<PatientDemographicAmendmentFieldName>>()

    for (const row of rows) {
      const { amendmentId, change } = decodeAmendmentChange(row)
      const seenFields = seenFieldsByAmendmentId.get(amendmentId) ?? new Set()

      if (seenFields.has(change.fieldName)) {
        throw new RepositoryDataIntegrityError()
      }

      seenFields.add(change.fieldName)
      seenFieldsByAmendmentId.set(amendmentId, seenFields)

      const changes = changesByAmendmentId.get(amendmentId) ?? []
      changes.push(change)
      changesByAmendmentId.set(amendmentId, changes)
    }

    return freezeChangesByAmendmentId(changesByAmendmentId)
  } catch (error) {
    throw toDataIntegrityError(error)
  }
}

function decodeAmendmentChange(row: unknown): {
  readonly amendmentId: string
  readonly change: PatientDemographicAmendmentChangeRecord
} {
  const data = readRowDataProperties(row, amendmentChangeRowKeys)
  const amendmentId = parseEntityId(data.amendment_id)
  const fieldName = parsePatientDemographicAmendmentFieldName(data.field_name)
  const previousValue = decodeStoredAmendmentValue(fieldName, data.previous_value_json)
  const newValue = decodeStoredAmendmentValue(fieldName, data.new_value_json)

  if (
    canonicalizePatientDemographicAmendmentValue(previousValue) ===
    canonicalizePatientDemographicAmendmentValue(newValue)
  ) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    amendmentId,
    change: Object.freeze({
      fieldName,
      previousValue,
      newValue
    })
  })
}

function decodeStoredAmendmentValue(
  fieldName: PatientDemographicAmendmentFieldName,
  valueJson: unknown
): PatientDemographicAmendmentValue {
  if (typeof valueJson !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(valueJson)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }

  if (
    Array.isArray(parsed) ||
    (parsed !== null && typeof parsed === 'object') ||
    typeof parsed === 'boolean'
  ) {
    throw new RepositoryDataIntegrityError()
  }

  const value = parsePatientDemographicAmendmentValueForField(fieldName, parsed)

  if (canonicalizePatientDemographicAmendmentValue(value) !== valueJson) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function freezeChangesByAmendmentId(
  changesByAmendmentId: Map<string, PatientDemographicAmendmentChangeRecord[]>
): ReadonlyMap<string, readonly PatientDemographicAmendmentChangeRecord[]> {
  return new Map(
    [...changesByAmendmentId.entries()].map(([amendmentId, changes]) => [
      amendmentId,
      Object.freeze(
        [...changes].sort((left, right) =>
          comparePatientDemographicAmendmentFields(left.fieldName, right.fieldName)
        )
      )
    ])
  )
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
}: Pick<
  ReturnType<typeof parsePatientDemographicAmendmentHistoryInput>,
  'page' | 'pageSize'
>): number {
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
