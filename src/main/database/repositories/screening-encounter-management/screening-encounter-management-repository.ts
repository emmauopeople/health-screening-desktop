import type Database from 'better-sqlite3'

import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import type {
  EncounterAddendumRecord,
  EncounterReviewFlagCategory,
  EncounterReviewFlagRecord,
  EncounterReviewFlagStatus,
  ManagedEncounterDetailRecord,
  ManagedEncounterFoodRecord,
  ManagedEncounterLifestyleRecord,
  ManagedEncounterOtcRecord,
  ManagedEncounterSummaryRecord,
  ManagedEncounterVitalsRecord,
  PatientContextEncounterRecord,
  PatientContextNextAction,
  PatientContextReferralRecord,
  PatientContextReferralStatus,
  PatientHistoryEncounterRecord,
  PatientHistoryMedicationChangeRecord,
  PatientHistoryMedicationChangeType,
  PatientHistoryReferralFollowupRecord,
  PatientHistoryReferralRecord,
  PatientHistoryReferralStatus,
  PatientHistoryTreatmentAction,
  PatientScreeningContextRecord,
  ScreeningEncounterManagementRepository,
  SearchManagedEncountersInput,
  SearchManagedEncountersResult
} from './screening-encounter-management-types'
import type { ScreeningEncounterStatus } from '../screening-encounter'

const encounterStatuses = new Set<ScreeningEncounterStatus>([
  'DRAFT',
  'COMPLETED',
  'AMENDED',
  'VOID'
])
const flagCategories = new Set<EncounterReviewFlagCategory>([
  'POSSIBLE_DATA_ERROR',
  'MISSING_INFORMATION',
  'WRONG_PATIENT',
  'DUPLICATE_ENCOUNTER',
  'OTHER'
])
const flagStatuses = new Set<EncounterReviewFlagStatus>(['OPEN', 'RESOLVED', 'DISMISSED'])
const patientContextNextActions = new Set<PatientContextNextAction>([
  'ROUTINE',
  'REFER',
  'URGENT_REFERRAL'
])
const patientContextReferralStatuses = new Set<PatientContextReferralStatus>([
  'OPEN',
  'CONTACTED',
  'SEEN',
  'UNABLE_TO_CONFIRM'
])
const patientHistoryReferralStatuses = new Set<PatientHistoryReferralStatus>([
  ...patientContextReferralStatuses,
  'CLOSED'
])
const patientHistoryTreatmentActions = new Set<PatientHistoryTreatmentAction>([
  'TREATMENT_INITIATED',
  'TREATMENT_MODIFIED',
  'NEW_MEDICATION'
])
const patientHistoryMedicationChangeTypes = new Set<PatientHistoryMedicationChangeType>([
  'TREATMENT_MODIFIED',
  'NEW_MEDICATION'
])
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u

const encounterSummaryColumns = `
  encounter.id,
  encounter.patient_id,
  encounter.screening_session_id,
  patient.patient_code,
  patient.display_name AS patient_display_name,
  patient.date_of_birth,
  location.name AS location_name,
  encounter.status,
  encounter.started_at,
  encounter.completed_at,
  encounter.record_version,
  CASE WHEN
    EXISTS (SELECT 1 FROM screening_vitals_drafts draft WHERE draft.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM lifestyle_drafts draft WHERE draft.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM food_drafts draft WHERE draft.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM otc_drafts draft WHERE draft.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM blood_pressure_readings final_vitals WHERE final_vitals.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM lifestyle_logs final_lifestyle WHERE final_lifestyle.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM food_logs final_food WHERE final_food.encounter_id = encounter.id)
    OR EXISTS (SELECT 1 FROM otc_medication_logs final_otc WHERE final_otc.encounter_id = encounter.id)
    THEN 1 ELSE 0
  END AS has_recorded_data,
  (SELECT COUNT(*) FROM screening_encounter_addenda addendum WHERE addendum.encounter_id = encounter.id) AS note_count,
  (SELECT COUNT(*) FROM screening_encounter_review_flags flag WHERE flag.encounter_id = encounter.id AND flag.status = 'OPEN') AS open_flag_count
`

