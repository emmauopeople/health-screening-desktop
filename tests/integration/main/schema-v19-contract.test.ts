import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion19 } from '@main/database/migrations/schema-v19-contract'

const now = '2026-09-03T08:00:00.000Z'

describe('schema version 19 sync transport foundation contract', () => {
  it('adds strict batch, item, lease, and immutable request storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hsw013a-sync-v19-'))
    const connection = new Database(join(directory, 'health-screening.sqlite3'))
    try {
      connection.pragma('foreign_keys = ON')
      migrate(connection, 18)
      migrate(connection, 19)

      expect(() => validateSchemaVersion19(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sync_transport_%' ORDER BY name"
          )
          .all()
      ).toEqual([{ name: 'sync_transport_batch_items' }, { name: 'sync_transport_batches' }])
    } finally {
      if (connection.open) connection.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function migrate(connection: Database.Database, version: 18 | 19): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}
