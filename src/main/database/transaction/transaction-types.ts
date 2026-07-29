import type Database from 'better-sqlite3'

import type { EntityId, EntityIdGenerator } from '@main/foundation/entity-id'
import { sanitizeErrorType } from '@main/foundation/error-type'
import type { UtcClock, UtcTimestamp } from '@main/foundation/utc-clock'

export type DatabaseTransactionPhase = 'begin' | 'work' | 'commit' | 'state'

export interface DatabaseTransactionStatement<
  BindParameters extends unknown[] = unknown[],
  Result = unknown
> {
  run(...params: BindParameters): Database.RunResult
  get(...params: BindParameters): Result | undefined
  all(...params: BindParameters): Result[]
  iterate(...params: BindParameters): IterableIterator<Result>
  pluck(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result>
  expand(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result>
  raw(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result>
  bind(...params: BindParameters): DatabaseTransactionStatement<BindParameters, Result>
  columns(): Database.ColumnDefinition[]
  safeIntegers(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result>
}

type DatabaseTransactionBindParameters<BindParameters extends unknown[] | object> =
  BindParameters extends unknown[] ? BindParameters : [BindParameters]

type PreparedDatabaseTransactionStatement<
  BindParameters extends unknown[] | object,
  Result
> = DatabaseTransactionStatement<DatabaseTransactionBindParameters<BindParameters>, Result>

export interface DatabaseTransactionConnection {
  readonly open: boolean
  readonly inTransaction: boolean
  prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
    source: string
  ): PreparedDatabaseTransactionStatement<BindParameters, Result>
  exec(source: string): DatabaseTransactionConnection
}

export interface DatabaseTransactionContext {
  readonly connection: DatabaseTransactionConnection
  newEntityId(): EntityId
  nowUtc(): UtcTimestamp
}

export type SynchronousTransactionResult<T> = T extends PromiseLike<unknown> ? never : T
export type DatabaseTransactionWork<T> = (
  context: DatabaseTransactionContext
) => SynchronousTransactionResult<T>

export interface DatabaseTransactionExecutor {
  run<T>(work: DatabaseTransactionWork<T>): SynchronousTransactionResult<T>
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
    delete this.stack
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
