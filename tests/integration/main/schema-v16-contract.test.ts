import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion16 } from '@main/database/migrations/schema-v16-contract'

const now = '2026-08-24T12:00:00.000Z'
const ids = {
  installation: '53000000-0000-4000-8000-000000000001',
  user: '53000000-0000-4000-8000-000000000002',
  location: '53000000-0000-4000-8000-000000000003',
  patient: '53000000-0000-4000-8000-000000000004',
  session: '53000000-0000-4000-8000-000000000005',
  firstEncounter: '53000000-0000-4000-8000-000000000006',
  secondEncounter: '53000000-0000-4000-8000-000000000007',
  draftEncounter: '53000000-0000-4000-8000-000000000008',
  duplicateDraft: '53000000-0000-4000-8000-000000000009'
} as const

describe('schema version 16 repeat screening encounter contract', () => {
  it('upgrades v15 and permits completed history plus only one active draft per patient/session', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 15)
      seedGraph(connection)
      insertEncounter(connection, ids.firstEncounter, 'COMPLETED')

      migrateToVersion(connection, 16)

      expect(() => validateSchemaVersion16(connection, 'compatibility')).not.toThrow()
      insertEncounter(connection, ids.secondEncounter, 'COMPLETED')
      insertEncounter(connection, ids.draftEncounter, 'DRAFT')
      expect(() => insertEncounter(connection, ids.duplicateDraft, 'DRAFT')).toThrow(
        /UNIQUE constraint failed/u
      )
      expect(
        connection
          .prepare('SELECT id, status FROM screening_encounters WHERE patient_id = ? ORDER BY id')
          .all(ids.patient)
      ).toEqual([
        { id: ids.firstEncounter, status: 'COMPLETED' },
        { id: ids.secondEncounter, status: 'COMPLETED' },
        { id: ids.draftEncounter, status: 'DRAFT' }
      ])
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-repeat-screening-v16-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToVersion(connection: Database.Database, version: 15 | 16): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}

function seedGraph(connection: Database.Database): void {
  const protocol = (
    connection.prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE'").get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'Test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.user, 'tester', 'tester', 'Tester', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
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
      protocol,
      '2026-08-24',
      'OPEN',
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now
    )
}

function insertEncounter(
  connection: Database.Database,
  encounterId: string,
  status: 'DRAFT' | 'COMPLETED'
): void {
  const protocol = (
    connection
      .prepare('SELECT protocol_version_id FROM screening_sessions WHERE id = ?')
      .get(ids.session) as {
      protocol_version_id: string
    }
  ).protocol_version_id
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounterId,
      ids.patient,
      ids.session,
      ids.location,
      protocol,
      status,
      now,
      status === 'COMPLETED' ? now : null,
      'LOCAL',
      ids.user,
      now,
      now
    )
}
