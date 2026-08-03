import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import {
  DatabaseTransactionStateError,
  type DatabaseTransactionConnection
} from '@main/database/transaction'
import { parseEntityId } from '@main/foundation'
import {
  normalizePatientPhone,
  normalizePatientSearchText,
  type PatientDuplicateReasonCode
} from '@shared/ipc'

import {
  getRepositoryErrorType,
  isRepositoryError,
  PatientAlreadyExistsError,
  rebuildRepositoryError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  formatPatientCode,
  normalizeResidenceValue,
  parseNullablePatientDateOnly,
  parseNullablePatientSex,
  parsePatientAcknowledgmentStatus,
  parsePatientAgeIdentity,
  parsePatientCode,
  parsePatientEntityId,
  parsePatientNameIdentity,
  parsePatientOptionalText,
  parsePatientPage,
  parsePatientPageSize,
  parsePatientPhone,
  parsePatientResidenceIdentity,
  parsePatientSex,
  parsePatientStatus,
  parsePatientUtcTimestamp,
  parseStoredPatientUtcTimestamp
} from './patient-validation'
import type {
  CreatePatientInput,
  PatientDuplicateCandidateRecord,
  PatientRecord,
  PatientRegistrationIdentityInput,
  PatientRepository,
  PatientSearchInput,
  PatientSearchResult
} from './patient-types'

interface PatientReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown
  }
}

interface ParsedCreatePatientInput {
  readonly id: string
  readonly identifierId: string
  readonly acknowledgmentId: string
  readonly outboxId: string
  readonly displayName: string
  readonly givenName: string
  readonly middleName: string | null
  readonly familyName: string
  readonly nameNormalized: string
  readonly sex: string
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly approximateAgeAsOfDate: string | null
  readonly phone: string | null
  readonly phoneNormalized: string | null
  readonly village: string
  readonly quarter: string | null
  readonly createdBy: string
  readonly createdAt: string
  readonly acknowledgmentStatus: string
  readonly acknowledgmentReference: string | null
}

