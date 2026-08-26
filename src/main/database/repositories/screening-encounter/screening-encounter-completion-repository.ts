import type Database from 'better-sqlite3'

import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import type {
  CompleteScreeningEncounterPersistenceInput,
  CompleteScreeningEncounterPersistenceResult,
  ScreeningCompletionFoodLogInput,
  ScreeningCompletionLifestyleLogInput,
  ScreeningCompletionOtcLogInput,
  ScreeningCompletionVitalsReadingInput,
  ScreeningEncounterCompletionRepository
} from './screening-encounter-completion-types'

const countExistingFinalRowsSql = `
SELECT
  (SELECT COUNT(*) FROM blood_pressure_readings WHERE encounter_id = ?) +
  (SELECT COUNT(*) FROM lifestyle_logs WHERE encounter_id = ?) +
  (SELECT COUNT(*) FROM food_logs WHERE encounter_id = ?) +
  (SELECT COUNT(*) FROM otc_medication_logs WHERE encounter_id = ?) AS row_count;
`

const completeEncounterSql = `
UPDATE screening_encounters
SET status = 'COMPLETED',
    completed_at = ?,
    summary_systolic = ?,
    summary_diastolic = ?,
    summary_pulse = ?,
    next_action_category = ?,
    decision_json = ?,
    updated_at = ?,
    record_version = record_version + 1
WHERE id = ?
  AND status = 'DRAFT'
  AND record_version = ?;
`

const insertVitalsReadingSql = `
INSERT INTO blood_pressure_readings (
  id, encounter_id, sequence_number, systolic, diastolic, pulse, arm, body_position,
  cuff_size, device_identifier, measured_at, status, discard_reason, source_type,
  recorded_by, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'ACTIVE', NULL, 'MEASURED', ?, ?);
`

const insertLifestyleLogSql = `
INSERT INTO lifestyle_logs (
  id, encounter_id, question_code, response_code, response_text, source_type,
  recorded_by, recorded_at
) VALUES (?, ?, ?, ?, NULL, 'PATIENT_REPORTED', ?, ?);
`

const insertFoodLogSql = `
INSERT INTO food_logs (
  id, encounter_id, food_code, food_name, food_name_normalized, frequency_code,
  notes, source_type, recorded_by, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'PATIENT_REPORTED', ?, ?);
`

const insertOtcLogSql = `
INSERT INTO otc_medication_logs (
  id, encounter_id, product_name, product_name_normalized, reason_for_use, dose_text,
  frequency_text, duration_text, source_of_medication, currently_taking, source_type,
  recorded_by, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PATIENT_REPORTED', ?, ?);
`

export function createScreeningEncounterCompletionRepository(
  connection: Database.Database
): ScreeningEncounterCompletionRepository {
  void connection

  return Object.freeze({
    complete(
      scopedConnection: DatabaseTransactionConnection,
      input: CompleteScreeningEncounterPersistenceInput
    ): CompleteScreeningEncounterPersistenceResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const parsed = parseCompletionInput(input)

      try {
        const existingRows = scopedConnection
          .prepare<[string, string, string, string], { row_count: number }>(
            countExistingFinalRowsSql
          )
          .get(parsed.encounterId, parsed.encounterId, parsed.encounterId, parsed.encounterId)

        if (
          existingRows === undefined ||
          typeof existingRows.row_count !== 'number' ||
          !Number.isSafeInteger(existingRows.row_count) ||
          existingRows.row_count < 0
        ) {
          throw new RepositoryDataIntegrityError()
        }

        if (existingRows.row_count !== 0) {
          throw new RepositoryDataIntegrityError()
        }

        const update = scopedConnection
          .prepare<[string, number, number, number, string, string, string, string, number]>(
            completeEncounterSql
          )
          .run(
            parsed.completedAt,
            parsed.summarySystolic,
            parsed.summaryDiastolic,
            parsed.summaryPulse,
            parsed.nextActionCategory,
            parsed.decisionJson,
            parsed.completedAt,
            parsed.encounterId,
            parsed.expectedRecordVersion
          )

        if (update.changes !== 1) {
          return Object.freeze({ status: 'VERSION_CONFLICT' as const })
        }

        for (const reading of parsed.vitalsReadings) {
          scopedConnection
            .prepare<
              [
                string,
                string,
                number,
                number,
                number,
                number,
                string,
                string,
                string,
                string,
                string
              ]
            >(insertVitalsReadingSql)
            .run(
              reading.id,
              parsed.encounterId,
              reading.sequenceNumber,
              reading.systolic,
              reading.diastolic,
              reading.pulse,
              reading.arm,
              reading.bodyPosition,
              reading.measuredAt,
              parsed.actorId,
              parsed.completedAt
            )
        }

        for (const log of parsed.lifestyleLogs) {
          scopedConnection
            .prepare<[string, string, string, string, string, string]>(insertLifestyleLogSql)
            .run(
              log.id,
              parsed.encounterId,
              log.questionCode,
              log.responseCode,
              parsed.actorId,
              parsed.completedAt
            )
        }

        for (const log of parsed.foodLogs) {
          scopedConnection
            .prepare<
              [
                string,
                string,
                string | null,
                string,
                string,
                string | null,
                string | null,
                string,
                string
              ]
            >(insertFoodLogSql)
            .run(
              log.id,
              parsed.encounterId,
              log.foodCode,
              log.foodName,
              log.foodNameNormalized,
              log.frequencyCode,
              log.notes,
              parsed.actorId,
              parsed.completedAt
            )
        }

        for (const log of parsed.otcLogs) {
          scopedConnection
            .prepare<
              [
                string,
                string,
                string,
                string,
                string,
                string | null,
                string | null,
                string | null,
                string | null,
                number | null,
                string,
                string
              ]
            >(insertOtcLogSql)
            .run(
              log.id,
              parsed.encounterId,
              log.productName,
              log.productNameNormalized,
              log.reasonForUse,
              log.doseText,
              log.frequencyText,
              log.durationText,
              log.sourceOfMedication,
              log.currentlyTaking === null ? null : log.currentlyTaking ? 1 : 0,
              parsed.actorId,
              parsed.completedAt
            )
        }

        return Object.freeze({
          status: 'COMPLETED' as const,
          recordVersion: parsed.expectedRecordVersion + 1
        })
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError)
          throw new DatabaseTransactionStateError(error.errorType)
        if (error instanceof RepositoryDataIntegrityError)
          throw new RepositoryDataIntegrityError(error.errorType)
        if (error instanceof RepositoryValidationError)
          throw new RepositoryValidationError(error.errorType)
        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    }
  })
}

