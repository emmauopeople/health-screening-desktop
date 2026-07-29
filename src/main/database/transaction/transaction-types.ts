import type Database from 'better-sqlite3'

import type { EntityId, EntityIdGenerator } from '@main/foundation/entity-id'
import type { UtcClock, UtcTimestamp } from '@main/foundation/utc-clock'

export type DatabaseTransactionPhase = 'begin' | 'work' | 'commit' | 'state'

export interface DatabaseTransactionContext {
  readonly connection: Database.Database
  newEntityId(): EntityId
  nowUtc(): UtcTimestamp
}

export interface DatabaseTransactionExecutor {
  run<T>(work: (context: DatabaseTransactionContext) => T): T
}

export interface DatabaseTransactionLogger {
  error(message: string): void
}

export interface DatabaseTransactionExecutorOptions {
  connection: Database.Database
  idGenerator: EntityIdGenerator
  clock: UtcClock
  logger?: DatabaseTransactionLogger
}

class ControlledDatabaseTransactionError extends Error {
  readonly errorType?: string

  constructor(name: string, message: string, errorType?: string) {
    super(message)
    this.name = name
    this.errorType = sanitizeErrorType(errorType)
    this.stack = undefined
  }
}

export class DatabaseTransactionStateError extends ControlledDatabaseTransactionError {
  constructor(errorType?: string) {
    super(
      'DatabaseTransactionStateError',
      'Database transaction state does not permit this operation.',
      errorType
    )
  }
}

export class DatabaseTransactionAsyncWorkError extends ControlledDatabaseTransactionError {
  constructor(errorType?: string) {
    super(
      'DatabaseTransactionAsyncWorkError',
      'Database transaction work must be synchronous.',
      errorType
    )
  }
}

export class DatabaseTransactionExecutionError extends ControlledDatabaseTransactionError {
  constructor(errorType?: string) {
    super(
      'DatabaseTransactionExecutionError',
      'Database transaction could not be completed.',
      errorType
    )
  }
}

function sanitizeErrorType(errorType: string | undefined): string | undefined {
  if (errorType === undefined) {
    return undefined
  }

  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorType) ? errorType : 'UnknownError'
}