interface ParsedSearchInput {
  readonly queryNormalized: string
  readonly phoneNormalized: string | null
  readonly filters: PatientSearchInput['filters']
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

interface PatientRow {
  readonly id?: unknown
  readonly patient_code?: unknown
  readonly display_name?: unknown
  readonly given_name?: unknown
  readonly family_name?: unknown
  readonly other_names?: unknown
  readonly name_normalized?: unknown
  readonly sex?: unknown
  readonly date_of_birth?: unknown
  readonly approximate_age_years?: unknown
  readonly age_as_of_date?: unknown
  readonly phone?: unknown
  readonly phone_normalized?: unknown
  readonly village?: unknown
  readonly quarter?: unknown
  readonly status?: unknown
  readonly created_by?: unknown
  readonly created_at?: unknown
  readonly updated_by?: unknown
  readonly updated_at?: unknown
}

const patientRecordColumns = `
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
  village,
  quarter,
  status,
  created_by,
  created_at,
  updated_by,
  updated_at
`

const selectPatientByIdSql = `
SELECT
${patientRecordColumns}
FROM patients
WHERE id = ?;
`

const selectPatientByCodeSql = `
SELECT 1 AS has_existing
FROM patients
WHERE patient_code = ?
LIMIT 1;
`

const selectPatientByIdExistsSql = `
SELECT 1 AS has_existing
FROM patients
WHERE id = ?
LIMIT 1;
`

const selectPatientSequenceSql = `
SELECT next_value
FROM local_sequences
WHERE key = 'patient_code';
`

const updatePatientSequenceSql = `
UPDATE local_sequences
SET next_value = ?, updated_at = ?
WHERE key = 'patient_code';
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
  village,
  quarter,
  status,
  created_by,
  created_at,
  updated_by,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?);
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
) VALUES (?, ?, 'PARTICIPATION_DATA_USE_ACKNOWLEDGMENT', ?, 'REGISTRATION', ?, NULL, ?, ?, ?);
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
) VALUES (?, 'PATIENT', ?, 'CREATED', ?, 'patient.created.v1', ?, 'PENDING', 0, NULL, NULL, NULL, NULL);
`

export function createPatientRepository(connection: Database.Database): PatientRepository {
  const getById = (id: PatientRecord['id']): PatientRecord | null => {
    const parsedId = parsePatientEntityId(id)
    const row = readPatientRow(connection, selectPatientByIdSql, [parsedId])

    return row === undefined ? null : decodePatientRow(row)
  }

  const search = (input: PatientSearchInput): PatientSearchResult => {
    const parsedInput = parseSearchInput(input)
    const where = buildSearchWhere(parsedInput)
    const total = readCountRow(
      connection,
      `SELECT COUNT(*) AS total FROM patients ${where.sql};`,
      where.params
    )
    const rows = readPatientRows(
      connection,
      `SELECT
${patientRecordColumns}
FROM patients
${where.sql}
ORDER BY patient_code ASC, id ASC
LIMIT ? OFFSET ?;`,
      [...where.params, parsedInput.pageSize, (parsedInput.page - 1) * parsedInput.pageSize]
    )

    return Object.freeze({
      rows: decodePatientRows(rows),
      total,
      page: parsedInput.page,
      pageSize: parsedInput.pageSize
    })
  }

  const findDuplicateCandidates = (
    input: PatientRegistrationIdentityInput
  ): readonly PatientDuplicateCandidateRecord[] => {
    const parsedInput = parseDuplicateInput(input)
    const duplicateRows = readPatientRows(
      connection,
      buildDuplicateSearchSql(parsedInput),
      buildDuplicateSearchParams(parsedInput)
    )
    const candidates = decodePatientRows(duplicateRows)
      .map((patient) => buildDuplicateCandidate(patient, parsedInput))
      .filter((candidate): candidate is PatientDuplicateCandidateRecord => candidate !== null)

    return Object.freeze(
      candidates
        .sort((left, right) => left.patient.patientCode.localeCompare(right.patient.patientCode))
        .slice(0, 25)
    )
  }

  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: CreatePatientInput
  ): PatientRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)
    const parsedInput = parseCreatePatientInput(input)

    if (hasExistingPatientId(scopedConnection, parsedInput.id)) {
      throw new PatientAlreadyExistsError()
    }

    const patientCode = allocatePatientCode(scopedConnection, parsedInput.createdAt)

    try {
      scopedConnection
        .prepare<
          [
            string,
            string,
            string,
            string,
            string,
            string | null,
            string,
            string,
            string | null,
            number | null,
            string | null,
            string | null,
            string | null,
            string,
            string | null,
            string,
            string,
            string,
            string
          ]
        >(insertPatientSql)
        .run(
          parsedInput.id,
          patientCode,
          parsedInput.displayName,
          parsedInput.givenName,
          parsedInput.familyName,
          parsedInput.middleName,
          parsedInput.nameNormalized,
          parsedInput.sex,
          parsedInput.dateOfBirth,
          parsedInput.approximateAgeYears,
          parsedInput.approximateAgeAsOfDate,
          parsedInput.phone,
          parsedInput.phoneNormalized,
          parsedInput.village,
          parsedInput.quarter,
          parsedInput.createdBy,
          parsedInput.createdAt,
          parsedInput.createdBy,
          parsedInput.createdAt
        )
      scopedConnection
        .prepare<[string, string, string, string, string, string]>(insertIdentifierSql)
        .run(
          parsedInput.identifierId,
          parsedInput.id,
          patientCode,
          parsedInput.createdAt,
          parsedInput.createdBy,
          parsedInput.createdAt
        )
      scopedConnection
        .prepare<[string, string, string, string, string | null, string, string]>(
          insertAcknowledgmentSql
        )
        .run(
          parsedInput.acknowledgmentId,
          parsedInput.id,
          parsedInput.acknowledgmentStatus,
          parsedInput.createdAt,
          parsedInput.acknowledgmentReference,
          parsedInput.createdBy,
          parsedInput.createdAt
        )
      scopedConnection
        .prepare<[string, string, string, string]>(insertOutboxSql)
        .run(
          parsedInput.outboxId,
          parsedInput.id,
          createPatientCreatedPayloadJson(parsedInput.id, patientCode, parsedInput.createdAt),
          parsedInput.createdAt
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      if (isDuplicateSqliteConstraintError(error)) {
        throw new PatientAlreadyExistsError(getRepositoryErrorType(error))
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }

    const created = readPatientAfterWrite(scopedConnection, parsedInput.id)

    if (created === null) {
      throw new RepositoryWriteError()
    }

    return created
  }

  return Object.freeze({
    getById,
    search,
    findDuplicateCandidates,
    insert
  })
}

