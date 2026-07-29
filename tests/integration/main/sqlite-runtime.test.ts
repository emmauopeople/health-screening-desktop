import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseRuntime,
  DatabaseRuntimeInitializationError,
  getDatabasePath
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

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
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
      expect(connection.pragma('user_version', { simple: true })).toBe(0)
      expect(
        connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      ).toEqual([])

      runtime.close()
      runtime.close()

      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.info.mock.calls).toEqual([
        ['Database runtime initialized.'],
        ['Database runtime closed.']
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
})

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
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
