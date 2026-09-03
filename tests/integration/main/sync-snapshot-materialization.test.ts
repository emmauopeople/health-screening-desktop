import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSyncSnapshotPreparationService } from '@main/application/sync-transport'
import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createSyncSnapshotRepository,
  createSyncTransportBatchRepository
} from '@main/database'
import { createEntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock } from '@main/foundation/utc-clock'

const now = '2026-09-03T12:00:00.000Z'
const installationId = '10000000-0000-4000-8000-000000000001'
const locationId = '20000000-0000-4000-8000-000000000001'
const adminId = '30000000-0000-4000-8000-000000000001'
const nurseId = '30000000-0000-4000-8000-000000000002'
const protocolId = '00000000-0000-4000-8000-000000000007'
const patientId = '50000000-0000-4000-8000-000000000001'
const sessionId = '60000000-0000-4000-8000-000000000001'
const encounterId = '70000000-0000-4000-8000-000000000001'
const vitalsId = '80000000-0000-4000-8000-000000000001'
const readingId = '90000000-0000-4000-8000-000000000001'
const batchId = 'a0000000-0000-4000-8000-000000000001'
const patientSignalOne = 'b0000000-0000-4000-8000-000000000001'
const patientSignalTwo = 'b0000000-0000-4000-8000-000000000002'
const sessionSignal = 'b0000000-0000-4000-8000-000000000003'
const encounterSignal = 'b0000000-0000-4000-8000-000000000004'
const vitalsSignalOne = 'b0000000-0000-4000-8000-000000000005'
const vitalsSignalTwo = 'b0000000-0000-4000-8000-000000000006'
const unsupportedSignal = 'b0000000-0000-4000-8000-000000000007'
const lifestyleId = 'c0000000-0000-4000-8000-000000000001'
const lifestyleSignal = 'd0000000-0000-4000-8000-000000000001'
const alcoholBaselineId = 'c0000000-0000-4000-8000-000000000002'
const tobaccoBaselineId = 'c0000000-0000-4000-8000-000000000003'
const workBaselineId = 'c0000000-0000-4000-8000-000000000004'
const alcoholWeeklyId = 'c0000000-0000-4000-8000-000000000005'
const tobaccoWeeklyId = 'c0000000-0000-4000-8000-000000000006'
const physicalWeeklyId = 'c0000000-0000-4000-8000-000000000007'
const workWeeklyId = 'c0000000-0000-4000-8000-000000000008'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

