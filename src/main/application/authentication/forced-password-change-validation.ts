import { parseEntityId } from '@main/foundation'
import { getErrorType } from '@main/foundation/error-type'
import { parsePlaintextPassword } from '@main/security'

import { LocalForcedPasswordChangeValidationError } from './forced-password-change-errors'
import type { ParsedLocalForcedPasswordChangeInput } from './forced-password-change-types'

const forcedPasswordChangeInputKeys = Object.freeze([
  'userId',
  'currentPassword',
  'newPassword',
  'confirmNewPassword'
] as const)

type ForcedPasswordChangeInputKey = (typeof forcedPasswordChangeInputKeys)[number]

export function parseLocalForcedPasswordChangeInput(
  input: unknown
): ParsedLocalForcedPasswordChangeInput {
  try {
    const data = readExactPlainDataProperties(input, forcedPasswordChangeInputKeys)

    return Object.freeze({
      userId: parseEntityId(data.userId),
      currentPassword: parsePlaintextPassword(data.currentPassword),
      newPassword: parsePlaintextPassword(data.newPassword),
      confirmNewPassword: parsePlaintextPassword(data.confirmNewPassword)
    })
  } catch (error) {
    if (error instanceof LocalForcedPasswordChangeValidationError) {
      throw new LocalForcedPasswordChangeValidationError(error.errorType)
    }

    throw new LocalForcedPasswordChangeValidationError(getErrorType(error))
  }
}

function readExactPlainDataProperties<TExpectedKey extends ForcedPasswordChangeInputKey>(
  value: unknown,
  expectedKeys: readonly TExpectedKey[]
): Record<TExpectedKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalForcedPasswordChangeValidationError()
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
    throw new LocalForcedPasswordChangeValidationError(getErrorType(error))
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new LocalForcedPasswordChangeValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key as TExpectedKey))
  ) {
    throw new LocalForcedPasswordChangeValidationError()
  }

  const data = Object.create(null) as Record<TExpectedKey, unknown>

  for (const key of expectedKeys) {
    const descriptor = descriptors[key]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new LocalForcedPasswordChangeValidationError()
    }

    data[key] = descriptor.value
  }

  return data
}