const searchWhere = `
WHERE encounter.location_id = @locationId
  AND (encounter.status <> 'DRAFT' OR encounter.screening_session_id = @resumableSessionId)
  AND ((@status = 'ALL' AND encounter.status <> 'VOID') OR encounter.status = @status)
  AND (
    @query = ''
    OR lower(patient.display_name) LIKE @likeQuery ESCAPE '\\'
    OR lower(patient.patient_code) LIKE @likeQuery ESCAPE '\\'
    OR lower(COALESCE(patient.date_of_birth, '')) LIKE @likeQuery ESCAPE '\\'
    OR lower(COALESCE(location.name, '')) LIKE @likeQuery ESCAPE '\\'
  )
`

const searchSql = `
SELECT ${encounterSummaryColumns}
FROM screening_encounters encounter
JOIN patients patient ON patient.id = encounter.patient_id
JOIN locations location ON location.id = encounter.location_id
${searchWhere}
ORDER BY COALESCE(encounter.completed_at, encounter.started_at) DESC, encounter.id DESC
LIMIT @limit OFFSET @offset;
`

const countSql = `
SELECT COUNT(*) AS total
FROM screening_encounters encounter
JOIN patients patient ON patient.id = encounter.patient_id
JOIN locations location ON location.id = encounter.location_id
${searchWhere};
`

const detailSummarySql = `
SELECT ${encounterSummaryColumns}
FROM screening_encounters encounter
JOIN patients patient ON patient.id = encounter.patient_id
JOIN locations location ON location.id = encounter.location_id
WHERE encounter.id = ?
  AND encounter.location_id = ?
  AND (encounter.status <> 'DRAFT' OR encounter.screening_session_id = ?);
`

const patientContextRecentEncountersSql = `
SELECT
  encounter.id,
  encounter.completed_at,
  encounter.summary_systolic,
  encounter.summary_diastolic,
  encounter.summary_pulse,
  encounter.next_action_category,
  vitals.weight_kg
FROM screening_encounters encounter
LEFT JOIN screening_vitals_drafts vitals ON vitals.encounter_id = encounter.id
WHERE encounter.patient_id = ?
  AND encounter.status IN ('COMPLETED', 'AMENDED')
  AND encounter.completed_at IS NOT NULL
  AND encounter.summary_systolic IS NOT NULL
  AND encounter.summary_diastolic IS NOT NULL
  AND encounter.summary_pulse IS NOT NULL
  AND encounter.next_action_category IN ('ROUTINE', 'REFER', 'URGENT_REFERRAL')
ORDER BY encounter.completed_at DESC, encounter.id DESC
LIMIT ?;
`

const patientContextThirtyDayAverageSql = `
SELECT
  ROUND(AVG(encounter.summary_systolic)) AS average_systolic,
  ROUND(AVG(encounter.summary_diastolic)) AS average_diastolic,
  COUNT(*) AS encounter_count
FROM screening_encounters encounter
WHERE encounter.patient_id = ?
  AND encounter.status IN ('COMPLETED', 'AMENDED')
  AND encounter.completed_at IS NOT NULL
  AND encounter.completed_at >= ?
  AND encounter.summary_systolic IS NOT NULL
  AND encounter.summary_diastolic IS NOT NULL;
`

const patientHistoryEncountersSql = `
SELECT
  encounter.id,
  encounter.completed_at,
  encounter.summary_systolic,
  encounter.summary_diastolic,
  encounter.summary_pulse,
  encounter.next_action_category,
  vitals.weight_kg
FROM screening_encounters encounter
LEFT JOIN screening_vitals_drafts vitals ON vitals.encounter_id = encounter.id
WHERE encounter.patient_id = ?
  AND encounter.status IN ('COMPLETED', 'AMENDED')
  AND encounter.completed_at IS NOT NULL
  AND encounter.summary_systolic IS NOT NULL
  AND encounter.summary_diastolic IS NOT NULL
  AND encounter.summary_pulse IS NOT NULL
  AND encounter.next_action_category IN ('ROUTINE', 'REFER', 'URGENT_REFERRAL')
ORDER BY encounter.completed_at DESC, encounter.id DESC
LIMIT ? OFFSET ?;
`

const patientHistoryCountSql = `
SELECT COUNT(*) AS total
FROM screening_encounters encounter
WHERE encounter.patient_id = ?
  AND encounter.status IN ('COMPLETED', 'AMENDED')
  AND encounter.completed_at IS NOT NULL
  AND encounter.summary_systolic IS NOT NULL
  AND encounter.summary_diastolic IS NOT NULL
  AND encounter.summary_pulse IS NOT NULL
  AND encounter.next_action_category IN ('ROUTINE', 'REFER', 'URGENT_REFERRAL');
`

