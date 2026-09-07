import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  createDatabaseRuntime,
  DatabaseRuntimeInitializationError,
  getDatabasePath,
  type DatabaseMigrationRunner
} from '@main/database'

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  info: MockLogMethod
  error: MockLogMethod
}

describe('SQLite runtime integration', () => {
  it('creates a configured file-backed database and manages health safely', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-userdata-'))
    const logger = createLogger()
    const openConnection = vi.fn((path: string) => new Database(path))
    const migrationRunner = createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger,
      clock: { now: () => '2026-07-29T00:00:00.000Z' }
    })

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner,
        openConnection,
        logger
      })

      expect(runtime.getStatus()).toBe('unavailable')
      runtime.initialize()
      runtime.initialize()
      expect(openConnection).toHaveBeenCalledOnce()

      const connection = runtime.getConnection()
      const databaseStats = await stat(getDatabasePath(userDataDirectory))
      expect(databaseStats.isFile()).toBe(true)
      expect(runtime.getStatus()).toBe('ready')
      expect(connection.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(connection.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(connection.pragma('synchronous', { simple: true })).toBe(1)
      expect(connection.pragma('busy_timeout', { simple: true })).toBe(5000)
      expect(connection.pragma('trusted_schema', { simple: true })).toBe(0)
      expect(connection.pragma('user_version', { simple: true })).toBe(21)
      expect(
        connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      ).toContainEqual({ name: 'schema_migrations' })

      runtime.close()
      runtime.close()

      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.info.mock.calls.flat()).toEqual([
        'Database migration started; version=1; name=initial-schema',
        'Database migration applied; version=1; name=initial-schema',
        'Database migration started; version=2; name=patient-registry-management',
        'Database migration applied; version=2; name=patient-registry-management',
        'Database migration started; version=3; name=patient-demographic-amendment-history',
        'Database migration applied; version=3; name=patient-demographic-amendment-history',
        'Database migration started; version=4; name=screening-session-lifecycle-foundation',
        'Database migration applied; version=4; name=screening-session-lifecycle-foundation',
        'Database migration started; version=5; name=screening-encounter-identity',
        'Database migration applied; version=5; name=screening-encounter-identity',
        'Database migration started; version=6; name=installation-location-configuration',
        'Database migration applied; version=6; name=installation-location-configuration',
        'Database migration started; version=7; name=baseline-active-protocol',
        'Database migration applied; version=7; name=baseline-active-protocol',
        'Database migration started; version=8; name=screening-vitals-drafts',
        'Database migration applied; version=8; name=screening-vitals-drafts',
        'Database migration started; version=9; name=lifestyle-foundation',
        'Database migration applied; version=9; name=lifestyle-foundation',
        'Database migration started; version=10; name=lifestyle-activity-response-semantics',
        'Database migration applied; version=10; name=lifestyle-activity-response-semantics',
        'Database migration started; version=11; name=vitals-reading-bounds',
        'Database migration applied; version=11; name=vitals-reading-bounds',
        'Database migration started; version=12; name=optional-other-activity-description',
        'Database migration applied; version=12; name=optional-other-activity-description',
        'Database migration started; version=13; name=food-draft-foundation',
        'Database migration applied; version=13; name=food-draft-foundation',
        'Database migration started; version=14; name=otc-draft-foundation',
        'Database migration applied; version=14; name=otc-draft-foundation',
        'Database migration started; version=15; name=encounter-management',
        'Database migration applied; version=15; name=encounter-management',
        'Database migration started; version=16; name=repeat-screening-encounters',
        'Database migration applied; version=16; name=repeat-screening-encounters',
        'Database migration started; version=17; name=bp-screening-protocol',
        'Database migration applied; version=17; name=bp-screening-protocol',
        'Database migration started; version=18; name=referral-treatment-actions',
        'Database migration applied; version=18; name=referral-treatment-actions',
        'Database migration started; version=19; name=sync-transport-foundation',
        'Database migration applied; version=19; name=sync-transport-foundation',
        'Database migration started; version=20; name=sync-worker-response',
        'Database migration applied; version=20; name=sync-worker-response',
        'Database migration started; version=21; name=sync-identity-resolution-delivery',
        'Database migration applied; version=21; name=sync-identity-resolution-delivery',
        'Database migrations current; schemaVersion=21',
        'Database runtime initialized.',
        'Database runtime closed.'
      ])
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('logs safe health-query failures and returns unavailable', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-health-failure-'))
    const logger = createLogger()
    let healthQueryCount = 0
    const connection = createFakeConnection(() => {
      healthQueryCount += 1
      return healthQueryCount === 1
        ? { health: 1 }
        : (() => {
            throw new Error('C:\\secret\\database.sqlite3')
          })()
    })

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner: createNoopMigrationRunner(),
        openConnection: () => connection as never,
        logger
      })

      runtime.initialize()

      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toBe(
        'Database runtime health check failed; phase=health; errorType=Error'
      )
      expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('logs unexpected health results as safe unavailable failures', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-health-result-'))
    const logger = createLogger()
    let healthQueryCount = 0
    const connection = createFakeConnection(() => {
      healthQueryCount += 1
      return healthQueryCount === 1 ? { health: 1 } : { health: 0 }
    })

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner: createNoopMigrationRunner(),
        openConnection: () => connection as never,
        logger
      })

      runtime.initialize()

      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toBe(
        'Database runtime health check failed; phase=health; errorType=UnexpectedHealthResult'
      )
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('preserves the initialization error when partial cleanup close fails', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-failure-'))
    const logger = createLogger()
    const close = vi.fn(() => {
      throw new Error('C:\\secret\\cleanup.sqlite3')
    })
    const connection = {
      pragma: vi.fn(() => {
        throw new Error('C:\\secret\\database.sqlite3')
      }),
      close
    }

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner: createNoopMigrationRunner(),
        openConnection: () => connection as never,
        logger
      })

      expect(() => runtime.initialize()).toThrow(DatabaseRuntimeInitializationError)
      expect(close).toHaveBeenCalledOnce()
      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toContain(
        'Database runtime cleanup failed; phase=initialization; errorType=Error'
      )
      expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('safely logs a normal shutdown close failure and remains idempotent', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-close-failure-'))
    const logger = createLogger()
    const close = vi.fn(() => {
      throw new Error('C:\\secret\\shutdown.sqlite3')
    })
    const connection = createFakeConnection(() => ({ health: 1 }), close)

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner: createNoopMigrationRunner(),
        openConnection: () => connection as never,
        logger
      })

      runtime.initialize()

      expect(() => runtime.close()).not.toThrow()
      runtime.close()
      expect(close).toHaveBeenCalledOnce()
      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toBe(
        'Database runtime close failed; phase=shutdown; errorType=Error'
      )
      expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  it('keeps the database unavailable and closes the handle when migration fails', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd007-migration-failure-'))
    const logger = createLogger()
    const close = vi.fn()
    const connection = createFakeConnection(() => ({ health: 1 }), close)
    const migrationRunner = vi.fn(() => {
      throw new Error('C:\\secret\\migration.sqlite3 SELECT * FROM patient')
    })

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        migrationRunner,
        openConnection: () => connection as never,
        logger
      })

      expect(() => runtime.initialize()).toThrow(DatabaseRuntimeInitializationError)
      expect(migrationRunner).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toContain(
        'Database runtime initialization failed; phase=open; errorType=Error'
      )
      expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
      expect(logger.error.mock.calls.join('\n')).not.toContain('patient')
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })
})

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
}

function createNoopMigrationRunner(): DatabaseMigrationRunner {
  return vi.fn(() => ({
    previousVersion: 0,
    currentVersion: 0,
    appliedVersions: []
  }))
}

function createFakeConnection(
  healthResult: () => unknown,
  close = vi.fn()
): {
  pragma: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  close: typeof close
} {
  return {
    pragma: vi.fn((name: string) => {
      const values: Record<string, unknown> = {
        foreign_keys: 1,
        journal_mode: 'wal',
        synchronous: 1,
        busy_timeout: 5000,
        trusted_schema: 0,
        user_version: 0
      }

      return name.includes('=') ? undefined : values[name]
    }),
    prepare: vi.fn(() => ({ get: healthResult })),
    close
  }
}
