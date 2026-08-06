import { DatabaseTransactionStateError } from '@main/database/transaction'
import {
  getRepositoryErrorType,
  isRepositoryError,
  rebuildRepositoryError,
  RepositoryValidationError
} from '@main/database/repositories/repository-errors'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import type {
  InsertCanonicalRootScreeningEncounterInput,
  ScreeningEncounterStatus
} from './screening-encounter-types'

export interface ParsedInsertCanonicalRootScreeningEncounterInput {
  readonly id: string
  readonly patientId: string
  readonly screeningSessionId: string
  readonly locationId: string
  readonly protocolVersionId: string
  readonly startedAt: string
  readonly recordedBy: string
}

const insertCanonicalRootInputKeys = Object.freeze([
  'id',
  'patientId',
  'screeningSessionId',
  'locationId',
  'protocolVersionId',
  'startedAt',
  'recordedBy'
] as const)

const statuses = new Set<ScreeningEncounterStatus>(['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])

export function parseInsertCanonicalRootScreeningEncounterInput(
  input: InsertCanonicalRootScreeningEncounterInput
): ParsedInsertCanonicalRootScreeningEncounterInput {
  try {
    const data = readDataProperties(input, insertCanonicalRootInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patientId),
      screeningSessionId: parseEntityId(data.screeningSessionId),
      locationId: parseEntityId(data.locationId),
      protocolVersionId: parseEntityId(data.protocolVersionId),
      startedAt: parseUtcTimestamp(data.startedAt),
      recordedBy: parseEntityId(data.recordedBy)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseScreeningEncounterStatus(value: unknown): ScreeningEncounterStatus {
  if (typeof value !== 'string' || !statuses.has(value as ScreeningEncounterStatus)) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningEncounterStatus
}

export function parseScreeningEncounterRecordVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parseNullableScreeningEncounterText(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || hasUnpairedSurrogate(value) || hasUnsafeTextCharacter(value)) {
    throw new RepositoryValidationError()
  }

  if (Array.from(value).length > 500) {
    throw new RepositoryValidationError()
  }

  return value
}

export function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  let isArray: boolean

  try {
    isArray = Array.isArray(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (typeof value !== 'object' || value === null || isArray) {
    throw new RepositoryValidationError()
  }

  let prototype: unknown
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
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

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof DatabaseTransactionStateError) {
    throw new DatabaseTransactionStateError(error.errorType)
  }

  if (isRepositoryError(error)) {
    const rebuilt = rebuildRepositoryError(error)

    if (rebuilt instanceof RepositoryValidationError) {
      return rebuilt
    }

    return new RepositoryValidationError(rebuilt.errorType)
  }

  return new RepositoryValidationError(getRepositoryErrorType(error))
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

function hasUnsafeTextCharacter(value: string): boolean {
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