function parseSearchInput(input: PatientSearchInput): ParsedSearchInput {
  try {
    const query = parsePatientOptionalText(input.query, 160) ?? ''
    const filters = input.filters

    return Object.freeze({
      queryNormalized: normalizePatientSearchText(query),
      phoneNormalized: normalizePatientPhone(query),
      filters: Object.freeze({
        dateOfBirth:
          filters.dateOfBirth === null ? null : parseNullablePatientDateOnly(filters.dateOfBirth),
        approximateAgeYears:
          filters.approximateAgeYears === null
            ? null
            : parseApproximateAgeFilter(filters.approximateAgeYears),
        sex: filters.sex === null ? null : parsePatientSex(filters.sex),
        village: parsePatientOptionalText(filters.village, 80),
        quarter: parsePatientOptionalText(filters.quarter, 80)
      }),
      page: parsePatientPage(input.page),
      pageSize: parsePatientPageSize(input.pageSize)
    })
  } catch (error) {
    throw toRepositoryValidationError(error)
  }
}

function parseDuplicateInput(
  input: PatientRegistrationIdentityInput
): PatientRegistrationIdentityInput {
  try {
    const name = parsePatientNameIdentity(input)
    const age = parsePatientAgeIdentity(input)
    const residence = parsePatientResidenceIdentity(input)
    const phone = parsePatientPhone(input.phone)

    return Object.freeze({
      givenName: name.givenName,
      middleName: name.middleName,
      familyName: name.familyName,
      sex: parsePatientSex(input.sex),
      dateOfBirth: age.dateOfBirth,
      approximateAgeYears: age.approximateAgeYears,
      approximateAgeAsOfDate: age.approximateAgeAsOfDate,
      village: residence.village,
      quarter: residence.quarter,
      phone: phone.phone
    })
  } catch (error) {
    throw toRepositoryValidationError(error)
  }
}

function parseCreatePatientInput(input: CreatePatientInput): ParsedCreatePatientInput {
  try {
    const name = parsePatientNameIdentity(input)
    const age = parsePatientAgeIdentity(input)
    const residence = parsePatientResidenceIdentity(input)
    const phone = parsePatientPhone(input.phone)

    return Object.freeze({
      id: parsePatientEntityId(input.id),
      identifierId: parsePatientEntityId(input.identifierId),
      acknowledgmentId: parsePatientEntityId(input.acknowledgmentId),
      outboxId: parsePatientEntityId(input.outboxId),
      displayName: name.displayName,
      givenName: name.givenName,
      middleName: name.middleName,
      familyName: name.familyName,
      nameNormalized: name.nameNormalized,
      sex: parsePatientSex(input.sex),
      dateOfBirth: age.dateOfBirth,
      approximateAgeYears: age.approximateAgeYears,
      approximateAgeAsOfDate: age.approximateAgeAsOfDate,
      phone: phone.phone,
      phoneNormalized: phone.phoneNormalized,
      village: residence.village,
      quarter: residence.quarter,
      createdBy: parsePatientEntityId(input.createdBy),
      createdAt: parsePatientUtcTimestamp(input.createdAt),
      acknowledgmentStatus: parsePatientAcknowledgmentStatus(input.acknowledgmentStatus),
      acknowledgmentReference: parsePatientOptionalText(input.acknowledgmentReference, 160)
    })
  } catch (error) {
    throw toRepositoryValidationError(error)
  }
}

