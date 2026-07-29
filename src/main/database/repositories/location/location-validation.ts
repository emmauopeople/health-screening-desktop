import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import type {
  LocationAdministrativeArea,
  LocationDirections,
  LocationName,
  LocationNameIdentity,
  LocationType,
  NormalizedLocationName
} from './location-types'

const maximumLocationNameCodePoints = 120
const maximumAdministrativeAreaCodePoints = 120
const maximumDirectionsCodePoints = 500
const letterOrDecimalDigitPattern = /[\p{L}\p{Nd}]/u
const locationTypes = new Set<LocationType>([
  'CHURCH',
  'QUARTER',
  'VILLAGE',
  'COMMUNITY_SITE',
  'OTHER'
])

export function parseLocationNameIdentity(value: unknown): LocationNameIdentity {
  try {
    const name = parseCanonicalText(value, maximumLocationNameCodePoints, true) as LocationName

    return Object.freeze({
      name,
      nameNormalized: name.toLowerCase() as NormalizedLocationName
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLocationName(value: unknown): LocationName {
  return parseLocationNameIdentity(value).name
}

export function parseLocationType(value: unknown): LocationType {
  if (typeof value !== 'string' || !locationTypes.has(value as LocationType)) {
    throw new RepositoryValidationError()
  }

  return value as LocationType
}

export function parseLocationAdministrativeArea(value: unknown): LocationAdministrativeArea | null {
  if (value === null) {
    return null
  }

  try {
    return parseCanonicalText(
      value,
      maximumAdministrativeAreaCodePoints,
      true
    ) as LocationAdministrativeArea
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLocationDirections(value: unknown): LocationDirections | null {
  if (value === null) {
    return null
  }

  try {
    return parseCanonicalText(value, maximumDirectionsCodePoints, false) as LocationDirections
  } catch (error) {
    throw toValidationError(error)
  }
}

export function decodeSqliteLocationBoolean(value: unknown): boolean {
  if (value === 0) {
    return false
  }

  if (value === 1) {
    return true
  }

  throw new RepositoryValidationError()
}

function parseCanonicalText(
  value: unknown,
  maximumCodePoints: number,
  requireLetterOrDecimalDigit: boolean
): string {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
    throw new RepositoryValidationError()
  }

  const normalized = value.normalize('NFKC')

  if (hasUnpairedSurrogate(normalized) || hasUnsafeTextCharacter(normalized)) {
    throw new RepositoryValidationError()
  }

  const canonical = normalized.trim().replace(/\s+/gu, ' ')
  const codePointLength = Array.from(canonical).length

  if (
    codePointLength < 1 ||
    codePointLength > maximumCodePoints ||
    (requireLetterOrDecimalDigit && !letterOrDecimalDigitPattern.test(canonical))
  ) {
    throw new RepositoryValidationError()
  }

  return canonical
}

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
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
