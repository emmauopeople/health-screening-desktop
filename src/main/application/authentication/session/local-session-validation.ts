import {
  decodeFailedLoginCount,
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  type LocalUserRecord,
  type LocalUserRole
} from '@main/database'
import { parseEntityId, parseUtcTimestamp, type UtcTimestamp } from '@main/foundation'
import { getErrorType } from '@main/foundation/error-type'
import { parsePlaintextPassword } from '@main/security'

import {
  LocalSessionStateIntegrityError,
  LocalSessionValidationError
} from './local-session-errors'
import type {
  ParsedLocalSessionPasswordChangeInput,
  ParsedLocalSessionRoleList,
  ParsedLocalSessionUnlockInput
} from './local-session-types'

const passwordChangeInputKeys = Object.freeze([
  'currentPassword',
  'newPassword',
  'confirmNewPassword'
] as const)
const unlockInputKeys = Object.freeze(['password'] as const)
const localUserRecordKeys = Object.freeze([
  'id',
  'username',
  'displayName',
  'role',
  'isActive',
  'mustChangePassword',
  'failedLoginCount',
  'lockedUntil',
  'lastLoginAt',
  'createdAt',
  'updatedAt'
] as const)

type ExpectedKey = (typeof passwordChangeInputKeys)[number] | (typeof unlockInputKeys)[number]

export function parseLocalSessionPasswordChangeInput(
  input: unknown
): ParsedLocalSessionPasswordChangeInput {
  try {
    const data = readExactPlainDataProperties(input, passwordChangeInputKeys)

    return Object.freeze({
      currentPassword: parsePlaintextPassword(data.currentPassword),
      newPassword: parsePlaintextPassword(data.newPassword),
      confirmNewPassword: parsePlaintextPassword(data.confirmNewPassword)
    })
  } catch (error) {
    if (error instanceof LocalSessionValidationError) {
      throw new LocalSessionValidationError(error.errorType)
    }

    throw new LocalSessionValidationError(getErrorType(error))
  }
}

export function parseLocalSessionUnlockInput(input: unknown): ParsedLocalSessionUnlockInput {
  try {
    const data = readExactPlainDataProperties(input, unlockInputKeys)

    return Object.freeze({
      password: parsePlaintextPassword(data.password)
    })
  } catch (error) {
    if (error instanceof LocalSessionValidationError) {
      throw new LocalSessionValidationError(error.errorType)
    }

    throw new LocalSessionValidationError(getErrorType(error))
  }
}

export function parseLocalSessionRoleList(input: unknown): ParsedLocalSessionRoleList {
  try {
    if (!Array.isArray(input)) {
      throw new LocalSessionValidationError()
    }

    let prototype: unknown
    let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>

    try {
      prototype = Object.getPrototypeOf(input)
      descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
        PropertyKey,
        PropertyDescriptor | undefined
      >
    } catch (error) {
      throw new LocalSessionValidationError(getErrorType(error))
    }

    if (prototype !== Array.prototype || input.length < 1) {
      throw new LocalSessionValidationError()
    }

    const expectedKeys = [
      ...Array.from({ length: input.length }, (_value, index) => String(index)),
      'length'
    ]
    const keys = Reflect.ownKeys(descriptors)

    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      throw new LocalSessionValidationError()
    }

    const roles: LocalUserRole[] = []
    const seen = new Set<LocalUserRole>()

    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new LocalSessionValidationError()
      }

      const role = parseLocalUserRole(descriptor.value)

      if (seen.has(role)) {
        throw new LocalSessionValidationError()
      }

      seen.add(role)
      roles.push(role)
    }

    return Object.freeze(roles)
  } catch (error) {
    if (error instanceof LocalSessionValidationError) {
      throw new LocalSessionValidationError(error.errorType)
    }

    throw new LocalSessionValidationError(getErrorType(error))
  }
}

export function parseCredentialFreeLocalSessionUser(value: unknown): LocalUserRecord {
  try {
    const data = readExactPlainDataProperties(value, localUserRecordKeys)
    const usernameIdentity = parseUsernameIdentity(data.username)
    const displayName = parseUserDisplayName(data.displayName)

    requireCanonicalString(data.username, usernameIdentity.username)
    requireCanonicalString(data.displayName, displayName)

    return Object.freeze({
      id: parseEntityId(data.id),
      username: usernameIdentity.username,
      displayName,
      role: parseLocalUserRole(data.role),
      isActive: parseBoolean(data.isActive),
      mustChangePassword: parseBoolean(data.mustChangePassword),
      failedLoginCount: decodeFailedLoginCount(data.failedLoginCount),
      lockedUntil: parseNullableUtcTimestamp(data.lockedUntil),
      lastLoginAt: parseNullableUtcTimestamp(data.lastLoginAt),
      createdAt: parseUtcTimestamp(data.createdAt),
      updatedAt: parseUtcTimestamp(data.updatedAt)
    })
  } catch (error) {
    if (error instanceof LocalSessionStateIntegrityError) {
      throw new LocalSessionStateIntegrityError(error.errorType)
    }

    throw new LocalSessionStateIntegrityError(getErrorType(error))
  }
}

function readExactPlainDataProperties<TExpectedKey extends ExpectedKey | string>(
  value: unknown,
  expectedKeys: readonly TExpectedKey[]
): Record<TExpectedKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalSessionValidationError()
  }

  let prototype: unknown
  let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
  } catch (error) {
    throw new LocalSessionValidationError(getErrorType(error))
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocalSessionValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key as TExpectedKey))
  ) {
    throw new LocalSessionValidationError()
  }

  const data = Object.create(null) as Record<TExpectedKey, unknown>

  for (const key of expectedKeys) {
    const descriptor = descriptors[key]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new LocalSessionValidationError()
    }

    data[key] = descriptor.value
  }

  return data
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new LocalSessionStateIntegrityError()
  }

  return value
}

function parseNullableUtcTimestamp(value: unknown): UtcTimestamp | null {
  if (value === null) {
    return null
  }

  return parseUtcTimestamp(value)
}

function requireCanonicalString(value: unknown, canonical: string): void {
  if (value !== canonical) {
    throw new LocalSessionStateIntegrityError()
  }
}
