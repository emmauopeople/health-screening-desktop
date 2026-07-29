import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createDatabaseRuntime, getDatabasePath } from '@main/database'

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  info: MockLogMethod
  error: MockLogMethod
}

describe('SQLite runtime integration', () => {
  it('creates a configured file-backed database and manages health safely', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-userdata-'))
    const logger = createLogger()

    try {
      const runtime = createDatabaseRuntime({
        databasePath: getDatabasePath(userDataDirectory),
        logger
      })

      expect(runtime.getStatus()).toBe('unavailable')
      runtime.initialize()
      runtime.initialize()

      const connection = runtime.getConnection()
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

  it('closes a partially opened connection and logs only safe context', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'hsd006-failure-'))
    const logger = createLogger()
    const close = vi.fn()
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

      expect(() => runtime.initialize()).toThrow('Database runtime initialization failed.')
      expect(close).toHaveBeenCalledOnce()
      expect(runtime.getStatus()).toBe('unavailable')
      expect(logger.error.mock.calls.join('\n')).toBe(
        'Database runtime initialization failed; phase=open; errorType=Error'
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
