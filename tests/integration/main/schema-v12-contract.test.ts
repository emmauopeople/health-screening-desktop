import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { MigrationCompatibilityError } from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion12 } from '@main/database/migrations/schema-v12-contract'

const now = '2026-08-10T12:00:00.000Z'
const ids = Object.freeze({
  installation: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  user: '11111111-1111-4111-8111-111111111111',
  location: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  session: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  patient: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  encounter: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  draft: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherActivity: '14141414-1414-4141-8141-141414141414'
})

describe('schema version 12 optional Other Activity description contract', () => {
  it('accepts fresh schema version 12 databases with exact schema and clean integrity checks', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 12)

      expect(() => validateSchemaVersion12(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('upgrades schema v11 data without rewriting existing Other Activity rows or breaking foreign keys', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 11)
      seedVersion11LifestyleGraph(connection)
      const before = readOtherActivityRow(connection)

      migrateToVersion(connection, 12)

      const after = readOtherActivityRow(connection)
      expect(after).toEqual(before)
      expect(after.description).toBe('Existing row')
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(() => validateSchemaVersion12(connection, 'compatibility')).not.toThrow()
    })
  })

  it.each([
    [
      'description incorrectly restored as NOT NULL',
      (sql: string) => sql.replace('description TEXT NULL', 'description TEXT NOT NULL')
    ],
    [
      'nullable description with the non-null text constraint removed',
      (sql: string) =>
        sql.replace(
          /[ ]{2}CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank\r?\n[ ]{4}CHECK \(description IS NULL OR TRIM\(description\) != ''\),\r?\n/u,
          ''
        )
    ],
    [
      'altered non-null description text contract',
      (sql: string) => sql.replace("TRIM(description) != ''", "description != ''")
    ],
    [
      'missing inherited foreign key',
      (sql: string) =>
        sql.replace(
          /[ ]{2}CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY \(updated_by\)\r?\n[ ]{4}REFERENCES users \(id\) ON UPDATE RESTRICT ON DELETE RESTRICT,\r?\n/u,
          ''
        )
    ],
    [
      'altered inherited table constraint',
      (sql: string) =>
        sql.replace(
          'days_in_past_seven_days BETWEEN 1 AND 7',
          'days_in_past_seven_days BETWEEN 0 AND 7'
        )
    ],
    [
      'altered column contract',
      (sql: string) => sql.replace('intensity TEXT NOT NULL', 'intensity TEXT NULL')
    ]
  ])('rejects %s', async (_caseName, transform) => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 11)
      connection.exec(transform(databaseMigrations[11]!.sql))

      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects missing or extra named indexes and triggers', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      connection.exec('DROP INDEX ix_lifestyle_other_activity_rows_draft')

      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      connection.exec(
        'CREATE INDEX ix_lifestyle_other_activity_rows_extra ON lifestyle_other_activity_rows (category)'
      )

      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      connection.exec('DROP TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert')

      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      connection.exec(`
        CREATE TRIGGER ck_lifestyle_other_activity_rows_extra
        BEFORE INSERT ON lifestyle_other_activity_rows
        FOR EACH ROW
        BEGIN
          SELECT NEW.id;
        END;
      `)

      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('accepts NULL and valid non-null descriptions and rejects invalid blank descriptions', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      seedVersion11LifestyleGraph(connection)

      insertOtherActivityDescription(connection, 2, null)
      insertOtherActivityDescription(connection, 3, 'Community gardening')
      expect(() => insertOtherActivityDescription(connection, 4, '')).toThrow()
      expect(() => insertOtherActivityDescription(connection, 5, '   ')).toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd046-schema-v12-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    connection.pragma('journal_mode = WAL')
    connection.pragma('synchronous = NORMAL')
    connection.pragma('busy_timeout = 5000')
    connection.pragma('trusted_schema = OFF')
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToVersion(connection: Database.Database, version: 11 | 12): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}

function seedVersion11LifestyleGraph(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.user, 'tester', 'tester', 'Test User', 'hash', 'salt', 'TRAINED_SCREENER', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(ids.location, 'Test Location', 'test location', 'CLINIC', ids.user, now, ids.user, now)
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
      '2026-08-10',
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
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      ids.encounter,
      ids.patient,
      ids.session,
      ids.location,
      protocolId,
      'DRAFT',
      now,
      'LOCAL',
      ids.user,
      now,
      now
    )
  connection
    .prepare(
      'INSERT INTO lifestyle_drafts (id, encounter_id, status, patient_id, screening_session_id, location_id, installation_id, period_start, period_end, alcohol_baseline_version_id, tobacco_baseline_version_id, work_baseline_version_id, created_by, created_at, updated_by, updated_at, row_version, other_activity_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.draft,
      ids.encounter,
      'DRAFT',
      ids.patient,
      ids.session,
      ids.location,
      ids.installation,
      '2026-08-04',
      '2026-08-10',
      null,
      null,
      null,
      ids.user,
      now,
      ids.user,
      now,
      1,
      'YES'
    )
  insertOtherActivityDescription(connection, 1, 'Existing row', ids.otherActivity)
}

function insertOtherActivityDescription(
  connection: Database.Database,
  sequenceNumber: number,
  description: string | null,
  id = `14141414-1414-4141-8141-${String(sequenceNumber).padStart(12, '0')}`
): void {
  connection
    .prepare(
      'INSERT INTO lifestyle_other_activity_rows (id, lifestyle_draft_id, sequence_number, category, description, days_in_past_seven_days, average_minutes_per_day, intensity, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      id,
      ids.draft,
      sequenceNumber,
      'COMMUNITY',
      description,
      2,
      45,
      'MODERATE',
      ids.user,
      now,
      ids.user,
      now
    )
}

function readOtherActivityRow(connection: Database.Database): Record<string, unknown> {
  return connection
    .prepare('SELECT * FROM lifestyle_other_activity_rows WHERE id = ?')
    .get(ids.otherActivity) as Record<string, unknown>
}
