import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
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
import { readDataProperties } from '../screening-encounter'
import {
  parseInsertScreeningVitalsDraftInput,
  parseScreeningVitalsDraftRowVersion,
  parseScreeningVitalsDraftStatus,
  parseUpdateScreeningVitalsDraftInput,
  parseVitalsMeasurementSite,
  parseVitalsMeasurementTime,
  parseVitalsPatientPosition,
  type ParsedScreeningVitalsDraftReadingInput
} from './screening-vitals-draft-validation'
import type {
  InsertScreeningVitalsDraftInput,
  ScreeningVitalsDraftReadingRecord,
  ScreeningVitalsDraftRecord,
  ScreeningVitalsDraftRepository,
  UpdateScreeningVitalsDraftInput,
  UpdateScreeningVitalsDraftResult
} from './screening-vitals-draft-types'

interface ScreeningVitalsDraftReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const draftRowKeys = Object.freeze([
  'id',
  'encounter_id',
  'status',
  'weight_kg',
  'waist_cm',
  'notes',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'row_version'
] as const)
const readingRowKeys = Object.freeze([
  'id',
  'vitals_draft_id',
  'sequence_number',
  'systolic',
  'diastolic',
  'pulse',
  'measurement_site',
  'patient_position',
  'measurement_time',
  'created_at',
  'updated_at'
] as const)

const draftColumns = `
  id,
  encounter_id,
  status,
  weight_kg,
  waist_cm,
  notes,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
`
const readingColumns = `
  id,
  vitals_draft_id,
  sequence_number,
  systolic,
  diastolic,
  pulse,
  measurement_site,
  patient_position,
  measurement_time,
  created_at,
  updated_at
`

const selectDraftByEncounterSql = `
SELECT
${draftColumns}
FROM screening_vitals_drafts
WHERE encounter_id = ?;
`
const selectDraftByIdSql = `
SELECT
${draftColumns}
FROM screening_vitals_drafts
WHERE id = ?;
`
const selectReadingsByDraftSql = `
SELECT
${readingColumns}
FROM screening_vitals_draft_readings
WHERE vitals_draft_id = ?
ORDER BY sequence_number ASC;
`
const insertDraftSql = `
INSERT INTO screening_vitals_drafts (
  id,
  encounter_id,
  status,
  weight_kg,
  waist_cm,
  notes,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1);
`
const updateDraftSql = `
UPDATE screening_vitals_drafts
SET
  status = ?,
  weight_kg = ?,
  waist_cm = ?,
  notes = ?,
  updated_by = ?,
  updated_at = ?,
  row_version = row_version + 1
WHERE id = ?
  AND row_version = ?;
`
const selectReadingOwnerSql = `
SELECT vitals_draft_id
FROM screening_vitals_draft_readings
WHERE id = ?;
`
const deleteReadingSql = `
DELETE FROM screening_vitals_draft_readings
WHERE id = ?
  AND vitals_draft_id = ?;
`
const moveReadingSequenceSql = `
UPDATE screening_vitals_draft_readings
SET sequence_number = ?
WHERE id = ?
  AND vitals_draft_id = ?;
`
const updateReadingSql = `
UPDATE screening_vitals_draft_readings
SET
  sequence_number = ?,
  systolic = ?,
  diastolic = ?,
  pulse = ?,
  measurement_site = ?,
  patient_position = ?,
  measurement_time = ?,
  updated_at = ?
WHERE id = ?
  AND vitals_draft_id = ?;
`
const insertReadingSql = `
INSERT INTO screening_vitals_draft_readings (
  id,
  vitals_draft_id,
  sequence_number,
  systolic,
  diastolic,
  pulse,
  measurement_site,
  patient_position,
  measurement_time,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`