function parseCompletionInput(input: CompleteScreeningEncounterPersistenceInput): {
  readonly encounterId: string
  readonly expectedRecordVersion: number
  readonly actorId: string
  readonly completedAt: string
  readonly summarySystolic: number
  readonly summaryDiastolic: number
  readonly summaryPulse: number
  readonly nextActionCategory: 'ROUTINE' | 'REFER' | 'URGENT_REFERRAL'
  readonly decisionJson: string
  readonly vitalsReadings: readonly ScreeningCompletionVitalsReadingInput[]
  readonly lifestyleLogs: readonly ScreeningCompletionLifestyleLogInput[]
  readonly foodLogs: readonly ScreeningCompletionFoodLogInput[]
  readonly otcLogs: readonly ScreeningCompletionOtcLogInput[]
} {
  try {
    if (!Number.isSafeInteger(input.expectedRecordVersion) || input.expectedRecordVersion < 1)
      throw new RepositoryValidationError()
    if (input.vitalsReadings.length < 1) throw new RepositoryValidationError()
    for (const value of [input.summarySystolic, input.summaryDiastolic, input.summaryPulse]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RepositoryValidationError()
    }
    if (!['ROUTINE', 'REFER', 'URGENT_REFERRAL'].includes(input.nextActionCategory))
      throw new RepositoryValidationError()
    if (typeof input.decisionJson !== 'string' || input.decisionJson.length > 4000)
      throw new RepositoryValidationError()
    const decision = JSON.parse(input.decisionJson) as unknown
    if (typeof decision !== 'object' || decision === null || Array.isArray(decision))
      throw new RepositoryValidationError()

    input.vitalsReadings.forEach(validateVitalsReading)
    input.lifestyleLogs.forEach((log) => {
      parseEntityId(log.id)
      validateText(log.questionCode)
      validateText(log.responseCode)
    })
    input.foodLogs.forEach(validateFoodLog)
    input.otcLogs.forEach(validateOtcLog)

    return Object.freeze({
      encounterId: parseEntityId(input.encounterId),
      expectedRecordVersion: input.expectedRecordVersion,
      actorId: parseEntityId(input.actorId),
      completedAt: parseUtcTimestamp(input.completedAt),
      summarySystolic: input.summarySystolic,
      summaryDiastolic: input.summaryDiastolic,
      summaryPulse: input.summaryPulse,
      nextActionCategory: input.nextActionCategory,
      decisionJson: input.decisionJson,
      vitalsReadings: input.vitalsReadings,
      lifestyleLogs: input.lifestyleLogs,
      foodLogs: input.foodLogs,
      otcLogs: input.otcLogs
    })
  } catch (error) {
    if (error instanceof RepositoryValidationError)
      throw new RepositoryValidationError(error.errorType)
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function validateVitalsReading(reading: ScreeningCompletionVitalsReadingInput): void {
  parseEntityId(reading.id)
  for (const value of [
    reading.sequenceNumber,
    reading.systolic,
    reading.diastolic,
    reading.pulse
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RepositoryValidationError()
  }
  validateText(reading.arm)
  validateText(reading.bodyPosition)
  parseUtcTimestamp(reading.measuredAt)
}

function validateFoodLog(log: ScreeningCompletionFoodLogInput): void {
  parseEntityId(log.id)
  if (log.foodCode !== null) validateText(log.foodCode)
  validateText(log.foodName)
  validateText(log.foodNameNormalized)
  if (log.frequencyCode !== null) validateText(log.frequencyCode)
  if (log.notes !== null) validateText(log.notes)
}

function validateOtcLog(log: ScreeningCompletionOtcLogInput): void {
  parseEntityId(log.id)
  validateText(log.productName)
  validateText(log.productNameNormalized)
  validateText(log.reasonForUse)
  for (const value of [log.doseText, log.frequencyText, log.durationText, log.sourceOfMedication]) {
    if (value !== null) validateText(value)
  }
  if (log.currentlyTaking !== null && typeof log.currentlyTaking !== 'boolean')
    throw new RepositoryValidationError()
}

function validateText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RepositoryValidationError()
  }
}
