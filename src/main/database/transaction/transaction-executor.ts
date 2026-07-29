import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import type { EntityIdGenerator } from '@main/foundation/entity-id'
import type { UtcClock } from '@main/foundation/utc-clock'

import {
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  type DatabaseTransactionContext,
  type DatabaseTransactionExecutor,
  type DatabaseTransactionExecutorOptions,
  type DatabaseTransactionLogger,
  type DatabaseTransactionPhase
} from './transaction-types'

const defaultLogger: DatabaseTransactionLogger = console

export function createDatabaseTransactionExecutor({
  connection,
  idGenerator,
  clock,
  logger = defaultLogger
}: DatabaseTransactionExecutorOptions): DatabaseTransactionExecutor {
  return {
    run<T>(work: (context: DatabaseTransactionContext) => T): T {
      if (!isConnectionOpen(connection) || connection.inTransaction) {
        const error = new DatabaseTransactionStateError()
        logTransactionFailure(logger, 'state', error)
        throw error
      }

      let transactionAcquired = false
      let phase: DatabaseTransactionPhase = 'begin'

      try {
        connection.exec('BEGIN IMMEDIATE')
        transactionAcquired = true

        phase = 'state'
        if (!connection.inTransaction) {
          throw new DatabaseTransactionStateError()
        }

        phase = 'work'
        const result = work(createTransactionContext(connection, idGenerator, clock))

        if (isThenable(result)) {
          throw new DatabaseTransactionAsyncWorkError()
        }

        phase = 'commit'
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

        if (transactionAcquired && connection.inTransaction) {
          try {
            connection.exec('ROLLBACK')
          } catch (rollbackError) {
            logger.error(
              `Database transaction rollback failed; phase=rollback; errorType=${getErrorType(rollbackError)}`
            )
          }
        }

        logTransactionFailure(logger, failurePhase, error)
        throw controlledError
      }
    }
  }
}

function createTransactionContext(
  connection: DatabaseTransactionContext['connection'],
  idGenerator: EntityIdGenerator,
  clock: UtcClock
): DatabaseTransactionContext {
  return Object.freeze({
    connection,
    newEntityId: () => parseEntityId(idGenerator.generate()),
    nowUtc: () => parseUtcTimestamp(clock.now())
  })
}

function isConnectionOpen(connection: DatabaseTransactionContext['connection']): boolean {
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

function toControlledTransactionError(error: unknown): Error {
  if (
    error instanceof DatabaseTransactionStateError ||
    error instanceof DatabaseTransactionAsyncWorkError ||
    isSafeFoundationError(error)
  ) {
    return error
  }

  return new DatabaseTransactionExecutionError(getErrorType(error))
}

function isSafeFoundationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === 'EntityIdGenerationError' || error.name === 'UtcClockError')
  )
}

function logTransactionFailure(
  logger: DatabaseTransactionLogger,
  phase: DatabaseTransactionPhase,
  error: unknown
): void {
  logger.error(`Database transaction failed; phase=${phase}; errorType=${getErrorType(error)}`)
}

function getErrorType(error: unknown): string {
  return sanitizeErrorType(error instanceof Error ? error.name : typeof error)
}

function sanitizeErrorType(errorType: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorType) ? errorType : 'UnknownError'
}
