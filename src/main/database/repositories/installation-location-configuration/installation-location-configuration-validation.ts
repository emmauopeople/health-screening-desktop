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
  InsertInstallationLocationConfigurationInput,
  UpdateInstallationLocationConfigurationInput
} from './installation-location-configuration-types'

export interface ParsedInsertInstallationLocationConfigurationInput {
  readonly installationId: string
  readonly locationId: string
  readonly configuredAt: string
  readonly configuredBy: string
}

export interface ParsedUpdateInstallationLocationConfigurationInput {
  readonly locationId: string
  readonly updatedAt: string
  readonly updatedBy: string
  readonly expectedRowVersion: number
}

const insertInputKeys = Object.freeze([
  'installationId',
  'locationId',
  'configuredAt',
  'configuredBy'
] as const)

const updateInputKeys = Object.freeze([
  'locationId',
  'updatedAt',
  'updatedBy',
  'expectedRowVersion'
] as const)

export function parseInsertInstallationLocationConfigurationInput(
  input: InsertInstallationLocationConfigurationInput
): ParsedInsertInstallationLocationConfigurationInput {
  try {
    const data = readDataProperties(input, insertInputKeys)

    return Object.freeze({
      installationId: parseEntityId(data.installationId),
      locationId: parseEntityId(data.locationId),
      configuredAt: parseUtcTimestamp(data.configuredAt),
      configuredBy: parseEntityId(data.configuredBy)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseUpdateInstallationLocationConfigurationInput(
  input: UpdateInstallationLocationConfigurationInput
): ParsedUpdateInstallationLocationConfigurationInput {
  try {
    const data = readDataProperties(input, updateInputKeys)

    return Object.freeze({
      locationId: parseEntityId(data.locationId),
      updatedAt: parseUtcTimestamp(data.updatedAt),
      updatedBy: parseEntityId(data.updatedBy),
      expectedRowVersion: parseInstallationLocationConfigurationRowVersion(data.expectedRowVersion)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseInstallationLocationConfigurationRowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
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