const patientHistoryReferralSql = `
SELECT id, status, urgency, due_date, closed_at
FROM referrals
WHERE encounter_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 1;
`

const patientHistoryLatestFollowupSql = `
SELECT id, contact_date, provider_seen, reported_outcome
FROM followups
WHERE referral_id = ?
ORDER BY contact_date DESC, recorded_at DESC, id DESC
LIMIT 1;
`

const patientHistoryActionsSql = `
SELECT action_code
FROM referral_followup_actions
WHERE followup_id = ?
ORDER BY sequence_number, id;
`

const patientHistoryMedicationChangesSql = `
SELECT id, change_type, medication_name, dosage, frequency
FROM referral_followup_medication_changes
WHERE followup_id = ?
ORDER BY sequence_number, id;
`

const patientContextActiveReferralSql = `
SELECT
  referral.id,
  referral.status,
  referral.urgency,
  referral.due_date,
  (
    SELECT MAX(followup.contact_date)
    FROM followups followup
    WHERE followup.referral_id = referral.id
  ) AS last_contact_date
FROM referrals referral
WHERE referral.patient_id = ?
  AND referral.status <> 'CLOSED'
ORDER BY referral.created_at DESC, referral.id DESC
LIMIT 1;
`

const addendumColumns = `
  addendum.id,
  addendum.encounter_id,
  addendum.note_text,
  addendum.created_by,
  author.display_name AS created_by_display_name,
  addendum.created_at
`

const flagColumns = `
  flag.id,
  flag.encounter_id,
  flag.category,
  flag.description,
  flag.status,
  flag.opened_by,
  opener.display_name AS opened_by_display_name,
  flag.opened_at,
  flag.resolved_by,
  resolver.display_name AS resolved_by_display_name,
  flag.resolved_at,
  flag.resolution_note
`

