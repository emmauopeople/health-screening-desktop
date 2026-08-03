import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import {
  createSchemaMigrationsTableSql,
  schemaVersion1NamedIndexes,
  schemaVersion1TableContracts,
  schemaVersion1TableNames,
  type SchemaVersion1ColumnContract,
  validateSchemaVersion1
} from '@main/database/migrations/schema-v1-contract'

const now = '2026-07-29T00:00:00Z'

describe('schema version 1', () => {
  it('creates exactly the required empty strict tables and named indexes', async () => {
    await withMigratedDatabase((connection) => {
      expect(readUserVersion(connection)).toBe(1)
      expect(readTableNames(connection)).toEqual([...schemaVersion1TableNames])
      expect(readNamedIndexNames(connection)).toEqual([...schemaVersion1NamedIndexes])

      const strictByTable = readStrictByTable(connection)

      for (const tableName of schemaVersion1TableNames) {
        expect(strictByTable.get(tableName)).toBe(1)
      }

      for (const tableName of schemaVersion1TableNames) {
        const rowCount = readTableCount(connection, tableName)

        expect(rowCount).toBe(tableName === 'schema_migrations' ? 1 : 0)
      }
    })
  })

  it('matches exact ordered table_xinfo metadata for every required table', async () => {
    await withMigratedDatabase((connection) => {
      for (const tableContract of schemaVersion1TableContracts) {
        expect(readTableXInfo(connection, tableContract.name)).toEqual(tableContract.columns)
      }
    })
  })

  it('keeps the exact schema_migrations structure and constraints', async () => {
    await withMigratedDatabase((connection) => {
      expect(normalizeSchemaSql(readCreateTableSql(connection, 'schema_migrations'))).toBe(
        normalizeSchemaSql(createSchemaMigrationsTableSql)
      )

      expect(() =>
        connection
          .prepare(
            `INSERT INTO schema_migrations (
              version,
              name,
              checksum,
              applied_at,
              application_version
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(0, 'zero', 'a'.repeat(64), now, '1.0.0')
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO schema_migrations (
              version,
              name,
              checksum,
              applied_at,
              application_version
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(2, 'bad-checksum', 'short', now, '1.0.0')
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO schema_migrations (
              version,
              name,
              checksum,
              applied_at,
              application_version
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(2, 'initial-schema', 'b'.repeat(64), now, '1.0.0')
      ).toThrow()
    })
  })

  it('enforces foreign keys, restrict deletes, checks, and JSON constraints', async () => {
    await withMigratedDatabase((connection) => {
      expect(connection.pragma('foreign_keys', { simple: true })).toBe(1)
      insertValidGraph(connection)

      expect(() =>
        connection
          .prepare(
            `INSERT INTO locations (
              id,
              name,
              name_normalized,
              location_type,
              is_active,
              created_by,
              created_at,
              updated_by,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            'missing-user-location',
            'Missing',
            'missing',
            'COMMUNITY',
            1,
            'missing',
            now,
            'user-1',
            now
          )
      ).toThrow()

      expect(() => connection.prepare("DELETE FROM users WHERE id = 'user-1'").run()).toThrow()
      expect(() => insertUser(connection, 'bad-role', 'bad-role', 'NOT_A_ROLE')).toThrow()
      expect(() =>
        insertUser(connection, 'bad-active', 'bad-active', 'NURSE', {
          isActive: 2
        })
      ).toThrow()
      expect(() =>
        insertUser(connection, 'bad-failure-count', 'bad-failure-count', 'NURSE', {
          failedLoginCount: -1
        })
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO app_settings (
              key,
              value_json,
              updated_at,
              sensitivity_classification
            ) VALUES (?, ?, ?, ?)`
          )
          .run('invalid-json', '{invalid', now, 'STANDARD')
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO sync_outbox (
              id,
              aggregate_type,
              aggregate_id,
              operation,
              payload_json,
              payload_schema_version,
              created_at,
              status,
              attempt_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('outbox-invalid', 'patient', 'patient-1', 'UPSERT', '{}', '1', now, 'UNKNOWN', 0)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO sync_outbox (
              id,
              aggregate_type,
              aggregate_id,
              operation,
              payload_json,
              payload_schema_version,
              created_at,
              status,
              attempt_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('outbox-negative', 'patient', 'patient-1', 'UPSERT', '{}', '1', now, 'PENDING', -1)
      ).toThrow()

      expect(() => insertUser(connection, 'nurse-1', 'nurse-1', 'NURSE')).not.toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO app_settings (
              key,
              value_json,
              updated_at,
              sensitivity_classification
            ) VALUES (?, ?, ?, ?)`
          )
          .run('valid-json', '{"enabled":true}', now, 'STANDARD')
      ).not.toThrow()
    })
  })

  it('enforces required uniqueness for planned access patterns', async () => {
    await withMigratedDatabase((connection) => {
      insertValidGraph(connection)

      expect(() => insertUser(connection, 'dupe-user', 'admin', 'NURSE')).toThrow()
      expect(() => insertPatient(connection, 'patient-2', 'P-001')).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO patient_identifiers (
              id,
              patient_id,
              identifier_type,
              issuer,
              identifier_value,
              is_primary,
              created_by,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('identifier-2', 'patient-1', 'LOCAL', 'HSD', 'P-001', 0, 'user-1', now)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO screening_sessions (
              id,
              location_id,
              protocol_version_id,
              session_date,
              status,
              created_by,
              created_at,
              opened_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            'session-2',
            'location-1',
            'protocol-1',
            '2026-07-29',
            'OPEN',
            'user-1',
            now,
            now,
            now
          )
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            `INSERT INTO blood_pressure_readings (
              id,
              encounter_id,
              sequence_number,
              systolic,
              diastolic,
              measured_at,
              status,
              source_type,
              recorded_by,
              recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('bp-2', 'encounter-1', 1, 121, 81, now, 'ACTIVE', 'LOCAL', 'user-1', now)
      ).toThrow()
    })
  })
})

async function withMigratedDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd007-schema-v1-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    runDatabaseMigrations({
      connection,
      migrations: [databaseMigrations[0]!],
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: { now: () => '2026-07-29T00:00:00.000Z' },
      expectedHighestVersion: 1,
      schemaValidators: new Map([[1, validateSchemaVersion1]])
    })
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function readTableNames(connection: Database.Database): string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function readNamedIndexNames(connection: Database.Database): string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function readStrictByTable(connection: Database.Database): Map<string, number> {
  const rows = connection.prepare('PRAGMA table_list').all() as Array<{
    schema: string
    name: string
    type: string
    strict: number
  }>

  return new Map(
    rows
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [row.name, row.strict])
  )
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return row.count
}

function readTableXInfo(
  connection: Database.Database,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
  return (
    connection.prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`).all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
      hidden: number
    }>
  ).map((row) => ({
    name: row.name,
    type: row.type as SchemaVersion1ColumnContract['type'],
    notNull: row.notnull as SchemaVersion1ColumnContract['notNull'],
    primaryKey: row.pk,
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: row.hidden
  }))
}

function readCreateTableSql(connection: Database.Database, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string }

  return row.sql
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}

function insertValidGraph(connection: Database.Database): void {
  insertUser(connection, 'user-1', 'admin', 'LOCAL_ADMIN')

  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'location-1',
      'Central Church',
      'central church',
      'CHURCH',
      1,
      'user-1',
      now,
      'user-1',
      now
    )

  connection
    .prepare(
      `INSERT INTO protocol_versions (
        id,
        protocol_key,
        version_label,
        status,
        configuration_json,
        checksum,
        imported_by,
        imported_at,
        activated_by,
        activated_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'protocol-1',
      'bp-screening',
      'v1',
      'ACTIVE',
      '{}',
      'protocol-checksum',
      'user-1',
      now,
      'user-1',
      now,
      now
    )

  insertPatient(connection, 'patient-1', 'P-001')

  connection
    .prepare(
      `INSERT INTO patient_identifiers (
        id,
        patient_id,
        identifier_type,
        issuer,
        identifier_value,
        is_primary,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('identifier-1', 'patient-1', 'LOCAL', 'HSD', 'P-001', 1, 'user-1', now)

  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        created_by,
        created_at,
        opened_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('session-1', 'location-1', 'protocol-1', '2026-07-29', 'OPEN', 'user-1', now, now, now)

  connection
    .prepare(
      `INSERT INTO screening_encounters (
        id,
        patient_id,
        screening_session_id,
        location_id,
        protocol_version_id,
        status,
        started_at,
        source_type,
        recorded_by,
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'encounter-1',
      'patient-1',
      'session-1',
      'location-1',
      'protocol-1',
      'DRAFT',
      now,
      'LOCAL',
      'user-1',
      1,
      now,
      now
    )

  connection
    .prepare(
      `INSERT INTO blood_pressure_readings (
        id,
        encounter_id,
        sequence_number,
        systolic,
        diastolic,
        measured_at,
        status,
        source_type,
        recorded_by,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('bp-1', 'encounter-1', 1, 120, 80, now, 'ACTIVE', 'LOCAL', 'user-1', now)
}

function insertUser(
  connection: Database.Database,
  id: string,
  usernameNormalized: string,
  role: string,
  options: { isActive?: number; failedLoginCount?: number } = {}
): void {
  connection
    .prepare(
      `INSERT INTO users (
        id,
        username,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        role,
        is_active,
        must_change_password,
        failed_login_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      usernameNormalized,
      usernameNormalized,
      usernameNormalized,
      'hash',
      'salt',
      role,
      options.isActive ?? 1,
      0,
      options.failedLoginCount ?? 0,
      now,
      now
    )
}

function insertPatient(connection: Database.Database, id: string, patientCode: string): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        name_normalized,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, patientCode, 'Patient One', `patient ${id}`, 'ACTIVE', 'user-1', now, 'user-1', now)
}