describe('sync snapshot materialization', () => {
  it('coalesces current SQLite snapshots in dependency order and excludes unsupported signals', async () => {
    const harness = await createHarness()
    insertClinicalFoundation(harness.connection)
    insertSignal(harness.connection, patientSignalOne, 'PATIENT', patientId, 'PATIENT_CREATED', 1)
    insertSignal(
      harness.connection,
      patientSignalTwo,
      'PATIENT',
      patientId,
      'PATIENT_DEMOGRAPHICS_AMENDED',
      2
    )
    insertSignal(
      harness.connection,
      sessionSignal,
      'SCREENING_SESSION',
      sessionId,
      'SCREENING_SESSION_CREATED',
      3
    )
    insertSignal(
      harness.connection,
      encounterSignal,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_ENCOUNTER_STARTED',
      4
    )
    insertSignal(
      harness.connection,
      vitalsSignalOne,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_VITALS_DRAFT_SAVED',
      5
    )
    insertSignal(
      harness.connection,
      vitalsSignalTwo,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_VITALS_STEP_COMPLETED',
      6
    )
    insertSignal(
      harness.connection,
      unsupportedSignal,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_FOOD_DRAFT_SAVED',
      7
    )

    expect(harness.service.prepareNextBatch()).toEqual({
      status: 'PREPARED',
      batchId,
      requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      recordCount: 4,
      signalCount: 6
    })

    const request = readStoredRequest(harness.connection)
    expect(request.records.map((record) => record.resourceType)).toEqual([
      'PATIENT',
      'SCREENING_SESSION',
      'SCREENING_ENCOUNTER',
      'VITALS'
    ])
    expect(request.records.map((record) => record.recordId)).toEqual([
      patientSignalTwo,
      sessionSignal,
      encounterSignal,
      vitalsSignalTwo
    ])
    expect(request.actors).toEqual([
      {
        active: true,
        displayName: 'Synthetic Administrator',
        localActorId: adminId,
        role: 'LOCAL_ADMIN',
        updatedAt: now
      },
      {
        active: true,
        displayName: 'Synthetic Nurse',
        localActorId: nurseId,
        role: 'NURSE',
        updatedAt: now
      }
    ])
    expect(request.records[0]?.payload).toMatchObject({
      localPatientCode: 'PT-000001',
      knownChsMedicalId: null,
      acknowledgmentStatus: 'ACKNOWLEDGED',
      displayName: 'Synthetic Patient',
      sex: 'FEMALE'
    })
    expect(request.records[1]?.payload).toMatchObject({
      localProtocolVersionId: protocolId,
      openedByLocalActorId: nurseId,
      localLocationId: locationId
    })
    expect(request.records[3]?.payload).toMatchObject({
      localEncounterId: encounterId,
      performedByLocalActorId: nurseId,
      status: 'VITALS_COMPLETE',
      readings: [
        expect.objectContaining({
          localReadingId: readingId,
          measurementLocalDate: '2026-09-03',
          measurementLocalTime: '12:15',
          measurementTimezone: 'Africa/Douala',
          systolic: 122,
          diastolic: 78
        })
      ]
    })
    expect(readOutboxStatuses(harness.connection)).toEqual([
      { id: patientSignalOne, status: 'IN_FLIGHT' },
      { id: patientSignalTwo, status: 'IN_FLIGHT' },
      { id: sessionSignal, status: 'IN_FLIGHT' },
      { id: encounterSignal, status: 'IN_FLIGHT' },
      { id: vitalsSignalOne, status: 'IN_FLIGHT' },
      { id: vitalsSignalTwo, status: 'IN_FLIGHT' },
      { id: unsupportedSignal, status: 'PENDING' }
    ])
  })

  it('leaves in-progress Lifestyle data local until a complete snapshot exists', async () => {
    const harness = await createHarness()
    insertClinicalFoundation(harness.connection)
    harness.connection
      .prepare(
        `INSERT INTO lifestyle_drafts (
           id, encounter_id, status, patient_id, screening_session_id, location_id,
           installation_id, period_start, period_end, created_by, created_at,
           updated_by, updated_at, row_version
         ) VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?, ?, '2026-08-28', '2026-09-03', ?, ?, ?, ?, 2)`
      )
      .run(
        lifestyleId,
        encounterId,
        patientId,
        sessionId,
        locationId,
        installationId,
        nurseId,
        now,
        nurseId,
        now
      )
    insertSignal(
      harness.connection,
      lifestyleSignal,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_LIFESTYLE_DRAFT_SAVED',
      1
    )

    expect(harness.service.prepareNextBatch()).toEqual({ status: 'IDLE' })
    expect(readTableCount(harness.connection, 'sync_transport_batches')).toBe(0)
    expect(readOutboxStatuses(harness.connection)).toEqual([
      { id: lifestyleSignal, status: 'PENDING' }
    ])
  })

  it('materializes only a completed Lifestyle aggregate with its referenced baselines and actors', async () => {
    const harness = await createHarness()
    insertClinicalFoundation(harness.connection)
    insertCompleteLifestyle(harness.connection)
    insertSignal(
      harness.connection,
      lifestyleSignal,
      'SCREENING_ENCOUNTER',
      encounterId,
      'SCREENING_LIFESTYLE_STEP_COMPLETED',
      1
    )

    expect(harness.service.prepareNextBatch()).toMatchObject({
      status: 'PREPARED',
      recordCount: 1,
      signalCount: 1
    })
    const request = readStoredRequest(harness.connection)
    expect(request.actors.map((actor) => actor.localActorId)).toEqual([adminId, nurseId])
    expect(request.records[0]).toMatchObject({
      recordId: lifestyleSignal,
      resourceType: 'LIFESTYLE',
      localResourceId: lifestyleId,
      sourceRevision: 7,
      payload: {
        status: 'COMPLETE',
        localPatientId: patientId,
        localEncounterId: encounterId,
        baselines: {
          alcohol: { localBaselineVersionId: alcoholBaselineId, status: 'NEVER' },
          tobacco: { localBaselineVersionId: tobaccoBaselineId, status: 'NEVER' },
          work: { localBaselineVersionId: workBaselineId, status: 'EMPLOYED' }
        },
        alcohol: { localWeeklyRecordId: alcoholWeeklyId, weeklyResponse: 'NO' },
        tobacco: { localWeeklyRecordId: tobaccoWeeklyId, weeklyResponse: 'NO', products: [] },
        physicalActivity: {
          localWeeklyRecordId: physicalWeeklyId,
          weeklyResponse: 'NO',
          activities: []
        },
        work: { localWeeklyRecordId: workWeeklyId, weeklyResponse: 'USUAL' },
        otherActivity: { weeklyResponse: 'NO', activities: [] }
      }
    })
  })

  it('rolls back the canonical batch and every signal reservation on a final write failure', async () => {
    const harness = await createHarness()
    insertClinicalFoundation(harness.connection)
    insertSignal(harness.connection, patientSignalOne, 'PATIENT', patientId, 'PATIENT_CREATED', 1)
    harness.connection.exec(`
      CREATE TRIGGER fail_snapshot_batch_item
      BEFORE INSERT ON sync_transport_batch_items
      BEGIN
        SELECT RAISE(ABORT, 'synthetic final write failure');
      END;
    `)

    expect(harness.service.prepareNextBatch()).toEqual({ status: 'UNAVAILABLE' })
    expect(readTableCount(harness.connection, 'sync_transport_batches')).toBe(0)
    expect(readTableCount(harness.connection, 'sync_transport_batch_items')).toBe(0)
    expect(readOutboxStatuses(harness.connection)).toEqual([
      { id: patientSignalOne, status: 'PENDING' }
    ])
  })
})

