import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  createScreeningSessionSummaryRepository
} from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-28T10:00:00.000Z' as UtcTimestamp
const prefix = '71000000-0000-4000-8000-0000000000'
const id = (suffix: number): string => `${prefix}${String(suffix).padStart(2, '0')}`

describe('screening session summary repository', () => {
  it('separates draft operations and excludes voided encounters from clinical totals', async () => {
    await withDatabase((connection) => {
      const repository = createScreeningSessionSummaryRepository(connection)
      const summary = repository.getBySessionId(parseEntityId(id(4)))

      expect(summary).toMatchObject({
        sessionDate: '2026-08-28',
        status: 'OPEN',
        location: { name: 'Test Location' },
        openedBy: { displayName: 'Admin User' },
        operational: {
          totalEncounters: 5,
          activeDrafts: 1,
          emptyDrafts: 1,
          finalizedEncounters: 2,
          voidedEncounters: 1
        },
        recommendations: { routine: 1, standardReferral: 0, urgentReferral: 1 },
        referrals: { open: 1, closed: 0 }
      })
      expect(repository.getBySessionId(parseEntityId(id(99)))).toBeNull()
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd059a-session-summary-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seed(connection)
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function seed(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(id(1), 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(id(2), 'admin', 'admin', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(id(3), 'Test Location', 'test location', 'COMMUNITY_SITE', id(2), now, id(2), now)
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as { id: string }
  ).id
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(id(4), id(3), protocolId, '2026-08-28', 'OPEN', id(2), now, id(2), now, id(2), now)

  const statuses = ['DRAFT', 'DRAFT', 'COMPLETED', 'COMPLETED', 'VOID'] as const
  const actions = [null, null, 'ROUTINE', 'URGENT_REFERRAL', 'URGENT_REFERRAL'] as const
  for (let index = 0; index < statuses.length; index += 1) {
    const patientId = id(10 + index)
    const encounterId = id(20 + index)
    connection
      .prepare(
        'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        patientId,
        `TEST-${index}`,
        `Patient ${index}`,
        `patient ${index}`,
        'ACTIVE',
        id(2),
        now,
        id(2),
        now
      )
    connection
      .prepare(
        'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, summary_systolic, summary_diastolic, summary_pulse, next_action_category, amendment_of_encounter_id, amendment_reason, void_reason, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)'
      )
      .run(
        encounterId,
        patientId,
        id(4),
        id(3),
        protocolId,
        statuses[index],
        now,
        statuses[index] === 'DRAFT' ? null : now,
        'LOCAL',
        id(2),
        actions[index] === null ? null : 150,
        actions[index] === null ? null : 95,
        actions[index] === null ? null : 80,
        actions[index],
        statuses[index] === 'VOID' ? 'test void' : null,
        now,
        now
      )
  }
  connection
    .prepare(
      "INSERT INTO blood_pressure_readings (id, encounter_id, sequence_number, systolic, diastolic, pulse, measured_at, status, source_type, recorded_by, recorded_at) VALUES (?, ?, 1, 130, 85, 72, ?, 'ACTIVE', 'LOCAL', ?, ?)"
    )
    .run(id(30), id(21), now, id(2), now)
  insertReferral(connection, protocolId, id(31), id(13), id(23), 'OPEN')
  insertReferral(connection, protocolId, id(32), id(14), id(24), 'CLOSED')
}

function insertReferral(
  connection: Database.Database,
  protocolId: string,
  referralId: string,
  patientId: string,
  encounterId: string,
  status: 'OPEN' | 'CLOSED'
): void {
  connection
    .prepare(
      'INSERT INTO referrals (id, patient_id, encounter_id, protocol_version_id, reason_codes_json, urgency, status, created_by, created_at, closed_by, closed_at, closure_reason, record_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
    )
    .run(
      referralId,
      patientId,
      encounterId,
      protocolId,
      '["BP_SCREENING_REFERRAL"]',
      'URGENT',
      status,
      id(2),
      now,
      status === 'CLOSED' ? id(2) : null,
      status === 'CLOSED' ? now : null,
      status === 'CLOSED' ? 'Resolved' : null,
      now
    )
}