export function createScreeningEncounterManagementRepository(
  connection: Database.Database
): ScreeningEncounterManagementRepository {
  const repository: ScreeningEncounterManagementRepository = {
    search(input: SearchManagedEncountersInput): SearchManagedEncountersResult {
      const parsed = parseSearchInput(input)
      try {
        const parameters = {
          locationId: parsed.locationId,
          resumableSessionId: parsed.resumableSessionId,
          query: parsed.query,
          likeQuery: `%${escapeLike(parsed.query)}%`,
          status: parsed.status,
          limit: parsed.pageSize,
          offset: (parsed.page - 1) * parsed.pageSize
        }
        const rows = connection.prepare(searchSql).all(parameters) as readonly Record<
          string,
          unknown
        >[]
        const count = connection.prepare(countSql).get(parameters) as
          { total?: unknown } | undefined
        const total = parseCount(count?.total)
        return Object.freeze({
          items: Object.freeze(rows.map(readSummary)),
          total,
          page: parsed.page,
          pageSize: parsed.pageSize
        })
      } catch (error) {
        rethrowRead(error)
      }
    },

    getDetail(
      encounterId: EntityId,
      locationId: EntityId,
      resumableSessionId: EntityId | null
    ): ManagedEncounterDetailRecord | null {
      const parsedEncounterId = parseEntityId(encounterId)
      const parsedLocationId = parseEntityId(locationId)
      const parsedResumableSessionId =
        resumableSessionId === null ? null : parseEntityId(resumableSessionId)
      try {
        const row = connection
          .prepare(detailSummarySql)
          .get(parsedEncounterId, parsedLocationId, parsedResumableSessionId) as
          Record<string, unknown> | undefined
        if (row === undefined) return null

        return Object.freeze({
          encounter: readSummary(row),
          vitals: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT sequence_number, systolic, diastolic, pulse, measured_at
                 FROM blood_pressure_readings WHERE encounter_id = ? AND status = 'ACTIVE'
                 ORDER BY sequence_number, id`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readVitals)
          ),
          lifestyle: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT question_code, response_code FROM lifestyle_logs
                 WHERE encounter_id = ? ORDER BY question_code, id`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readLifestyle)
          ),
          foods: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT food_name, frequency_code, notes FROM food_logs
                 WHERE encounter_id = ? ORDER BY food_name_normalized, id`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readFood)
          ),
          otcMedications: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT product_name, reason_for_use, dose_text, frequency_text, duration_text,
                          source_of_medication, currently_taking FROM otc_medication_logs
                 WHERE encounter_id = ? ORDER BY product_name_normalized, id`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readOtc)
          ),
          addenda: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT ${addendumColumns} FROM screening_encounter_addenda addendum
                 JOIN users author ON author.id = addendum.created_by
                 WHERE addendum.encounter_id = ? ORDER BY addendum.created_at DESC, addendum.id DESC`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readAddendum)
          ),
          flags: Object.freeze(
            (
              connection
                .prepare(
                  `SELECT ${flagColumns} FROM screening_encounter_review_flags flag
                 JOIN users opener ON opener.id = flag.opened_by
                 LEFT JOIN users resolver ON resolver.id = flag.resolved_by
                 WHERE flag.encounter_id = ? ORDER BY flag.opened_at DESC, flag.id DESC`
                )
                .all(parsedEncounterId) as readonly Record<string, unknown>[]
            ).map(readFlag)
          )
        })
      } catch (error) {
        rethrowRead(error)
      }
    },

    getPatientContext(
      patientId: EntityId,
      thirtyDayCutoff: UtcTimestamp,
      recentEncounterLimit: number
    ): PatientScreeningContextRecord {
      const parsedPatientId = parseEntityId(patientId)
      const parsedCutoff = parseUtcTimestamp(thirtyDayCutoff)
      if (
        !Number.isSafeInteger(recentEncounterLimit) ||
        recentEncounterLimit < 3 ||
        recentEncounterLimit > 12
      ) {
        throw new RepositoryValidationError()
      }

      try {
        const recentRows = connection
          .prepare(patientContextRecentEncountersSql)
          .all(parsedPatientId, recentEncounterLimit) as readonly Record<string, unknown>[]
        const averageRow = connection
          .prepare(patientContextThirtyDayAverageSql)
          .get(parsedPatientId, parsedCutoff) as Record<string, unknown> | undefined
        const referralRow = connection
          .prepare(patientContextActiveReferralSql)
          .get(parsedPatientId) as Record<string, unknown> | undefined

        return Object.freeze({
          recentEncounters: Object.freeze(recentRows.map(readPatientContextEncounter)),
          thirtyDayAverage: readPatientContextAverage(averageRow),
          activeReferral: referralRow === undefined ? null : readPatientContextReferral(referralRow)
        })
      } catch (error) {
        rethrowRead(error)
      }
    },

    getPatientHistory(patientId, thirtyDayCutoff, page, pageSize, trendLimit) {
      const parsedPatientId = parseEntityId(patientId)
      const parsedCutoff = parseUtcTimestamp(thirtyDayCutoff)
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        ![25, 50, 100].includes(pageSize) ||
        !Number.isSafeInteger(trendLimit) ||
        trendLimit < 3 ||
        trendLimit > 12
      )
        throw new RepositoryValidationError()
      try {
        const patient = connection
          .prepare('SELECT id FROM patients WHERE id = ?')
          .get(parsedPatientId)
        if (patient === undefined) return null
        const rows = connection
          .prepare(patientHistoryEncountersSql)
          .all(parsedPatientId, pageSize, (page - 1) * pageSize) as readonly Record<
          string,
          unknown
        >[]
        const totalRow = connection.prepare(patientHistoryCountSql).get(parsedPatientId) as
          { total?: unknown } | undefined
        const context = this.getPatientContext(parsedPatientId, parsedCutoff, trendLimit)
        return Object.freeze({
          patientId: parsedPatientId,
          items: Object.freeze(rows.map((row) => readPatientHistoryEncounter(connection, row))),
          total: parseCount(totalRow?.total),
          page,
          pageSize,
          trendEncounters: context.recentEncounters,
          thirtyDayAverage: context.thirtyDayAverage
        })
      } catch (error) {
        rethrowRead(error)
      }
    },

    insertAddendum(scopedConnection, input) {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const noteText = parseText(input.noteText, 2000)
      try {
        scopedConnection
          .prepare(
            `INSERT INTO screening_encounter_addenda (id, encounter_id, note_text, created_by, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            parseEntityId(input.id),
            parseEntityId(input.encounterId),
            noteText,
            parseEntityId(input.createdBy),
            parseUtcTimestamp(input.createdAt)
          )
        return readAddendumForWrite(scopedConnection, input.id)
      } catch (error) {
        rethrowWrite(error)
      }
    },

    insertFlag(scopedConnection, input) {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const category = parseFlagCategory(input.category)
      const description = parseText(input.description, 1000)
      try {
        scopedConnection
          .prepare(
            `INSERT INTO screening_encounter_review_flags (
               id, encounter_id, category, description, status, opened_by, opened_at,
               resolved_by, resolved_at, resolution_note
             ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, NULL, NULL, NULL)`
          )
          .run(
            parseEntityId(input.id),
            parseEntityId(input.encounterId),
            category,
            description,
            parseEntityId(input.openedBy),
            parseUtcTimestamp(input.openedAt)
          )
        return readFlagForWrite(scopedConnection, input.id)
      } catch (error) {
        rethrowWrite(error)
      }
    },

    resolveFlag(scopedConnection, input) {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const status =
        input.status === 'RESOLVED' || input.status === 'DISMISSED' ? input.status : null
      if (status === null) throw new RepositoryValidationError()
      try {
        const result = scopedConnection
          .prepare(
            `UPDATE screening_encounter_review_flags
             SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?
             WHERE id = ? AND encounter_id = ? AND status = 'OPEN'`
          )
          .run(
            status,
            parseEntityId(input.resolvedBy),
            parseUtcTimestamp(input.resolvedAt),
            parseText(input.resolutionNote, 1000),
            parseEntityId(input.id),
            parseEntityId(input.encounterId)
          )
        if (result.changes === 0) return null
        return readFlagForWrite(scopedConnection, input.id)
      } catch (error) {
        rethrowWrite(error)
      }
    },

    voidEmptyDraft(scopedConnection, input) {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const encounterId = parseEntityId(input.encounterId)
      const expectedVersion = parsePositiveInteger(input.expectedVersion)
      const reason = parseText(input.reason, 500)
      const updatedAt = parseUtcTimestamp(input.updatedAt)
      try {
        const current = scopedConnection
          .prepare('SELECT status, record_version FROM screening_encounters WHERE id = ?')
          .get(encounterId) as Record<string, unknown> | undefined
        if (current === undefined) return 'NOT_FOUND'
        if (current['status'] !== 'DRAFT') return 'NOT_DRAFT'
        if (parsePositiveInteger(current['record_version']) !== expectedVersion)
          return 'VERSION_CONFLICT'
        if (hasRecordedData(scopedConnection, encounterId)) return 'NOT_EMPTY'

        const result = scopedConnection
          .prepare(
            `UPDATE screening_encounters
             SET status = 'VOID', void_reason = ?, updated_at = ?, record_version = record_version + 1
             WHERE id = ? AND status = 'DRAFT' AND record_version = ?`
          )
          .run(reason, updatedAt, encounterId, expectedVersion)
        return result.changes === 1 ? 'VOIDED' : 'VERSION_CONFLICT'
      } catch (error) {
        rethrowWrite(error)
      }
    },

    voidDraft(scopedConnection, input) {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const encounterId = parseEntityId(input.encounterId)
      const expectedVersion = parsePositiveInteger(input.expectedVersion)
      const reason = parseText(input.reason, 500)
      const updatedAt = parseUtcTimestamp(input.updatedAt)
      try {
        const current = scopedConnection
          .prepare('SELECT status, record_version FROM screening_encounters WHERE id = ?')
          .get(encounterId) as Record<string, unknown> | undefined
        if (current === undefined) return 'NOT_FOUND'
        if (current['status'] !== 'DRAFT') return 'NOT_DRAFT'
        if (parsePositiveInteger(current['record_version']) !== expectedVersion)
          return 'VERSION_CONFLICT'

        const result = scopedConnection
          .prepare(
            `UPDATE screening_encounters
             SET status = 'VOID', void_reason = ?, updated_at = ?, record_version = record_version + 1
             WHERE id = ? AND status = 'DRAFT' AND record_version = ?`
          )
          .run(reason, updatedAt, encounterId, expectedVersion)
        return result.changes === 1 ? 'VOIDED' : 'VERSION_CONFLICT'
      } catch (error) {
        rethrowWrite(error)
      }
    }
  }
  return Object.freeze(repository)
}

