import { parseEntityId, parseUtcTimestamp } from '@main/foundation'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import {
  normalizePatientPhone,
  normalizePatientSearchText,
  type PatientAcknowledgmentStatus,
  type PatientSex,
  type PatientStatus
} from '@shared/ipc'

import { RepositoryDataIntegrityError, RepositoryValidationError } from '../repository-errors'

export interface PatientNameIdentity {
  readonly displayName: string
  readonly givenName: string
  readonly middleName: string | null
  readonly familyName: string
  readonly nameNormalized: string
}

export interface PatientResidenceIdentity {
  readonly village: string
  readonly quarter: string | null
}

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u
const patientCodePattern = /^PT-\d{6}$/u

export function formatPatientCode(sequenceValue: number): string {
  if (!Number.isInteger(sequenceValue) || sequenceValue < 1 || sequenceValue > 999999) {
    throw new RepositoryValidationError()
  }

  return `PT-${String(sequenceValue).padStart(6, '0')}`
}

export function parsePatientCode(value: unknown): string {
  if (typeof value !== 'string' || !patientCodePattern.test(value)) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

export function parsePatientNameIdentity(input: {
  readonly givenName: unknown
  readonly middleName: unknown
  readonly familyName: unknown
}): PatientNameIdentity {
  const givenName = parseRequiredPatientText(input.givenName, 80)
  const middleName = parsePatientText(input.middleName, 80, true)
  const familyName = parseRequiredPatientText(input.familyName, 80)
  const displayName = [givenName, middleName, familyName].filter(Boolean).join(' ')

  return Object.freeze({
    displayName,
    givenName,
    middleName,
    familyName,
    nameNormalized: normalizePatientSearchText(displayName)
  })
}

export function parsePatientResidenceIdentity(input: {
  readonly village: unknown
  readonly quarter: unknown
}): PatientResidenceIdentity {
  return Object.freeze({
    village: parseRequiredPatientText(input.village, 80),
    quarter: parsePatientText(input.quarter, 80, true)
  })
}

export function parsePatientOptionalText(value: unknown, maxLength: number): string | null {
  return parsePatientText(value, maxLength, true)
}

export function parsePatientPhone(value: unknown): {
  readonly phone: string | null
  readonly phoneNormalized: string | null
} {
  const phone = parsePatientText(value, 40, true)

  return Object.freeze({
    phone,
    phoneNormalized: normalizePatientPhone(phone)
  })
}

export function parsePatientSex(value: unknown): PatientSex {
  if (value === 'FEMALE' || value === 'MALE' || value === 'OTHER' || value === 'UNKNOWN') {
    return value
  }

  throw new RepositoryValidationError()
}

export function parseNullablePatientSex(value: unknown): PatientSex | null {
  if (value === null) {
    return null
  }

  return parsePatientSex(value)
}

export function parsePatientStatus(value: unknown): PatientStatus {
  if (value === 'ACTIVE' || value === 'INACTIVE') {
    return value
  }

  throw new RepositoryDataIntegrityError()
}

export function parsePatientAcknowledgmentStatus(value: unknown): PatientAcknowledgmentStatus {
  if (value === 'ACKNOWLEDGED' || value === 'DECLINED' || value === 'UNABLE_TO_ACKNOWLEDGE') {
    return value
  }

  throw new RepositoryValidationError()
}

export function parsePatientDateOnly(value: unknown): string {
  if (typeof value !== 'string' || !dateOnlyPattern.test(value)) {
    throw new RepositoryValidationError()
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parseNullablePatientDateOnly(value: unknown): string | null {
  if (value === null) {
    return null
  }

  return parsePatientDateOnly(value)
}

export function parsePatientAgeIdentity(input: {
  readonly dateOfBirth: unknown
  readonly approximateAgeYears: unknown
  readonly approximateAgeAsOfDate: unknown
}): {
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly approximateAgeAsOfDate: string | null
} {
  const dateOfBirth = parseNullablePatientDateOnly(input.dateOfBirth)
  const approximateAgeYears = parseNullableApproximateAge(input.approximateAgeYears)
  const approximateAgeAsOfDate = parseNullablePatientDateOnly(input.approximateAgeAsOfDate)

  if ((dateOfBirth === null) === (approximateAgeYears === null)) {
    throw new RepositoryValidationError()
  }

  if ((approximateAgeYears === null) !== (approximateAgeAsOfDate === null)) {
    throw new RepositoryValidationError()
  }

  if (dateOfBirth !== null && dateOfBirth > new Date().toISOString().slice(0, 10)) {
    throw new RepositoryValidationError()
  }

  return Object.freeze({
    dateOfBirth,
    approximateAgeYears,
    approximateAgeAsOfDate
  })
}

export function parseNullableApproximateAge(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 120) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parsePatientPage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100000) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parsePatientPageSize(value: unknown): 25 | 50 | 100 {
  if (value === 25 || value === 50 || value === 100) {
    return value
  }

  throw new RepositoryValidationError()
}

export function parsePatientEntityId(value: unknown): EntityId {
  try {
    return parseEntityId(value)
  } catch {
    throw new RepositoryValidationError()
  }
}

export function parsePatientUtcTimestamp(value: unknown): UtcTimestamp {
  try {
    return parseUtcTimestamp(value)
  } catch {
    throw new RepositoryValidationError()
  }
}

export function parseStoredPatientUtcTimestamp(value: unknown): UtcTimestamp {
  try {
    return parseUtcTimestamp(value)
  } catch {
    throw new RepositoryDataIntegrityError()
  }
}

export function normalizeResidenceValue(value: string | null): string | null {
  if (value === null) {
    return null
  }

  return normalizePatientSearchText(value)
}

function parsePatientText(value: unknown, maxLength: number, nullable: boolean): string | null {
  if (value === null) {
    if (nullable) {
      return null
    }

    throw new RepositoryValidationError()
  }

  if (typeof value !== 'string') {
    throw new RepositoryValidationError()
  }

  const normalized = value.trim().replace(/\s+/gu, ' ')

  if (normalized.length === 0) {
    if (nullable) {
      return null
    }

    throw new RepositoryValidationError()
  }

  if (normalized.length > maxLength || hasUnsafeControlCharacter(normalized)) {
    throw new RepositoryValidationError()
  }

  return normalized
}

function parseRequiredPatientText(value: unknown, maxLength: number): string {
  const parsed = parsePatientText(value, maxLength, false)

  if (parsed === null) {
    throw new RepositoryValidationError()
  }

  return parsed
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if ((codePoint <= 0x1f && codePoint !== 0x09) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true
    }
  }

  return false
}
