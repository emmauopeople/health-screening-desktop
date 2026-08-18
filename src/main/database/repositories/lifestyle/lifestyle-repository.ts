import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { readDataProperties } from '../screening-session/screening-session-validation'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  calculateLifestyleWeeklyMinutes,
  parseLifestyleAlcoholBaselineInput,
  parseLifestyleDraftOwnershipInput,
  parseLifestyleDraftUpdateInput,
  parseLifestyleTobaccoBaselineInput,
  parseLifestyleWorkBaselineInput
} from './lifestyle-validation'
import type {
  LifestyleActivityInput,
  LifestyleActivityRow,
  LifestyleAlcoholBaselineInput,
  LifestyleAlcoholBaselineRecord,
  LifestyleAlcoholWeeklyInput,
  LifestyleAlcoholWeeklyRecord,
  LifestyleDraftRecord,
  LifestyleDraftBaselineReferenceUpdateInput,
  LifestyleDraftReopenInput,
  LifestyleDraftUpdateInput,
  LifestyleDraftUpdateResult,
  LifestyleRepository,
  LifestyleTobaccoBaselineInput,
  LifestyleTobaccoBaselineRecord,
  LifestyleTobaccoProductInput,
  LifestyleTobaccoProductRow,
  LifestyleTobaccoWeeklyInput,
  LifestyleTobaccoWeeklyRecord,
  LifestyleVersionResult,
  LifestyleWorkBaselineInput,
  LifestyleWorkBaselineRecord,
  LifestyleWorkWeeklyInput,
  LifestyleWorkWeeklyRecord,
  LifestyleOtherActivityInput,
  LifestyleOtherActivityRow
} from './lifestyle-types'

type BaselineInput =
  LifestyleAlcoholBaselineInput | LifestyleTobaccoBaselineInput | LifestyleWorkBaselineInput
type BaselineRecord =
  LifestyleAlcoholBaselineRecord | LifestyleTobaccoBaselineRecord | LifestyleWorkBaselineRecord

interface ReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const baselineColumns = {
  alcohol:
    'id, patient_id, installation_id, version, status, ever_consumed, consumed_past_12_months, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at',
  tobacco:
    'id, patient_id, installation_id, version, status, ever_regularly_used, former_use_approximate_stop_date, current_use_frequency, product_types_json, other_product_description, created_by, created_at, updated_by, updated_at',
  work: 'id, patient_id, installation_id, version, status, occupation_job_title, usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday, shift_pattern, description, created_by, created_at, updated_by, updated_at'
} as const

