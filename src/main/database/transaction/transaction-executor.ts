import { types as nodeTypes } from 'node:util'
import type Database from 'better-sqlite3'

import { EntityIdGenerationError, parseEntityId } from '@main/foundation/entity-id'
import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'
import { parseUtcTimestamp, UtcClockError } from '@main/foundation/utc-clock'
import type { EntityIdGenerator } from '@main/foundation/entity-id'
import type { UtcClock } from '@main/foundation/utc-clock'

import { isRepositoryError, rebuildRepositoryError } from '../repositories/repository-errors'
import {
  DatabaseTransactionAsyncWorkError,
  type DatabaseTransactionConnection,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  type DatabaseTransactionContext,
  type DatabaseTransactionExecutor,
  type DatabaseTransactionExecutorOptions,
  type DatabaseTransactionLogger,
  type DatabaseTransactionPhase,
  type DatabaseTransactionStatement,
  type DatabaseTransactionWork,
  type SynchronousTransactionResult
} from './transaction-types'

type StatementBindParameters<BindParameters extends unknown[] | object> =
  BindParameters extends unknown[] ? BindParameters : [BindParameters]

type PreparedTransactionStatement<
  BindParameters extends unknown[] | object,
  Result
> = DatabaseTransactionStatement<StatementBindParameters<BindParameters>, Result>

const defaultLogger: DatabaseTransactionLogger = console
const disallowedTransactionSqlPattern =
  /(^|[^A-Za-z0-9_])(BEGIN|COMMIT|END|SAVEPOINT|RELEASE|ROLLBACK)(\s+TO)?($|[^A-Za-z0-9_])/i

export function createDatabaseTransactionExecutor({
  connection,
  idGenerator,
  clock,
  logger = defaultLogger
}: DatabaseTransactionExecutorOptions): DatabaseTransactionExecutor {
  return {
    run<T>(work: DatabaseTransactionWork<T>): SynchronousTransactionResult<T> {
      if (!isConnectionOpen(connection) || connection.inTransaction) {
        const error = new DatabaseTransactionStateError()
        logTransactionFailure(logger, 'state', error)
        throw error
      }

      let transactionAcquired = false
      let phase: DatabaseTransactionPhase = 'begin'
      let guard: TransactionScopeGuard | undefined

      try {
        connection.exec('BEGIN IMMEDIATE')
        transactionAcquired = true

        phase = 'state'
        if (!connection.inTransaction) {
          throw new DatabaseTransactionStateError()
        }

        phase = 'work'
        guard = createTransactionScopeGuard()
        const result = runTransactionWork(
          work,
          createTransactionContext(connection, guard, idGenerator, clock),
          guard
        )

        if (isNativePromise(result)) {
          observeNativePromiseRejection(result)
          guard.deactivate()
          throw new DatabaseTransactionAsyncWorkError()
        }

        if (isThenable(result)) {
          guard.deactivate()
          throw new DatabaseTransactionAsyncWorkError()
        }

        phase = 'commit'
        guard.deactivate()
        connection.exec('COMMIT')

        phase = 'state'
        if (connection.inTransaction) {
          throw new DatabaseTransactionStateError()
        }
        transactionAcquired = false

        return result
      } catch (error) {
        const failurePhase = phase
        const controlledError = toControlledTransactionError(error)
        guard?.deactivate()

        if (transactionAcquired && connection.inTransaction) {
          try {
            connection.exec('ROLLBACK')
          } catch (rollbackError) {
            logger.error(
              `Database transaction rollback failed; phase=rollback; errorType=${getTransactionLogErrorType(rollbackError)}`
            )
          }
        }

        logTransactionFailure(logger, failurePhase, controlledError)
        throw controlledError
      }
    }
  }
}

interface TransactionScopeGuard {
  deactivate(): void
  assertActive(): void
}

function createTransactionScopeGuard(): TransactionScopeGuard {
  let active = true

  return {
    deactivate(): void {
      active = false
    },
    assertActive(): void {
      if (!active) {
        throw new DatabaseTransactionStateError()
      }
    }
  }
}

function runTransactionWork<T>(
  work: DatabaseTransactionWork<T>,
  context: DatabaseTransactionContext,
  guard: TransactionScopeGuard
): SynchronousTransactionResult<T> {
  try {
    return work(context)
  } finally {
    guard.deactivate()
  }
}

function createTransactionContext(
  connection: Database.Database,
  guard: TransactionScopeGuard,
  idGenerator: EntityIdGenerator,
  clock: UtcClock
): DatabaseTransactionContext {
  return Object.freeze({
    connection: createGuardedTransactionConnection(connection, guard),
    newEntityId: () => {
      guard.assertActive()
      return parseEntityId(idGenerator.generate())
    },
    nowUtc: () => {
      guard.assertActive()
      return parseUtcTimestamp(clock.now())
    }
  })
}

function createGuardedTransactionConnection(
  connection: Database.Database,
  guard: TransactionScopeGuard
): DatabaseTransactionConnection {
  const guardedConnection: DatabaseTransactionConnection = Object.freeze({
    get open(): boolean {
      guard.assertActive()
      return connection.open
    },
    get inTransaction(): boolean {
      guard.assertActive()
      return connection.inTransaction
    },
    prepare<BindParameters extends unknown[] | object = unknown[], Result = unknown>(
      source: string
    ): PreparedTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      assertSqlAllowedForTransactionWork(source)

      const statement = connection.prepare<BindParameters, Result>(source)

      return createGuardedStatement(
        statement as Database.Statement<StatementBindParameters<BindParameters>, Result>,
        guard
      )
    },
    exec(source: string): DatabaseTransactionConnection {
      guard.assertActive()
      assertSqlAllowedForTransactionWork(source)
      connection.exec(source)

      return guardedConnection
    }
  })

  return guardedConnection
}

