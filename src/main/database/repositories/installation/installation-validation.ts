import { getErrorType } from '@main/foundation/error-type'

import { RepositoryValidationError } from '../repository-errors'
import type { DeploymentName, IanaTimeZone } from './installation-types'

const deploymentNameMaximumCodePoints = 120
const timezoneMaximumLength = 64
const asciiVisiblePattern = /^[\x21-\x7e]+$/u
const fixedOffsetTimeZonePattern = /^[+-]\d{2}:\d{2}$/u

export function parseDeploymentName(value: unknown): DeploymentName {
  if (typeof value !== 'string') {
    throw new RepositoryValidationError()
  }

  if (hasUnpairedSurrogate(value)) {
    throw new RepositoryValidationError()
  }

  const normalized = value.normalize('NFKC')

  if (hasUnpairedSurrogate(normalized) || hasUnsafeDeploymentNameCharacter(normalized)) {
    throw new RepositoryValidationError()
  }

  const canonical = normalized.trim().replace(/\s+/gu, ' ')
  const codePointLength = Array.from(canonical).length

  if (codePointLength < 1 || codePointLength > deploymentNameMaximumCodePoints) {
    throw new RepositoryValidationError()
  }

  return canonical as DeploymentName
}

export function parseIanaTimeZone(value: unknown): IanaTimeZone {
  if (typeof value !== 'string') {
    throw new RepositoryValidationError()
  }

  const candidate = value.trim()

  if (
    candidate !== value ||
    candidate.length < 1 ||
    candidate.length > timezoneMaximumLength ||
    !asciiVisiblePattern.test(candidate) ||
    /\s/u.test(candidate)
  ) {
    throw new RepositoryValidationError()
  }

  try {
    const resolvedTimeZone = new Intl.DateTimeFormat('en-US', {
      timeZone: candidate
    }).resolvedOptions().timeZone

    if (fixedOffsetTimeZonePattern.test(resolvedTimeZone)) {
      throw new RepositoryValidationError()
    }

    return resolvedTimeZone as IanaTimeZone
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getErrorType(error))
  }
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

function hasUnsafeDeploymentNameCharacter(value: string): boolean {
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