function buildSearchWhere(input: ParsedSearchInput): {
  readonly sql: string
  readonly params: readonly unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (input.queryNormalized.length > 0) {
    const like = `%${escapeLike(input.queryNormalized)}%`
    const queryClauses = [
      "lower(patient_code) LIKE ? ESCAPE '\\'",
      "name_normalized LIKE ? ESCAPE '\\'",
      "lower(COALESCE(village, '')) LIKE ? ESCAPE '\\'",
      "lower(COALESCE(quarter, '')) LIKE ? ESCAPE '\\'"
    ]
    params.push(like, like, like, like)

    if (input.phoneNormalized !== null) {
      queryClauses.push('phone_normalized LIKE ?')
      params.push(`${input.phoneNormalized}%`)
    }

    clauses.push(`(${queryClauses.join(' OR ')})`)
  }

  if (input.filters.dateOfBirth !== null) {
    clauses.push('date_of_birth = ?')
    params.push(input.filters.dateOfBirth)
  }

  if (input.filters.approximateAgeYears !== null) {
    clauses.push('approximate_age_years = ?')
    params.push(input.filters.approximateAgeYears)
  }

  if (input.filters.sex !== null) {
    clauses.push('sex = ?')
    params.push(input.filters.sex)
  }

  if (input.filters.village !== null) {
    clauses.push("lower(COALESCE(village, '')) = ?")
    params.push(normalizePatientSearchText(input.filters.village))
  }

  if (input.filters.quarter !== null) {
    clauses.push("lower(COALESCE(quarter, '')) = ?")
    params.push(normalizePatientSearchText(input.filters.quarter))
  }

  if (clauses.length === 0) {
    return { sql: "WHERE status = 'ACTIVE'", params: [] }
  }

  return { sql: `WHERE status = 'ACTIVE' AND ${clauses.join(' AND ')}`, params }
}

function buildDuplicateSearchSql(input: PatientRegistrationIdentityInput): string {
  const clauses = ['name_normalized = ?']

  if (input.phone !== null && normalizePatientPhone(input.phone) !== null) {
    clauses.push('phone_normalized = ?')
  }

  if (input.dateOfBirth !== null) {
    clauses.push('date_of_birth = ?')
  }

  if (input.approximateAgeYears !== null) {
    clauses.push('approximate_age_years BETWEEN ? AND ?')
  }

  return `SELECT
${patientRecordColumns}
FROM patients
WHERE status = 'ACTIVE'
  AND (${clauses.join(' OR ')})
ORDER BY patient_code ASC, id ASC
LIMIT 50;`
}

function buildDuplicateSearchParams(input: PatientRegistrationIdentityInput): readonly unknown[] {
  const name = parsePatientNameIdentity(input)
  const params: unknown[] = [name.nameNormalized]
  const phone = normalizePatientPhone(input.phone)

  if (phone !== null) {
    params.push(phone)
  }

  if (input.dateOfBirth !== null) {
    params.push(input.dateOfBirth)
  }

  if (input.approximateAgeYears !== null) {
    params.push(
      Math.max(0, input.approximateAgeYears - 2),
      Math.min(120, input.approximateAgeYears + 2)
    )
  }

  return params
}

function buildDuplicateCandidate(
  patient: PatientRecord,
  input: PatientRegistrationIdentityInput
): PatientDuplicateCandidateRecord | null {
  const reasonCodes: PatientDuplicateReasonCode[] = []
  const inputName = parsePatientNameIdentity(input).nameNormalized
  const inputPhone = normalizePatientPhone(input.phone)
  const sameResidence = hasSameResidence(patient, input)

  if (inputPhone !== null && patient.phoneNormalized === inputPhone) {
    reasonCodes.push('EXACT_PHONE')
  }

  if (
    input.dateOfBirth !== null &&
    patient.dateOfBirth === input.dateOfBirth &&
    namesAreSimilar(patient.nameNormalized, inputName)
  ) {
    reasonCodes.push('DOB_SIMILAR_NAME')
  }

  if (patient.nameNormalized === inputName && sameResidence) {
    reasonCodes.push('EXACT_NAME_RESIDENCE')
  }

  if (
    input.approximateAgeYears !== null &&
    patient.approximateAgeYears !== null &&
    Math.abs(patient.approximateAgeYears - input.approximateAgeYears) <= 2 &&
    namesAreSimilar(patient.nameNormalized, inputName) &&
    sameResidence
  ) {
    reasonCodes.push('APPROXIMATE_AGE_NAME_RESIDENCE')
  }

  if (reasonCodes.length === 0) {
    return null
  }

  return Object.freeze({
    patient,
    reasonCodes: Object.freeze([...new Set(reasonCodes)])
  })
}

