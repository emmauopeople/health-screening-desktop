import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { MigrationCompatibilityError } from '@main/database'
import { validateSchemaVersion11 } from '@main/database/migrations'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'

const now = '2026-08-10T12:00:00.000Z'

describe('schema version 11 compatibility contract', () => {
  it('accepts fresh and upgraded schema version 11 databases with clean integrity checks', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)

      expect(() => validateSchemaVersion11(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })

    await withDatabase((connection) => {
      runDatabaseMigrations({
        connection,
        migrations: databaseMigrations.slice(0, 10),
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: { now: () => now },
        expectedHighestVersion: 10
      })

      migrateToCurrent(connection)

      expect(() => validateSchemaVersion11(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('rejects a missing required bounds trigger', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      connection.exec('DROP TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert')

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects an altered required bounds trigger', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      connection.exec(`
        DROP TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert;
        CREATE TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert
        BEFORE INSERT ON screening_vitals_draft_readings
        FOR EACH ROW
        WHEN NEW.systolic IS NOT NULL AND NEW.systolic > 299
        BEGIN
          SELECT RAISE(ABORT, 'systolic out of range');
        END;
      `)

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects an extra trigger', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      connection.exec(`
        CREATE TRIGGER ck_screening_vitals_draft_readings_extra
        BEFORE INSERT ON screening_vitals_draft_readings
        FOR EACH ROW
        BEGIN
          SELECT NEW.id;
        END;
      `)

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects missing inherited foreign keys and table constraints', async () => {
    await withDatabase((connection) => {
      migrateToVersion10WithTransform(connection, 9, (sql) =>
        sql.replace(
          /,\s+CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY \(updated_by\)\s+REFERENCES users \(id\) ON UPDATE RESTRICT ON DELETE RESTRICT/,
          ''
        )
      )

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToVersion10WithTransform(connection, 9, (sql) =>
        sql.replace('period_start <= period_end', 'period_start < period_end')
      )

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects altered inherited response constraints and accepts no extra response codes', async () => {
    await withDatabase((connection) => {
      migrateToVersion10WithTransform(connection, 10, (sql) =>
        sql.replace(
          /sedentary_time_response IN \([^)]*\)/,
          "sedentary_time_response IN ('RECORDED', 'UNKNOWN')"
        )
      )

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToVersion10WithTransform(connection, 10, (sql) =>
        sql.replace(
          /other_activity_response IN \(([^)]*)\)/,
          "other_activity_response IN ($1, 'INVALID')"
        )
      )

      expect(() => validateSchemaVersion11(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('preserves a pre-v11 out-of-range reading through upgrade for later correction', async () => {
    await withDatabase((connection) => {
      runDatabaseMigrations({
        connection,
        migrations: databaseMigrations.slice(0, 10),
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: { now: () => now },
        expectedHighestVersion: 10
      })

      connection.pragma('foreign_keys = OFF')
      connection.exec(`
        INSERT INTO screening_vitals_drafts (
          id, encounter_id, status, weight_kg, waist_cm, notes,
          created_by, created_at, updated_by, updated_at, row_version
        ) VALUES ('legacy-draft', 'legacy-encounter', 'DRAFT', NULL, NULL, NULL,
          'legacy-user', '${now}', 'legacy-user', '${now}', 1);

        INSERT INTO screening_vitals_draft_readings (
          id, vitals_draft_id, sequence_number, systolic, diastolic, pulse,
          measurement_site, patient_position, measurement_time, created_at, updated_at
        ) VALUES ('legacy-reading', 'legacy-draft', 1, 301, 121, 302,
          NULL, NULL, NULL, '${now}', '${now}');
      `)
      connection.pragma('foreign_keys = ON')

      migrateToCurrent(connection)

      expect(
        connection
          .prepare(
            'SELECT systolic, diastolic, pulse FROM screening_vitals_draft_readings WHERE id = ?'
          )
          .get('legacy-reading')
      ).toEqual({ systolic: 301, diastolic: 121, pulse: 302 })
      expect(() => validateSchemaVersion11(connection, 'compatibility')).not.toThrow()
    })
  })

  it('enforces the systolic, diastolic, and pulse bounds at the database write boundary', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      connection.pragma('foreign_keys = OFF')
      connection.exec(`
        INSERT INTO screening_vitals_drafts (
          id, encounter_id, status, weight_kg, waist_cm, notes,
          created_by, created_at, updated_by, updated_at, row_version
        ) VALUES ('draft-1', 'encounter-1', 'DRAFT', NULL, NULL, NULL,
          'user-1', '${now}', 'user-1', '${now}', 1)
      `)

      const insert = connection.prepare(`
        INSERT INTO screening_vitals_draft_readings (
          id, vitals_draft_id, sequence_number, systolic, diastolic, pulse,
          measurement_site, patient_position, measurement_time, created_at, updated_at
        ) VALUES (?, 'draft-1', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      `)

      insert.run('reading-valid', 1, 1, 1, 1, now, now)
      expect(() => insert.run('reading-systolic-high', 2, 301, 1, 1, now, now)).toThrow()
      expect(() => insert.run('reading-diastolic-high', 3, 1, 121, 1, now, now)).toThrow()
      expect(() => insert.run('reading-pulse-high', 4, 1, 1, 301, now, now)).toThrow()

      expect(() =>
        connection
          .prepare('UPDATE screening_vitals_draft_readings SET systolic = 301 WHERE id = ?')
          .run('reading-valid')
      ).toThrow()
      expect(
        connection
          .prepare(
            'SELECT systolic, diastolic, pulse FROM screening_vitals_draft_readings WHERE id = ?'
          )
          .get('reading-valid')
      ).toEqual({ systolic: 1, diastolic: 1, pulse: 1 })
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd045-schema-v11-'))
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

function migrateToCurrent(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations,
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: 11
  })
}

function migrateToVersion10WithTransform(
  connection: Database.Database,
  version: 9 | 10,
  transform: (sql: string) => string
): void {
  const migrations = databaseMigrations
    .slice(0, 10)
    .map((migration) =>
      migration.version === version ? { ...migration, sql: transform(migration.sql) } : migration
    )

  runDatabaseMigrations({
    connection,
    migrations,
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: 10
  })

  connection.exec(databaseMigrations[10]!.sql)
}
