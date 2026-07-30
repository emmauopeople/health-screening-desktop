import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import type {
  LocalUserRole,
  NormalizedUsername,
  UserDisplayName,
  Username,
  UsernameIdentity
} from './local-user-types'

const minimumUsernameCodePoints = 3
const maximumUsernameCodePoints = 64
const maximumDisplayNameCodePoints = 120
const maximumAuthenticationFailedLoginCount = Number.MAX_SAFE_INTEGER
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/u
const localUserRoles = new Set<LocalUserRole>(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'])
const authenticationStateSnapshotKeys = Object.freeze([
  'failedLoginCount',
  'lockedUntil',
  'lastLoginAt',
  'updatedAt'
] as const)
const updateAuthenticationStateInputKeys = Object.freeze(['id', 'expected', 'next'] as const)

export interface ParsedLocalUserAuthenticationStateSnapshot {
  readonly failedLoginCount: number
  readonly lockedUntil: string | null
  readonly lastLoginAt: string | null
  readonly updatedAt: string
}

export interface ParsedUpdateLocalUserAuthenticationStateInput {
  readonly id: string
  readonly expected: ParsedLocalUserAuthenticationStateSnapshot
  readonly next: ParsedLocalUserAuthenticationStateSnapshot
}

export function parseUsernameIdentity(value: unknown): UsernameIdentity {
  try {
    if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
      throw new RepositoryValidationError()
    }

    const normalized = value.normalize('NFKC')

    if (hasUnpairedSurrogate(normalized)) {
      throw new RepositoryValidationError()
    }

    const username = normalized.trim()
    const codePointLength = Array.from(username).length

    if (
      codePointLength < minimumUsernameCodePoints ||
      codePointLength > maximumUsernameCodePoints ||
      !isAscii(username) ||
      !usernamePattern.test(username)
    ) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      username: username as Username,
      usernameNormalized: toAsciiLowercase(username) as NormalizedUsername
    })
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

export function parseUsername(value: unknown): Username {
  return parseUsernameIdentity(value).username
}

export function parseUserDisplayName(value: unknown): UserDisplayName {
  try {
    if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
      throw new RepositoryValidationError()
    }

    const normalized = value.normalize('NFKC')

    if (hasUnpairedSurrogate(normalized) || hasUnsafeDisplayNameCharacter(normalized)) {
      throw new RepositoryValidationError()
    }

    const displayName = normalized.trim().replace(/\s+/gu, ' ')
    const codePointLength = Array.from(displayName).length

    if (codePointLength < 1 || codePointLength > maximumDisplayNameCodePoints) {
      throw new RepositoryValidationError()
    }

    return displayName as UserDisplayName
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

export function parseLocalUserRole(value: unknown): LocalUserRole {
  if (typeof value !== 'string' || !localUserRoles.has(value as LocalUserRole)) {
    throw new RepositoryValidationError()
  }

  return value as LocalUserRole
}

export function parseCreateMustChangePassword(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new RepositoryValidationError()
  }

  return value
}

export function decodeSqliteBoolean(value: unknown): boolean {
  if (value === 0) {
    return false
  }

  if (value === 1) {
    return true
  }

  throw new RepositoryValidationError()
}

export function encodeSqliteBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0
}

export function decodeFailedLoginCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximumAuthenticationFailedLoginCount
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parseUpdateLocalUserAuthenticationStateInput(
  value: unknown
): ParsedUpdateLocalUserAuthenticationStateInput {
  try {
    const data = readStrictPlainDataProperties(value, updateAuthenticationStateInputKeys)
    const id = parseEntityId(data.id)
    const expected = parseAuthenticationStateSnapshot(data.expected)
    const next = parseAuthenticationStateSnapshot(data.next)

    validateAuthenticationStateTransition(expected, next)

    return Object.freeze({
      id,
      expected,
      next
    })
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function parseAuthenticationStateSnapshot(
  value: unknown
): ParsedLocalUserAuthenticationStateSnapshot {
  const data = readStrictPlainDataProperties(value, authenticationStateSnapshotKeys)

  return Object.freeze({
    failedLoginCount: decodeFailedLoginCount(data.failedLoginCount),
    lockedUntil: parseNullableUtcTimestamp(data.lockedUntil),
    lastLoginAt: parseNullableUtcTimestamp(data.lastLoginAt),
    updatedAt: parseUtcTimestamp(data.updatedAt)
  })
}

function validateAuthenticationStateTransition(
  expected: ParsedLocalUserAuthenticationStateSnapshot,
  next: ParsedLocalUserAuthenticationStateSnapshot
): void {
  if (next.updatedAt < expected.updatedAt) {
    throw new RepositoryValidationError()
  }

  if (expected.lastLoginAt !== null) {
    if (next.lastLoginAt === null || next.lastLoginAt < expected.lastLoginAt) {
      throw new RepositoryValidationError()
    }
  }

  if (next.lockedUntil !== null && next.lockedUntil <= next.updatedAt) {
    throw new RepositoryValidationError()
  }
}

function parseNullableUtcTimestamp(value: unknown): ReturnType<typeof parseUtcTimestamp> | null {
  if (value === null) {
    return null
  }

  return parseUtcTimestamp(value)
}

function readStrictPlainDataProperties<TExpectedKey extends string>(
  value: unknown,
  expectedKeys: readonly TExpectedKey[]
): Record<TExpectedKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype) {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data = {} as Record<TExpectedKey, unknown>

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function toAsciiLowercase(value: string): string {
  let lowered = ''

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    lowered += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : value[index]
  }

  return lowered
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false
    }
  }

  return true
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true
      }

      index += 1
      continue
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }

  return false
}

function hasUnsafeDisplayNameCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return true
    }
  }

  return false
}
