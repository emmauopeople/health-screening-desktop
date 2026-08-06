import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import {
  RepositoryValidationError,
  getRepositoryErrorType
} from '@main/database/repositories/repository-errors'
import type {
  PatientAcknowledgmentStatus,
  PatientRegistrationFields,
  PatientSex,
  PatientStatus
} from '@shared/ipc'

import type {
  NormalizedPatientFields,
  PatientCode,
  PatientDisplayName,
  PatientNormalizationOptions,
  PatientNormalizedName,
  PatientPhoneDigits
} from './patient-types'

const patientCodePattern = /^PT-\d{6}$/u
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const letterOrDecimalDigitPattern = /[\p{L}\p{Nd}]/u
const validSexes = new Set<PatientSex>(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'])
const validStatuses = new Set<PatientStatus>(['ACTIVE', 'INACTIVE'])
const validAcknowledgmentStatuses = new Set<PatientAcknowledgmentStatus>([
  'ACKNOWLEDGED',
  'DECLINED',
  'NOT_REQUESTED'
])

export function formatPatientCode(sequenceValue: number): PatientCode {
  if (!Number.isSafeInteger(sequenceValue) || sequenceValue < 1 || sequenceValue > 999999) {
    throw new RepositoryValidationError()
  }

  return `PT-${String(sequenceValue).padStart(6, '0')}` as PatientCode
}

export function parsePatientCode(value: unknown): PatientCode {
  if (typeof value !== 'string' || !patientCodePattern.test(value)) {
    throw new RepositoryValidationError()
  }

  return value as PatientCode
}

export function parsePatientRowVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

export function normalizePatientRegistrationFields(
  input: PatientRegistrationFields,
  { today }: PatientNormalizationOptions
): NormalizedPatientFields {
  return normalizePatientFields(input, 'NOT_REQUESTED', { today })
}

export function normalizePatientDemographicFields(
  input: PatientRegistrationFields,
  acknowledgmentStatus: PatientAcknowledgmentStatus,
  { today }: PatientNormalizationOptions
): NormalizedPatientFields {
  return normalizePatientFields(input, acknowledgmentStatus, { today })
}

function normalizePatientFields(
  input: PatientRegistrationFields,
  acknowledgmentStatusValue: unknown,
  { today }: PatientNormalizationOptions
): NormalizedPatientFields {
  try {
    const givenName = parsePatientText(input.givenName, 120, false)
    const familyName = parsePatientText(input.familyName, 120, false)
    const otherNames = parsePatientText(input.otherNames, 120, false)
    const displayName = createDisplayName({ givenName, familyName, otherNames })
    const dateOfBirth = parsePatientLocalDate(input.dateOfBirth, today, false)
    const approximateAgeYears = parseApproximateAge(input.approximateAgeYears)
    const ageAsOfDate = parsePatientLocalDate(input.ageAsOfDate, today, false)
    const sex = parsePatientSex(input.sex)
    const village = parsePatientText(input.village, 120, false)
    const quarter = parsePatientText(input.quarter, 120, false)
    const phone = parsePatientPhoneDisplay(input.phone)
    const phoneNormalized = phone === null ? null : normalizePhoneDigits(phone)
    const alternateContactName = parsePatientText(input.alternateContactName, 120, false)
    const alternateContactPhone = parsePatientPhoneDisplay(input.alternateContactPhone)
    const residenceNotes = parsePatientText(input.residenceNotes, 500, false)
    const status = parsePatientStatus(input.status)
    const acknowledgmentStatus = parsePatientAcknowledgmentStatus(acknowledgmentStatusValue)

    if (dateOfBirth !== null && approximateAgeYears !== null) {
      throw new RepositoryValidationError()
    }

    if (approximateAgeYears !== null && ageAsOfDate === null) {
      throw new RepositoryValidationError()
    }

    if (dateOfBirth === null && approximateAgeYears === null) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      givenName,
      familyName,
      otherNames,
      displayName,
      nameNormalized: displayName.toLowerCase() as PatientNormalizedName,
      dateOfBirth,
      approximateAgeYears,
      ageAsOfDate,
      sex,
      village,
      quarter,
      phone,
      phoneNormalized,
      alternateContactName,
      alternateContactPhone,
      residenceNotes,
      status,
      acknowledgmentStatus
    })
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

export function parsePatientEntityId(value: unknown): ReturnType<typeof parseEntityId> {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

export function parsePatientUtcTimestamp(value: unknown): ReturnType<typeof parseUtcTimestamp> {
  try {
    return parseUtcTimestamp(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

export function parsePatientSearchText(value: unknown): string {
  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
    throw new RepositoryValidationError()
  }

  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')

  if (hasUnpairedSurrogate(normalized) || hasUnsafeTextCharacter(normalized)) {
    throw new RepositoryValidationError()
  }

  if (Array.from(normalized).length > 160) {
    throw new RepositoryValidationError()
  }

  return normalized
}

export function normalizeDuplicateReasonCodes(value: readonly string[]): readonly string[] {
  const normalized = value.map((reason) => parseReasonCode(reason))
  const unique = [...new Set(normalized)].sort()

  return Object.freeze(unique)
}

function parseReasonCode(value: unknown): string {
  const parsed = parsePatientText(value, 64, true)

  if (parsed === null) {
    throw new RepositoryValidationError()
  }

  return parsed.toUpperCase().replace(/\s+/gu, '_')
}

function createDisplayName({
  givenName,
  familyName,
  otherNames
}: {
  readonly givenName: string | null
  readonly familyName: string | null
  readonly otherNames: string | null
}): PatientDisplayName {
  const displayName = [givenName, otherNames, familyName].filter(isPresentText).join(' ')

  if (!letterOrDecimalDigitPattern.test(displayName)) {
    throw new RepositoryValidationError()
  }

  return displayName as PatientDisplayName
}

function parsePatientText(
  value: unknown,
  maximumCodePoints: number,
  requireLetterOrDecimalDigit: boolean
): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
    throw new RepositoryValidationError()
  }

  const canonical = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')

  if (hasUnpairedSurrogate(canonical) || hasUnsafeTextCharacter(canonical)) {
    throw new RepositoryValidationError()
  }

  if (canonical.length === 0) {
    return null
  }

  const codePointLength = Array.from(canonical).length

  if (
    codePointLength > maximumCodePoints ||
    (requireLetterOrDecimalDigit && !letterOrDecimalDigitPattern.test(canonical))
  ) {
    throw new RepositoryValidationError()
  }

  return canonical
}

function parsePatientPhoneDisplay(value: unknown): string | null {
  const display = parsePatientText(value, 80, false)

  if (display === null) {
    return null
  }

  if (normalizePhoneDigits(display).length < 4) {
    throw new RepositoryValidationError()
  }

  return display
}

function normalizePhoneDigits(value: string): PatientPhoneDigits {
  const digits = value.replace(/\D/gu, '')

  if (digits.length < 4 || digits.length > 24) {
    throw new RepositoryValidationError()
  }

  return digits as PatientPhoneDigits
}

function parsePatientLocalDate(value: unknown, today: string, nullable: boolean): string | null {
  if (value === null && nullable) {
    return null
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || !isValidLocalDate(value)) {
    throw new RepositoryValidationError()
  }

  if (!isValidLocalDate(today) || value > today) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseApproximateAge(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 120) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePatientSex(value: unknown): PatientSex {
  if (typeof value !== 'string' || !validSexes.has(value as PatientSex)) {
    throw new RepositoryValidationError()
  }

  return value as PatientSex
}

function parsePatientStatus(value: unknown): PatientStatus {
  if (typeof value !== 'string' || !validStatuses.has(value as PatientStatus)) {
    throw new RepositoryValidationError()
  }

  return value as PatientStatus
}

function parsePatientAcknowledgmentStatus(value: unknown): PatientAcknowledgmentStatus {
  if (
    typeof value !== 'string' ||
    !validAcknowledgmentStatuses.has(value as PatientAcknowledgmentStatus)
  ) {
    throw new RepositoryValidationError()
  }

  return value as PatientAcknowledgmentStatus
}

function isValidLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
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

function isPresentText(value: string | null): value is string {
  return value !== null && value.length > 0
}