function readAddendumForWrite(
  connection: DatabaseTransactionConnection,
  id: EntityId
): EncounterAddendumRecord {
  const row = connection
    .prepare(
      `SELECT ${addendumColumns} FROM screening_encounter_addenda addendum
     JOIN users author ON author.id = addendum.created_by WHERE addendum.id = ?`
    )
    .get(parseEntityId(id)) as Record<string, unknown> | undefined
  if (row === undefined) throw new RepositoryDataIntegrityError()
  return readAddendum(row)
}

function readFlagForWrite(
  connection: DatabaseTransactionConnection,
  id: EntityId
): EncounterReviewFlagRecord {
  const row = connection
    .prepare(
      `SELECT ${flagColumns} FROM screening_encounter_review_flags flag
     JOIN users opener ON opener.id = flag.opened_by
     LEFT JOIN users resolver ON resolver.id = flag.resolved_by WHERE flag.id = ?`
    )
    .get(parseEntityId(id)) as Record<string, unknown> | undefined
  if (row === undefined) throw new RepositoryDataIntegrityError()
  return readFlag(row)
}

function readSummary(row: Record<string, unknown>): ManagedEncounterSummaryRecord {
  const status = String(row['status']) as ScreeningEncounterStatus
  if (!encounterStatuses.has(status)) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row['id']),
    patientId: parseEntityId(row['patient_id']),
    screeningSessionId: parseEntityId(row['screening_session_id']),
    patientCode: parseStoredText(row['patient_code']),
    patientDisplayName: parseStoredText(row['patient_display_name']),
    dateOfBirth: parseNullableText(row['date_of_birth']),
    locationName: parseStoredText(row['location_name']),
    status,
    startedAt: parseUtcTimestamp(row['started_at']),
    completedAt: row['completed_at'] === null ? null : parseUtcTimestamp(row['completed_at']),
    noteCount: parseCount(row['note_count']),
    openFlagCount: parseCount(row['open_flag_count']),
    recordVersion: parsePositiveInteger(row['record_version']),
    hasRecordedData: parseBooleanInteger(row['has_recorded_data'])
  })
}

