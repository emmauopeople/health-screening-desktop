import { parseUsernameIdentity } from '@main/database'
import { getErrorType } from '@main/foundation/error-type'
import { parsePlaintextPassword } from '@main/security'

import { LocalLoginValidationError } from './local-login-errors'
import type { ParsedLocalLoginInput } from './local-login-types'

const localLoginInputKeys = Object.freeze(['username', 'password'] as const)

type LocalLoginInputKey = (typeof localLoginInputKeys)[number]

export function parseLocalLoginInput(input: unknown): ParsedLocalLoginInput {
  try {
    const data = readExactPlainDataProperties(input, localLoginInputKeys)
    const usernameIdentity = parseUsernameIdentity(data.username)

    return Object.freeze({
      username: usernameIdentity.username,
      password: parsePlaintextPassword(data.password)
    })
  } catch (error) {
    if (error instanceof LocalLoginValidationError) {
      throw new LocalLoginValidationError(error.errorType)
    }

    throw new LocalLoginValidationError(getErrorType(error))
  }
}

function readExactPlainDataProperties<TExpectedKey extends LocalLoginInputKey>(
  value: unknown,
  expectedKeys: readonly TExpectedKey[]
): Record<TExpectedKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalLoginValidationError()
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
    throw new LocalLoginValidationError(getErrorType(error))
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocalLoginValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key as TExpectedKey))
  ) {
    throw new LocalLoginValidationError()
  }

  const data = Object.create(null) as Record<TExpectedKey, unknown>

  for (const key of expectedKeys) {
    const descriptor = descriptors[key]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new LocalLoginValidationError()
    }

    data[key] = descriptor.value
  }

  return data
}