export function createLifestyleRepository(connection: Database.Database): LifestyleRepository {
  const repository: LifestyleRepository = {
    findActiveAlcoholBaseline: (patientId: EntityId, installationId: EntityId) =>
      readBaseline(
        connection,
        'alcohol',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleAlcoholBaselineRecord | null,
    findActiveAlcoholBaselineForWrite: (
      tx: DatabaseTransactionConnection,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaseline(
        tx,
        'alcohol',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleAlcoholBaselineRecord | null
    },
    findAlcoholBaselineByIdForWrite: (
      tx: DatabaseTransactionConnection,
      id: EntityId,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaselineById(
        tx,
        'alcohol',
        parseEntityId(id),
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleAlcoholBaselineRecord | null
    },
    listAlcoholBaselineHistory: (patientId: EntityId, installationId: EntityId) =>
      readBaselineHistory(
        connection,
        'alcohol',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as readonly LifestyleAlcoholBaselineRecord[],
    insertAlcoholBaseline: (
      tx: DatabaseTransactionConnection,
      input: LifestyleAlcoholBaselineInput
    ) => insertAlcoholBaseline(tx, input),
    findActiveTobaccoBaseline: (patientId: EntityId, installationId: EntityId) =>
      readBaseline(
        connection,
        'tobacco',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleTobaccoBaselineRecord | null,
    findActiveTobaccoBaselineForWrite: (
      tx: DatabaseTransactionConnection,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaseline(
        tx,
        'tobacco',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleTobaccoBaselineRecord | null
    },
    findTobaccoBaselineByIdForWrite: (
      tx: DatabaseTransactionConnection,
      id: EntityId,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaselineById(
        tx,
        'tobacco',
        parseEntityId(id),
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleTobaccoBaselineRecord | null
    },
    listTobaccoBaselineHistory: (patientId: EntityId, installationId: EntityId) =>
      readBaselineHistory(
        connection,
        'tobacco',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as readonly LifestyleTobaccoBaselineRecord[],
    insertTobaccoBaseline: (
      tx: DatabaseTransactionConnection,
      input: LifestyleTobaccoBaselineInput
    ) => insertTobaccoBaseline(tx, input),
    findActiveWorkBaseline: (patientId: EntityId, installationId: EntityId) =>
      readBaseline(
        connection,
        'work',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleWorkBaselineRecord | null,
    findActiveWorkBaselineForWrite: (
      tx: DatabaseTransactionConnection,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaseline(
        tx,
        'work',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleWorkBaselineRecord | null
    },
    findWorkBaselineByIdForWrite: (
      tx: DatabaseTransactionConnection,
      id: EntityId,
      patientId: EntityId,
      installationId: EntityId
    ) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readBaselineById(
        tx,
        'work',
        parseEntityId(id),
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as LifestyleWorkBaselineRecord | null
    },
    listWorkBaselineHistory: (patientId: EntityId, installationId: EntityId) =>
      readBaselineHistory(
        connection,
        'work',
        parseEntityId(patientId),
        parseEntityId(installationId)
      ) as readonly LifestyleWorkBaselineRecord[],
    insertWorkBaseline: (tx: DatabaseTransactionConnection, input: LifestyleWorkBaselineInput) =>
      insertWorkBaseline(tx, input),
    findDraftByEncounter: (encounterId: EntityId) =>
      readDraft(connection, parseEntityId(encounterId)),
    findDraftByEncounterForWrite: (tx: DatabaseTransactionConnection, encounterId: EntityId) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readDraft(tx, parseEntityId(encounterId))
    },
    insertDraft: (
      tx: DatabaseTransactionConnection,
      input: Parameters<LifestyleRepository['insertDraft']>[1]
    ) => insertDraft(tx, input),
    updateDraft: (tx: DatabaseTransactionConnection, input: LifestyleDraftUpdateInput) =>
      updateDraft(tx, input),
    updateDraftBaselineReferences: (
      tx: DatabaseTransactionConnection,
      input: LifestyleDraftBaselineReferenceUpdateInput
    ) => updateDraftBaselineReferences(tx, input),
    reopenDraft: (tx: DatabaseTransactionConnection, input: LifestyleDraftReopenInput) =>
      reopenDraft(tx, input)
  }
  return Object.freeze(repository)
}

function insertAlcoholBaseline(
  tx: DatabaseTransactionConnection,
  input: LifestyleAlcoholBaselineInput
): LifestyleVersionResult<LifestyleAlcoholBaselineRecord> {
  const parsed = parseLifestyleAlcoholBaselineInput(input)
  return insertBaseline(
    tx,
    'alcohol',
    parsed
  ) as LifestyleVersionResult<LifestyleAlcoholBaselineRecord>
}
function insertTobaccoBaseline(
  tx: DatabaseTransactionConnection,
  input: LifestyleTobaccoBaselineInput
): LifestyleVersionResult<LifestyleTobaccoBaselineRecord> {
  const parsed = parseLifestyleTobaccoBaselineInput(input)
  return insertBaseline(
    tx,
    'tobacco',
    parsed
  ) as LifestyleVersionResult<LifestyleTobaccoBaselineRecord>
}
function insertWorkBaseline(
  tx: DatabaseTransactionConnection,
  input: LifestyleWorkBaselineInput
): LifestyleVersionResult<LifestyleWorkBaselineRecord> {
  const parsed = parseLifestyleWorkBaselineInput(input)
  return insertBaseline(tx, 'work', parsed) as LifestyleVersionResult<LifestyleWorkBaselineRecord>
}

function insertBaseline<T extends 'alcohol' | 'tobacco' | 'work'>(
  tx: DatabaseTransactionConnection,
  kind: T,
  input: BaselineInput
): LifestyleVersionResult<BaselineRecord> {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const table = `lifestyle_${kind}_baseline_versions`
    const current = tx
      .prepare(
        `SELECT MAX(version) AS version FROM ${table} WHERE patient_id = ? AND installation_id = ?`
      )
      .get(input.patientId, input.installationId) as { version?: unknown } | undefined
    const currentVersion =
      current?.version === null || current?.version === undefined ? null : Number(current.version)
    if (currentVersion !== input.expectedCurrentVersion)
      return { status: 'VERSION_CONFLICT', currentVersion }
    const version = (currentVersion ?? 0) + 1
    if (kind === 'alcohol') {
      const alcohol = input as LifestyleAlcoholBaselineInput
      tx.prepare(
        `INSERT INTO ${table} (id, patient_id, installation_id, version, status, ever_consumed, consumed_past_12_months, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        alcohol.id,
        alcohol.patientId,
        alcohol.installationId,
        version,
        alcohol.status,
        alcohol.everConsumed,
        alcohol.consumedPast12Months,
        JSON.stringify(alcohol.commonBeverageTypes),
        alcohol.otherBeverageDescription,
        alcohol.actorId,
        alcohol.occurredAt,
        alcohol.actorId,
        alcohol.occurredAt
      )
    } else if (kind === 'tobacco') {
      const tobacco = input as LifestyleTobaccoBaselineInput
      tx.prepare(
        `INSERT INTO ${table} (id, patient_id, installation_id, version, status, ever_regularly_used, former_use_approximate_stop_date, current_use_frequency, product_types_json, other_product_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        tobacco.id,
        tobacco.patientId,
        tobacco.installationId,
        version,
        tobacco.status,
        tobacco.everRegularlyUsed,
        tobacco.formerUseApproximateStopDate,
        tobacco.currentUseFrequency,
        JSON.stringify(tobacco.productTypes),
        tobacco.otherProductDescription,
        tobacco.actorId,
        tobacco.occurredAt,
        tobacco.actorId,
        tobacco.occurredAt
      )
    } else {
      const work = input as LifestyleWorkBaselineInput
      tx.prepare(
        `INSERT INTO ${table} (id, patient_id, installation_id, version, status, occupation_job_title, usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday, shift_pattern, description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        work.id,
        work.patientId,
        work.installationId,
        version,
        work.status,
        work.occupationJobTitle,
        work.usualPhysicalDemand,
        work.typicalWorkdaysPerWeek,
        work.typicalHoursPerWorkday,
        work.shiftPattern,
        work.description,
        work.actorId,
        work.occurredAt,
        work.actorId,
        work.occurredAt
      )
    }
    const record = readBaseline(tx, kind, input.patientId, input.installationId)
    if (!record || (record as { id?: unknown }).id !== input.id)
      throw new RepositoryDataIntegrityError()
    return { status: 'INSERTED', record }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function insertDraft(
  tx: DatabaseTransactionConnection,
  input: Parameters<LifestyleRepository['insertDraft']>[1]
): LifestyleDraftRecord {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const parsed = parseLifestyleDraftOwnershipInput(input)
    validateDraftEncounterOwnership(tx, parsed)
    tx.prepare(
      `INSERT INTO lifestyle_drafts (id, encounter_id, status, patient_id, screening_session_id, location_id, installation_id, period_start, period_end, alcohol_baseline_version_id, tobacco_baseline_version_id, work_baseline_version_id, other_activity_response, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, 1)`
    ).run(
      parsed.id,
      parsed.encounterId,
      parsed.patientId,
      parsed.screeningSessionId,
      parsed.locationId,
      parsed.installationId,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.actorId,
      parsed.occurredAt,
      parsed.actorId,
      parsed.occurredAt
    )
    return (
      readDraft(tx, parsed.encounterId) ??
      (() => {
        throw new RepositoryDataIntegrityError()
      })()
    )
  } catch (error) {
    throw mapWriteError(error)
  }
}

function updateDraft(
  tx: DatabaseTransactionConnection,
  input: LifestyleDraftUpdateInput
): LifestyleDraftUpdateResult {
  assertActiveDatabaseTransactionConnection(tx)
  const parsed = parseLifestyleDraftUpdateInput(input)
  try {
    const current = readDraftById(tx, parsed.id)
    if (!current) return { status: 'NOT_FOUND' }
    if (current.rowVersion !== parsed.expectedRowVersion)
      return { status: 'VERSION_CONFLICT', draft: current }
    if (current.status === 'COMPLETE') return { status: 'INVALID_STATUS', draft: current }
    validateReferencedBaselines(
      tx,
      current.patientId,
      current.installationId,
      parsed.alcoholBaselineVersionId,
      parsed.tobaccoBaselineVersionId,
      parsed.workBaselineVersionId
    )
    tx.prepare(
      `UPDATE lifestyle_drafts SET status = ?, alcohol_baseline_version_id = ?, tobacco_baseline_version_id = ?, work_baseline_version_id = ?, other_activity_response = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?`
    ).run(
      parsed.status,
      parsed.alcoholBaselineVersionId,
      parsed.tobaccoBaselineVersionId,
      parsed.workBaselineVersionId,
      parsed.otherActivityResponse,
      parsed.actorId,
      parsed.occurredAt,
      parsed.id,
      parsed.expectedRowVersion
    )
    if (parsed.alcohol)
      reconcileAlcohol(tx, current.id, parsed.alcohol, parsed.actorId, parsed.occurredAt)
    if (parsed.tobacco)
      reconcileTobacco(tx, current.id, parsed.tobacco, parsed.actorId, parsed.occurredAt)
    if (parsed.physicalActivity)
      reconcilePhysical(tx, current.id, parsed.physicalActivity, parsed.actorId, parsed.occurredAt)
    if (parsed.work) reconcileWork(tx, current.id, parsed.work, parsed.actorId, parsed.occurredAt)
    reconcileOtherActivities(
      tx,
      current.id,
      parsed.otherActivities,
      parsed.actorId,
      parsed.occurredAt
    )
    return {
      status: 'UPDATED',
      draft:
        readDraftById(tx, parsed.id) ??
        (() => {
          throw new RepositoryDataIntegrityError()
        })()
    }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function updateDraftBaselineReferences(
  tx: DatabaseTransactionConnection,
  input: LifestyleDraftBaselineReferenceUpdateInput
): LifestyleDraftUpdateResult {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const data = readDataProperties(input, [
      'id',
      'expectedRowVersion',
      'alcoholBaselineVersionId',
      'tobaccoBaselineVersionId',
      'workBaselineVersionId',
      'actorId',
      'occurredAt'
    ] as const)
    const parsed = {
      id: parseEntityId(data.id),
      expectedRowVersion: parsePositiveVersion(data.expectedRowVersion),
      alcoholBaselineVersionId:
        data.alcoholBaselineVersionId === null
          ? null
          : parseEntityId(data.alcoholBaselineVersionId),
      tobaccoBaselineVersionId:
        data.tobaccoBaselineVersionId === null
          ? null
          : parseEntityId(data.tobaccoBaselineVersionId),
      workBaselineVersionId:
        data.workBaselineVersionId === null ? null : parseEntityId(data.workBaselineVersionId),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    }
    const current = readDraftById(tx, parsed.id)
    if (!current) return { status: 'NOT_FOUND' }
    if (current.rowVersion !== parsed.expectedRowVersion)
      return { status: 'VERSION_CONFLICT', draft: current }
    if (current.status === 'COMPLETE') return { status: 'INVALID_STATUS', draft: current }
    validateReferencedBaselines(
      tx,
      current.patientId,
      current.installationId,
      parsed.alcoholBaselineVersionId,
      parsed.tobaccoBaselineVersionId,
      parsed.workBaselineVersionId
    )
    if (
      current.alcoholBaselineVersionId === parsed.alcoholBaselineVersionId &&
      current.tobaccoBaselineVersionId === parsed.tobaccoBaselineVersionId &&
      current.workBaselineVersionId === parsed.workBaselineVersionId
    )
      return { status: 'UPDATED', draft: current }
    const result = tx
      .prepare(
        'UPDATE lifestyle_drafts SET status = ?, alcohol_baseline_version_id = ?, tobacco_baseline_version_id = ?, work_baseline_version_id = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?'
      )
      .run(
        current.status,
        parsed.alcoholBaselineVersionId,
        parsed.tobaccoBaselineVersionId,
        parsed.workBaselineVersionId,
        parsed.actorId,
        parsed.occurredAt,
        parsed.id,
        parsed.expectedRowVersion
      )
    if (result.changes !== 1) return { status: 'VERSION_CONFLICT', draft: current }
    return {
      status: 'UPDATED',
      draft:
        readDraftById(tx, parsed.id) ??
        (() => {
          throw new RepositoryDataIntegrityError()
        })()
    }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function reopenDraft(
  tx: DatabaseTransactionConnection,
  input: LifestyleDraftReopenInput
): LifestyleDraftUpdateResult {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const data = readDataProperties(input, [
      'id',
      'expectedRowVersion',
      'actorId',
      'occurredAt'
    ] as const)
    const parsed = {
      id: parseEntityId(data.id),
      expectedRowVersion: parsePositiveVersion(data.expectedRowVersion),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    }
    const current = readDraftById(tx, parsed.id)
    if (!current) return { status: 'NOT_FOUND' }
    if (current.rowVersion !== parsed.expectedRowVersion)
      return { status: 'VERSION_CONFLICT', draft: current }
    if (current.status !== 'COMPLETE') return { status: 'INVALID_STATUS', draft: current }
    const result = tx
      .prepare(
        "UPDATE lifestyle_drafts SET status = 'DRAFT', updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND status = 'COMPLETE'"
      )
      .run(parsed.actorId, parsed.occurredAt, parsed.id, parsed.expectedRowVersion)
    if (result.changes !== 1) return { status: 'VERSION_CONFLICT', draft: current }
    return {
      status: 'UPDATED',
      draft:
        readDraftById(tx, parsed.id) ??
        (() => {
          throw new RepositoryDataIntegrityError()
        })()
    }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function parsePositiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RepositoryValidationError()
  return value
}

function reconcileAlcohol(
  tx: DatabaseTransactionConnection,
  draftId: string,
  input: LifestyleAlcoholWeeklyInput,
  actorId: string,
  at: string
): void {
  const existing = tx
    .prepare(
      'SELECT id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description FROM lifestyle_alcohol_weekly_records WHERE lifestyle_draft_id = ?'
    )
    .get(draftId) as Record<string, unknown> | undefined
  if (!existing) {
    tx.prepare(
      'INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      input.id,
      draftId,
      input.weeklyResponse,
      input.drinkingDays,
      input.totalStandardizedDrinks,
      input.largestOneDayAmount,
      input.daysAtLargestAmount,
      JSON.stringify(input.commonBeverageTypes),
      input.otherBeverageDescription,
      actorId,
      at,
      actorId,
      at
    )
    return
  }
  if (String(existing.id) !== input.id) throw new RepositoryValidationError()
  const changed =
    !sameJson(existing.common_beverage_types_json, input.commonBeverageTypes) ||
    existing.weekly_response !== input.weeklyResponse ||
    existing.drinking_days !== input.drinkingDays ||
    existing.total_standardized_drinks !== input.totalStandardizedDrinks ||
    existing.largest_one_day_amount !== input.largestOneDayAmount ||
    existing.days_at_largest_amount !== input.daysAtLargestAmount ||
    existing.other_beverage_description !== input.otherBeverageDescription
  if (changed)
    tx.prepare(
      'UPDATE lifestyle_alcohol_weekly_records SET weekly_response = ?, drinking_days = ?, total_standardized_drinks = ?, largest_one_day_amount = ?, days_at_largest_amount = ?, common_beverage_types_json = ?, other_beverage_description = ?, updated_by = ?, updated_at = ? WHERE id = ?'
    ).run(
      input.weeklyResponse,
      input.drinkingDays,
      input.totalStandardizedDrinks,
      input.largestOneDayAmount,
      input.daysAtLargestAmount,
      JSON.stringify(input.commonBeverageTypes),
      input.otherBeverageDescription,
      actorId,
      at,
      input.id
    )
}

function reconcileTobacco(
  tx: DatabaseTransactionConnection,
  draftId: string,
  input: LifestyleTobaccoWeeklyInput,
  actorId: string,
  at: string
): void {
  const existing = tx
    .prepare(
      'SELECT id, weekly_response FROM lifestyle_tobacco_weekly_records WHERE lifestyle_draft_id = ?'
    )
    .get(draftId) as Record<string, unknown> | undefined
  if (!existing)
    tx.prepare(
      'INSERT INTO lifestyle_tobacco_weekly_records (id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(input.id, draftId, input.weeklyResponse, actorId, at, actorId, at)
  else {
    if (String(existing.id) !== input.id) throw new RepositoryValidationError()
    if (existing.weekly_response !== input.weeklyResponse)
      tx.prepare(
        'UPDATE lifestyle_tobacco_weekly_records SET weekly_response = ?, updated_by = ?, updated_at = ? WHERE id = ?'
      ).run(input.weeklyResponse, actorId, at, input.id)
  }
  reconcileRows(
    tx,
    'lifestyle_tobacco_product_rows',
    'tobacco_weekly_record_id',
    input.id,
    input.products,
    actorId,
    at,
    productRowSql
  )
}

function reconcilePhysical(
  tx: DatabaseTransactionConnection,
  draftId: string,
  input: {
    id: EntityId
    weeklyResponse: string | null
    sedentaryTimeResponse: string | null
    sedentaryMinutesPerDay: number | null
    activities: readonly LifestyleActivityInput[]
  },
  actorId: string,
  at: string
): void {
  const existing = tx
    .prepare(
      'SELECT id, weekly_response, sedentary_time_response, sedentary_minutes_per_day FROM lifestyle_physical_activity_weekly_records WHERE lifestyle_draft_id = ?'
    )
    .get(draftId) as Record<string, unknown> | undefined
  if (!existing)
    tx.prepare(
      'INSERT INTO lifestyle_physical_activity_weekly_records (id, lifestyle_draft_id, weekly_response, sedentary_time_response, sedentary_minutes_per_day, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      input.id,
      draftId,
      input.weeklyResponse,
      input.sedentaryTimeResponse,
      input.sedentaryMinutesPerDay,
      actorId,
      at,
      actorId,
      at
    )
  else {
    if (String(existing.id) !== input.id) throw new RepositoryValidationError()
    if (
      existing.weekly_response !== input.weeklyResponse ||
      existing.sedentary_time_response !== input.sedentaryTimeResponse ||
      existing.sedentary_minutes_per_day !== input.sedentaryMinutesPerDay
    )
      tx.prepare(
        'UPDATE lifestyle_physical_activity_weekly_records SET weekly_response = ?, sedentary_time_response = ?, sedentary_minutes_per_day = ?, updated_by = ?, updated_at = ? WHERE id = ?'
      ).run(
        input.weeklyResponse,
        input.sedentaryTimeResponse,
        input.sedentaryMinutesPerDay,
        actorId,
        at,
        input.id
      )
  }
  reconcileRows(
    tx,
    'lifestyle_activity_rows',
    'physical_activity_weekly_record_id',
    input.id,
    input.activities,
    actorId,
    at,
    activityRowSql
  )
}

function reconcileWork(
  tx: DatabaseTransactionConnection,
  draftId: string,
  input: LifestyleWorkWeeklyInput,
  actorId: string,
  at: string
): void {
  const existing = tx
    .prepare(
      'SELECT id, weekly_response FROM lifestyle_work_weekly_records WHERE lifestyle_draft_id = ?'
    )
    .get(draftId) as Record<string, unknown> | undefined
  if (!existing)
    tx.prepare(
      'INSERT INTO lifestyle_work_weekly_records (id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(input.id, draftId, input.weeklyResponse, actorId, at, actorId, at)
  else {
    if (String(existing.id) !== input.id) throw new RepositoryValidationError()
    if (existing.weekly_response !== input.weeklyResponse)
      tx.prepare(
        'UPDATE lifestyle_work_weekly_records SET weekly_response = ?, updated_by = ?, updated_at = ? WHERE id = ?'
      ).run(input.weeklyResponse, actorId, at, input.id)
  }
}

type ChildInput =
  LifestyleTobaccoProductInput | LifestyleActivityInput | LifestyleOtherActivityInput
type ChildSql = {
  readonly values: (
    row: ChildInput,
    parentId: string,
    actorId: string,
    at: string
  ) => readonly unknown[]
  readonly updateValues: (row: ChildInput, actorId: string, at: string) => readonly unknown[]
  readonly equals: (stored: Record<string, unknown>, row: ChildInput) => boolean
  readonly update: string
  readonly insert: string
}
function reconcileRows(
  tx: DatabaseTransactionConnection,
  table: string,
  parentColumn: string,
  parentId: string,
  rows: readonly ChildInput[],
  actorId: string,
  at: string,
  sql: ChildSql
): void {
  const stored = tx
    .prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? ORDER BY sequence_number`)
    .all(parentId) as Record<string, unknown>[]
  const storedById = new Map(stored.map((row) => [String(row.id), row]))
  const sequenceChangingExistingRows: ChildInput[] = []
  const changedExistingRows: ChildInput[] = []
  const newRows: ChildInput[] = []
  for (const row of rows) {
    const old = storedById.get(row.id)
    if (old && !sameOwner(old, parentColumn, parentId)) throw new RepositoryValidationError()
    if (!old) {
      const owner = tx.prepare(`SELECT ${parentColumn} FROM ${table} WHERE id = ?`).get(row.id) as
        Record<string, unknown> | undefined
      if (owner) throw new RepositoryValidationError()
      newRows.push(row)
      continue
    }
    if (Number(old.sequence_number) !== row.sequenceNumber) sequenceChangingExistingRows.push(row)
    if (!sql.equals(old, row)) changedExistingRows.push(row)
  }
  const temporarySequences = allocateTemporarySequences(
    stored,
    rows,
    sequenceChangingExistingRows.length
  )
  let temporarySequenceIndex = 0
  for (const row of sequenceChangingExistingRows) {
    const old = storedById.get(row.id)
    if (!old) throw new RepositoryDataIntegrityError()
    tx.prepare(`UPDATE ${table} SET sequence_number = ? WHERE id = ? AND ${parentColumn} = ?`).run(
      temporarySequences[temporarySequenceIndex],
      row.id,
      parentId
    )
    temporarySequenceIndex += 1
  }
  const submitted = new Set(rows.map((row) => String(row.id)))
  for (const old of stored)
    if (!submitted.has(String(old.id)))
      tx.prepare(`DELETE FROM ${table} WHERE id = ? AND ${parentColumn} = ?`).run(old.id, parentId)
  for (const row of changedExistingRows)
    tx.prepare(sql.update).run(...sql.updateValues(row, actorId, at), row.id, parentId)
  for (const row of newRows) tx.prepare(sql.insert).run(...sql.values(row, parentId, actorId, at))
}

function allocateTemporarySequences(
  storedRows: readonly Record<string, unknown>[],
  submittedRows: readonly ChildInput[],
  count: number
): readonly number[] {
  if (count === 0) return Object.freeze([])
  const maxStoredSequence = storedRows.reduce(
    (max, row) => Math.max(max, parseStoredSequence(row.sequence_number)),
    0
  )
  const maxSubmittedSequence = submittedRows.reduce(
    (max, row) => Math.max(max, row.sequenceNumber),
    0
  )
  const firstTemporarySequence = Math.max(maxStoredSequence, maxSubmittedSequence) + 1
  const lastTemporarySequence = firstTemporarySequence + count - 1
  if (
    !Number.isSafeInteger(firstTemporarySequence) ||
    !Number.isSafeInteger(lastTemporarySequence) ||
    firstTemporarySequence <= 0 ||
    lastTemporarySequence > Number.MAX_SAFE_INTEGER
  )
    throw new RepositoryValidationError()
  return Object.freeze(Array.from({ length: count }, (_, index) => firstTemporarySequence + index))
}

function parseStoredSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new RepositoryDataIntegrityError()
  return value
}

const productRowSql: ChildSql = {
  values: (row, parentId, actorId, at) => {
    const r = row as LifestyleTobaccoProductInput
    return [
      r.id,
      parentId,
      r.sequenceNumber,
      r.productType,
      r.daysUsed,
      r.averageQuantityPerUseDay,
      r.unit,
      r.secondhandSmokeExposure === null ? null : r.secondhandSmokeExposure ? 1 : 0,
      r.otherProductDescription,
      r.otherUnitDescription,
      actorId,
      at,
      actorId,
      at
    ]
  },
  updateValues: (row, actorId, at) => {
    const r = row as LifestyleTobaccoProductInput
    return [
      r.sequenceNumber,
      r.productType,
      r.daysUsed,
      r.averageQuantityPerUseDay,
      r.unit,
      r.secondhandSmokeExposure === null ? null : r.secondhandSmokeExposure ? 1 : 0,
      r.otherProductDescription,
      r.otherUnitDescription,
      actorId,
      at
    ]
  },
  equals: (old, row) => {
    const r = row as LifestyleTobaccoProductInput
    return (
      Number(old.sequence_number) === r.sequenceNumber &&
      old.product_type === r.productType &&
      Number(old.days_used) === r.daysUsed &&
      Number(old.average_quantity_per_use_day) === r.averageQuantityPerUseDay &&
      old.unit === r.unit &&
      (old.secondhand_smoke_exposure === null
        ? null
        : Number(old.secondhand_smoke_exposure) === 1) === r.secondhandSmokeExposure &&
      old.other_product_description === r.otherProductDescription &&
      old.other_unit_description === r.otherUnitDescription
    )
  },
  update:
    'UPDATE lifestyle_tobacco_product_rows SET sequence_number = ?, product_type = ?, days_used = ?, average_quantity_per_use_day = ?, unit = ?, secondhand_smoke_exposure = ?, other_product_description = ?, other_unit_description = ?, updated_by = ?, updated_at = ? WHERE id = ? AND tobacco_weekly_record_id = ?',
  insert:
    'INSERT INTO lifestyle_tobacco_product_rows (id, tobacco_weekly_record_id, sequence_number, product_type, days_used, average_quantity_per_use_day, unit, secondhand_smoke_exposure, other_product_description, other_unit_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
}

const activityRowSql: ChildSql = {
  values: (row, parentId, actorId, at) => {
    const r = row as LifestyleActivityInput
    return [
      r.id,
      parentId,
      r.sequenceNumber,
      r.activityDomain,
      r.description,
      r.intensity,
      r.daysInPastSevenDays,
      r.averageMinutesPerActiveDay,
      actorId,
      at,
      actorId,
      at
    ]
  },
  updateValues: (row, actorId, at) => {
    const r = row as LifestyleActivityInput
    return [
      r.sequenceNumber,
      r.activityDomain,
      r.description,
      r.intensity,
      r.daysInPastSevenDays,
      r.averageMinutesPerActiveDay,
      actorId,
      at
    ]
  },
  equals: (old, row) => {
    const r = row as LifestyleActivityInput
    return (
      Number(old.sequence_number) === r.sequenceNumber &&
      old.activity_domain === r.activityDomain &&
      old.description === r.description &&
      old.intensity === r.intensity &&
      Number(old.days_in_past_seven_days) === r.daysInPastSevenDays &&
      Number(old.average_minutes_per_active_day) === r.averageMinutesPerActiveDay
    )
  },
  update:
    'UPDATE lifestyle_activity_rows SET sequence_number = ?, activity_domain = ?, description = ?, intensity = ?, days_in_past_seven_days = ?, average_minutes_per_active_day = ?, updated_by = ?, updated_at = ? WHERE id = ? AND physical_activity_weekly_record_id = ?',
  insert:
    'INSERT INTO lifestyle_activity_rows (id, physical_activity_weekly_record_id, sequence_number, activity_domain, description, intensity, days_in_past_seven_days, average_minutes_per_active_day, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
}

const otherActivityRowSql: ChildSql = {
  values: (row, parentId, actorId, at) => {
    const r = row as LifestyleOtherActivityInput
    return [
      r.id,
      parentId,
      r.sequenceNumber,
      r.category,
      r.description,
      r.daysInPastSevenDays,
      r.averageMinutesPerDay,
      r.intensity,
      actorId,
      at,
      actorId,
      at
    ]
  },
  updateValues: (row, actorId, at) => {
    const r = row as LifestyleOtherActivityInput
    return [
      r.sequenceNumber,
      r.category,
      r.description,
      r.daysInPastSevenDays,
      r.averageMinutesPerDay,
      r.intensity,
      actorId,
      at
    ]
  },
  equals: (old, row) => {
    const r = row as LifestyleOtherActivityInput
    return (
      Number(old.sequence_number) === r.sequenceNumber &&
      old.category === r.category &&
      old.description === r.description &&
      Number(old.days_in_past_seven_days) === r.daysInPastSevenDays &&
      Number(old.average_minutes_per_day) === r.averageMinutesPerDay &&
      old.intensity === r.intensity
    )
  },
  update:
    'UPDATE lifestyle_other_activity_rows SET sequence_number = ?, category = ?, description = ?, days_in_past_seven_days = ?, average_minutes_per_day = ?, intensity = ?, updated_by = ?, updated_at = ? WHERE id = ? AND lifestyle_draft_id = ?',
  insert:
    'INSERT INTO lifestyle_other_activity_rows (id, lifestyle_draft_id, sequence_number, category, description, days_in_past_seven_days, average_minutes_per_day, intensity, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
}

function reconcileOtherActivities(
  tx: DatabaseTransactionConnection,
  draftId: string,
  rows: readonly LifestyleOtherActivityInput[],
  actorId: string,
  at: string
): void {
  reconcileRows(
    tx,
    'lifestyle_other_activity_rows',
    'lifestyle_draft_id',
    draftId,
    rows,
    actorId,
    at,
    otherActivityRowSql
  )
}

function readDraft(connection: ReadConnection, encounterId: EntityId): LifestyleDraftRecord | null {
  try {
    return readDraftByEncounter(connection, encounterId)
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}
function readDraftByEncounter(
  connection: ReadConnection,
  encounterId: string
): LifestyleDraftRecord | null {
  const row = connection
    .prepare('SELECT * FROM lifestyle_drafts WHERE encounter_id = ?')
    .get(encounterId) as Record<string, unknown> | undefined
  return row ? readAggregate(connection, row) : null
}
function readDraftById(connection: ReadConnection, id: string): LifestyleDraftRecord | null {
  const row = connection.prepare('SELECT * FROM lifestyle_drafts WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? readAggregate(connection, row) : null
}
function readAggregate(
  connection: ReadConnection,
  row: Record<string, unknown>
): LifestyleDraftRecord {
  try {
    const draftId = parseEntityId(row.id)
    const alcohol = readAlcohol(connection, draftId)
    const tobacco = readTobacco(connection, draftId)
    const physicalActivity = readPhysical(connection, draftId)
    const work = readWork(connection, draftId)
    const otherActivities = (
      connection
        .prepare(
          'SELECT * FROM lifestyle_other_activity_rows WHERE lifestyle_draft_id = ? ORDER BY sequence_number'
        )
        .all(draftId) as Record<string, unknown>[]
    ).map(readOtherActivity)
    return {
      id: draftId,
      encounterId: parseEntityId(row.encounter_id),
      status: String(row.status) as LifestyleDraftRecord['status'],
      patientId: parseEntityId(row.patient_id),
      screeningSessionId: parseEntityId(row.screening_session_id),
      locationId: parseEntityId(row.location_id),
      installationId: parseEntityId(row.installation_id),
      periodStart: String(row.period_start) as LifestyleDraftRecord['periodStart'],
      periodEnd: String(row.period_end) as LifestyleDraftRecord['periodEnd'],
      alcoholBaselineVersionId:
        row.alcohol_baseline_version_id === null
          ? null
          : parseEntityId(row.alcohol_baseline_version_id),
      tobaccoBaselineVersionId:
        row.tobacco_baseline_version_id === null
          ? null
          : parseEntityId(row.tobacco_baseline_version_id),
      workBaselineVersionId:
        row.work_baseline_version_id === null ? null : parseEntityId(row.work_baseline_version_id),
      otherActivityResponse:
        row.other_activity_response as LifestyleDraftRecord['otherActivityResponse'],
      createdBy: parseEntityId(row.created_by),
      createdAt: parseUtcTimestamp(row.created_at),
      updatedBy: parseEntityId(row.updated_by),
      updatedAt: parseUtcTimestamp(row.updated_at),
      rowVersion: Number(row.row_version),
      alcohol,
      tobacco,
      physicalActivity,
      work,
      otherActivities
    }
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}
function readAlcohol(
  connection: ReadConnection,
  draftId: string
): LifestyleAlcoholWeeklyRecord | null {
  const row = connection
    .prepare('SELECT * FROM lifestyle_alcohol_weekly_records WHERE lifestyle_draft_id = ?')
    .get(draftId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: parseEntityId(row.id),
    lifestyleDraftId: draftId as EntityId,
    weeklyResponse: row.weekly_response as LifestyleAlcoholWeeklyRecord['weeklyResponse'],
    drinkingDays: nullableNumber(row.drinking_days),
    totalStandardizedDrinks: nullableNumber(row.total_standardized_drinks),
    largestOneDayAmount: nullableNumber(row.largest_one_day_amount),
    daysAtLargestAmount: nullableNumber(row.days_at_largest_amount),
    commonBeverageTypes: parseJsonArray(row.common_beverage_types_json),
    otherBeverageDescription: row.other_beverage_description as string | null,
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at)
  }
}
function readTobacco(
  connection: ReadConnection,
  draftId: string
): LifestyleTobaccoWeeklyRecord | null {
  const row = connection
    .prepare('SELECT * FROM lifestyle_tobacco_weekly_records WHERE lifestyle_draft_id = ?')
    .get(draftId) as Record<string, unknown> | undefined
  if (!row) return null
  const products = (
    connection
      .prepare(
        'SELECT * FROM lifestyle_tobacco_product_rows WHERE tobacco_weekly_record_id = ? ORDER BY sequence_number'
      )
      .all(row.id) as Record<string, unknown>[]
  ).map(readProduct)
  return {
    id: parseEntityId(row.id),
    lifestyleDraftId: draftId as EntityId,
    weeklyResponse: row.weekly_response as LifestyleTobaccoWeeklyRecord['weeklyResponse'],
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at),
    products
  }
}
function readPhysical(
  connection: ReadConnection,
  draftId: string
): LifestyleDraftRecord['physicalActivity'] {
  const row = connection
    .prepare(
      'SELECT * FROM lifestyle_physical_activity_weekly_records WHERE lifestyle_draft_id = ?'
    )
    .get(draftId) as Record<string, unknown> | undefined
  if (!row) return null
  const activities = (
    connection
      .prepare(
        'SELECT * FROM lifestyle_activity_rows WHERE physical_activity_weekly_record_id = ? ORDER BY sequence_number'
      )
      .all(row.id) as Record<string, unknown>[]
  ).map(readActivity)
  return {
    id: parseEntityId(row.id),
    lifestyleDraftId: draftId as EntityId,
    weeklyResponse: row.weekly_response as
      | 'YES'
      | 'NO'
      | 'UNKNOWN'
      | 'DECLINED'
      | 'NOT_APPLICABLE'
      | 'UNABLE_TO_ANSWER'
      | 'PREFER_NOT_TO_ANSWER'
      | null,
    sedentaryTimeResponse: row.sedentary_time_response as
      'RECORDED' | 'UNKNOWN' | 'UNABLE_TO_ANSWER' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | null,
    sedentaryMinutesPerDay: nullableNumber(row.sedentary_minutes_per_day),
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at),
    activities
  }
}
function readWork(connection: ReadConnection, draftId: string): LifestyleWorkWeeklyRecord | null {
  const row = connection
    .prepare('SELECT * FROM lifestyle_work_weekly_records WHERE lifestyle_draft_id = ?')
    .get(draftId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: parseEntityId(row.id),
    lifestyleDraftId: draftId as EntityId,
    weeklyResponse: row.weekly_response as LifestyleWorkWeeklyRecord['weeklyResponse'],
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at)
  }
}
function readProduct(row: Record<string, unknown>): LifestyleTobaccoProductRow {
  return {
    id: parseEntityId(row.id),
    tobaccoWeeklyRecordId: parseEntityId(row.tobacco_weekly_record_id),
    sequenceNumber: Number(row.sequence_number),
    productType: row.product_type as LifestyleTobaccoProductRow['productType'],
    daysUsed: Number(row.days_used),
    averageQuantityPerUseDay: Number(row.average_quantity_per_use_day),
    unit: row.unit as LifestyleTobaccoProductRow['unit'],
    secondhandSmokeExposure:
      row.secondhand_smoke_exposure === null ? null : Number(row.secondhand_smoke_exposure) === 1,
    otherProductDescription: row.other_product_description as string | null,
    otherUnitDescription: row.other_unit_description as string | null,
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at)
  }
}
function readActivity(row: Record<string, unknown>): LifestyleActivityRow {
  const days = Number(row.days_in_past_seven_days)
  const minutes = Number(row.average_minutes_per_active_day)
  return {
    id: parseEntityId(row.id),
    physicalActivityWeeklyRecordId: parseEntityId(row.physical_activity_weekly_record_id),
    sequenceNumber: Number(row.sequence_number),
    activityDomain: row.activity_domain as LifestyleActivityRow['activityDomain'],
    description: row.description as string | null,
    intensity: row.intensity as LifestyleActivityRow['intensity'],
    daysInPastSevenDays: days,
    averageMinutesPerActiveDay: minutes,
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at),
    weeklyMinutes: calculateLifestyleWeeklyMinutes(days, minutes)
  }
}
function readOtherActivity(row: Record<string, unknown>): LifestyleOtherActivityRow {
  return {
    id: parseEntityId(row.id),
    lifestyleDraftId: parseEntityId(row.lifestyle_draft_id),
    sequenceNumber: Number(row.sequence_number),
    category: row.category as LifestyleOtherActivityRow['category'],
    description: row.description as string | null,
    daysInPastSevenDays: Number(row.days_in_past_seven_days),
    averageMinutesPerDay: Number(row.average_minutes_per_day),
    intensity: row.intensity as LifestyleOtherActivityRow['intensity'],
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at)
  }
}

function readBaseline(
  connection: ReadConnection,
  kind: 'alcohol' | 'tobacco' | 'work',
  patientId: EntityId,
  installationId: EntityId
): BaselineRecord | null {
  const row = connection
    .prepare(
      `SELECT ${baselineColumns[kind]} FROM lifestyle_${kind}_baseline_versions WHERE patient_id = ? AND installation_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(patientId, installationId) as Record<string, unknown> | undefined
  return row ? decodeBaseline(kind, row) : null
}

function readBaselineById(
  connection: ReadConnection,
  kind: 'alcohol' | 'tobacco' | 'work',
  id: string,
  patientId: string,
  installationId: string
): BaselineRecord | null {
  const row = connection
    .prepare(
      `SELECT ${baselineColumns[kind]} FROM lifestyle_${kind}_baseline_versions WHERE id = ? AND patient_id = ? AND installation_id = ?`
    )
    .get(id, patientId, installationId) as Record<string, unknown> | undefined
  return row ? decodeBaseline(kind, row) : null
}
function readBaselineHistory(
  connection: ReadConnection,
  kind: 'alcohol' | 'tobacco' | 'work',
  patientId: EntityId,
  installationId: EntityId
): readonly BaselineRecord[] {
  return (
    connection
      .prepare(
        `SELECT ${baselineColumns[kind]} FROM lifestyle_${kind}_baseline_versions WHERE patient_id = ? AND installation_id = ? ORDER BY version ASC`
      )
      .all(patientId, installationId) as Record<string, unknown>[]
  ).map((row) => decodeBaseline(kind, row))
}
function decodeBaseline(
  kind: 'alcohol' | 'tobacco' | 'work',
  row: Record<string, unknown>
): LifestyleAlcoholBaselineRecord | LifestyleTobaccoBaselineRecord | LifestyleWorkBaselineRecord {
  const common = {
    id: parseEntityId(row.id),
    patientId: parseEntityId(row.patient_id),
    installationId: parseEntityId(row.installation_id),
    version: Number(row.version),
    createdBy: parseEntityId(row.created_by),
    createdAt: parseUtcTimestamp(row.created_at),
    updatedBy: parseEntityId(row.updated_by),
    updatedAt: parseUtcTimestamp(row.updated_at)
  }
  if (kind === 'alcohol')
    return {
      ...common,
      status: row.status as LifestyleAlcoholBaselineRecord['status'],
      everConsumed: row.ever_consumed as LifestyleAlcoholBaselineRecord['everConsumed'],
      consumedPast12Months:
        row.consumed_past_12_months as LifestyleAlcoholBaselineRecord['consumedPast12Months'],
      commonBeverageTypes: parseJsonArray(row.common_beverage_types_json),
      otherBeverageDescription: row.other_beverage_description as string | null
    }
  if (kind === 'tobacco')
    return {
      ...common,
      status: row.status as LifestyleTobaccoBaselineRecord['status'],
      everRegularlyUsed:
        row.ever_regularly_used as LifestyleTobaccoBaselineRecord['everRegularlyUsed'],
      formerUseApproximateStopDate: row.former_use_approximate_stop_date as string | null,
      currentUseFrequency:
        row.current_use_frequency as LifestyleTobaccoBaselineRecord['currentUseFrequency'],
      productTypes: parseJsonArray(row.product_types_json),
      otherProductDescription: row.other_product_description as string | null
    }
  return {
    ...common,
    status: row.status as LifestyleWorkBaselineRecord['status'],
    occupationJobTitle: row.occupation_job_title as string | null,
    usualPhysicalDemand:
      row.usual_physical_demand as LifestyleWorkBaselineRecord['usualPhysicalDemand'],
    typicalWorkdaysPerWeek: nullableNumber(row.typical_workdays_per_week),
    typicalHoursPerWorkday: nullableNumber(row.typical_hours_per_workday),
    shiftPattern: row.shift_pattern as LifestyleWorkBaselineRecord['shiftPattern'],
    description: row.description as string | null
  }
}
function parseJsonArray<T extends string = string>(value: unknown): readonly T[] {
  if (value === null) return []
  try {
    const parsed: unknown = JSON.parse(String(value))
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error()
    return parsed as readonly T[]
  } catch {
    throw new RepositoryDataIntegrityError()
  }
}
function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}
function sameJson(value: unknown, next: readonly string[]): boolean {
  try {
    return JSON.stringify(JSON.parse(String(value))) === JSON.stringify(next)
  } catch {
    return false
  }
}
function sameOwner(row: Record<string, unknown>, parentColumn: string, parentId: string): boolean {
  return String(row[parentColumn]) === parentId
}
function validateDraftEncounterOwnership(
  tx: DatabaseTransactionConnection,
  input: Parameters<LifestyleRepository['insertDraft']>[1]
): void {
  const row = tx
    .prepare(
      `SELECT
        e.patient_id,
        e.screening_session_id,
        e.location_id,
        i.id AS installation_id
      FROM screening_encounters e
      JOIN screening_sessions s ON s.id = e.screening_session_id
      JOIN installation i ON i.singleton_id = 1
      WHERE e.id = ?`
    )
    .get(input.encounterId) as Record<string, unknown> | undefined
  if (
    !row ||
    row.patient_id !== input.patientId ||
    row.screening_session_id !== input.screeningSessionId ||
    row.location_id !== input.locationId ||
    row.installation_id !== input.installationId
  )
    throw new RepositoryValidationError()
}
function validateReferencedBaselines(
  tx: DatabaseTransactionConnection,
  patientId: string,
  installationId: string,
  alcoholId: string | null,
  tobaccoId: string | null,
  workId: string | null
): void {
  for (const [table, id] of [
    ['lifestyle_alcohol_baseline_versions', alcoholId],
    ['lifestyle_tobacco_baseline_versions', tobaccoId],
    ['lifestyle_work_baseline_versions', workId]
  ] as const)
    if (
      id !== null &&
      !tx
        .prepare(`SELECT id FROM ${table} WHERE id = ? AND patient_id = ? AND installation_id = ?`)
        .get(id, patientId, installationId)
    )
      throw new RepositoryValidationError()
}
function mapWriteError(error: unknown): Error {
  if (
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof RepositoryWriteError
  )
    return error
  return new RepositoryWriteError(getRepositoryErrorType(error))
}