export function createScreeningVitalsDraftRepository(
  connection: Database.Database
): ScreeningVitalsDraftRepository {
  return Object.freeze({
    getByEncounterId(encounterId: string): ScreeningVitalsDraftRecord | null {
      const parsedEncounterId = parseReadEntityId(encounterId)

      try {
        return readDraftAggregate(connection, selectDraftByEncounterSql, [parsedEncounterId])
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getByEncounterIdForWrite(
      scopedConnection: DatabaseTransactionConnection,
      encounterId: string
    ): ScreeningVitalsDraftRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const parsedEncounterId = parseReadEntityId(encounterId)

      try {
        return readDraftAggregate(scopedConnection, selectDraftByEncounterSql, [parsedEncounterId])
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    insert(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertScreeningVitalsDraftInput
    ): ScreeningVitalsDraftRecord {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseInsertScreeningVitalsDraftInput(input)

        scopedConnection
          .prepare<
            [
              string,
              string,
              string,
              number | null,
              number | null,
              string | null,
              string,
              string,
              string,
              string
            ]
          >(insertDraftSql)
          .run(
            parsed.id,
            parsed.encounterId,
            parsed.status,
            parsed.weightKg,
            parsed.waistCm,
            parsed.notes,
            parsed.createdBy,
            parsed.createdAt,
            parsed.createdBy,
            parsed.createdAt
          )
        insertReadings(scopedConnection, parsed.id, parsed.readings, parsed.createdAt)

        return readDraftAggregateAfterWrite(scopedConnection, parsed.id)
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

    update(
      scopedConnection: DatabaseTransactionConnection,
      input: UpdateScreeningVitalsDraftInput
    ): UpdateScreeningVitalsDraftResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseUpdateScreeningVitalsDraftInput(input)
        const updateResult = scopedConnection
          .prepare<
            [string, number | null, number | null, string | null, string, string, string, number]
          >(updateDraftSql)
          .run(
            parsed.status,
            parsed.weightKg,
            parsed.waistCm,
            parsed.notes,
            parsed.updatedBy,
            parsed.updatedAt,
            parsed.id,
            parsed.expectedRowVersion
          )

        if (updateResult.changes !== 1) {
          const current = readDraftAggregate(scopedConnection, selectDraftByIdSql, [parsed.id])

          if (current === null) {
            return Object.freeze({ status: 'NOT_FOUND' as const })
          }

          return Object.freeze({ status: 'VERSION_CONFLICT' as const, draft: current })
        }

        reconcileReadings(scopedConnection, parsed.id, parsed.readings, parsed.updatedAt)

        return Object.freeze({
          status: 'UPDATED' as const,
          draft: readDraftAggregateAfterWrite(scopedConnection, parsed.id)
        })
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    }
  })
}

function insertReadings(
  connection: DatabaseTransactionConnection,
  draftId: string,
  readings: readonly ParsedScreeningVitalsDraftReadingInput[],
  occurredAt: string
): void {
  for (const reading of readings) {
    insertReading(connection, draftId, reading, reading.sequenceNumber, occurredAt)
  }
}

function reconcileReadings(
  connection: DatabaseTransactionConnection,
  draftId: string,
  readings: readonly ParsedScreeningVitalsDraftReadingInput[],
  occurredAt: string
): void {
  const currentDraft = readDraftAggregate(connection, selectDraftByIdSql, [draftId])

  if (currentDraft === null) {
    throw new RepositoryDataIntegrityError()
  }

  const existingById = new Map<string, (typeof currentDraft.readings)[number]>(
    currentDraft.readings.map((reading) => [reading.id, reading])
  )

  for (const reading of readings) {
    if (existingById.has(reading.id)) {
      continue
    }

    const ownerRow = connection.prepare(selectReadingOwnerSql).get(reading.id)

    if (ownerRow !== undefined) {
      throw new RepositoryValidationError()
    }
  }

  const firstReading = currentDraft.readings.find((reading) => reading.sequenceNumber === 1)

  if (firstReading !== undefined && !readings.some((reading) => reading.id === firstReading.id)) {
    throw new RepositoryValidationError()
  }

  const submittedIds = new Set<string>(readings.map((reading) => reading.id))

  const sequenceChangedIds = new Set(
    readings.flatMap((reading) => {
      const existing = existingById.get(reading.id)

      return existing !== undefined && existing.sequenceNumber !== reading.sequenceNumber
        ? [reading.id]
        : []
    })
  )
  const hasNewReading = readings.some((reading) => !existingById.has(reading.id))
  const requiresSequenceReconciliation = sequenceChangedIds.size > 0 || hasNewReading

  for (const reading of currentDraft.readings) {
    if (!submittedIds.has(reading.id)) {
      const deleteResult = connection
        .prepare<[string, string]>(deleteReadingSql)
        .run(reading.id, draftId)

      if (deleteResult.changes !== 1) {
        throw new RepositoryDataIntegrityError()
      }
    }
  }

  const temporarySequenceStart = 1_000_000
  const retainedReadings = currentDraft.readings.filter((reading) => submittedIds.has(reading.id))

  if (requiresSequenceReconciliation) {
    retainedReadings
      .filter((reading) => sequenceChangedIds.has(reading.id))
      .forEach((reading, index) => {
        moveReadingSequence(connection, draftId, reading.id, temporarySequenceStart + index + 1)
      })

    for (const reading of readings) {
      if (existingById.has(reading.id)) {
        continue
      }

      insertReading(connection, draftId, reading, reading.sequenceNumber, occurredAt)
    }
  }

  for (const reading of readings) {
    const existing = existingById.get(reading.id)

    if (existing === undefined) {
      continue
    }

    if (isPersistedReadingChanged(existing, reading)) {
      updateReading(connection, draftId, reading, reading.sequenceNumber, occurredAt)
    }
  }
}

function isPersistedReadingChanged(
  existing: ScreeningVitalsDraftReadingRecord,
  submitted: ParsedScreeningVitalsDraftReadingInput
): boolean {
  return (
    existing.sequenceNumber !== submitted.sequenceNumber ||
    existing.systolic !== submitted.systolic ||
    existing.diastolic !== submitted.diastolic ||
    existing.pulse !== submitted.pulse ||
    existing.measurementSite !== submitted.measurementSite ||
    existing.patientPosition !== submitted.patientPosition ||
    existing.measurementTime !== submitted.measurementTime
  )
}

function moveReadingSequence(
  connection: DatabaseTransactionConnection,
  draftId: string,
  readingId: string,
  sequenceNumber: number
): void {
  const result = connection
    .prepare<[number, string, string]>(moveReadingSequenceSql)
    .run(sequenceNumber, readingId, draftId)

  if (result.changes !== 1) {
    throw new RepositoryDataIntegrityError()
  }
}

function insertReading(
  connection: DatabaseTransactionConnection,
  draftId: string,
  reading: ParsedScreeningVitalsDraftReadingInput,
  sequenceNumber: number,
  occurredAt: string
): void {
  connection
    .prepare<
      [
        string,
        string,
        number,
        number | null,
        number | null,
        number | null,
        string | null,
        string | null,
        string | null,
        string,
        string
      ]
    >(insertReadingSql)
    .run(
      reading.id,
      draftId,
      sequenceNumber,
      reading.systolic,
      reading.diastolic,
      reading.pulse,
      reading.measurementSite,
      reading.patientPosition,
      reading.measurementTime,
      occurredAt,
      occurredAt
    )
}

function updateReading(
  connection: DatabaseTransactionConnection,
  draftId: string,
  reading: ParsedScreeningVitalsDraftReadingInput,
  sequenceNumber: number,
  occurredAt: string
): void {
  const result = connection
    .prepare<
      [
        number,
        number | null,
        number | null,
        number | null,
        string | null,
        string | null,
        string | null,
        string,
        string,
        string
      ]
    >(updateReadingSql)
    .run(
      sequenceNumber,
      reading.systolic,
      reading.diastolic,
      reading.pulse,
      reading.measurementSite,
      reading.patientPosition,
      reading.measurementTime,
      occurredAt,
      reading.id,
      draftId
    )

  if (result.changes !== 1) {
    throw new RepositoryDataIntegrityError()
  }
}

function readDraftAggregateAfterWrite(
  connection: DatabaseTransactionConnection,
  draftId: string
): ScreeningVitalsDraftRecord {
  const draft = readDraftAggregate(connection, selectDraftByIdSql, [draftId])

  if (draft === null) {
    throw new RepositoryDataIntegrityError()
  }

  return draft
}

function readDraftAggregate(
  connection: ScreeningVitalsDraftReadConnection,
  sql: string,
  params: readonly string[]
): ScreeningVitalsDraftRecord | null {
  const row = connection.prepare(sql).get(...params)

  if (row === undefined) {
    return null
  }

  const draft = decodeDraftRow(row)
  const readings = decodeReadingRows(connection.prepare(selectReadingsByDraftSql).all(draft.id))

  return Object.freeze({ ...draft, readings })
}

function decodeDraftRow(row: unknown): Omit<ScreeningVitalsDraftRecord, 'readings'> {
  try {
    const data = readDataProperties(row, draftRowKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      encounterId: parseEntityId(data.encounter_id),
      status: parseScreeningVitalsDraftStatus(data.status),
      weightKg: readNullablePositiveReal(data.weight_kg),
      waistCm: readNullablePositiveReal(data.waist_cm),
      notes: readNullableText(data.notes),
      createdBy: parseEntityId(data.created_by),
      createdAt: parseUtcTimestamp(data.created_at),
      updatedBy: parseEntityId(data.updated_by),
      updatedAt: parseUtcTimestamp(data.updated_at),
      rowVersion: parseScreeningVitalsDraftRowVersion(data.row_version)
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeReadingRows(rows: unknown): readonly ScreeningVitalsDraftReadingRecord[] {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze(rows.map(decodeReadingRow))
}

function decodeReadingRow(row: unknown): ScreeningVitalsDraftReadingRecord {
  try {
    const data = readDataProperties(row, readingRowKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      vitalsDraftId: parseEntityId(data.vitals_draft_id),
      sequenceNumber: readPositiveInteger(data.sequence_number),
      systolic: readNullablePositiveInteger(data.systolic),
      diastolic: readNullablePositiveInteger(data.diastolic),
      pulse: readNullablePositiveInteger(data.pulse),
      measurementSite: readNullableMeasurementSite(data.measurement_site),
      patientPosition: readNullablePatientPosition(data.patient_position),
      measurementTime: readNullableMeasurementTime(data.measurement_time),
      createdAt: parseUtcTimestamp(data.created_at),
      updatedAt: parseUtcTimestamp(data.updated_at)
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readNullableText(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function readNullableMeasurementSite(
  value: unknown
): ScreeningVitalsDraftReadingRecord['measurementSite'] {
  if (value === null) {
    return null
  }

  try {
    return parseVitalsMeasurementSite(value)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readNullablePatientPosition(
  value: unknown
): ScreeningVitalsDraftReadingRecord['patientPosition'] {
  if (value === null) {
    return null
  }

  try {
    return parseVitalsPatientPosition(value)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readNullableMeasurementTime(
  value: unknown
): ScreeningVitalsDraftReadingRecord['measurementTime'] {
  if (value === null) {
    return null
  }

  try {
    return parseVitalsMeasurementTime(value)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readNullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : readPositiveInteger(value)
}

function readPositiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function readNullablePositiveReal(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || Object.is(value, -0)) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function parseReadEntityId(id: string): string {
  try {
    return parseEntityId(id)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}
