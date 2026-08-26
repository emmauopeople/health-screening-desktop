import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createReferralRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-20T12:00:00.000Z' as UtcTimestamp
const ids = Object.freeze({
  installation: '61000000-0000-4000-8000-000000000001',
  user: '61000000-0000-4000-8000-000000000002',
  location: '61000000-0000-4000-8000-000000000003',
  patient: '61000000-0000-4000-8000-000000000004',
  session: '61000000-0000-4000-8000-000000000005',
  encounter: '61000000-0000-4000-8000-000000000006',
  referral: '61000000-0000-4000-8000-000000000007',
  history: '61000000-0000-4000-8000-000000000008',
  outbox: '61000000-0000-4000-8000-000000000009'
})

describe('referral repository', () => {
  it('atomically creates an automatic referral, initial history, and sync outbox record', async () => {
    await withDatabase((connection, protocolId) => {
      const repository = createReferralRepository(connection)
      const transactionExecutor = createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => ids.referral),
        clock: createUtcClock(() => now)
      })
      const input = {
        id: parseEntityId(ids.referral),
        statusHistoryId: parseEntityId(ids.history),
        outboxId: parseEntityId(ids.outbox),
        patientId: parseEntityId(ids.patient),
        encounterId: parseEntityId(ids.encounter),
        protocolVersionId: parseEntityId(protocolId),
        reasonCode: 'BP_SCREENING_REFERRAL' as const,
        urgency: 'STANDARD' as const,
        dueDate: '2026-09-03',
        actorId: parseEntityId(ids.user),
        createdAt: now
      }

      const first = transactionExecutor.run((context) =>
        repository.createAutomaticReferral(context.connection, input)
      )
      const second = transactionExecutor.run((context) =>
        repository.createAutomaticReferral(context.connection, input)
      )

      expect(first).toMatchObject({
        status: 'CREATED',
        referral: { id: ids.referral, status: 'OPEN', urgency: 'STANDARD', recordVersion: 1 }
      })
      expect(second).toMatchObject({ status: 'EXISTING', referral: { id: ids.referral } })
      expect(readCount(connection, 'referrals')).toBe(1)
      expect(readCount(connection, 'referral_status_history')).toBe(1)
      expect(readCount(connection, 'sync_outbox')).toBe(1)
      expect(
        connection
          .prepare(
            'SELECT aggregate_type, aggregate_id, operation, payload_schema_version FROM sync_outbox WHERE id = ?'
          )
          .get(ids.outbox)
      ).toEqual({
        aggregate_type: 'REFERRAL',
        aggregate_id: ids.referral,
        operation: 'REFERRAL_CREATED',
        payload_schema_version: 'referral.created.v1'
      })
      expect(connection.pragma('foreign_key_check')).toEqual([])
    })
  })
})

async function withDatabase(
  test: (connection: Database.Database, protocolId: string) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd057a-referral-repository-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    const protocolId = seedCoreGraph(connection)
    test(connection, protocolId)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function seedCoreGraph(connection: Database.Database): string {
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
      .get() as { id: string }
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
  return protocolId
}

function readCount(connection: Database.Database, tableName: string): number {
  return (
    connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
  ).count
}
