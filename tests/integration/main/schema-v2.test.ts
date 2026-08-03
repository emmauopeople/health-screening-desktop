import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createProductionDatabaseMigrationRunner } from '@main/database'

const now = '2026-08-03T00:00:00.000Z'

const schemaVersion2Indexes = Object.freeze([
  'ix_patients_approximate_age',
  'ix_patients_code_name',
  'ix_patients_date_of_birth',
  'ix_patients_residence_search',
  'ux_patient_identifiers_active_local_code'
])

const schemaVersion2Triggers = Object.freeze([
  'patients_hsd025_identity_insert',
  'patients_hsd025_identity_update'
])

describe('schema version 2', () => {
  it('adds the HSD-025 patient registry objects without rewriting schema version 1', async () => {
    await withMigratedDatabase((connection) => {
      expect(readUserVersion(connection)).toBe(2)
      expect(readLedgerNames(connection)).toEqual(['initial-schema', 'patient-registry'])
      expect(readStrictByTable(connection).get('local_sequences')).toBe(1)
      expect(readLocalSequenceValue(connection, 'patient_code')).toBe(1)
      expect(readColumnType(connection, 'patient_identifiers', 'status')).toBe('TEXT')

      const indexNames = readObjectNames(connection, 'index')
      const triggerNames = readObjectNames(connection, 'trigger')

      for (const indexName of schemaVersion2Indexes) {
        expect(indexNames).toContain(indexName)
      }

      for (const triggerName of schemaVersion2Triggers) {
        expect(triggerNames).toContain(triggerName)
      }
    })
  })

  it('enforces active patient identity and active local identifier uniqueness', async () => {
    await withMigratedDatabase((connection) => {
      insertUser(connection, '00000000-0000-4000-8000-000000000001')

      expect(() =>
        insertPatient(connection, {
          id: '00000000-0000-4000-8000-000000000101',
          code: 'PT-000101',
          givenName: 'No',
          familyName: 'Age',
          dateOfBirth: null,
          approximateAgeYears: null,
          approximateAgeAsOfDate: null
        })
      ).toThrow()

      expect(() =>
        insertPatient(connection, {
          id: '00000000-0000-4000-8000-000000000102',
          code: 'PT-000102',
          givenName: 'Both',
          familyName: 'Ages',
          dateOfBirth: '2000-01-01',
          approximateAgeYears: 25,
          approximateAgeAsOfDate: '2026-08-03'
        })
      ).toThrow()

      insertPatient(connection, {
        id: '00000000-0000-4000-8000-000000000201',
        code: 'PT-000201',
        givenName: 'Dora',
        familyName: 'Birth',
        dateOfBirth: '1998-04-02',
        approximateAgeYears: null,
        approximateAgeAsOfDate: null
      })
      insertPatient(connection, {
        id: '00000000-0000-4000-8000-000000000202',
        code: 'PT-000202',
        givenName: 'Amos',
        familyName: 'Approx',
        dateOfBirth: null,
        approximateAgeYears: 46,
        approximateAgeAsOfDate: '2026-08-03'
      })

      expect(() =>
        connection
          .prepare('UPDATE patients SET approximate_age_years = 28 WHERE id = ?')
          .run('00000000-0000-4000-8000-000000000201')
      ).toThrow()

      insertIdentifier(connection, {
        id: '00000000-0000-4000-8000-000000000301',
        patientId: '00000000-0000-4000-8000-000000000201',
        value: 'PT-000201',
        status: 'ACTIVE'
      })

      expect(() =>
        insertIdentifier(connection, {
          id: '00000000-0000-4000-8000-000000000302',
          patientId: '00000000-0000-4000-8000-000000000202',
          value: 'PT-000201',
          status: 'ACTIVE'
        })
      ).toThrow()

      expect(() =>
        insertIdentifierWithRawStatus(connection, {
          id: '00000000-0000-4000-8000-000000000303',
          patientId: '00000000-0000-4000-8000-000000000202',
          value: 'PT-000202',
          status: 'UNKNOWN'
        })
      ).toThrow()
    })
  })
})

async function withMigratedDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd025-schema-v2-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: { now: () => now }
    })(connection)
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

function readLedgerNames(connection: Database.Database): string[] {
  return (
    connection.prepare('SELECT name FROM schema_migrations ORDER BY version').all() as Array<{
      name: string
    }>
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

function readLocalSequenceValue(connection: Database.Database, key: string): number {
  const row = connection
    .prepare('SELECT next_value FROM local_sequences WHERE key = ?')
    .get(key) as {
    next_value: number
  }

  return row.next_value
}

function readColumnType(
  connection: Database.Database,
  tableName: string,
  columnName: string
): string | null {
  const rows = connection
    .prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`)
    .all() as Array<{
    name: string
    type: string
  }>

  return rows.find((row) => row.name === columnName)?.type ?? null
}

function readObjectNames(connection: Database.Database, type: 'index' | 'trigger'): string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = ?
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all(type) as Array<{ name: string }>
  ).map((row) => row.name)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function insertUser(connection: Database.Database, id: string): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(id, 'admin', 'admin', 'Administrator', 'hash', 'salt', now, now)
}

function insertPatient(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly code: string
    readonly givenName: string
    readonly familyName: string
    readonly dateOfBirth: string | null
    readonly approximateAgeYears: number | null
    readonly approximateAgeAsOfDate: string | null
  }
): void {
  const displayName = `${input.givenName} ${input.familyName}`

  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        other_names,
        name_normalized,
        sex,
        date_of_birth,
        approximate_age_years,
        age_as_of_date,
        village,
        quarter,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'UNKNOWN', ?, ?, ?, 'Village', NULL, 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.code,
      displayName,
      input.givenName,
      input.familyName,
      displayName.toLocaleLowerCase('en-US'),
      input.dateOfBirth,
      input.approximateAgeYears,
      input.approximateAgeAsOfDate,
      '00000000-0000-4000-8000-000000000001',
      now,
      '00000000-0000-4000-8000-000000000001',
      now
    )
}

function insertIdentifier(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly patientId: string
    readonly value: string
    readonly status: 'ACTIVE' | 'INACTIVE'
  }
): void {
  connection
    .prepare(
      `INSERT INTO patient_identifiers (
        id,
        patient_id,
        identifier_type,
        issuer,
        identifier_value,
        is_primary,
        valid_from,
        valid_to,
        created_by,
        created_at,
        status
      ) VALUES (?, ?, 'LOCAL_PATIENT_CODE', 'LOCAL', ?, 1, ?, NULL, ?, ?, ?)`
    )
    .run(
      input.id,
      input.patientId,
      input.value,
      now,
      '00000000-0000-4000-8000-000000000001',
      now,
      input.status
    )
}

function insertIdentifierWithRawStatus(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly patientId: string
    readonly value: string
    readonly status: string
  }
): void {
  connection
    .prepare(
      `INSERT INTO patient_identifiers (
        id,
        patient_id,
        identifier_type,
        issuer,
        identifier_value,
        is_primary,
        valid_from,
        valid_to,
        created_by,
        created_at,
        status
      ) VALUES (?, ?, 'LOCAL_PATIENT_CODE', 'LOCAL', ?, 1, ?, NULL, ?, ?, ?)`
    )
    .run(
      input.id,
      input.patientId,
      input.value,
      now,
      '00000000-0000-4000-8000-000000000001',
      now,
      input.status
    )
}
