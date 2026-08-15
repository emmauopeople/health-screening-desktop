import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError
} from '@main/database'
import { validateSchemaVersion10 } from '@main/database/migrations'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'

const now = '2026-08-10T12:00:00.000Z'

describe('schema version 10 compatibility contract', () => {
  it('accepts valid fresh and upgraded schema version 10 databases', async () => {
    await withDatabase((connection) => {
      migrateToCurrent(connection)
      expect(() => validateSchemaVersion10(connection, 'compatibility')).not.toThrow()
    })

    await withDatabase((connection) => {
      runDatabaseMigrations({
        connection,
        migrations: databaseMigrations.slice(0, 9),
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: { now: () => now },
        expectedHighestVersion: 9
      })
      migrateToCurrent(connection)
      expect(() => validateSchemaVersion10(connection, 'compatibility')).not.toThrow()
    })
  })

  it('rejects a missing inherited foreign key', async () => {
    await withDatabase((connection) => {
      migrateWithAlteredMigration(connection, 9, (sql) =>
        sql.replace(
          /,\s+CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY \(updated_by\)\s+REFERENCES users \(id\) ON UPDATE RESTRICT ON DELETE RESTRICT/,
          ''
        )
      )

      expect(() => validateSchemaVersion10(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects an altered inherited schema-v9 SQL constraint', async () => {
    await withDatabase((connection) => {
      migrateWithAlteredMigration(connection, 9, (sql) =>
        sql.replace('period_start <= period_end', 'period_start < period_end')
      )

      expect(() => validateSchemaVersion10(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects incomplete sedentary-response checks', async () => {
    await withDatabase((connection) => {
      migrateWithAlteredMigration(connection, 10, (sql) =>
        sql.replace(
          /sedentary_time_response IN \([^)]*\)/,
          "sedentary_time_response IN ('RECORDED', 'UNKNOWN')"
        )
      )

      expect(() => validateSchemaVersion10(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects incomplete Other Activity-response checks', async () => {
    await withDatabase((connection) => {
      migrateWithAlteredMigration(connection, 10, (sql) =>
        sql.replace(
          /other_activity_response IN \([^)]*\)/,
          "other_activity_response IN ('YES', 'NO', 'UNKNOWN')"
        )
      )

      expect(() => validateSchemaVersion10(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects response checks that permit an extra invalid code', async () => {
    await withDatabase((connection) => {
      migrateWithAlteredMigration(connection, 10, (sql) =>
        sql.replace(
          /other_activity_response IN \(([^)]*)\)/,
          "other_activity_response IN ($1, 'INVALID')"
        )
      )

      expect(() => validateSchemaVersion10(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd044-schema-v10-'))
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
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now }
  })(connection)
}

function migrateWithAlteredMigration(
  connection: Database.Database,
  version: 9 | 10,
  transform: (sql: string) => string
): void {
  const migrations = databaseMigrations.map((migration) =>
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
}
