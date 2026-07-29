import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

import type { DatabaseStatus } from './database-health'

type SqliteConnection = Database.Database
type SqliteConnectionFactory = (databasePath: string) => SqliteConnection

export interface DatabaseRuntimeLogger {
  info(message: string): void
  error(message: string): void
}

export interface DatabaseRuntime {
  initialize(): void
  getStatus(): DatabaseStatus
  getConnection(): SqliteConnection
  close(): void
}

export interface SqliteRuntimeOptions {
  databasePath: string
  openConnection?: SqliteConnectionFactory
  logger?: DatabaseRuntimeLogger
}

const defaultLogger: DatabaseRuntimeLogger = console

export function createDatabaseRuntime({
  databasePath,
  openConnection = (path) => new Database(path),
  logger = defaultLogger
}: SqliteRuntimeOptions): DatabaseRuntime {
  let connection: SqliteConnection | null = null

  return {
    initialize(): void {
      if (connection) {
        return
      }

      let openedConnection: SqliteConnection | null = null

      try {
        mkdirSync(dirname(databasePath), { recursive: true })
        openedConnection = openConnection(databasePath)
        configureAndVerifyConnection(openedConnection)
        connection = openedConnection
        logger.info('Database runtime initialized.')
      } catch (error) {
        openedConnection?.close()
        connection = null
        logger.error(
          `Database runtime initialization failed; phase=open; errorType=${getErrorType(error)}`
        )
        throw new DatabaseRuntimeInitializationError()
      }
    },

    getStatus(): DatabaseStatus {
      if (!connection) {
        return 'unavailable'
      }

      try {
        const result = connection.prepare('SELECT 1 AS health').get() as { health?: unknown }
        return result.health === 1 ? 'ready' : 'unavailable'
      } catch {
        return 'unavailable'
      }
    },

    getConnection(): SqliteConnection {
      if (!connection) {
        throw new DatabaseRuntimeUnavailableError()
      }

      return connection
    },

    close(): void {
      if (!connection) {
        return
      }

      const connectionToClose = connection
      connection = null
      connectionToClose.close()
      logger.info('Database runtime closed.')
    }
  }
}

function configureAndVerifyConnection(connection: SqliteConnection): void {
  connection.pragma('foreign_keys = ON')
  assertPragma(connection, 'foreign_keys', 1)

  connection.pragma('journal_mode = WAL')
  assertPragma(connection, 'journal_mode', 'wal')

  connection.pragma('synchronous = NORMAL')
  assertPragma(connection, 'synchronous', 1)

  connection.pragma('busy_timeout = 5000')
  assertPragma(connection, 'busy_timeout', 5000)

  connection.pragma('trusted_schema = OFF')
  assertPragma(connection, 'trusted_schema', 0)
  assertPragma(connection, 'user_version', 0)

  const health = connection.prepare('SELECT 1 AS health').get() as { health?: unknown }
  if (health.health !== 1) {
    throw new Error('SQLite health query failed')
  }
}

function assertPragma(connection: SqliteConnection, name: string, expected: number | string): void {
  const value = connection.pragma(name, { simple: true })
  const normalizedValue = typeof value === 'string' ? value.toLowerCase() : value

  if (normalizedValue !== expected) {
    throw new Error(`SQLite pragma verification failed: ${name}`)
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export class DatabaseRuntimeInitializationError extends Error {
  constructor() {
    super('Database runtime initialization failed.')
    this.name = 'DatabaseRuntimeInitializationError'
  }
}

export class DatabaseRuntimeUnavailableError extends Error {
  constructor() {
    super('Database runtime is unavailable.')
    this.name = 'DatabaseRuntimeUnavailableError'
  }
}
