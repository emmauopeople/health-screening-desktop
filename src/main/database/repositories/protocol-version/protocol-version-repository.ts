import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError
} from '../repository-errors'
import { readDataProperties } from '../screening-session/screening-session-validation'
import type {
  ProtocolVersionReferenceRecord,
  ProtocolVersionReferenceStatus,
  ProtocolVersionRepository
} from './protocol-version-types'

interface ProtocolVersionReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const protocolVersionRowKeys = Object.freeze(['id', 'status'] as const)
const protocolVersionStatuses = new Set<ProtocolVersionReferenceStatus>([
  'DRAFT',
  'ACTIVE',
  'INACTIVE'
])

const selectProtocolVersionByIdSql = `
SELECT
  id,
  status
FROM protocol_versions
WHERE id = ?;
`

const selectActiveProtocolVersionSql = `
SELECT
  id,
  status
FROM protocol_versions
WHERE status = 'ACTIVE'
ORDER BY id ASC
LIMIT 2;
`

export function createProtocolVersionRepository(
  connection: Database.Database
): ProtocolVersionRepository {
  void connection

  return Object.freeze({
    getByIdForWrite(
      scopedConnection: DatabaseTransactionConnection,
      id: ProtocolVersionReferenceRecord['id']
    ): ProtocolVersionReferenceRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readProtocolVersionById(scopedConnection, parseReadEntityId(id))
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getActiveForWrite(
      scopedConnection: DatabaseTransactionConnection
    ): ProtocolVersionReferenceRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const records = decodeProtocolVersionRows(
          scopedConnection.prepare(selectActiveProtocolVersionSql).all()
        )

        if (records.length > 1) {
          throw new RepositoryDataIntegrityError()
        }

        return records[0] ?? null
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    }
  })
}

function readProtocolVersionById(
  connection: ProtocolVersionReadConnection,
  id: string
): ProtocolVersionReferenceRecord | null {
  try {
    const row = connection.prepare(selectProtocolVersionByIdSql).get(id)

    return row === undefined ? null : decodeProtocolVersionRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function decodeProtocolVersionRows(rows: unknown): readonly ProtocolVersionReferenceRecord[] {
  try {
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      throw new RepositoryDataIntegrityError()
    }

    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
    const lengthDescriptor = descriptors.length

    if (
      lengthDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > 2
    ) {
      throw new RepositoryDataIntegrityError()
    }

    const length = lengthDescriptor.value as number
    const propertyNames = Object.getOwnPropertyNames(descriptors)

    if (
      propertyNames.length !== length + 1 ||
      propertyNames.some((propertyName) => {
        if (propertyName === 'length') {
          return false
        }

        const numeric = Number(propertyName)
        return (
          !/^(0|[1-9]\d*)$/u.test(propertyName) ||
          !Number.isSafeInteger(numeric) ||
          numeric < 0 ||
          numeric >= length ||
          String(numeric) !== propertyName
        )
      }) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')
    ) {
      throw new RepositoryDataIntegrityError()
    }

    const records: ProtocolVersionReferenceRecord[] = []

    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryDataIntegrityError()
      }

      records.push(decodeProtocolVersionRow(descriptor.value))
    }

    return Object.freeze(records)
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeProtocolVersionRow(row: unknown): ProtocolVersionReferenceRecord {
  try {
    const data = readDataProperties(row, protocolVersionRowKeys)
    const id = parseEntityId(data.id)
    const status = parseProtocolVersionStatus(data.status)

    return Object.freeze({ id, status })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function parseProtocolVersionStatus(value: unknown): ProtocolVersionReferenceStatus {
  if (
    typeof value !== 'string' ||
    !protocolVersionStatuses.has(value as ProtocolVersionReferenceStatus)
  ) {
    throw new RepositoryDataIntegrityError()
  }

  return value as ProtocolVersionReferenceStatus
}

function parseReadEntityId(value: unknown): string {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}
