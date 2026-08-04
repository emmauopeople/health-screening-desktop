import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError,
  MigrationExecutionError
} from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import {
  createSchemaMigrationsTableSql,
  type SchemaVersion1ColumnContract
} from '@main/database/migrations/schema-v1-contract'
import {
  schemaVersion3NamedIndexes,
  schemaVersion3TableContracts,
  schemaVersion3TableNames,
  schemaVersion3TriggerNames,
  validateSchemaVersion3
} from '@main/database/migrations'

const now = '2026-07-29T00:00:00Z'
const registryAcknowledgmentType = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'

const demographicAmendmentFields = Object.freeze([
  'given_name',
  'family_name',
  'other_names',
  'date_of_birth',
  'approximate_age_years',
  'age_as_of_date',
  'sex',
  'village',
  'quarter',
  'phone',
  'alternate_contact_name',
  'alternate_contact_phone',
  'residence_notes',
  'status'
] as const)

const prohibitedDemographicAmendmentFields = Object.freeze([
  'id',
  'patient_id',
  'patient_code',
  'display_name',
  'name_normalized',
  'phone_normalized',
  'acknowledgment_status',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'row_version'
] as const)

describe('schema version 3', () => {
  it('creates exactly the required empty strict tables and named indexes', async () => {
    await withMigratedDatabase((connection) => {
      expect(readUserVersion(connection)).toBe(3)
      expect(readTableNames(connection)).toEqual([...schemaVersion3TableNames])
      expect(readNamedIndexNames(connection)).toEqual([...schemaVersion3NamedIndexes])
      expect(readTriggerNames(connection)).toEqual([...schemaVersion3TriggerNames])

      const strictByTable = readStrictByTable(connection)

      for (const tableName of schemaVersion3TableNames) {
        expect(strictByTable.get(tableName)).toBe(1)
      }

      for (const tableName of schemaVersion3TableNames) {
        const rowCount = readTableCount(connection, tableName)

        expect(rowCount).toBe(
          tableName === 'schema_migrations' ? 3 : tableName === 'patient_local_sequence' ? 1 : 0
        )
      }
    })
  })

  it('matches exact ordered table_xinfo metadata for every required table', async () => {
    await withMigratedDatabase((connection) => {
      for (const tableContract of schemaVersion3TableContracts) {
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

  it('enforces demographic amendment header constraints and foreign keys', async () => {
    await withMigratedDatabase((connection) => {
      insertValidGraph(connection)

      expect(() => insertValidAmendment(connection)).not.toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-bad-version',
          priorRowVersion: 1,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-bad-reason',
          priorRowVersion: 2,
          resultingRowVersion: 3,
          reasonCode: 'NOT_A_REASON'
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-other-null',
          priorRowVersion: 3,
          resultingRowVersion: 4,
          reasonCode: 'OTHER',
          reasonNote: null
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-other-blank',
          priorRowVersion: 3,
          resultingRowVersion: 4,
          reasonCode: 'OTHER',
          reasonNote: '   '
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-dupe-version'
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-missing-patient',
          patientId: 'missing-patient',
          priorRowVersion: 2,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertValidAmendment(connection, {
          id: 'amendment-missing-user',
          priorRowVersion: 2,
          resultingRowVersion: 3,
          amendedBy: 'missing-user'
        })
      ).toThrow()
    })
  })

  it('enforces demographic amendment changed-field constraints', async () => {
    await withMigratedDatabase((connection) => {
      insertValidGraph(connection)
      insertValidAmendment(connection)

      for (const fieldName of demographicAmendmentFields) {
        expect(() =>
          insertAmendmentChange(
            connection,
            'amendment-1',
            fieldName,
            JSON.stringify(`previous-${fieldName}`),
            JSON.stringify(`new-${fieldName}`)
          )
        ).not.toThrow()
      }

      for (const fieldName of prohibitedDemographicAmendmentFields) {
        expect(() =>
          insertAmendmentChange(connection, 'amendment-1', fieldName, '"previous"', '"new"')
        ).toThrow()
      }
      expect(() =>
        insertAmendmentChange(connection, 'amendment-1', 'given_name', '{invalid', '"Amina"')
      ).toThrow()
      expect(() =>
        insertAmendmentChange(connection, 'amendment-1', 'family_name', '[]', '"Patient"')
      ).toThrow()
      expect(() =>
        insertAmendmentChange(connection, 'amendment-1', 'other_names', '"Test"', '{}')
      ).toThrow()
      expect(() =>
        insertAmendmentChange(connection, 'amendment-1', 'sex', '"FEMALE"', '"FEMALE"')
      ).toThrow()
    })
  })

  it('rejects updates and deletes to demographic amendment history with bounded messages', async () => {
    await withMigratedDatabase((connection) => {
      insertValidGraph(connection)
      insertValidAmendment(connection)
      insertAmendmentChange(connection, 'amendment-1', 'given_name', '"Amina"', '"Test Amina"')

      const headerUpdateError = captureError(() =>
        connection
          .prepare("UPDATE patient_demographic_amendments SET reason_note = 'changed'")
          .run()
      )
      const headerDeleteError = captureError(() =>
        connection.prepare('DELETE FROM patient_demographic_amendments').run()
      )
      const changeUpdateError = captureError(() =>
        connection
          .prepare('UPDATE patient_demographic_amendment_changes SET new_value_json = \'"B"\'')
          .run()
      )
      const changeDeleteError = captureError(() =>
        connection.prepare('DELETE FROM patient_demographic_amendment_changes').run()
      )

      expectSqliteErrorMessage(headerUpdateError, 'patient demographic amendments are append-only')
      expectSqliteErrorMessage(headerDeleteError, 'patient demographic amendments are append-only')
      expectSqliteErrorMessage(
        changeUpdateError,
        'patient demographic amendment changes are append-only'
      )
      expectSqliteErrorMessage(
        changeDeleteError,
        'patient demographic amendment changes are append-only'
      )

      for (const error of [
        headerUpdateError,
        headerDeleteError,
        changeUpdateError,
        changeDeleteError
      ]) {
        expect(String((error as Error).message)).not.toContain('patient-1')
        expect(String((error as Error).message)).not.toContain('P-001')
        expect(String((error as Error).message)).not.toContain('Patient One')
      }
    })
  })

  it('preserves pre-version-3 acknowledgment rows and enforces linked version metadata', async () => {
    await withVersion2Database((connection) => {
      insertValidGraph(connection)
      insertConsentRecordVersion2(connection, {
        id: 'consent-pre-v3',
        consentType: registryAcknowledgmentType
      })

      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: {
          info: vi.fn<(message: string) => void>(),
          error: vi.fn<(message: string) => void>()
        },
        clock: { now: () => '2026-07-29T00:00:00.000Z' }
      })(connection)

      const preV3Row = connection
        .prepare(
          `SELECT patient_prior_row_version, patient_resulting_row_version
           FROM consent_records
           WHERE id = ?`
        )
        .get('consent-pre-v3') as {
        patient_prior_row_version: number | null
        patient_resulting_row_version: number | null
      }

      expect(preV3Row).toEqual({
        patient_prior_row_version: null,
        patient_resulting_row_version: null
      })
      expect(() =>
        insertConsentRecordVersion3(connection, {
          id: 'consent-linked',
          patientPriorRowVersion: 1,
          patientResultingRowVersion: 2
        })
      ).not.toThrow()
      expect(() =>
        insertConsentRecordVersion3(connection, {
          id: 'consent-missing-resulting',
          patientPriorRowVersion: 1,
          patientResultingRowVersion: null
        })
      ).toThrow()
      expect(() =>
        insertConsentRecordVersion3(connection, {
          id: 'consent-missing-prior',
          patientPriorRowVersion: null,
          patientResultingRowVersion: 2
        })
      ).toThrow()
      expect(() =>
        insertConsentRecordVersion3(connection, {
          id: 'consent-nonconsecutive',
          patientPriorRowVersion: 1,
          patientResultingRowVersion: 3
        })
      ).toThrow()
    })
  })

  it('rejects updates and deletes only for registry acknowledgment rows', async () => {
    await withMigratedDatabase((connection) => {
      insertValidGraph(connection)
      insertConsentRecordVersion3(connection, {
        id: 'consent-registry',
        consentType: registryAcknowledgmentType
      })
      insertConsentRecordVersion3(connection, {
        id: 'consent-unrelated',
        consentType: 'TEST_UNRELATED_ACKNOWLEDGMENT'
      })

      const registryUpdateError = captureError(() =>
        connection
          .prepare("UPDATE consent_records SET notes = 'changed' WHERE id = 'consent-registry'")
          .run()
      )
      const registryDeleteError = captureError(() =>
        connection.prepare("DELETE FROM consent_records WHERE id = 'consent-registry'").run()
      )
      const registryTypeChangeError = captureError(() =>
        connection
          .prepare(
            "UPDATE consent_records SET consent_type = 'TEST_UNRELATED_ACKNOWLEDGMENT' WHERE id = 'consent-registry'"
          )
          .run()
      )
      const unrelatedIntoRegistryError = captureError(() =>
        connection
          .prepare("UPDATE consent_records SET consent_type = ? WHERE id = 'consent-unrelated'")
          .run(registryAcknowledgmentType)
      )

      expectSqliteErrorMessage(
        registryUpdateError,
        'registry acknowledgment records are append-only'
      )
      expectSqliteErrorMessage(
        registryDeleteError,
        'registry acknowledgment records are append-only'
      )
      expectSqliteErrorMessage(
        registryTypeChangeError,
        'registry acknowledgment records are append-only'
      )
      expectSqliteErrorMessage(
        unrelatedIntoRegistryError,
        'registry acknowledgment records are append-only'
      )
      expect(String((registryUpdateError as Error).message)).not.toContain('patient-1')
      expect(String((registryDeleteError as Error).message)).not.toContain('patient-1')
      expect(String((registryTypeChangeError as Error).message)).not.toContain('patient-1')
      expect(String((unrelatedIntoRegistryError as Error).message)).not.toContain('patient-1')

      expect(() =>
        connection
          .prepare("UPDATE consent_records SET notes = 'changed' WHERE id = 'consent-unrelated'")
          .run()
      ).not.toThrow()
      expect(() =>
        connection.prepare("DELETE FROM consent_records WHERE id = 'consent-unrelated'").run()
      ).not.toThrow()
    })
  })

  it('accepts the exact schema version 3 contract and rejects required object drift', async () => {
    await withMigratedDatabase((connection) => {
      expect(() => validateSchemaVersion3(connection, 'compatibility')).not.toThrow()
    })

    await expectSchemaVersion3Drift(
      (connection) => connection.exec('DROP TABLE patient_demographic_amendment_changes'),
      'missing table'
    )
    await expectSchemaVersion3MigrationDrift('  amended_at TEXT NOT NULL,\n', '', 'missing column')
    await expectSchemaVersion3Drift(
      (connection) => connection.exec('DROP INDEX ix_patient_demographic_amendments_patient_time'),
      'missing index'
    )
    await expectSchemaVersion3MigrationDrift(
      '  CONSTRAINT fk_patient_demographic_amendments_patient FOREIGN KEY (patient_id)\n    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,\n',
      '',
      'missing foreign key'
    )
    await expectSchemaVersion3MigrationDrift("      'STATUS_CHANGE',\n", '', 'missing constraint')
    await expectSchemaVersion3Drift(
      (connection) => connection.exec('DROP TRIGGER tr_patient_demographic_amendments_no_update'),
      'missing trigger'
    )
    await expectSchemaVersion3MigrationDrift(
      "WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'\n  OR NEW.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'",
      "WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'",
      'missing registry acknowledgment NEW trigger condition'
    )
  })

  it('rejects malformed same-name definitions for required version 3 indexes', async () => {
    const malformedIndexDefinitions: ReadonlyArray<{
      indexName: string
      cases: ReadonlyArray<{ label: string; sql: string }>
    }> = [
      {
        indexName: 'ix_patient_demographic_amendments_patient_time',
        cases: [
          {
            label: 'wrong table',
            sql: `CREATE INDEX ix_patient_demographic_amendments_patient_time
              ON consent_records (patient_id, recorded_at DESC, id DESC);`
          },
          {
            label: 'wrong column order',
            sql: `CREATE INDEX ix_patient_demographic_amendments_patient_time
              ON patient_demographic_amendments (amended_at DESC, patient_id, id DESC);`
          },
          {
            label: 'wrong direction',
            sql: `CREATE INDEX ix_patient_demographic_amendments_patient_time
              ON patient_demographic_amendments (patient_id, amended_at, id DESC);`
          },
          {
            label: 'wrong uniqueness',
            sql: `CREATE UNIQUE INDEX ix_patient_demographic_amendments_patient_time
              ON patient_demographic_amendments (patient_id, amended_at DESC, id DESC);`
          }
        ]
      },
      {
        indexName: 'ix_patient_demographic_amendment_changes_field',
        cases: [
          {
            label: 'wrong table',
            sql: `CREATE INDEX ix_patient_demographic_amendment_changes_field
              ON patients (name_normalized, id);`
          },
          {
            label: 'wrong column order',
            sql: `CREATE INDEX ix_patient_demographic_amendment_changes_field
              ON patient_demographic_amendment_changes (amendment_id, field_name);`
          },
          {
            label: 'wrong direction',
            sql: `CREATE INDEX ix_patient_demographic_amendment_changes_field
              ON patient_demographic_amendment_changes (field_name DESC, amendment_id);`
          },
          {
            label: 'wrong uniqueness',
            sql: `CREATE UNIQUE INDEX ix_patient_demographic_amendment_changes_field
              ON patient_demographic_amendment_changes (field_name, amendment_id);`
          }
        ]
      },
      {
        indexName: 'ix_consent_records_registry_ack_history',
        cases: [
          {
            label: 'wrong table',
            sql: `CREATE INDEX ix_consent_records_registry_ack_history
              ON patients (id, patient_code, created_at DESC, updated_at DESC);`
          },
          {
            label: 'wrong column order',
            sql: `CREATE INDEX ix_consent_records_registry_ack_history
              ON consent_records (consent_type, patient_id, recorded_at DESC, id DESC);`
          },
          {
            label: 'wrong direction',
            sql: `CREATE INDEX ix_consent_records_registry_ack_history
              ON consent_records (patient_id, consent_type, recorded_at, id DESC);`
          },
          {
            label: 'wrong uniqueness',
            sql: `CREATE UNIQUE INDEX ix_consent_records_registry_ack_history
              ON consent_records (patient_id, consent_type, recorded_at DESC, id DESC);`
          }
        ]
      }
    ]

    for (const { indexName, cases } of malformedIndexDefinitions) {
      for (const malformedCase of cases) {
        await expectSchemaVersion3IndexDrift(
          indexName,
          malformedCase.sql,
          `${indexName} ${malformedCase.label}`
        )
      }
    }
  })
})

async function withMigratedDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd007-schema-v1-'))
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
      clock: { now: () => '2026-07-29T00:00:00.000Z' }
    })(connection)
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-schema-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function withVersion2Database(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-schema-v2-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    runDatabaseMigrations({
      connection,
      migrations: databaseMigrations.slice(0, 2),
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: { now: () => '2026-07-29T00:00:00.000Z' },
      expectedHighestVersion: 2
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

function readTriggerNames(connection: Database.Database): string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
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

function insertValidAmendment(
  connection: Database.Database,
  overrides: {
    id?: string
    patientId?: string
    priorRowVersion?: number
    resultingRowVersion?: number
    reasonCode?: string
    reasonNote?: string | null
    amendedBy?: string
  } = {}
): void {
  connection
    .prepare(
      `INSERT INTO patient_demographic_amendments (
        id,
        patient_id,
        prior_row_version,
        resulting_row_version,
        reason_code,
        reason_note,
        amended_by,
        amended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.id ?? 'amendment-1',
      overrides.patientId ?? 'patient-1',
      overrides.priorRowVersion ?? 1,
      overrides.resultingRowVersion ?? 2,
      overrides.reasonCode ?? 'DATA_ENTRY_CORRECTION',
      Object.hasOwn(overrides, 'reasonNote')
        ? overrides.reasonNote
        : 'Correcting synthetic test demographic data',
      overrides.amendedBy ?? 'user-1',
      now
    )
}

function insertAmendmentChange(
  connection: Database.Database,
  amendmentId: string,
  fieldName: string,
  previousValueJson: string,
  newValueJson: string
): void {
  connection
    .prepare(
      `INSERT INTO patient_demographic_amendment_changes (
        amendment_id,
        field_name,
        previous_value_json,
        new_value_json
      ) VALUES (?, ?, ?, ?)`
    )
    .run(amendmentId, fieldName, previousValueJson, newValueJson)
}

function insertConsentRecordVersion2(
  connection: Database.Database,
  overrides: {
    id?: string
    consentType?: string
  } = {}
): void {
  connection
    .prepare(
      `INSERT INTO consent_records (
        id,
        patient_id,
        consent_type,
        status,
        source_type,
        effective_at,
        withdrawn_at,
        notes,
        recorded_by,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.id ?? 'consent-1',
      'patient-1',
      overrides.consentType ?? registryAcknowledgmentType,
      'ACKNOWLEDGED',
      'PATIENT_REPORTED',
      now,
      null,
      'Synthetic test acknowledgment row',
      'user-1',
      now
    )
}

function insertConsentRecordVersion3(
  connection: Database.Database,
  overrides: {
    id?: string
    consentType?: string
    patientPriorRowVersion?: number | null
    patientResultingRowVersion?: number | null
  } = {}
): void {
  connection
    .prepare(
      `INSERT INTO consent_records (
        id,
        patient_id,
        consent_type,
        status,
        source_type,
        effective_at,
        withdrawn_at,
        notes,
        recorded_by,
        recorded_at,
        patient_prior_row_version,
        patient_resulting_row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.id ?? 'consent-1',
      'patient-1',
      overrides.consentType ?? registryAcknowledgmentType,
      'ACKNOWLEDGED',
      'PATIENT_REPORTED',
      now,
      null,
      'Synthetic test acknowledgment row',
      'user-1',
      now,
      overrides.patientPriorRowVersion ?? null,
      overrides.patientResultingRowVersion ?? null
    )
}

async function expectSchemaVersion3Drift(
  mutate: (connection: Database.Database) => void,
  label: string
): Promise<void> {
  await withMigratedDatabase((connection) => {
    mutate(connection)

    expect(() => validateSchemaVersion3(connection, 'compatibility'), label).toThrow(
      MigrationCompatibilityError
    )
  })
}

async function expectSchemaVersion3MigrationDrift(
  search: string,
  replacement: string,
  label: string
): Promise<void> {
  const version3Migration = databaseMigrations[2]

  if (version3Migration === undefined) {
    throw new Error('Missing version 3 migration')
  }

  const normalizedSql = version3Migration.sql.replaceAll('\r\n', '\n')

  if (!normalizedSql.includes(search)) {
    throw new Error(`Missing drift search target for ${label}`)
  }

  await withDatabase((connection) => {
    expect(
      () =>
        runDatabaseMigrations({
          connection,
          migrations: [
            ...databaseMigrations.slice(0, 2),
            {
              ...version3Migration,
              sql: normalizedSql.replace(search, replacement)
            }
          ],
          applicationVersion: '1.0.0',
          logger: {
            info: vi.fn<(message: string) => void>(),
            error: vi.fn<(message: string) => void>()
          },
          clock: { now: () => '2026-07-29T00:00:00.000Z' },
          expectedHighestVersion: 3,
          schemaValidators: new Map([[3, validateSchemaVersion3]])
        }),
      label
    ).toThrow(MigrationExecutionError)
  })
}

async function expectSchemaVersion3IndexDrift(
  indexName: string,
  replacementSql: string,
  label: string
): Promise<void> {
  await expectSchemaVersion3Drift((connection) => {
    connection.exec(`DROP INDEX ${quoteIdentifier(indexName)}; ${replacementSql}`)
  }, label)
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}

function expectSqliteErrorMessage(error: unknown, expectedMessage: string): void {
  expect(error).toBeInstanceOf(Error)
  expect(String((error as Error).message)).toContain(expectedMessage)
}
