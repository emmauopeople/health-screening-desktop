import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  Hsd046DraftV12RecoveryError,
  hsd046KnownDraftVersion12Checksum,
  recoverHsd046DraftV12Database
} from '@main/database/migrations/hsd046-draft-v12-recovery'
import {
  MigrationCompatibilityError,
  createProductionDatabaseMigrationRunner
} from '@main/database/migrations'
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

describe('HSD-046 unreleased draft-v12 local recovery', () => {
  it('recovers the exact old-checksum draft-v12 schema and is idempotent on repeated startup', async () => {
    await withDraftV12Database(async ({ connection, databasePath, directory }) => {
      const beforeRow = readOtherActivityRow(connection)
      const beforeCounts = readTableCounts(connection)
      const backupDirectory = join(directory, 'backups')

      expect(() => runProductionMigrations(connection)).toThrow(MigrationCompatibilityError)
      expect(() => validateSchemaVersion12(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
      connection.close()

      const result = await recoverHsd046DraftV12Database({
        databasePath,
        backupDirectory,
        applicationVersion: '1.0.0-test',
        confirmApplicationStopped: true,
        repositoryRoot: 'E:\\health-app\\health-screening-desktop',
        now: () => now,
        logger: { info: vi.fn(), error: vi.fn() }
      })

      expect(result.recovered).toBe(true)
      expect(result.draftChecksum).toBe(hsd046KnownDraftVersion12Checksum)
      expect(result.afterUserVersion).toBe(13)
      expect(result.backupSizeBytes).toBeGreaterThan(0)
      expect(result.backupSha256).toMatch(/^[a-f0-9]{64}$/u)

      const recovered = openDatabase(databasePath)
      try {
        expect(recovered.pragma('user_version', { simple: true })).toBe(13)
        expect(readLedgerChecksum(recovered, 12)).toBe(result.finalChecksum)
        expect(readOtherActivityRow(recovered)).toEqual(beforeRow)
        const afterCounts = readTableCounts(recovered)
        for (const [tableName, count] of Object.entries(beforeCounts)) {
          if (tableName === 'schema_migrations') {
            expect(afterCounts[tableName]).toBe(13)
          } else {
            expect(afterCounts[tableName]).toBe(count)
          }
        }
        expect(afterCounts.food_catalog_items).toBe(26)
        expect(afterCounts.food_drafts).toBe(0)
        expect(afterCounts.food_draft_rows).toBe(0)
        expect(recovered.pragma('foreign_key_check')).toEqual([])
        expect(recovered.pragma('integrity_check', { simple: true })).toBe('ok')
        const firstStartup = runProductionMigrations(recovered)
        const secondStartup = runProductionMigrations(recovered)
        expect(firstStartup.appliedVersions).toEqual([])
        expect(secondStartup.appliedVersions).toEqual([])
      } finally {
        recovered.close()
      }
    })
  })

  it('refuses unknown draft-v12 checksums and leaves the original database unchanged', async () => {
    await withDraftV12Database(async ({ connection, databasePath, directory }) => {
      const beforeChecksum = readLedgerChecksum(connection, 12)
      const beforeTableSql = readOtherActivityTableSql(connection)
      connection
        .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 12')
        .run('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      const alteredChecksum = readLedgerChecksum(connection, 12)
      connection.close()

      await expect(
        recoverHsd046DraftV12Database({
          databasePath,
          backupDirectory: join(directory, 'backups'),
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow(Hsd046DraftV12RecoveryError)

      const after = openDatabase(databasePath)
      try {
        expect(readLedgerChecksum(after, 12)).toBe(alteredChecksum)
        expect(readLedgerChecksum(after, 12)).not.toBe(beforeChecksum)
        expect(readOtherActivityTableSql(after)).toBe(beforeTableSql)
      } finally {
        after.close()
      }
    })
  })

  it('refuses unknown draft-v12 schemas and leaves the original database unchanged', async () => {
    await withDraftV12Database(async ({ connection, databasePath, directory }) => {
      const beforeChecksum = readLedgerChecksum(connection, 12)
      connection.exec('DROP INDEX ix_lifestyle_other_activity_rows_draft')
      const beforeIndexNames = readIndexNames(connection)
      connection.close()

      await expect(
        recoverHsd046DraftV12Database({
          databasePath,
          backupDirectory: join(directory, 'backups'),
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow(Hsd046DraftV12RecoveryError)

      const after = openDatabase(databasePath)
      try {
        expect(readLedgerChecksum(after, 12)).toBe(beforeChecksum)
        expect(readIndexNames(after)).toEqual(beforeIndexNames)
      } finally {
        after.close()
      }
    })
  })

  it('rejects unsafe inputs before mutation', async () => {
    await withDraftV12Database(async ({ connection, databasePath, directory }) => {
      const beforeChecksum = readLedgerChecksum(connection, 12)
      const backupFilePath = join(directory, 'backup-target-file')
      await writeFile(backupFilePath, 'not a directory')
      connection.close()

      await expect(
        recoverHsd046DraftV12Database({
          databasePath,
          backupDirectory: backupFilePath,
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow()

      const afterFailedBackup = openDatabase(databasePath)
      try {
        expect(readLedgerChecksum(afterFailedBackup, 12)).toBe(beforeChecksum)
      } finally {
        afterFailedBackup.close()
      }

      await expect(
        recoverHsd046DraftV12Database({
          databasePath: directory,
          backupDirectory: join(directory, 'backups'),
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow(Hsd046DraftV12RecoveryError)

      const nonSqlitePath = join(directory, 'not-sqlite.sqlite3')
      await writeFile(nonSqlitePath, 'not sqlite')

      await expect(
        recoverHsd046DraftV12Database({
          databasePath: nonSqlitePath,
          backupDirectory: join(directory, 'backups'),
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow(Hsd046DraftV12RecoveryError)
    })
  })

  it('requires explicit confirmation that the application is stopped', async () => {
    await withDraftV12Database(async ({ connection, databasePath, directory }) => {
      const beforeChecksum = readLedgerChecksum(connection, 12)
      connection.close()

      await expect(
        recoverHsd046DraftV12Database({
          databasePath,
          backupDirectory: join(directory, 'backups'),
          applicationVersion: '1.0.0-test',
          confirmApplicationStopped: false as true,
          repositoryRoot: 'E:\\health-app\\health-screening-desktop',
          now: () => now,
          logger: { info: vi.fn(), error: vi.fn() }
        })
      ).rejects.toThrow(Hsd046DraftV12RecoveryError)

      const after = openDatabase(databasePath)
      try {
        expect(readLedgerChecksum(after, 12)).toBe(beforeChecksum)
      } finally {
        after.close()
      }
    })
  })
})

async function withDraftV12Database(
  test: (context: {
    connection: Database.Database
    databasePath: string
    directory: string
  }) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd046-draft-v12-recovery-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = openDatabase(databasePath)
  try {
    migrateToVersion(connection, 11)
    seedVersion11LifestyleGraph(connection)
    migrateToDraftVersion12(connection)
    await test({ connection, databasePath, directory })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function openDatabase(databasePath: string): Database.Database {
  const connection = new Database(databasePath)
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
  return connection
}

function migrateToVersion(connection: Database.Database, version: 11): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}

function migrateToDraftVersion12(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: [
      ...databaseMigrations.slice(0, 11),
      {
        ...databaseMigrations[11]!,
        sql: databaseMigrations[11]!.sql.replace(
          /[ ]{2}CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank\r?\n[ ]{4}CHECK \(description IS NULL OR TRIM\(description\) != ''\),\r?\n/u,
          ''
        )
      }
    ],
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: 12
  })
}

function runProductionMigrations(
  connection: Database.Database
): ReturnType<ReturnType<typeof createProductionDatabaseMigrationRunner>> {
  return createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() }
  })(connection)
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
  connection
    .prepare(
      'INSERT INTO lifestyle_other_activity_rows (id, lifestyle_draft_id, sequence_number, category, description, days_in_past_seven_days, average_minutes_per_day, intensity, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.otherActivity,
      ids.draft,
      1,
      'COMMUNITY',
      'Existing row',
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

function readLedgerChecksum(connection: Database.Database, version: number): string {
  return (
    connection.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(version) as {
      checksum: string
    }
  ).checksum
}

function readOtherActivityTableSql(connection: Database.Database): string {
  return (
    connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('lifestyle_other_activity_rows') as { sql: string }
  ).sql
}

function readIndexNames(connection: Database.Database): string[] {
  return (
    connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name"
      )
      .all() as { name: string }[]
  ).map((row) => row.name)
}

function readTableCounts(connection: Database.Database): Record<string, number> {
  const tableNames = connection
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[]

  return Object.fromEntries(
    tableNames.map((row) => [
      row.name,
      (
        connection
          .prepare(`SELECT COUNT(*) AS count FROM "${row.name.replaceAll('"', '""')}"`)
          .get() as {
          count: number
        }
      ).count
    ])
  )
}
