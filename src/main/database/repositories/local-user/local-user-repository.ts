import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { validateStoredPasswordCredentialForPersistence } from '@main/security/password/password-persistence-validation'

import {
  getRepositoryErrorType,
  isRepositoryError,
  LocalUserAuthenticationStateConflictError,
  LocalUserAlreadyExistsError,
  LocalUserNotFoundError,
  rebuildRepositoryError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  decodeFailedLoginCount,
  decodeSqliteBoolean,
  encodeSqliteBoolean,
  parseCreateMustChangePassword,
  parseLocalUserRole,
  parseUserDisplayName,
  parseUpdateLocalUserAuthenticationStateInput,
  parseUsernameIdentity
} from './local-user-validation'
import type {
  CreateLocalUserInput,
  LocalUserAuthenticationRecord,
  LocalUserRecord,
  LocalUserRepository,
  NormalizedUsername,
  UpdateLocalUserAuthenticationStateInput
} from './local-user-types'

interface LocalUserReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
  }
}

interface LocalUserSqlRow {
  readonly id: unknown
  readonly username: unknown
  readonly username_normalized: unknown
  readonly display_name: unknown
  readonly role: unknown
  readonly is_active: unknown
  readonly must_change_password: unknown
  readonly failed_login_count: unknown
  readonly locked_until: unknown
  readonly last_login_at: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

interface LocalUserAuthenticationSqlRow extends LocalUserSqlRow {
  readonly password_hash: unknown
  readonly password_salt: unknown
}

interface ParsedCreateLocalUserInput {
  readonly id: string
  readonly username: string
  readonly usernameNormalized: string
  readonly displayName: string
  readonly passwordHash: string
  readonly passwordSalt: string
  readonly role: string
  readonly mustChangePassword: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

type ParsedUpdateLocalUserAuthenticationStateInput = ReturnType<
  typeof parseUpdateLocalUserAuthenticationStateInput
>

const localUserRecordColumns = `
  id,
  username,
  username_normalized,
  display_name,
  role,
  is_active,
  must_change_password,
  failed_login_count,
  locked_until,
  last_login_at,
  created_at,
  updated_at
`

const selectHasAnyLocalUserSql = `
SELECT EXISTS(
  SELECT 1 FROM users LIMIT 1
) AS has_any;
`

const selectLocalUserByIdSql = `
SELECT
${localUserRecordColumns}
FROM users
WHERE id = ?;
`

const selectLocalUserByNormalizedUsernameSql = `
SELECT
${localUserRecordColumns}
FROM users
WHERE username_normalized = ?;
`

const selectLocalUserAuthenticationByNormalizedUsernameSql = `
SELECT
  id,
  username,
  username_normalized,
  display_name,
  password_hash,
  password_salt,
  role,
  is_active,
  must_change_password,
  failed_login_count,
  locked_until,
  last_login_at,
  created_at,
  updated_at
FROM users
WHERE username_normalized = ?;
`

const selectExistingLocalUserSql = `
SELECT
  1 AS has_existing
FROM users
WHERE id = ? OR username_normalized = ?
LIMIT 1;
`

const selectExistingLocalUserByIdSql = `
SELECT
  1 AS has_existing
FROM users
WHERE id = ?
LIMIT 1;
`

const insertLocalUserSql = `
INSERT INTO users (
  id,
  username,
  username_normalized,
  display_name,
  password_hash,
  password_salt,
  role,
  is_active,
  must_change_password,
  failed_login_count,
  locked_until,
  last_login_at,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, NULL, ?, ?);
`

const updateLocalUserAuthenticationStateSql = `
UPDATE users
SET
  failed_login_count = ?,
  locked_until = ?,
  last_login_at = ?,
  updated_at = ?
WHERE id = ?
  AND failed_login_count = ?
  AND (
    (locked_until IS NULL AND ? IS NULL)
    OR locked_until = ?
  )
  AND (
    (last_login_at IS NULL AND ? IS NULL)
    OR last_login_at = ?
  )
  AND updated_at = ?;
`

const createLocalUserInputKeys = Object.freeze([
  'id',
  'username',
  'displayName',
  'credential',
  'role',
  'mustChangePassword',
  'createdAt',
  'updatedAt'
] as const)

const localUserRowKeys = Object.freeze([
  'id',
  'username',
  'username_normalized',
  'display_name',
  'role',
  'is_active',
  'must_change_password',
  'failed_login_count',
  'locked_until',
  'last_login_at',
  'created_at',
  'updated_at'
] as const)

const localUserAuthenticationRowKeys = Object.freeze([
  'id',
  'username',
  'username_normalized',
  'display_name',
  'password_hash',
  'password_salt',
  'role',
  'is_active',
  'must_change_password',
  'failed_login_count',
  'locked_until',
  'last_login_at',
  'created_at',
  'updated_at'
] as const)

export function createLocalUserRepository(connection: Database.Database): LocalUserRepository {
  const hasAny = (): boolean => decodeHasAnyRow(readHasAnyRow(connection))

  const getById = (id: CreateLocalUserInput['id']): LocalUserRecord | null => {
    const parsedId = parseReadEntityId(id)
    const row = readLocalUserRow(
      connection,
      selectLocalUserByIdSql,
      [parsedId],
      (error) => new RepositoryReadError(error)
    )

    return row === null ? null : decodeLocalUserRow(row)
  }

  const getByUsername = (username: CreateLocalUserInput['username']): LocalUserRecord | null => {
    const identity = parseReadUsernameIdentity(username)
    const row = readLocalUserRow(
      connection,
      selectLocalUserByNormalizedUsernameSql,
      [identity.usernameNormalized],
      (error) => new RepositoryReadError(error)
    )

    return row === null ? null : decodeLocalUserRow(row)
  }

  const getAuthenticationByUsername = (
    username: CreateLocalUserInput['username']
  ): LocalUserAuthenticationRecord | null => {
    const identity = parseReadUsernameIdentity(username)
    const row = readLocalUserAuthenticationRow(
      connection,
      selectLocalUserAuthenticationByNormalizedUsernameSql,
      [identity.usernameNormalized],
      (error) => new RepositoryReadError(error)
    )

    return row === null ? null : decodeLocalUserAuthenticationRow(row)
  }

  const insert = (
    scopedConnection: DatabaseTransactionConnection,
    input: CreateLocalUserInput
  ): LocalUserRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const validatedInput = parseCreateLocalUserInput(input)

    if (
      hasExistingLocalUser(scopedConnection, validatedInput.id, validatedInput.usernameNormalized)
    ) {
      throw new LocalUserAlreadyExistsError()
    }

    try {
      scopedConnection
        .prepare<[string, string, string, string, string, string, string, 0 | 1, string, string]>(
          insertLocalUserSql
        )
        .run(
          validatedInput.id,
          validatedInput.username,
          validatedInput.usernameNormalized,
          validatedInput.displayName,
          validatedInput.passwordHash,
          validatedInput.passwordSalt,
          validatedInput.role,
          encodeSqliteBoolean(validatedInput.mustChangePassword),
          validatedInput.createdAt,
          validatedInput.updatedAt
        )
    } catch (error) {
      if (error instanceof DatabaseTransactionStateError) {
        throw new DatabaseTransactionStateError(error.errorType)
      }

      if (isDuplicateSqliteConstraintError(error)) {
        throw new LocalUserAlreadyExistsError(getRepositoryErrorType(error))
      }

      throw new RepositoryWriteError(getRepositoryErrorType(error))
    }

    const created = readLocalUserAfterWrite(scopedConnection, validatedInput.id)

    if (created === null) {
      throw new RepositoryWriteError()
    }

    return created
  }