function readAddendum(row: Record<string, unknown>): EncounterAddendumRecord {
  return Object.freeze({
    id: parseEntityId(row['id']),
    encounterId: parseEntityId(row['encounter_id']),
    noteText: parseStoredText(row['note_text']),
    createdBy: parseEntityId(row['created_by']),
    createdByDisplayName: parseStoredText(row['created_by_display_name']),
    createdAt: parseUtcTimestamp(row['created_at'])
  })
}

function readFlag(row: Record<string, unknown>): EncounterReviewFlagRecord {
  const category = parseFlagCategory(row['category'])
  const status = String(row['status']) as EncounterReviewFlagStatus
  if (!flagStatuses.has(status)) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row['id']),
    encounterId: parseEntityId(row['encounter_id']),
    category,
    description: parseStoredText(row['description']),
    status,
    openedBy: parseEntityId(row['opened_by']),
    openedByDisplayName: parseStoredText(row['opened_by_display_name']),
    openedAt: parseUtcTimestamp(row['opened_at']),
    resolvedBy: row['resolved_by'] === null ? null : parseEntityId(row['resolved_by']),
    resolvedByDisplayName: parseNullableText(row['resolved_by_display_name']),
    resolvedAt: row['resolved_at'] === null ? null : parseUtcTimestamp(row['resolved_at']),
    resolutionNote: parseNullableText(row['resolution_note'])
  })
}

function readVitals(row: Record<string, unknown>): ManagedEncounterVitalsRecord {
  return Object.freeze({
    sequenceNumber: parsePositiveInteger(row['sequence_number']),
    systolic: parsePositiveInteger(row['systolic']),
    diastolic: parsePositiveInteger(row['diastolic']),
    pulse: row['pulse'] === null ? null : parsePositiveInteger(row['pulse']),
    measuredAt: parseUtcTimestamp(row['measured_at'])
  })
}
function readLifestyle(row: Record<string, unknown>): ManagedEncounterLifestyleRecord {
  return Object.freeze({
    questionCode: parseStoredText(row['question_code']),
    responseCode: parseStoredText(row['response_code'])
  })
}
function readFood(row: Record<string, unknown>): ManagedEncounterFoodRecord {
  return Object.freeze({
    foodName: parseStoredText(row['food_name']),
    frequencyCode: parseStoredText(row['frequency_code']),
    notes: parseNullableText(row['notes'])
  })
}
function readOtc(row: Record<string, unknown>): ManagedEncounterOtcRecord {
  const currentlyTaking = row['currently_taking']
  if (currentlyTaking !== null && currentlyTaking !== 0 && currentlyTaking !== 1)
    throw new RepositoryDataIntegrityError()
  return Object.freeze({
    productName: parseStoredText(row['product_name']),
    reasonForUse: parseStoredText(row['reason_for_use']),
    doseText: parseNullableText(row['dose_text']),
    frequencyText: parseNullableText(row['frequency_text']),
    durationText: parseNullableText(row['duration_text']),
    sourceOfMedication: parseNullableText(row['source_of_medication']),
    currentlyTaking: currentlyTaking === null ? null : currentlyTaking === 1
  })
}

