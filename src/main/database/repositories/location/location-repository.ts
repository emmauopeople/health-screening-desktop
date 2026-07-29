import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  isRepositoryError,
  LocationAlreadyExistsError,
  rebuildRepositoryError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  decodeSqliteLocationBoolean,
  parseLocationAdministrativeArea,
  parseLocationDirections,
  parseLocationNameIdentity,
  parseLocationType
} from './location-validation'
import type { CreateLocationInput, LocationRecord, LocationRepository } from './location-types'

interface LocationReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown
  }
}

interface LocationSqlRow {
  readonly id: unknown
  readonly name: unknown
  readonly name_normalized: unknown
  readonly location_type: unknown
  readonly village: unknown
  readonly subdivision: unknown
  readonly region: unknown
  readonly directions: unknown
  readonly is_active: unknown
  readonly created_by: unknown
  readonly created_at: unknown
  readonly updated_by: unknown
  readonly updated_at: unknown
}

interface ParsedCreateLocationInput {
  readonly id: string
  readonly name: string
  readonly nameNormalized: string
  readonly locationType: string
  readonly village: string | null
  readonly subdivision: string | null
  readonly region: string | null
  readonly directions: string | null
  readonly createdBy: string
  readonly createdAt: string
}

const locationRecordColumns = `
  id,
  name,
  name_normalized,
  location_type,
  village,
  subdivision,
  region,
  directions,
  is_active,
  created_by,
  created_at,
  updated_by,
  updated_at
`

const selectHasAnyLocationSql = `
SELECT EXISTS(
  SELECT 1 FROM locations LIMIT 1
) AS has_any;
`

const selectLocationByIdSql = `
SELECT
${locationRecordColumns}
FROM locations
WHERE id = ?;
`

const selectAllLocationsSql = `
SELECT
${locationRecordColumns}
FROM locations
ORDER BY name_normalized ASC, id ASC;
`

const selectActiveLocationsSql = `
SELECT
${locationRecordColumns}
FROM locations
WHERE is_active = 1
ORDER BY name_normalized ASC, id ASC;
`

const selectExistingLocationSql = `
SELECT
  1 AS has_existing
FROM locations
WHERE id = ?
LIMIT 1;
`

const insertLocationSql = `
INSERT INTO locations (
  id,
  name,
  name_normalized,
  location_type,
  village,
  subdivision,
  region,
  directions,
  is_active,
  created_by,
  created_at,
  updated_by,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?);
`

const createLocationInputKeys = Object.freeze([
  'id',
  'name',
  'locationType',
  'village',
  'subdivision',
  'region',
  'directions',
  'createdBy',
  'createdAt'
] as const)

const locationRowKeys = Object.freeze([
  'id',
  'name',
  'name_normalized',
  'location_type',
  'village',
  'subdivision',
  'region',
  'directions',
  'is_active',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at'
] as const)

export function createLocationRepository(connection: Database.Database): LocationRepository {
  const hasAny = (): boolean => decodeHasAnyRow(readHasAnyRow(connection))

  const getById = (id: CreateLocationInput['id']): LocationRecord | null => {
    const parsedId = parseReadEntityId(id)
    const row = readLocationRow(
      connection,
      selectLocationByIdSql,
      [parsedId],
      (error) => new RepositoryReadError(error)
    )

    return row === null ? null : decodeLocationRow(row)
  }

  const listAll = (): readonly LocationRecord[] => {
    return decodeLocationRows(
      readLocationRows(connection, selectAllLocationsSql, (error) => new RepositoryReadError(error))
    )
  }

  const listActive = (): readonly LocationRecord[] => {
    return decodeLocationRows(
      readLocationRows(
        connection,
        selectActiveLocationsSql,
        (error) => new RepositoryReadError(error)
      )
    )
  }

  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: CreateLocationInput
  ): LocationRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const validatedInput = parseCreateLocationInput(input)

    if (hasExistingLocation(scopedConnection, validatedInput.id)) {
      throw new LocationAlreadyExistsError()
    }

    try {
      scopedConnection
        .prepare<
          [
            string,
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            string | null,
            string,
            string,
            string,
            string
          ]
        >(insertLocationSql)
        .run(
          validatedInput.id,
          validatedInput.name,
          validatedInput.nameNormalized,
          validatedInput.locationType,
          validatedInput.village,
          validatedInput.subdivision,
          validatedInput.region,
          validatedInput.directions,
          validatedInput.createdBy,
          validatedInput.createdAt,
          validatedInput.createdBy,
          validatedInput.createdAt
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      if (isDuplicateSqliteConstraintError(error)) {
        throw new LocationAlreadyExistsError(getRepositoryErrorType(error))
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }

    const created = readLocationAfterWrite(scopedConnection, validatedInput.id)

    if (created === null) {
      throw new RepositoryWriteError()
    }

    return created
  }

  return Object.freeze({
    hasAny,
    getById,
    listAll,
    listActive,
    insert
  })
}