function createGuardedStatement<BindParameters extends unknown[], Result>(
  statement: Database.Statement<BindParameters, Result>,
  guard: TransactionScopeGuard
): DatabaseTransactionStatement<BindParameters, Result> {
  const guardedStatement: DatabaseTransactionStatement<BindParameters, Result> = Object.freeze({
    run(...params: BindParameters): Database.RunResult {
      guard.assertActive()
      return statement.run(...params)
    },
    get(...params: BindParameters): Result | undefined {
      guard.assertActive()
      return statement.get(...params)
    },
    all(...params: BindParameters): Result[] {
      guard.assertActive()
      return statement.all(...params)
    },
    iterate(...params: BindParameters): IterableIterator<Result> {
      guard.assertActive()
      return createGuardedIterator(statement.iterate(...params), guard)
    },
    pluck(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      statement.pluck(toggleState)

      return guardedStatement
    },
    expand(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      statement.expand(toggleState)

      return guardedStatement
    },
    raw(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      statement.raw(toggleState)

      return guardedStatement
    },
    bind(...params: BindParameters): DatabaseTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      statement.bind(...params)

      return guardedStatement
    },
    columns(): Database.ColumnDefinition[] {
      guard.assertActive()
      return statement.columns()
    },
    safeIntegers(toggleState?: boolean): DatabaseTransactionStatement<BindParameters, Result> {
      guard.assertActive()
      statement.safeIntegers(toggleState)

      return guardedStatement
    }
  })

  return guardedStatement
}

function createGuardedIterator<Result>(
  iterator: IterableIterator<Result>,
  guard: TransactionScopeGuard
): IterableIterator<Result> {
  return Object.freeze({
    [Symbol.iterator](): IterableIterator<Result> {
      return this
    },
    next(...args: [] | [undefined]): IteratorResult<Result> {
      guard.assertActive()
      return iterator.next(...args)
    },
    return(value?: unknown): IteratorResult<Result> {
      guard.assertActive()

      if (iterator.return === undefined) {
        return { done: true, value: value as Result }
      }

      return iterator.return(value)
    },
    throw(error?: unknown): IteratorResult<Result> {
      guard.assertActive()

      if (iterator.throw === undefined) {
        throw error
      }

      return iterator.throw(error)
    }
  })
}

function assertSqlAllowedForTransactionWork(source: string): void {
  if (disallowedTransactionSqlPattern.test(stripSqlCommentsAndQuotedText(source))) {
    throw new DatabaseTransactionStateError()
  }
}

function stripSqlCommentsAndQuotedText(source: string): string {
  let stripped = ''
  let index = 0

  while (index < source.length) {
    const character = source[index]
    const nextCharacter = source[index + 1]

    if (character === '-' && nextCharacter === '-') {
      index += 2
      while (index < source.length && source[index] !== '\n') {
        index += 1
      }
      stripped += '\n'
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += index < source.length ? 2 : 0
      stripped += ' '
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSqlText(source, index, character)
      stripped += ' '
      continue
    }

    if (character === '[') {
      index += 1
      while (index < source.length && source[index] !== ']') {
        index += 1
      }
      index += index < source.length ? 1 : 0
      stripped += ' '
      continue
    }

    stripped += character
    index += 1
  }

  return stripped
}

function skipQuotedSqlText(source: string, startIndex: number, quote: string): number {
  let index = startIndex + 1

  while (index < source.length) {
    if (source[index] !== quote) {
      index += 1
      continue
    }

    if (source[index + 1] === quote) {
      index += 2
      continue
    }

    return index + 1
  }

  return index
}

function isConnectionOpen(connection: Database.Database): boolean {
  return connection.open !== false
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function isNativePromise(value: unknown): value is Promise<unknown> {
  return nodeTypes.isPromise(value)
}

function observeNativePromiseRejection(value: Promise<unknown>): void {
  void value.catch(() => undefined)
}

function toControlledTransactionError(error: unknown): Error {
  if (error instanceof DatabaseTransactionStateError) {
    return new DatabaseTransactionStateError(error.errorType)
  }

  if (error instanceof DatabaseTransactionAsyncWorkError) {
    return new DatabaseTransactionAsyncWorkError(error.errorType)
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return new DatabaseTransactionExecutionError(error.errorType)
  }

  if (error instanceof EntityIdGenerationError) {
    return new EntityIdGenerationError(error.errorType)
  }

  if (error instanceof UtcClockError) {
    return new UtcClockError(error.errorType)
  }

  if (isRepositoryError(error)) {
    return rebuildRepositoryError(error)
  }

  return new DatabaseTransactionExecutionError(getErrorType(error))
}

function logTransactionFailure(
  logger: DatabaseTransactionLogger,
  phase: DatabaseTransactionPhase,
  error: unknown
): void {
  logger.error(
    `Database transaction failed; phase=${phase}; errorType=${getTransactionLogErrorType(error)}`
  )
}

function getTransactionLogErrorType(error: unknown): string {
  if (isControlledErrorWithType(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}

function isControlledErrorWithType(
  error: unknown
): error is Error & { readonly errorType?: string } {
  return (
    error instanceof DatabaseTransactionStateError ||
    error instanceof DatabaseTransactionAsyncWorkError ||
    error instanceof DatabaseTransactionExecutionError ||
    error instanceof EntityIdGenerationError ||
    error instanceof UtcClockError ||
    isRepositoryError(error)
  )
}
