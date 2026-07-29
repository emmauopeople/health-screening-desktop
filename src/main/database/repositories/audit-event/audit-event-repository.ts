import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  AuditEventAlreadyExistsError,
  getRepositoryErrorType,
  isRepositoryError,
  rebuildRepositoryError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseAuditMetadata,
  parseAuditQueryLimit,
  parseStoredAuditMetadataJson
} from './audit-event-validation'
import type {
  AuditEventRecord,
  AuditEventRepository,
  AuditQueryLimit,
  CreateAuditEventInput
} from './audit-event-types'

interface AuditEventReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown
  }
}

interface ParsedCreateAuditEventInput {
  readonly id: string
  readonly installationId: string
  readonly userId: string | null
  readonly action: string
  readonly entityType: string
  readonly entityId: string | null
  readonly occurredAt: string
  readonly metadataJson: string
}

const auditEventRecordColumns = `
  id,
  installation_id,
  user_id,
  action,
  entity_type,
  entity_id,
  occurred_at,
  metadata_json
`

const selectAuditEventByIdSql = `
SELECT
${auditEventRecordColumns}
FROM audit_log
WHERE id = ?;
`

const selectRecentAuditEventsSql = `
SELECT
${auditEventRecordColumns}
FROM audit_log
ORDER BY occurred_at DESC, id DESC
LIMIT ?;
`

const selectAuditEventsForEntitySql = `
SELECT
${auditEventRecordColumns}
FROM audit_log
WHERE entity_type = ? AND entity_id = ?
ORDER BY occurred_at DESC, id DESC
LIMIT ?;
`

const selectExistingAuditEventSql = `
SELECT
  1 AS has_existing
FROM audit_log
WHERE id = ?
LIMIT 1;
`

const insertAuditEventSql = `
INSERT INTO audit_log (
  id,
  installation_id,
  user_id,
  action,
  entity_type,
  entity_id,
  occurred_at,
  metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`

const createAuditEventInputKeys = Object.freeze([
  'id',
  'installationId',
  'userId',
  'action',
  'entityType',
  'entityId',
  'occurredAt',
  'metadata'
] as const)

const auditEventRowKeys = Object.freeze([
  'id',
  'installation_id',
  'user_id',
  'action',
  'entity_type',
  'entity_id',
  'occurred_at',
  'metadata_json'
] as const)

export function createAuditEventRepository(connection: Database.Database): AuditEventRepository {
  const getById = (id: CreateAuditEventInput['id']): AuditEventRecord | null => {
    const parsedId = parseReadEntityId(id)
    const row = readAuditEventRow(
      connection,
      selectAuditEventByIdSql,
      [parsedId],
      (error) => new RepositoryReadError(error)
    )

    return row === undefined ? null : decodeAuditEventRow(row)
  }

  const listRecent = (limit: AuditQueryLimit): readonly AuditEventRecord[] => {
    const parsedLimit = parseAuditQueryLimit(limit)

    return decodeAuditEventRows(
      readAuditEventRows(
        connection,
        selectRecentAuditEventsSql,
        [parsedLimit],
        (error) => new RepositoryReadError(error)
      )
    )
  }

  const listForEntity = (
    entityType: CreateAuditEventInput['entityType'],
    entityId: CreateAuditEventInput['entityId'],
    limit: AuditQueryLimit
  ): readonly AuditEventRecord[] => {
    const parsedEntityType = parseAuditEntityType(entityType)
    const parsedEntityId = parseRequiredEntityId(entityId)
    const parsedLimit = parseAuditQueryLimit(limit)

    return decodeAuditEventRows(
      readAuditEventRows(
        connection,
        selectAuditEventsForEntitySql,
        [parsedEntityType, parsedEntityId, parsedLimit],
        (error) => new RepositoryReadError(error)
      )
    )
  }

  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: CreateAuditEventInput
  ): AuditEventRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const validatedInput = parseCreateAuditEventInput(input)

    if (hasExistingAuditEvent(scopedConnection, validatedInput.id)) {
      throw new AuditEventAlreadyExistsError()
    }

    try {
      scopedConnection
        .prepare<[string, string, string | null, string, string, string | null, string, string]>(
          insertAuditEventSql
        )
        .run(
          validatedInput.id,
          validatedInput.installationId,
          validatedInput.userId,
          validatedInput.action,
          validatedInput.entityType,
          validatedInput.entityId,
          validatedInput.occurredAt,
          validatedInput.metadataJson
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      if (isDuplicateSqliteConstraintError(error)) {
        throw new AuditEventAlreadyExistsError(getRepositoryErrorType(error))
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }

    const created = readAuditEventAfterWrite(scopedConnection, validatedInput.id)

    if (created === null) {
      throw new RepositoryWriteError()
    }

    return created
  }

  return Object.freeze({
    getById,
    listRecent,
    listForEntity,
    insert
  })
}

function readAuditEventAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): AuditEventRecord | null {
  const row = readAuditEventRow(
    connection,
    selectAuditEventByIdSql,
    [id],
    (error) => new RepositoryWriteError(error)
  )

  if (row === undefined) {
    return null
  }

  try {
    return decodeAuditEventRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readAuditEventRow(
  connection: AuditEventReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): unknown {
  try {
    return connection.prepare(sql).get(...params)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function readAuditEventRows(
  connection: AuditEventReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): unknown {
  try {
    return connection.prepare(sql).all(...params)
  } catch (error) {
    throw createFailure(getRepositoryErrorType(error))
  }
}

function hasExistingAuditEvent(connection: DatabaseTransactionConnection, id: string): boolean {
  try {
    const row = connection.prepare<[string], unknown>(selectExistingAuditEventSql).get(id)

    return decodeExistingAuditEventRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function parseCreateAuditEventInput(input: CreateAuditEventInput): ParsedCreateAuditEventInput {
  try {
    const data = readDataProperties(input, createAuditEventInputKeys)
    const id = parseEntityId(data.id)
    const installationId = parseEntityId(data.installationId)
    const userId = parseNullableEntityId(data.userId)
    const action = parseAuditActionCode(data.action)
    const entityType = parseAuditEntityType(data.entityType)
    const entityId = parseNullableEntityId(data.entityId)
    const occurredAt = parseUtcTimestamp(data.occurredAt)
    const metadata = parseAuditMetadata(data.metadata)

    return Object.freeze({
      id,
      installationId,
      userId,
      action,
      entityType,
      entityId,
      occurredAt,
      metadataJson: metadata.metadataJson
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

function parseReadEntityId(value: unknown): string {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function parseRequiredEntityId(value: unknown): string {
  if (value === null) {
    throw new RepositoryValidationError()
  }

  return parseReadEntityId(value)
}

function parseNullableEntityId(value: unknown): ReturnType<typeof parseEntityId> | null {
  if (value === null) {
    return null
  }

  return parseEntityId(value)
}

function decodeAuditEventRows(rows: unknown): readonly AuditEventRecord[] {
  try {
    if (!Array.isArray(rows)) {
      throw new RepositoryDataIntegrityError()
    }

    const descriptors = readArrayPropertyDescriptors(rows)
    const lengthDescriptor = descriptors.length

    if (
      lengthDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      throw new RepositoryDataIntegrityError()
    }

    const length = lengthDescriptor.value as number
    const expectedKeys = new Set<PropertyKey>(['length'])
    const records: AuditEventRecord[] = []

    for (let index = 0; index < length; index += 1) {
      const propertyName = String(index)
      const descriptor = descriptors[propertyName]
      expectedKeys.add(propertyName)

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryDataIntegrityError()
      }

      records.push(decodeAuditEventRow(descriptor.value))
    }

    const keys = Reflect.ownKeys(descriptors)

    if (keys.length !== expectedKeys.size || !keys.every((key) => expectedKeys.has(key))) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze(records)
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readArrayPropertyDescriptors(
  rows: readonly unknown[]
): Record<PropertyKey, PropertyDescriptor | undefined> {
  try {
    return Object.getOwnPropertyDescriptors(rows) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeAuditEventRow(row: unknown): AuditEventRecord {
  try {
    const data = readDataProperties(row, auditEventRowKeys)
    return decodeAuditEventRecordData(data)
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

function decodeAuditEventRecordData(data: Record<string, unknown>): AuditEventRecord {
  const id = parseEntityId(data.id)
  const installationId = parseEntityId(data.installation_id)
  const userId = parseNullableEntityId(data.user_id)
  const action = parseAuditActionCode(data.action)
  const entityType = parseAuditEntityType(data.entity_type)
  const entityId = parseNullableEntityId(data.entity_id)
  const occurredAt = parseUtcTimestamp(data.occurred_at)
  const metadata = parseStoredAuditMetadataJson(data.metadata_json)

  return Object.freeze({
    id,
    installationId,
    userId,
    action,
    entityType,
    entityId,
    occurredAt,
    metadata: metadata.metadata
  })
}

function decodeExistingAuditEventRow(row: unknown): boolean {
  if (row === undefined) {
    return false
  }

  try {
    const data = readDataProperties(row, ['has_existing'])

    if (data.has_existing !== 1) {
      throw new RepositoryDataIntegrityError()
    }

    return true
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  let descriptors: PropertyDescriptorMap

  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function isDuplicateSqliteConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  let codeDescriptor: PropertyDescriptor | undefined

  try {
    codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code')
  } catch {
    return false
  }

  if (
    codeDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(codeDescriptor, 'value')
  ) {
    return false
  }

  const code = codeDescriptor.value

  return code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE'
}
