import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { MigrationCompatibilityError } from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion15 } from '@main/database/migrations/schema-v15-contract'

const now = '2026-08-20T12:00:00.000Z'

describe('schema version 15 encounter management contract', () => {
  it('accepts fresh schema version 15 databases with clean integrity', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 15)

      expect(() => validateSchemaVersion15(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('upgrades v14 without changing finalized clinical rows', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 14)
      seedCompletedEncounter(connection)
      const before = connection
        .prepare('SELECT * FROM blood_pressure_readings WHERE id = ?')
        .get('51000000-0000-4000-8000-000000000007')

      migrateToVersion(connection, 15)

      expect(
        connection
          .prepare('SELECT * FROM blood_pressure_readings WHERE id = ?')
          .get('51000000-0000-4000-8000-000000000007')
      ).toEqual(before)
      expect(() => validateSchemaVersion15(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it.each([
    [
      'altered addendum text limit',
      (sql: string) => sql.replace('length(note_text) <= 2000', 'length(note_text) <= 2500')
    ],
    ['extra review category', (sql: string) => sql.replace("'OTHER'", "'OTHER', 'UNVERIFIED'")],
    [
      'missing encounter foreign key',
      (sql: string) => removeConstraint(sql, 'fk_screening_encounter_addenda_encounter')
    ],
    [
      'weakened resolution pairing',
      (sql: string) => sql.replace('AND resolution_note IS NOT NULL', 'AND resolution_note IS NULL')
    ],
    [
      'extra management index',
      (sql: string) =>
        `${sql}\nCREATE INDEX ix_screening_encounter_addenda_extra ON screening_encounter_addenda (created_at);\n`
    ]
  ])('rejects %s', async (_name, transform) => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 14)
      const original = databaseMigrations[14]!.sql
      const mutated = transform(original)
      expect(mutated).not.toBe(original)
      connection.exec(mutated)

      expect(() => validateSchemaVersion15(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd051-schema-v15-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToVersion(connection: Database.Database, version: 14 | 15): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}

function removeConstraint(sql: string, constraintName: string): string {
  const pattern = new RegExp(
    `,\\r?\\n[ ]{2}CONSTRAINT ${constraintName}\\b[\\s\\S]*?(?=,\\r?\\n[ ]{2}CONSTRAINT|\\r?\\n\\) STRICT;)`,
    'u'
  )
  const next = sql.replace(pattern, '')
  if (next === sql) throw new Error(`Expected ${constraintName}`)
  return next
}

function seedCompletedEncounter(connection: Database.Database): void {
  const installation = '51000000-0000-4000-8000-000000000001'
  const user = '51000000-0000-4000-8000-000000000002'
  const location = '51000000-0000-4000-8000-000000000003'
  const patient = '51000000-0000-4000-8000-000000000004'
  const session = '51000000-0000-4000-8000-000000000005'
  const encounter = '51000000-0000-4000-8000-000000000006'
  const protocol = (
    connection.prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE'").get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(user, 'tester', 'tester', 'Test User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(location, 'Test Location', 'test location', 'COMMUNITY_SITE', user, now, user, now)
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(patient, 'TEST-1', 'Test Patient', 'test patient', 'ACTIVE', user, now, user, now)
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(session, location, protocol, '2026-08-20', 'OPEN', user, now, user, now, user, now)
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounter,
      patient,
      session,
      location,
      protocol,
      'COMPLETED',
      now,
      now,
      'LOCAL',
      user,
      now,
      now
    )
  connection
    .prepare(
      'INSERT INTO blood_pressure_readings (id, encounter_id, sequence_number, systolic, diastolic, pulse, measured_at, status, source_type, recorded_by, recorded_at) VALUES (?, ?, 1, 120, 80, 70, ?, ?, ?, ?, ?)'
    )
    .run(
      '51000000-0000-4000-8000-000000000007',
      encounter,
      now,
      'ACTIVE',
      'PATIENT_REPORTED',
      user,
      now
    )
}