function hasSameResidence(
  patient: PatientRecord,
  input: PatientRegistrationIdentityInput
): boolean {
  const patientVillage = normalizeResidenceValue(patient.village)
  const inputVillage = normalizeResidenceValue(input.village)
  const patientQuarter = normalizeResidenceValue(patient.quarter)
  const inputQuarter = normalizeResidenceValue(input.quarter)

  return (
    patientVillage !== null &&
    inputVillage !== null &&
    patientVillage === inputVillage &&
    (patientQuarter === inputQuarter || inputQuarter === null || patientQuarter === null)
  )
}

function namesAreSimilar(left: string, right: string): boolean {
  if (left === right || left.includes(right) || right.includes(left)) {
    return true
  }

  const leftTokens = new Set(left.split(' ').filter((token) => token.length >= 2))

  return right.split(' ').some((token) => token.length >= 2 && leftTokens.has(token))
}

function allocatePatientCode(connection: DatabaseTransactionConnection, updatedAt: string): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sequenceValue = readPatientSequence(connection)
    const code = formatPatientCode(sequenceValue)
    updatePatientSequence(connection, sequenceValue + 1, updatedAt)

    if (!hasExistingPatientCode(connection, code)) {
      return code
    }
  }

  throw new RepositoryWriteError()
}

