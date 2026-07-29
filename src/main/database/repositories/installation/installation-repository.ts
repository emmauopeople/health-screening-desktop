import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  InstallationAlreadyExistsError,
  isRepositoryError,
  rebuildRepositoryError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import { parseDeploymentName, parseIanaTimeZone } from './installation-validation'
import type {
  CreateInstallationInput,
  InstallationRecord,
  InstallationRepository,
  InstallationState
} from './installation-types'

interface InstallationReadConnection {
  prepare(source: string): {
    get(): unknown
  }
}

interface InstallationSqlRow {
  readonly singleton_id?: unknown
  readonly id?: unknown
  readonly deployment_name?: unknown
  readonly timezone?: unknown
  readonly created_at?: unknown
  readonly updated_at?: unknown
}

const selectInstallationSql = `
SELECT
  singleton_id,
  id,
  deployment_name,
  timezone,
  created_at,
  updated_at
FROM installation
WHERE singleton_id = 1;
`

const insertInstallationSql = `
INSERT INTO installation (
  singleton_id,
  id,
  deployment_name,
  timezone,
  created_at,
  updated_at
) VALUES (1, ?, ?, ?, ?, ?);
`

export function createInstallationRepository(
  connection: Database.Database
): InstallationRepository {
  const get = (): InstallationRecord | null => {
    const row = readInstallationRow(connection, (error) => new RepositoryReadError(error))

    return row === null ? null : decodeInstallationRow(row)
  }

  const getState = (): InstallationState => {
    const installation = get()

    return installation === null
      ? Object.freeze({ status: 'UNINITIALIZED' as const })
      : Object.freeze({ status: 'INITIALIZED' as const, installation })
  }

  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: CreateInstallationInput
  ): InstallationRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const validatedInput = parseCreateInstallationInput(input)
    const existing = readInstallationForWrite(scopedConnection)

    if (existing !== null) {
      throw new InstallationAlreadyExistsError()
    }

    try {
      scopedConnection
        .prepare<[string, string, string, string, string]>(insertInstallationSql)
        .run(
          validatedInput.id,
          validatedInput.deploymentName,
          validatedInput.timeZone,
          validatedInput.createdAt,
          validatedInput.updatedAt
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      if (isSqliteConstraintError(error)) {
        throw new InstallationAlreadyExistsError(getRepositoryErrorType(error))
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }

    const created = readInstallationAfterWrite(scopedConnection)

    if (created === null) {
      throw new RepositoryWriteError()
    }

    return created
  }

  return Object.freeze({
    get,
    getState,
    insert
  })
}

function readInstallationForWrite(
  connection: DatabaseTransactionConnection
): InstallationRecord | null {
  const row = readInstallationRow(connection, (error) => new RepositoryWriteError(error))

  return row === null ? null : decodeInstallationRow(row)
}

function readInstallationAfterWrite(
  connection: DatabaseTransactionConnection
): InstallationRecord | null {
  const row = readInstallationRow(connection, (error) => new RepositoryWriteError(error))

  if (row === null) {
    return null
  }

  try {
    return decodeInstallationRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readInstallationRow(
  connection: InstallationReadConnection,
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): InstallationSqlRow | null {
  try {
    return (
      (connection.prepare(selectInstallationSql).get() as InstallationSqlRow | undefined) ?? null
    )
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function parseCreateInstallationInput(input: CreateInstallationInput): CreateInstallationInput {
  try {
    if (!isRecord(input)) {
      throw new RepositoryValidationError()
    }

    const id = parseEntityId(input.id)
    const deploymentName = parseDeploymentName(input.deploymentName)
    const timeZone = parseIanaTimeZone(input.timeZone)
    const createdAt = parseUtcTimestamp(input.createdAt)
    const updatedAt = parseUtcTimestamp(input.updatedAt)

    if (updatedAt !== createdAt) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      id,
      deploymentName,
      timeZone,
      createdAt,
      updatedAt
    })
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (isRepositoryError(error)) {
      throw rebuildRepositoryError(error)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function decodeInstallationRow(row: InstallationSqlRow): InstallationRecord {
  try {
    if (!isRecord(row) || row.singleton_id !== 1) {
      throw new RepositoryDataIntegrityError()
    }

    const id = parseEntityId(row.id)
    const deploymentName = parseDeploymentName(row.deployment_name)
    const timeZone = parseIanaTimeZone(row.timezone)
    const createdAt = parseUtcTimestamp(row.created_at)
    const updatedAt = parseUtcTimestamp(row.updated_at)

    if (updatedAt < createdAt) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze({
      id,
      deploymentName,
      timeZone,
      createdAt,
      updatedAt
    })
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSqliteConstraintError(error: unknown): boolean {
  const code = isRecord(error) ? error.code : undefined

  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}
