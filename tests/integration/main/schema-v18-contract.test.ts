import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion18 } from '@main/database/migrations/schema-v18-contract'

const now = '2026-08-27T12:00:00.000Z'

describe('schema version 18 referral treatment actions contract', () => {
  it('upgrades v17 with strict normalized follow-up action and medication tables', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hsd-referral-actions-v18-'))
    const connection = new Database(join(directory, 'health-screening.sqlite3'))
    try {
      connection.pragma('foreign_keys = ON')
      migrate(connection, 17)
      migrate(connection, 18)

      expect(() => validateSchemaVersion18(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(
        connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'referral_followup_%' ORDER BY name"
          )
          .all()
      ).toEqual([
        { name: 'referral_followup_actions' },
        { name: 'referral_followup_medication_changes' }
      ])
    } finally {
      if (connection.open) connection.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function migrate(connection: Database.Database, version: 17 | 18): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}