function readPatientContextEncounter(row: Record<string, unknown>): PatientContextEncounterRecord {
  const nextAction = row['next_action_category'] as PatientContextNextAction
  if (!patientContextNextActions.has(nextAction)) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row['id']),
    completedAt: parseUtcTimestamp(row['completed_at']),
    systolic: parsePositiveInteger(row['summary_systolic']),
    diastolic: parsePositiveInteger(row['summary_diastolic']),
    pulse: parsePositiveInteger(row['summary_pulse']),
    nextAction,
    weightKg: parseNullablePositiveNumber(row['weight_kg'])
  })
}

function readPatientContextAverage(
  row: Record<string, unknown> | undefined
): PatientScreeningContextRecord['thirtyDayAverage'] {
  if (row === undefined) throw new RepositoryDataIntegrityError()
  const encounterCount = parseCount(row['encounter_count'])
  if (encounterCount === 0) {
    if (row['average_systolic'] !== null || row['average_diastolic'] !== null)
      throw new RepositoryDataIntegrityError()
    return null
  }
  return Object.freeze({
    systolic: parsePositiveInteger(row['average_systolic']),
    diastolic: parsePositiveInteger(row['average_diastolic']),
    encounterCount
  })
}

function readPatientContextReferral(row: Record<string, unknown>): PatientContextReferralRecord {
  const status = row['status'] as PatientContextReferralStatus
  if (!patientContextReferralStatuses.has(status)) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row['id']),
    status,
    urgency: parseStoredText(row['urgency']),
    dueDate: parseNullableLocalDate(row['due_date']),
    lastContactDate: parseNullableLocalDate(row['last_contact_date'])
  })
}

function readPatientHistoryEncounter(
  connection: Database.Database,
  row: Record<string, unknown>
): PatientHistoryEncounterRecord {
  const base = readPatientContextEncounter(row)
  const referralRow = connection.prepare(patientHistoryReferralSql).get(base.id) as
    Record<string, unknown> | undefined
  return Object.freeze({
    ...base,
    referral: referralRow === undefined ? null : readPatientHistoryReferral(connection, referralRow)
  })
}

function readPatientHistoryReferral(
  connection: Database.Database,
  row: Record<string, unknown>
): PatientHistoryReferralRecord {
  const status = row['status'] as PatientHistoryReferralStatus
  if (!patientHistoryReferralStatuses.has(status)) throw new RepositoryDataIntegrityError()
  const id = parseEntityId(row['id'])
  const followupRow = connection.prepare(patientHistoryLatestFollowupSql).get(id) as
    Record<string, unknown> | undefined
  return Object.freeze({
    id,
    status,
    urgency: parseStoredText(row['urgency']),
    dueDate: parseNullableLocalDate(row['due_date']),
    closedAt: row['closed_at'] === null ? null : parseUtcTimestamp(row['closed_at']),
    latestFollowup:
      followupRow === undefined ? null : readPatientHistoryFollowup(connection, followupRow)
  })
}