async function createHarness(): Promise<{
  readonly connection: Database.Database
  readonly service: ReturnType<typeof createSyncSnapshotPreparationService>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsw013b1-sync-snapshot-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  connection.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now }
  })(connection)
  cleanup.push(async () => {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  })
  const transactionExecutor = createDatabaseTransactionExecutor({
    connection,
    clock: createUtcClock(() => now),
    idGenerator: createEntityIdGenerator(() => batchId),
    logger: { error: vi.fn() }
  })
  return {
    connection,
    service: createSyncSnapshotPreparationService({
      snapshotRepository: createSyncSnapshotRepository(connection),
      batchRepository: createSyncTransportBatchRepository(connection),
      transactionExecutor,
      desktopApplicationVersion: '1.0.0',
      desktopSchemaVersion: 19
    })
  }
}

function insertClinicalFoundation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation
       (singleton_id, id, deployment_name, timezone, created_at, updated_at)
       VALUES (1, ?, 'Synthetic deployment', 'Africa/Douala', ?, ?)`
    )
    .run(installationId, now, now)
  insertUser(connection, adminId, 'admin', 'Synthetic Administrator', 'LOCAL_ADMIN')
  insertUser(connection, nurseId, 'nurse', 'Synthetic Nurse', 'NURSE')
  connection
    .prepare(
      `INSERT INTO locations (
         id, name, name_normalized, location_type, is_active,
         created_by, created_at, updated_by, updated_at
       ) VALUES (?, 'Synthetic Clinic', 'synthetic clinic', 'CLINIC', 1, ?, ?, ?, ?)`
    )
    .run(locationId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
         singleton_id, installation_id, location_id, configured_at, configured_by,
         updated_at, updated_by, row_version
       ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, locationId, now, adminId, now, adminId)
  connection
    .prepare(
      `INSERT INTO patients (
         id, patient_code, display_name, given_name, family_name, name_normalized,
         sex, date_of_birth, status, created_by, created_at, updated_by, updated_at, row_version
       ) VALUES (?, 'PT-000001', 'Synthetic Patient', 'Synthetic', 'Patient',
                 'synthetic patient', 'FEMALE', '1985-04-12', 'ACTIVE', ?, ?, ?, ?, 2)`
    )
    .run(patientId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO consent_records (
         id, patient_id, consent_type, status, source_type, recorded_by, recorded_at,
         patient_prior_row_version, patient_resulting_row_version
       ) VALUES ('e0000000-0000-4000-8000-000000000001', ?,
                 'PATIENT_REGISTRY_ACKNOWLEDGMENT', 'ACKNOWLEDGED', 'LOCAL', ?, ?, 1, 2)`
    )
    .run(patientId, adminId, now)
  connection
    .prepare(
      `INSERT INTO screening_sessions (
         id, location_id, protocol_version_id, session_date, status, notes, opened_by,
         opened_at, created_by, created_at, updated_by, updated_at, row_version
       ) VALUES (?, ?, ?, '2026-09-03', 'OPEN', 'Synthetic session', ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(sessionId, locationId, protocolId, nurseId, now, nurseId, now, nurseId, now)
  connection
    .prepare(
      `INSERT INTO screening_encounters (
         id, patient_id, screening_session_id, location_id, protocol_version_id,
         status, started_at, source_type, recorded_by, record_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, 'LOCAL', ?, 1, ?, ?)`
    )
    .run(encounterId, patientId, sessionId, locationId, protocolId, now, nurseId, now, now)
  connection
    .prepare(
      `INSERT INTO screening_vitals_drafts (
         id, encounter_id, status, weight_kg, waist_cm, notes, created_by, created_at,
         updated_by, updated_at, row_version
       ) VALUES (?, ?, 'VITALS_COMPLETE', 68.5, 82.2, NULL, ?, ?, ?, ?, 2)`
    )
    .run(vitalsId, encounterId, nurseId, now, nurseId, now)
  connection
    .prepare(
      `INSERT INTO screening_vitals_draft_readings (
         id, vitals_draft_id, sequence_number, systolic, diastolic, pulse,
         measurement_site, patient_position, measurement_time, created_at, updated_at
       ) VALUES (?, ?, 1, 122, 78, 72, 'RIGHT_ARM', 'SITTING', '12:15', ?, ?)`
    )
    .run(readingId, vitalsId, now, now)
}

function insertUser(
  connection: Database.Database,
  id: string,
  username: string,
  displayName: string,
  role: string
): void {
  connection
    .prepare(
      `INSERT INTO users (
         id, username, username_normalized, display_name, password_hash, password_salt,
         role, is_active, must_change_password, failed_login_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, ?, ?)`
    )
    .run(id, username, username, displayName, role, now, now)
}

function insertCompleteLifestyle(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_baseline_versions (
         id, patient_id, installation_id, version, status, ever_consumed,
         consumed_past_12_months, common_beverage_types_json, other_beverage_description,
         created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', 'NO', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(alcoholBaselineId, patientId, installationId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_baseline_versions (
         id, patient_id, installation_id, version, status, ever_regularly_used,
         former_use_approximate_stop_date, current_use_frequency, product_types_json,
         other_product_description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', NULL, 'NOT_AT_ALL', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(tobaccoBaselineId, patientId, installationId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_work_baseline_versions (
         id, patient_id, installation_id, version, status, occupation_job_title,
         usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday,
         shift_pattern, description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'EMPLOYED', 'Synthetic clerk', 'SITTING', 5, 8,
                 'DAY', NULL, ?, ?, ?, ?)`
    )
    .run(workBaselineId, patientId, installationId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_drafts (
         id, encounter_id, status, patient_id, screening_session_id, location_id,
         installation_id, period_start, period_end, alcohol_baseline_version_id,
         tobacco_baseline_version_id, work_baseline_version_id, other_activity_response,
         created_by, created_at, updated_by, updated_at, row_version
       ) VALUES (?, ?, 'COMPLETE', ?, ?, ?, ?, '2026-08-28', '2026-09-03', ?, ?, ?,
                 'NO', ?, ?, ?, ?, 7)`
    )
    .run(
      lifestyleId,
      encounterId,
      patientId,
      sessionId,
      locationId,
      installationId,
      alcoholBaselineId,
      tobaccoBaselineId,
      workBaselineId,
      nurseId,
      now,
      nurseId,
      now
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_weekly_records (
         id, lifestyle_draft_id, weekly_response, common_beverage_types_json,
         created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', '[]', ?, ?, ?, ?)`
    )
    .run(alcoholWeeklyId, lifestyleId, nurseId, now, nurseId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', ?, ?, ?, ?)`
    )
    .run(tobaccoWeeklyId, lifestyleId, nurseId, now, nurseId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_physical_activity_weekly_records (
         id, lifestyle_draft_id, weekly_response, sedentary_minutes_per_day,
         created_by, created_at, updated_by, updated_at, sedentary_time_response
       ) VALUES (?, ?, 'NO', 240, ?, ?, ?, ?, 'RECORDED')`
    )
    .run(physicalWeeklyId, lifestyleId, nurseId, now, nurseId, now)
  connection
    .prepare(
      `INSERT INTO lifestyle_work_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'USUAL', ?, ?, ?, ?)`
    )
    .run(workWeeklyId, lifestyleId, nurseId, now, nurseId, now)
}

function insertSignal(
  connection: Database.Database,
  id: string,
  aggregateType: string,
  aggregateId: string,
  operation: string,
  second: number
): void {
  connection
    .prepare(
      `INSERT INTO sync_outbox (
         id, aggregate_type, aggregate_id, operation, payload_json,
         payload_schema_version, created_at, status, attempt_count
       ) VALUES (?, ?, ?, ?, '{}', 'audit.v1', ?, 'PENDING', 0)`
    )
    .run(
      id,
      aggregateType,
      aggregateId,
      operation,
      `2026-09-03T11:59:${String(second).padStart(2, '0')}.000Z`
    )
}

function readStoredRequest(connection: Database.Database): {
  readonly actors: readonly Record<string, unknown>[]
  readonly records: readonly {
    readonly recordId: string
    readonly resourceType: string
    readonly payload: Record<string, unknown>
  }[]
} {
  const row = connection.prepare('SELECT request_json FROM sync_transport_batches').get() as {
    request_json: string
  }
  return JSON.parse(row.request_json) as ReturnType<typeof readStoredRequest>
}

function readOutboxStatuses(connection: Database.Database): readonly unknown[] {
  return connection.prepare('SELECT id, status FROM sync_outbox ORDER BY created_at, id').all()
}

function readTableCount(connection: Database.Database, tableName: string): number {
  return Number(
    (connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number })
      .count
  )
}
