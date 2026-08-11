import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError
} from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion7 } from '@main/database/migrations'

const now = '2026-08-10T12:00:00.000Z'
const installationId = '61000000-0000-4000-8000-000000000001'
const adminId = '61000000-0000-4000-8000-000000000002'
const locationId = '61000000-0000-4000-8000-000000000003'
const secondLocationId = '61000000-0000-4000-8000-000000000004'
const protocolId = '61000000-0000-4000-8000-000000000005'
const patientId = '61000000-0000-4000-8000-000000000006'
const sessionId = '61000000-0000-4000-8000-000000000007'
const encounterId = '61000000-0000-4000-8000-000000000008'
const auditId = '61000000-0000-4000-8000-000000000009'
const outboxId = '61000000-0000-4000-8000-000000000010'

describe('installation location configuration migration', () => {
  it('applies the current schema on a clean database without assigning a location', async () => {
    await withDatabase((connection) => {
      const summary = migrateToCurrent(connection)

      expect(summary).toEqual({
        previousVersion: 0,
        currentVersion: 7,
        appliedVersions: [1, 2, 3, 4, 5, 6, 7]
      })
      expect(readUserVersion(connection)).toBe(7)
      expect(readTableCount(connection, 'schema_migrations')).toBe(7)
      expect(hasTable(connection, 'installation_location_configuration')).toBe(true)
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(0)
      expect(() => validateSchemaVersion7(connection, 'compatibility')).not.toThrow()
    })
  })

  it('upgrades existing schema version 5 data without backfilling an arbitrary location', async () => {
    await withDatabase((connection) => {
      migrateToVersion5(connection)
      seedOperationalGraph(connection)
      const beforeCounts = readOperationalCounts(connection)

      const summary = migrateToCurrent(connection)

      expect(summary).toEqual({
        previousVersion: 5,
        currentVersion: 7,
        appliedVersions: [6, 7]
      })
      expect(readUserVersion(connection)).toBe(7)
      expect(readOperationalCounts(connection)).toEqual({
        ...beforeCounts,
        installation_location_configuration: 0
      })
      expect(readConfigurationRows(connection)).toEqual([])
      expect(() => validateSchemaVersion7(connection, 'compatibility')).not.toThrow()
    })
  })

  it('enforces singleton configuration and valid location references', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      insertInstallation(connection)
      insertUser(connection, adminId, 'admin')
      insertLocation(connection, locationId, 'Site One', true)
      insertLocation(connection, secondLocationId, 'Site Two', true)

      expect(() => insertConfiguration(connection, 'missing-location')).toThrow()
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(0)

      insertConfiguration(connection, locationId)

      expect(readConfigurationRows(connection)).toEqual([
        {
          singleton_id: 1,
          installation_id: installationId,
          location_id: locationId,
          configured_at: now,
          configured_by: adminId,
          updated_at: now,
          updated_by: adminId,
          row_version: 1
        }
      ])
      expect(() => insertConfiguration(connection, secondLocationId)).toThrow()
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(1)
    })
  })

  it('rejects schema drift for the configuration table and indexes', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)

      connection.exec('DROP INDEX ix_installation_location_configuration_location')

      expect(() => validateSchemaVersion7(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })

    await withDatabase((connection) => {
      migrateToCurrent(connection)

      connection.exec('DROP TABLE installation_location_configuration')

      expect(() => validateSchemaVersion7(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029c-p0-migration-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    test(connection)
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToCurrent(
  connection: Database.Database
): ReturnType<ReturnType<typeof createProductionDatabaseMigrationRunner>> {
  return createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now }
  })(connection)
}

function migrateToVersion5(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, 5),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: 5
  })
}

function seedOperationalGraph(connection: Database.Database): void {
  insertInstallation(connection)
  insertUser(connection, adminId, 'admin')
  insertLocation(connection, locationId, 'Site One', true)
  insertProtocolVersion(connection)
  insertPatient(connection)
  insertSession(connection)
  insertEncounter(connection)
  insertAudit(connection)
  insertOutbox(connection)
}

function insertInstallation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
}

function insertUser(connection: Database.Database, id: string, username: string): void {
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
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(id, username, username, `${username} User`, now, now)
}

function insertLocation(
  connection: Database.Database,
  id: string,
  name: string,
  isActive: boolean
): void {
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
      ) VALUES (?, ?, ?, 'COMMUNITY_SITE', ?, ?, ?, ?, ?)`
    )
    .run(id, name, name.toLowerCase(), isActive ? 1 : 0, adminId, now, adminId, now)
}

function insertProtocolVersion(connection: Database.Database): void {
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
      ) VALUES (?, 'screening', 'v1', 'ACTIVE', '{}', 'checksum', ?, ?, ?, ?, ?)`
    )
    .run(protocolId, adminId, now, adminId, now, now)
}

function insertPatient(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        name_normalized,
        sex,
        date_of_birth,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, 'PT-000001', 'Patient One', 'Patient', 'One', 'patient one',
        'UNKNOWN', '1990-01-01', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(patientId, adminId, now, adminId, now)
}

function insertSession(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        notes,
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, '2026-08-10', 'OPEN', NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, 1)`
    )
    .run(sessionId, locationId, protocolId, adminId, now, adminId, now, adminId, now)
}

function insertEncounter(connection: Database.Database): void {
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
        completed_at,
        source_type,
        recorded_by,
        amendment_of_encounter_id,
        amendment_reason,
        void_reason,
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, 1, ?, ?)`
    )
    .run(encounterId, patientId, sessionId, locationId, protocolId, now, adminId, now, now)
}

function insertAudit(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO audit_log (
        id,
        installation_id,
        user_id,
        action,
        entity_type,
        entity_id,
        occurred_at,
        metadata_json
      ) VALUES (?, ?, ?, 'TEST_EVENT', 'INSTALLATION', ?, ?, '{}')`
    )
    .run(auditId, installationId, adminId, installationId, now)
}

function insertOutbox(connection: Database.Database): void {
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
      ) VALUES (?, 'SCREENING_ENCOUNTER', ?, 'TEST', '{}', 'test.v1', ?, 'PENDING', 0)`
    )
    .run(outboxId, encounterId, now)
}

function insertConfiguration(connection: Database.Database, configuredLocationId: string): void {
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
        singleton_id,
        installation_id,
        location_id,
        configured_at,
        configured_by,
        updated_at,
        updated_by,
        row_version
      ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, configuredLocationId, now, adminId, now, adminId)
}

function readOperationalCounts(connection: Database.Database): Record<string, number> {
  return {
    installation: readTableCount(connection, 'installation'),
    users: readTableCount(connection, 'users'),
    locations: readTableCount(connection, 'locations'),
    screening_sessions: readTableCount(connection, 'screening_sessions'),
    screening_encounters: readTableCount(connection, 'screening_encounters'),
    audit_log: readTableCount(connection, 'audit_log'),
    sync_outbox: readTableCount(connection, 'sync_outbox'),
    installation_location_configuration: hasTable(connection, 'installation_location_configuration')
      ? readTableCount(connection, 'installation_location_configuration')
      : 0
  }
}

function readConfigurationRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare('SELECT * FROM installation_location_configuration ORDER BY singleton_id')
    .all() as Array<Record<string, unknown>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS total FROM "${tableName.replaceAll('"', '""')}"`)
    .get() as { total: number }

  return row.total
}

function hasTable(connection: Database.Database, tableName: string): boolean {
  const row = connection
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found?: number } | undefined

  return row?.found === 1
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}
