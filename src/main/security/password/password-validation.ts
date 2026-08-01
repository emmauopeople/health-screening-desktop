import { PasswordValidationError } from './password-errors'
import type { PlaintextPassword } from './password-types'

const passwordMinimumCodePoints = 12
const passwordMaximumCodePoints = 128
const passwordMaximumUtf8Bytes = 512

export function parsePlaintextPassword(value: unknown): PlaintextPassword {
  if (typeof value !== 'string') {
    throw new PasswordValidationError()
  }

  if (hasUnpairedSurrogate(value) || hasUnsafePasswordCharacter(value)) {
    throw new PasswordValidationError()
  }

  const codePointLength = Array.from(value).length
  const utf8ByteLength = Buffer.byteLength(value, 'utf8')

  if (
    codePointLength < passwordMinimumCodePoints ||
    codePointLength > passwordMaximumCodePoints ||
    utf8ByteLength > passwordMaximumUtf8Bytes
  ) {
    throw new PasswordValidationError()
  }

  return value as PlaintextPassword
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (Number.isNaN(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
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

function hasUnsafePasswordCharacter(value: string): boolean {
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