  const updateAuthenticationState = (
    scopedConnection: DatabaseTransactionConnection,
    input: UpdateLocalUserAuthenticationStateInput
  ): LocalUserRecord => {
    assertActiveDatabaseTransactionConnection(scopedConnection)

    const validatedInput = parseUpdateLocalUserAuthenticationStateInput(input)
    const updateResult = runAuthenticationStateUpdate(scopedConnection, validatedInput)

    if (updateResult.changes === 0) {
      classifyAuthenticationStateUpdateMiss(scopedConnection, validatedInput.id)
    }

    if (updateResult.changes !== 1) {
      throw new RepositoryDataIntegrityError()
    }

    const updated = readLocalUserAfterAuthenticationStateUpdate(scopedConnection, validatedInput.id)

    if (updated === null) {
      throw new RepositoryWriteError()
    }

    return updated
  }

  return Object.freeze({
    hasAny,
    getById,
    getByUsername,
    getAuthenticationByUsername,
    insert,
    updateAuthenticationState
  })
}

function readHasAnyRow(connection: LocalUserReadConnection): unknown {
  try {
    return connection.prepare(selectHasAnyLocalUserSql).get()
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

function readLocalUserAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): LocalUserRecord | null {
  const row = readLocalUserRow(
    connection,
    selectLocalUserByIdSql,
    [id],
    (error) => new RepositoryWriteError(error)
  )

  if (row === null) {
    return null
  }

  try {
    return decodeLocalUserRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function readLocalUserAfterAuthenticationStateUpdate(
  connection: DatabaseTransactionConnection,
  id: string
): LocalUserRecord | null {
  const row = readLocalUserRow(
    connection,
    selectLocalUserByIdSql,
    [id],
    (error) => new RepositoryWriteError(error)
  )

  if (row === null) {
    return null
  }

  try {
    return decodeLocalUserRow(row)
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

function readLocalUserRow(
  connection: LocalUserReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): LocalUserSqlRow | null {
  try {
    return (connection.prepare(sql).get(...params) as LocalUserSqlRow | undefined) ?? null
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function readLocalUserAuthenticationRow(
  connection: LocalUserReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): LocalUserAuthenticationSqlRow | null {
  try {
    return (
      (connection.prepare(sql).get(...params) as LocalUserAuthenticationSqlRow | undefined) ?? null
    )
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function hasExistingLocalUser(
  connection: DatabaseTransactionConnection,
  id: string,
  usernameNormalized: string
): boolean {
  try {
    const row = connection
      .prepare<[string, string], unknown>(selectExistingLocalUserSql)
      .get(id, usernameNormalized)

    return decodeExistingLocalUserRow(row)
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

function runAuthenticationStateUpdate(
  connection: DatabaseTransactionConnection,
  input: ParsedUpdateLocalUserAuthenticationStateInput
): Database.RunResult {
  try {
    return connection
      .prepare<
        [
          number,
          string | null,
          string | null,
          string,
          string,
          number,
          string | null,
          string | null,
          string | null,
          string | null,
          string
        ]
      >(updateLocalUserAuthenticationStateSql)
      .run(
        input.next.failedLoginCount,
        input.next.lockedUntil,
        input.next.lastLoginAt,
        input.next.updatedAt,
        input.id,
        input.expected.failedLoginCount,
        input.expected.lockedUntil,
        input.expected.lockedUntil,
        input.expected.lastLoginAt,
        input.expected.lastLoginAt,
        input.expected.updatedAt
      )
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    throw new RepositoryWriteError(getRepositoryErrorType(error))
  }
}

function classifyAuthenticationStateUpdateMiss(
  connection: DatabaseTransactionConnection,
  id: string
): never {
  if (!hasExistingLocalUserById(connection, id)) {
    throw new LocalUserNotFoundError()
  }

  throw new LocalUserAuthenticationStateConflictError()
}

function hasExistingLocalUserById(connection: DatabaseTransactionConnection, id: string): boolean {
  try {
    const row = connection.prepare<[string], unknown>(selectExistingLocalUserByIdSql).get(id)

    return decodeExistingLocalUserRow(row)
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

function parseCreateLocalUserInput(input: CreateLocalUserInput): ParsedCreateLocalUserInput {
  try {
    const data = readDataProperties(input, createLocalUserInputKeys)
    const id = parseEntityId(data.id)
    const identity = parseUsernameIdentity(data.username)
    const displayName = parseUserDisplayName(data.displayName)
    const credential = validateStoredPasswordCredentialForPersistence(data.credential)
    const role = parseLocalUserRole(data.role)
    const mustChangePassword = parseCreateMustChangePassword(data.mustChangePassword)
    const createdAt = parseUtcTimestamp(data.createdAt)
    const updatedAt = parseUtcTimestamp(data.updatedAt)

    if (updatedAt !== createdAt) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      id,
      username: identity.username,
      usernameNormalized: identity.usernameNormalized,
      displayName,
      passwordHash: credential.passwordHash,
      passwordSalt: credential.passwordSalt,
      role,
      mustChangePassword,
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

function parseReadEntityId(value: unknown): string {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function parseReadUsernameIdentity(value: unknown): {
  readonly usernameNormalized: NormalizedUsername
} {
  try {
    return parseUsernameIdentity(value)
  } catch (error) {
    if (isRepositoryError(error)) {
      throw rebuildRepositoryError(error)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function decodeLocalUserRow(row: LocalUserSqlRow): LocalUserRecord {
  try {
    const data = readDataProperties(row, localUserRowKeys)
    return decodeLocalUserRecordData(data)
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

function decodeLocalUserAuthenticationRow(
  row: LocalUserAuthenticationSqlRow
): LocalUserAuthenticationRecord {
  try {
    const data = readDataProperties(row, localUserAuthenticationRowKeys)
    const user = decodeLocalUserRecordData(data)
    const credential = validateStoredPasswordCredentialForPersistence({
      passwordHash: data.password_hash,
      passwordSalt: data.password_salt
    })

    return Object.freeze({
      user,
      credential
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeLocalUserRecordData(data: Record<string, unknown>): LocalUserRecord {
  const id = parseEntityId(data.id)
  const identity = parseUsernameIdentity(data.username)

  if (
    data.username !== identity.username ||
    data.username_normalized !== identity.usernameNormalized
  ) {
    throw new RepositoryDataIntegrityError()
  }

  const displayName = parseUserDisplayName(data.display_name)

  if (data.display_name !== displayName) {
    throw new RepositoryDataIntegrityError()
  }

  const role = parseLocalUserRole(data.role)
  const isActive = decodeSqliteBoolean(data.is_active)
  const mustChangePassword = decodeSqliteBoolean(data.must_change_password)
  const failedLoginCount = decodeFailedLoginCount(data.failed_login_count)
  const lockedUntil = parseNullableUtcTimestamp(data.locked_until)
  const lastLoginAt = parseNullableUtcTimestamp(data.last_login_at)
  const createdAt = parseUtcTimestamp(data.created_at)
  const updatedAt = parseUtcTimestamp(data.updated_at)

  if (updatedAt < createdAt) {
    throw new RepositoryDataIntegrityError()
  }

  return Object.freeze({
    id,
    username: identity.username,
    displayName,
    role,
    isActive,
    mustChangePassword,
    failedLoginCount,
    lockedUntil,
    lastLoginAt,
    createdAt,
    updatedAt
  })
}

function decodeExistingLocalUserRow(row: unknown): boolean {
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

function parseNullableUtcTimestamp(value: unknown): ReturnType<typeof parseUtcTimestamp> | null {
  if (value === null) {
    return null
  }

  return parseUtcTimestamp(value)
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
