import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import {
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError
} from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'

describe('central history migration', () => {
  it('upgrades v25 without clinical or upload writes and validates every cache definition on restart', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const options = {
      applicationVersion: '1.0.0',
      clock: { now: () => '2026-09-17T12:00:00.000Z' },
      logger: { info: vi.fn(), error: vi.fn() }
    }
    try {
      runDatabaseMigrations({
        ...options,
        connection: db,
        migrations: databaseMigrations.slice(0, 25)
      })
      const before = db.prepare('SELECT * FROM schema_migrations').all()
      const run = createProductionDatabaseMigrationRunner(options)
      expect(run(db)).toEqual({ previousVersion: 25, currentVersion: 26, appliedVersions: [26] })
      expect(db.prepare('SELECT * FROM schema_migrations WHERE version <= 25').all()).toEqual(
        before
      )
      expect(db.prepare('SELECT COUNT(*) n FROM sync_outbox').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) n FROM central_history_items').get()).toEqual({ n: 0 })
      expect(run(db)).toEqual({ previousVersion: 26, currentVersion: 26, appliedVersions: [] })
      db.exec('DROP INDEX ix_central_history_expiry')
      expect(() => run(db)).toThrow(MigrationCompatibilityError)
      db.exec('CREATE INDEX ix_central_history_expiry ON central_history_snapshots(created_at)')
      expect(() => run(db)).toThrow(MigrationCompatibilityError)
      db.exec(
        'DROP INDEX ix_central_history_expiry; CREATE INDEX ix_central_history_expiry ON central_history_snapshots(updated_at)'
      )
      expect(run(db).currentVersion).toBe(26)
      db.exec('ALTER TABLE central_history_items ADD COLUMN unexpected TEXT')
      expect(() => run(db)).toThrow(MigrationCompatibilityError)
    } finally {
      db.close()
    }
  })
})