function readHasAnyRow(connection: LocationReadConnection): unknown {
  try {
    return connection.prepare(selectHasAnyLocationSql).get()
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function decodeHasAnyRow(row: unknown): boolean {
  try {
    const data = readDataProperties(row, ['has_any'])

    if (data.has_any === 0) {
      return false
    }

    if (data.has_any === 1) {
      return true
    }

    throw new RepositoryDataIntegrityError()
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function readLocationAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): LocationRecord | null {
  const row = readLocationRow(
    connection,
    selectLocationByIdSql,
    [id],
    (error) => new RepositoryWriteError(error)
  )

  if (row === null) {
    return null
  }

  try {
    return decodeLocationRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readLocationRow(
  connection: LocationReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): LocationSqlRow | null {
  try {
    return (connection.prepare(sql).get(...params) as LocationSqlRow | undefined) ?? null
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function readLocationRows(
  connection: LocationReadConnection,
  sql: string,
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): unknown {
  try {
    return connection.prepare(sql).all()
  } catch (error) {
    throw createFailure(getRepositoryErrorType(error))
  }
}

function hasExistingLocation(connection: DatabaseTransactionConnection, id: string): boolean {
  try {
    const row = connection.prepare<[string], unknown>(selectExistingLocationSql).get(id)

    return decodeExistingLocationRow(row)
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

function parseCreateLocationInput(input: CreateLocationInput): ParsedCreateLocationInput {
  try {
    const data = readDataProperties(input, createLocationInputKeys)
    const id = parseEntityId(data.id)
    const identity = parseLocationNameIdentity(data.name)
    const locationType = parseLocationType(data.locationType)
    const village = parseLocationAdministrativeArea(data.village)
    const subdivision = parseLocationAdministrativeArea(data.subdivision)
    const region = parseLocationAdministrativeArea(data.region)
    const directions = parseLocationDirections(data.directions)
    const createdBy = parseEntityId(data.createdBy)
    const createdAt = parseUtcTimestamp(data.createdAt)

    return Object.freeze({
      id,
      name: identity.name,
      nameNormalized: identity.nameNormalized,
      locationType,
      village,
      subdivision,
      region,
      directions,
      createdBy,
      createdAt
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

function decodeLocationRows(rows: unknown): readonly LocationRecord[] {
  try {
    if (!Array.isArray(rows)) {
      throw new RepositoryDataIntegrityError()
    }

    const records: LocationRecord[] = []

    for (let index = 0; index < rows.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(rows, index)) {
        throw new RepositoryDataIntegrityError()
      }

      records.push(decodeLocationRow(rows[index]))
    }

    return Object.freeze(records)
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeLocationRow(row: unknown): LocationRecord {
  try {
    const data = readDataProperties(row, locationRowKeys)
    return decodeLocationRecordData(data)
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

function decodeLocationRecordData(data: Record<string, unknown>): LocationRecord {
  const id = parseEntityId(data.id)
  const identity = parseLocationNameIdentity(data.name)

  if (data.name !== identity.name || data.name_normalized !== identity.nameNormalized) {
    throw new RepositoryDataIntegrityError()
  }

  const locationType = parseLocationType(data.location_type)
  const village = parseLocationAdministrativeArea(data.village)
  const subdivision = parseLocationAdministrativeArea(data.subdivision)
  const region = parseLocationAdministrativeArea(data.region)
  const directions = parseLocationDirections(data.directions)

  if (
    data.village !== village ||
    data.subdivision !== subdivision ||
    data.region !== region ||
    data.directions !== directions
  ) {
    throw new RepositoryDataIntegrityError()
  }

  const isActive = decodeSqliteLocationBoolean(data.is_active)
  const createdBy = parseEntityId(data.created_by)
  const createdAt = parseUtcTimestamp(data.created_at)
  const updatedBy = parseEntityId(data.updated_by)
  const updatedAt = parseUtcTimestamp(data.updated_at)

  if (updatedAt < createdAt) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id,
    name: identity.name,
    locationType,
    village,
    subdivision,
    region,
    directions,
    isActive,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt
  })
}

function decodeExistingLocationRow(row: unknown): boolean {
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
