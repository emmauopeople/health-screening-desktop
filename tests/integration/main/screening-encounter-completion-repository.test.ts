import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterCompletionRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-20T12:00:00.000Z' as UtcTimestamp
const ids = Object.freeze({
  installation: '40000000-0000-4000-8000-000000000001',
  user: '40000000-0000-4000-8000-000000000002',
  location: '40000000-0000-4000-8000-000000000003',
  patient: '40000000-0000-4000-8000-000000000004',
  session: '40000000-0000-4000-8000-000000000005',
  encounter: '40000000-0000-4000-8000-000000000006',
  bloodPressure: '40000000-0000-4000-8000-000000000007',
  lifestyle: '40000000-0000-4000-8000-000000000008',
  food: '40000000-0000-4000-8000-000000000009',
  otc: '40000000-0000-4000-8000-000000000010'
})

describe('screening encounter completion repository', () => {
  it('materializes final screening rows and locks the encounter in one transaction', async () => {
    await withDatabase((connection) => {
      const repository = createScreeningEncounterCompletionRepository(connection)
      const transactionExecutor = createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => '40000000-0000-4000-8000-000000000099'),
        clock: createUtcClock(() => now)
      })

      const result = transactionExecutor.run((context) =>
        repository.complete(context.connection, {
          encounterId: parseEntityId(ids.encounter),
          expectedRecordVersion: 1,
          actorId: parseEntityId(ids.user),
          completedAt: now,
          summarySystolic: 120,
          summaryDiastolic: 80,
          summaryPulse: 70,
          nextActionCategory: 'ROUTINE',
          decisionJson: '{"protocol":"community-bp-screening","version":"1"}',
          vitalsReadings: [
            {
              id: parseEntityId(ids.bloodPressure),
              sequenceNumber: 1,
              systolic: 120,
              diastolic: 80,
              pulse: 70,
              arm: 'RIGHT_ARM',
              bodyPosition: 'SITTING',
              measuredAt: '2026-08-20T09:30:00.000Z' as UtcTimestamp
            }
          ],
          lifestyleLogs: [
            {
              id: parseEntityId(ids.lifestyle),
              questionCode: 'WEEKLY_ALCOHOL',
              responseCode: 'NO'
            }
          ],
          foodLogs: [
            {
              id: parseEntityId(ids.food),
              foodCode: 'RICE',
              foodName: 'Rice',
              foodNameNormalized: 'rice',
              frequencyCode: 'EVERY_DAY',
              notes: null
            }
          ],
          otcLogs: [
            {
              id: parseEntityId(ids.otc),
              productName: 'Ibuprofen',
              productNameNormalized: 'ibuprofen',
              reasonForUse: 'Headache',
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTaking: true
            }
          ]
        })
      )

      expect(result).toEqual({ status: 'COMPLETED', recordVersion: 2 })
      expect(
        connection
          .prepare(
            'SELECT status, completed_at, record_version, summary_systolic, summary_diastolic, summary_pulse, next_action_category, decision_json FROM screening_encounters WHERE id = ?'
          )
          .get(ids.encounter)
      ).toEqual({
        status: 'COMPLETED',
        completed_at: now,
        record_version: 2,
        summary_systolic: 120,
        summary_diastolic: 80,
        summary_pulse: 70,
        next_action_category: 'ROUTINE',
        decision_json: '{"protocol":"community-bp-screening","version":"1"}'
      })
      expect(
        connection
          .prepare(
            'SELECT systolic, diastolic, pulse, measured_at, source_type FROM blood_pressure_readings WHERE encounter_id = ?'
          )
          .get(ids.encounter)
      ).toEqual({
        systolic: 120,
        diastolic: 80,
        pulse: 70,
        measured_at: '2026-08-20T09:30:00.000Z',
        source_type: 'MEASURED'
      })
      expect(readCount(connection, 'lifestyle_logs')).toBe(1)
      expect(readCount(connection, 'food_logs')).toBe(1)
      expect(readCount(connection, 'otc_medication_logs')).toBe(1)
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    })
  })

  it('returns a version conflict without creating final rows', async () => {
    await withDatabase((connection) => {
      const repository = createScreeningEncounterCompletionRepository(connection)
      const transactionExecutor = createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => '40000000-0000-4000-8000-000000000099'),
        clock: createUtcClock(() => now)
      })
      const result = transactionExecutor.run((context) =>
        repository.complete(context.connection, {
          encounterId: parseEntityId(ids.encounter),
          expectedRecordVersion: 2,
          actorId: parseEntityId(ids.user),
          completedAt: now,
          summarySystolic: 120,
          summaryDiastolic: 80,
          summaryPulse: 70,
          nextActionCategory: 'ROUTINE',
          decisionJson: '{"protocol":"community-bp-screening","version":"1"}',
          vitalsReadings: [
            {
              id: parseEntityId(ids.bloodPressure),
              sequenceNumber: 1,
              systolic: 120,
              diastolic: 80,
              pulse: 70,
              arm: 'RIGHT_ARM',
              bodyPosition: 'SITTING',
              measuredAt: now
            }
          ],
          lifestyleLogs: [],
          foodLogs: [],
          otcLogs: []
        })
      )

      expect(result).toEqual({ status: 'VERSION_CONFLICT' })
      expect(readCount(connection, 'blood_pressure_readings')).toBe(0)
      expect(
        connection
          .prepare('SELECT status FROM screening_encounters WHERE id = ?')
          .get(ids.encounter)
      ).toEqual({ status: 'DRAFT' })
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd050-completion-repository-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seedCoreGraph(connection)
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function seedCoreGraph(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.user, 'admin', 'admin', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.location,
      'Test Location',
      'test location',
      'COMMUNITY_SITE',
      ids.user,
      now,
      ids.user,
      now
    )
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.patient,
      'TEST-1',
      'Test Patient',
      'test patient',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      ids.session,
      ids.location,
      protocolId,
      '2026-08-20',
      'OPEN',
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      "INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, amendment_of_encounter_id, amendment_reason, void_reason, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, 1, ?, ?)"
    )
    .run(ids.encounter, ids.patient, ids.session, ids.location, protocolId, now, ids.user, now, now)
}

function readCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }
  return row.count
}