function readPatientHistoryFollowup(
  connection: Database.Database,
  row: Record<string, unknown>
): PatientHistoryReferralFollowupRecord {
  const providerSeen = row['provider_seen']
  if (providerSeen !== null && providerSeen !== 0 && providerSeen !== 1)
    throw new RepositoryDataIntegrityError()
  const id = parseEntityId(row['id'])
  const actionRows = connection.prepare(patientHistoryActionsSql).all(id) as readonly {
    action_code?: unknown
  }[]
  const treatmentActions = actionRows.map((actionRow) => {
    const action = actionRow.action_code as PatientHistoryTreatmentAction
    if (!patientHistoryTreatmentActions.has(action)) throw new RepositoryDataIntegrityError()
    return action
  })
  const medicationRows = connection
    .prepare(patientHistoryMedicationChangesSql)
    .all(id) as readonly Record<string, unknown>[]
  return Object.freeze({
    id,
    contactDate: parseLocalDate(row['contact_date']),
    providerSeen: providerSeen === null ? null : providerSeen === 1,
    reportedOutcome: parseNullableText(row['reported_outcome']),
    treatmentActions: Object.freeze(treatmentActions),
    medicationChanges: Object.freeze(medicationRows.map(readPatientHistoryMedicationChange))
  })
}

function readPatientHistoryMedicationChange(
  row: Record<string, unknown>
): PatientHistoryMedicationChangeRecord {
  const changeType = row['change_type'] as PatientHistoryMedicationChangeType
  if (!patientHistoryMedicationChangeTypes.has(changeType)) throw new RepositoryDataIntegrityError()
  return Object.freeze({
    id: parseEntityId(row['id']),
    changeType,
    medicationName: parseStoredText(row['medication_name']),
    dosage: parseNullableText(row['dosage']),
    frequency: parseNullableText(row['frequency'])
  })
}

function parseSearchInput(input: SearchManagedEncountersInput): SearchManagedEncountersInput {
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
  if (
    query.length > 120 ||
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    ![25, 50, 100].includes(input.pageSize)
  )
    throw new RepositoryValidationError()
  if (input.status !== 'ALL' && !encounterStatuses.has(input.status))
    throw new RepositoryValidationError()
  return Object.freeze({
    ...input,
    locationId: parseEntityId(input.locationId),
    resumableSessionId:
      input.resumableSessionId === null ? null : parseEntityId(input.resumableSessionId),
    query
  })
}
function parseFlagCategory(value: unknown): EncounterReviewFlagCategory {
  if (typeof value !== 'string' || !flagCategories.has(value as EncounterReviewFlagCategory))
    throw new RepositoryValidationError()
  return value as EncounterReviewFlagCategory
}
function parseText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) throw new RepositoryValidationError()
  return normalized
}
function parseStoredText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new RepositoryDataIntegrityError()
  return value
}
function parseNullableText(value: unknown): string | null {
  return value === null ? null : parseStoredText(value)
}
function parseNullableLocalDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !localDatePattern.test(value))
    throw new RepositoryDataIntegrityError()
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new RepositoryDataIntegrityError()
  return value
}
function parseLocalDate(value: unknown): string {
  const parsed = parseNullableLocalDate(value)
  if (parsed === null) throw new RepositoryDataIntegrityError()
  return parsed
}
function parseNullablePositiveNumber(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new RepositoryDataIntegrityError()
  return value
}
function parseCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new RepositoryDataIntegrityError()
  return value
}
function parsePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RepositoryDataIntegrityError()
  return value
}
function parseBooleanInteger(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new RepositoryDataIntegrityError()
  return value === 1
}
function hasRecordedData(
  connection: DatabaseTransactionConnection,
  encounterId: EntityId
): boolean {
  const row = connection
    .prepare(
      `SELECT (
         EXISTS (SELECT 1 FROM screening_vitals_drafts WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM lifestyle_drafts WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM food_drafts WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM otc_drafts WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM blood_pressure_readings WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM lifestyle_logs WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM food_logs WHERE encounter_id = ?)
         OR EXISTS (SELECT 1 FROM otc_medication_logs WHERE encounter_id = ?)
       ) AS has_recorded_data`
    )
    .get(
      encounterId,
      encounterId,
      encounterId,
      encounterId,
      encounterId,
      encounterId,
      encounterId,
      encounterId
    ) as { has_recorded_data?: unknown } | undefined
  return parseBooleanInteger(row?.has_recorded_data)
}
function escapeLike(value: string): string {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_')
}
function rethrowRead(error: unknown): never {
  if (error instanceof RepositoryValidationError || error instanceof RepositoryDataIntegrityError)
    throw error
  throw new RepositoryReadError(getRepositoryErrorType(error))
}
function rethrowWrite(error: unknown): never {
  if (
    error instanceof DatabaseTransactionStateError ||
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryDataIntegrityError
  )
    throw error
  throw new RepositoryWriteError(getRepositoryErrorType(error))
}
