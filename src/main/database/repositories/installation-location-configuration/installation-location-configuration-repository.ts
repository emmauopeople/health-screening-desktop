import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  InstallationLocationConfigurationAlreadyExistsError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  parseInsertInstallationLocationConfigurationInput,
  parseInstallationLocationConfigurationRowVersion,
  parseUpdateInstallationLocationConfigurationInput,
  readDataProperties
} from './installation-location-configuration-validation'
import type {
  InstallationLocationConfigurationRecord,
  InstallationLocationConfigurationRepository,
  InsertInstallationLocationConfigurationInput,
  UpdateInstallationLocationConfigurationInput,
  UpdateInstallationLocationConfigurationResult
} from './installation-location-configuration-types'

interface InstallationLocationConfigurationReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
  }
}

const configurationRowKeys = Object.freeze([
  'singleton_id',
  'installation_id',
  'location_id',
  'configured_at',
  'configured_by',
  'updated_at',
  'updated_by',
  'row_version'
] as const)

const configurationColumns = `
  singleton_id,
  installation_id,
  location_id,
  configured_at,
  configured_by,
  updated_at,
  updated_by,
  row_version
`

const selectConfigurationSql = `
SELECT
${configurationColumns}
FROM installation_location_configuration
WHERE singleton_id = 1;
`

const insertConfigurationSql = `
INSERT INTO installation_location_configuration (
  singleton_id,
  installation_id,
  location_id,
  configured_at,
  configured_by,
  updated_at,
  updated_by,
  row_version
) VALUES (1, ?, ?, ?, ?, ?, ?, 1);
`

const updateConfigurationSql = `
UPDATE installation_location_configuration
SET
  location_id = ?,
  updated_at = ?,
  updated_by = ?,
  row_version = row_version + 1
WHERE singleton_id = 1
  AND row_version = ?;
`

export function createInstallationLocationConfigurationRepository(
  connection: Database.Database
): InstallationLocationConfigurationRepository {
  return Object.freeze({
    get(): InstallationLocationConfigurationRecord | null {
      try {
        return readConfiguration(connection, (error) => new RepositoryReadError(error))
      } catch (error) {
        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getForWrite(
      scopedConnection: DatabaseTransactionConnection
    ): InstallationLocationConfigurationRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readConfiguration(scopedConnection, (error) => new RepositoryReadError(error))
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    insert(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertInstallationLocationConfigurationInput
    ): InstallationLocationConfigurationRecord {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseInsertInstallationLocationConfigurationInput(input)

        if (
          readConfiguration(scopedConnection, (error) => new RepositoryWriteError(error)) !== null
        ) {
          throw new InstallationLocationConfigurationAlreadyExistsError()
        }

        scopedConnection
          .prepare<[string, string, string, string, string, string]>(insertConfigurationSql)
          .run(
            parsed.installationId,
            parsed.locationId,
            parsed.configuredAt,
            parsed.configuredBy,
            parsed.configuredAt,
            parsed.configuredBy
          )

        const created = readConfigurationAfterWrite(scopedConnection)

        if (created === null) {
          throw new RepositoryWriteError()
        }

        return created
      } catch (error) {
        throw toWriteError(error)
      }
    },

    updateLocation(
      scopedConnection: DatabaseTransactionConnection,
      input: UpdateInstallationLocationConfigurationInput
    ): UpdateInstallationLocationConfigurationResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseUpdateInstallationLocationConfigurationInput(input)
        const result = scopedConnection
          .prepare<[string, string, string, number]>(updateConfigurationSql)
          .run(parsed.locationId, parsed.updatedAt, parsed.updatedBy, parsed.expectedRowVersion)

        if (result.changes === 0) {
          const latest = readConfigurationAfterWrite(scopedConnection)

          if (latest === null) {
            return Object.freeze({ status: 'NOT_FOUND' as const })
          }

          return Object.freeze({
            status: 'CONFIGURATION_VERSION_CONFLICT' as const,
            configuration: latest
          })
        }

        const updated = readConfigurationAfterWrite(scopedConnection)

        if (
          updated === null ||
          updated.locationId !== parsed.locationId ||
          updated.updatedAt !== parsed.updatedAt ||
          updated.updatedBy !== parsed.updatedBy ||
          updated.rowVersion !== parsed.expectedRowVersion + 1
        ) {
          throw new RepositoryWriteError()
        }

        return Object.freeze({
          status: 'UPDATED' as const,
          configuration: updated
        })
      } catch (error) {
        throw toWriteError(error)
      }
    }
  })
}

function readConfigurationAfterWrite(
  connection: DatabaseTransactionConnection
): InstallationLocationConfigurationRecord | null {
  return readConfiguration(connection, (error) => new RepositoryWriteError(error))
}

function readConfiguration(
  connection: InstallationLocationConfigurationReadConnection,
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): InstallationLocationConfigurationRecord | null {
  try {
    const row = connection.prepare(selectConfigurationSql).get()

    return row === undefined ? null : decodeConfigurationRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function decodeConfigurationRow(row: unknown): InstallationLocationConfigurationRecord {
  try {
    const data = readDataProperties(row, configurationRowKeys)

    if (data.singleton_id !== 1) {
      throw new RepositoryDataIntegrityError()
    }

    const installationId = parseEntityId(data.installation_id)
    const locationId = parseEntityId(data.location_id)
    const configuredAt = parseUtcTimestamp(data.configured_at)
    const configuredBy = parseEntityId(data.configured_by)
    const updatedAt = parseUtcTimestamp(data.updated_at)
    const updatedBy = parseEntityId(data.updated_by)
    const rowVersion = parseInstallationLocationConfigurationRowVersion(data.row_version)

    if (updatedAt < configuredAt) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze({
      singletonId: 1 as const,
      installationId,
      locationId,
      configuredAt,
      configuredBy,
      updatedAt,
      updatedBy,
      rowVersion
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function toWriteError(error: unknown): Error {
  if (error instanceof DatabaseTransactionStateError) {
    return new DatabaseTransactionStateError(error.errorType)
  }

  if (error instanceof InstallationLocationConfigurationAlreadyExistsError) {
    return new InstallationLocationConfigurationAlreadyExistsError(error.errorType)
  }

  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }

  if (error instanceof RepositoryWriteError) {
    return new RepositoryWriteError(error.errorType)
  }

  if (isDuplicateSqliteConstraintError(error)) {
    return new InstallationLocationConfigurationAlreadyExistsError(getRepositoryErrorType(error))
  }

  return new RepositoryWriteError(getRepositoryErrorType(error))
}

function isDuplicateSqliteConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  let code: unknown
  let message: unknown

  try {
    code = Object.getOwnPropertyDescriptor(error, 'code')?.value
    message = Object.getOwnPropertyDescriptor(error, 'message')?.value
  } catch {
    return false
  }

  return (
    (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') &&
    typeof message === 'string' &&
    (message.includes('installation_location_configuration.singleton_id') ||
      message.includes('installation_location_configuration.installation_id'))
  )
}
