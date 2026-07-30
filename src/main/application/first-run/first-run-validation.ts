import {
  parseDeploymentName,
  parseIanaTimeZone,
  parseLocationAdministrativeArea,
  parseLocationDirections,
  parseLocationNameIdentity,
  parseLocationType,
  parseUserDisplayName,
  parseUsernameIdentity
} from '@main/database'
import { getErrorType } from '@main/foundation/error-type'

import { FirstRunValidationError } from './first-run-errors'
import type {
  ParsedFirstRunInitializationInput,
  ParsedFirstRunLocationInput
} from './first-run-types'

const topLevelInputKeys = Object.freeze([
  'deploymentName',
  'timeZone',
  'administrator',
  'initialLocation'
] as const)

const administratorInputKeys = Object.freeze([
  'username',
  'displayName',
  'temporaryPassword'
] as const)

const locationInputKeys = Object.freeze([
  'name',
  'locationType',
  'village',
  'subdivision',
  'region',
  'directions'
] as const)

type ExpectedPropertyKeys = readonly string[]

export function parseFirstRunInitializationInput(
  input: unknown
): ParsedFirstRunInitializationInput {
  try {
    const data = readExactDataProperties(input, topLevelInputKeys)
    const administrator = readExactDataProperties(data.administrator, administratorInputKeys)
    const initialLocation = readExactDataProperties(data.initialLocation, locationInputKeys)
    const usernameIdentity = parseUsernameIdentity(administrator.username)
    const locationIdentity = parseLocationNameIdentity(initialLocation.name)

    return Object.freeze({
      deploymentName: parseDeploymentName(data.deploymentName),
      timeZone: parseIanaTimeZone(data.timeZone),
      administrator: Object.freeze({
        username: usernameIdentity.username,
        displayName: parseUserDisplayName(administrator.displayName),
        temporaryPassword: administrator.temporaryPassword
      }),
      initialLocation: parseFirstRunLocationInput(initialLocation, locationIdentity.name)
    })
  } catch (error) {
    if (error instanceof FirstRunValidationError) {
      throw new FirstRunValidationError(error.errorType)
    }

    throw new FirstRunValidationError(getErrorType(error))
  }
}

function parseFirstRunLocationInput(
  input: Record<string, unknown>,
  name: ParsedFirstRunLocationInput['name']
): ParsedFirstRunLocationInput {
  return Object.freeze({
    name,
    locationType: parseLocationType(input.locationType),
    village: parseLocationAdministrativeArea(input.village),
    subdivision: parseLocationAdministrativeArea(input.subdivision),
    region: parseLocationAdministrativeArea(input.region),
    directions: parseLocationDirections(input.directions)
  })
}

function readExactDataProperties(
  value: unknown,
  expectedKeys: ExpectedPropertyKeys
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FirstRunValidationError()
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
    throw new FirstRunValidationError(getErrorType(error))
  }

  if (prototype !== Object.prototype) {
    throw new FirstRunValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new FirstRunValidationError()
  }

  const data: Record<string, unknown> = Object.create(null)

  for (const key of expectedKeys) {
    const descriptor = descriptors[key]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new FirstRunValidationError()
    }

    data[key] = descriptor.value
  }

  return data
}