function readPatientSequence(connection: DatabaseTransactionConnection): number {
  try {
    const row = connection.prepare<[], unknown>(selectPatientSequenceSql).get()

    if (typeof row !== 'object' || row === null) {
      throw new RepositoryDataIntegrityError()
    }

    const value = (row as { next_value?: unknown }).next_value

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new RepositoryDataIntegrityError()
    }

    return value
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function updatePatientSequence(
  connection: DatabaseTransactionConnection,
  nextValue: number,
  updatedAt: string
): void {
  try {
    const result = connection
      .prepare<[number, string]>(updatePatientSequenceSql)
      .run(nextValue, updatedAt)

    if (result.changes !== 1) {
      throw new RepositoryDataIntegrityError()
    }
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function hasExistingPatientId(connection: DatabaseTransactionConnection, id: string): boolean {
  return decodeExistingRow(readTransactionRow(connection, selectPatientByIdExistsSql, [id]))
}

function hasExistingPatientCode(connection: DatabaseTransactionConnection, code: string): boolean {
  return decodeExistingRow(readTransactionRow(connection, selectPatientByCodeSql, [code]))
}

function readTransactionRow(
  connection: DatabaseTransactionConnection,
  sql: string,
  params: readonly unknown[]
): unknown {
  try {
    return connection.prepare(sql).get(...params)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readPatientAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): PatientRecord | null {
  const row = readTransactionRow(connection, selectPatientByIdSql, [id])

  if (row === undefined) {
    return null
  }

  try {
    return decodePatientRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readPatientRow(
  connection: PatientReadConnection,
  sql: string,
  params: readonly unknown[]
): unknown {
  try {
    return connection.prepare(sql).get(...params)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function readPatientRows(
  connection: PatientReadConnection,
  sql: string,
  params: readonly unknown[]
): unknown {
  try {
    return connection.prepare(sql).all(...params)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function readCountRow(
  connection: PatientReadConnection,
  sql: string,
  params: readonly unknown[]
): number {
  const row = readPatientRow(connection, sql, params)

  if (typeof row !== 'object' || row === null) {
    throw new RepositoryDataIntegrityError()
  }

  const total = (row as { total?: unknown }).total

  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new RepositoryDataIntegrityError()
  }

  return total
}

function decodePatientRows(rows: unknown): readonly PatientRecord[] {
  if (!Array.isArray(rows)) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze(rows.map(decodePatientRow))
}

function decodePatientRow(row: unknown): PatientRecord {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new RepositoryDataIntegrityError()
  }

  const data = row as PatientRow
  const dateOfBirth = parseStoredNullableDateOnly(data.date_of_birth)
  const approximateAgeYears = parseStoredNullableAge(data.approximate_age_years)
  const approximateAgeAsOfDate = parseStoredNullableDateOnly(data.age_as_of_date)

  if ((dateOfBirth === null) === (approximateAgeYears === null)) {
    throw new RepositoryDataIntegrityError()
  }

  if ((approximateAgeYears === null) !== (approximateAgeAsOfDate === null)) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id: parseEntityIdForRow(data.id),
    patientCode: parsePatientCode(data.patient_code),
    displayName: parseStoredText(data.display_name, 180),
    givenName: parseStoredText(data.given_name, 80),
    middleName: parseStoredNullableText(data.other_names, 80),
    familyName: parseStoredText(data.family_name, 80),
    nameNormalized: parseStoredText(data.name_normalized, 220),
    sex: parseNullablePatientSexForRow(data.sex),
    dateOfBirth,
    approximateAgeYears,
    approximateAgeAsOfDate,
    phone: parseStoredNullableText(data.phone, 40),
    phoneNormalized: parseStoredNullableText(data.phone_normalized, 40),
    village: parseStoredNullableText(data.village, 80),
    quarter: parseStoredNullableText(data.quarter, 80),
    status: parsePatientStatus(data.status),
    createdBy: parseEntityIdForRow(data.created_by),
    createdAt: parseStoredPatientUtcTimestamp(data.created_at),
    updatedBy: parseEntityIdForRow(data.updated_by),
    updatedAt: parseStoredPatientUtcTimestamp(data.updated_at)
  })
}

function parseEntityIdForRow(value: unknown): PatientRecord['id'] {
  try {
    return parseEntityId(value)
  } catch {
    throw new RepositoryDataIntegrityError()
  }
}

function parseNullablePatientSexForRow(value: unknown): PatientRecord['sex'] {
  try {
    return parseNullablePatientSex(value)
  } catch {
    throw new RepositoryDataIntegrityError()
  }
}

function parseStoredNullableDateOnly(value: unknown): string | null {
  try {
    return parseNullablePatientDateOnly(value)
  } catch {
    throw new RepositoryDataIntegrityError()
  }
}

function parseStoredNullableAge(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 120) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function parseStoredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function parseStoredNullableText(value: unknown, maxLength: number): string | null {
  if (value === null) {
    return null
  }

  return parseStoredText(value, maxLength)
}

function decodeExistingRow(row: unknown): boolean {
  if (row === undefined) {
    return false
  }

  if (
    typeof row === 'object' &&
    row !== null &&
    (row as { has_existing?: unknown }).has_existing === 1
  ) {
    return true
  }

  throw new RepositoryDataIntegrityError()
}

function parseApproximateAgeFilter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 120) {
    throw new RepositoryValidationError()
  }

  return value
}

function createPatientCreatedPayloadJson(
  patientId: string,
  patientCode: string,
  createdAt: string
): string {
  return JSON.stringify({
    event: 'PATIENT_CREATED',
    patientId,
    patientCode,
    createdAt
  })
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

function toRepositoryValidationError(error: unknown): never {
  if (error instanceof DatabaseTransactionStateError) {
    throw new DatabaseTransactionStateError(error.errorType)
  }

  if (isRepositoryError(error)) {
    throw rebuildRepositoryError(error)
  }

  throw new RepositoryValidationError(getRepositoryErrorType(error))
}

function isDuplicateSqliteConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  let codeDescriptor: PropertyDescriptor | undefined

  try {
    codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code')
  } catch {
    return false
  }

  if (
    codeDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(codeDescriptor, 'value')
  ) {
    return false
  }

  return (
    codeDescriptor.value === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    codeDescriptor.value === 'SQLITE_CONSTRAINT_UNIQUE'
  )
}
