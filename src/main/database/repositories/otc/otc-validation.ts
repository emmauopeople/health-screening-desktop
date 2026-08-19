import { DatabaseTransactionStateError } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import {
  OTC_DOSE_TEXT_MAX_LENGTH,
  OTC_DURATION_TEXT_MAX_LENGTH,
  OTC_FREQUENCY_TEXT_MAX_LENGTH,
  OTC_PRODUCT_NAME_MAX_LENGTH,
  OTC_REASON_FOR_USE_MAX_LENGTH,
  OTC_SOURCE_OF_MEDICATION_MAX_LENGTH
} from '@shared/otc-text-limits'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import { readDataProperties } from '../screening-encounter'
import type {
  OtcCurrentlyTakingResponse,
  OtcDate,
  OtcDraftOwnershipInput,
  OtcDraftRowInput,
  OtcDraftUpdateInput,
  OtcResponse,
  OtcSourceType
} from './otc-types'

export const otcResponseCodes = Object.freeze([
  'REPORTED',
  'NONE_REPORTED',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
] as const satisfies readonly OtcResponse[])

export const otcCurrentlyTakingResponseCodes = Object.freeze([
  'YES',
  'NO',
  'UNKNOWN'
] as const satisfies readonly OtcCurrentlyTakingResponse[])

export const otcSourceTypes = Object.freeze([
  'PATIENT_REPORTED'
] as const satisfies readonly OtcSourceType[])

const responseCodeSet = new Set<OtcResponse>(otcResponseCodes)
const currentlyTakingResponseSet = new Set<OtcCurrentlyTakingResponse>(
  otcCurrentlyTakingResponseCodes
)
const sourceTypeSet = new Set<OtcSourceType>(otcSourceTypes)
const datePattern = /^\d{4}-\d{2}-\d{2}$/u

const ownershipKeys = Object.freeze([
  'id',
  'encounterId',
  'patientId',
  'screeningSessionId',
  'locationId',
  'installationId',
  'periodStart',
  'periodEnd',
  'actorId',
  'occurredAt'
] as const)

export function parseOtcDraftOwnershipInput(input: OtcDraftOwnershipInput): OtcDraftOwnershipInput {
  try {
    const data = readDataProperties(input, ownershipKeys)
    const periodStart = parseOtcDate(data.periodStart)
    const periodEnd = parseOtcDate(data.periodEnd)
    if (periodStart > periodEnd) throw new RepositoryValidationError()
    return Object.freeze({
      id: parseEntityId(data.id),
      encounterId: parseEntityId(data.encounterId),
      patientId: parseEntityId(data.patientId),
      screeningSessionId: parseEntityId(data.screeningSessionId),
      locationId: parseEntityId(data.locationId),
      installationId: parseEntityId(data.installationId),
      periodStart,
      periodEnd,
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseOtcDraftUpdateInput(input: OtcDraftUpdateInput): OtcDraftUpdateInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'expectedRowVersion',
      'otcResponse',
      'rows',
      'actorId',
      'occurredAt'
    ] as const)
    const otcResponse = parseNullableCode(data.otcResponse, responseCodeSet)
    const rows = parseOtcRows(data.rows)
    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parsePositiveInteger(data.expectedRowVersion),
      otcResponse,
      rows: isRowPermittingOtcResponse(otcResponse) ? rows : [],
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function isRowPermittingOtcResponse(otcResponse: OtcResponse | null): boolean {
  return otcResponse === 'REPORTED' || otcResponse === null
}

export function normalizeOtcProductName(value: unknown): {
  readonly snapshot: string
  readonly normalized: string
} {
  const snapshot = parseRequiredSafeText(value, OTC_PRODUCT_NAME_MAX_LENGTH)
  const normalized = snapshot.replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
  if (normalized.length === 0 || normalized.length > OTC_PRODUCT_NAME_MAX_LENGTH)
    throw new RepositoryValidationError()
  return Object.freeze({ snapshot, normalized })
}

export function normalizeOptionalOtcProductName(value: unknown): {
  readonly snapshot: string | null
  readonly normalized: string | null
} {
  if (value === null) return Object.freeze({ snapshot: null, normalized: null })
  const normalized = normalizeOtcProductName(value)
  return Object.freeze(normalized)
}

export function normalizeOtcReasonForUse(value: unknown): string | null {
  return normalizeOptionalSafeText(value, OTC_REASON_FOR_USE_MAX_LENGTH)
}

export function normalizeOtcDoseText(value: unknown): string | null {
  return normalizeOptionalSafeText(value, OTC_DOSE_TEXT_MAX_LENGTH)
}

export function normalizeOtcFrequencyText(value: unknown): string | null {
  return normalizeOptionalSafeText(value, OTC_FREQUENCY_TEXT_MAX_LENGTH)
}

export function normalizeOtcDurationText(value: unknown): string | null {
  return normalizeOptionalSafeText(value, OTC_DURATION_TEXT_MAX_LENGTH)
}

export function normalizeOtcSourceOfMedication(value: unknown): string | null {
  return normalizeOptionalSafeText(value, OTC_SOURCE_OF_MEDICATION_MAX_LENGTH)
}

export function parseOtcDate(value: unknown): OtcDate {
  if (typeof value !== 'string' || !datePattern.test(value)) throw new RepositoryValidationError()
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    throw new RepositoryValidationError()
  return value as OtcDate
}

function parseOtcRows(value: unknown): readonly OtcDraftRowInput[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  const rows = value.map(parseOtcRow)
  const ids = new Set(rows.map((row) => row.id))
  if (ids.size !== rows.length) throw new RepositoryValidationError()
  const sequences = new Set(rows.map((row) => row.sequenceNumber))
  if (sequences.size !== rows.length) throw new RepositoryValidationError()
  return Object.freeze(rows)
}

function parseOtcRow(value: unknown): OtcDraftRowInput {
  const data = readDataProperties(value, [
    'id',
    'sequenceNumber',
    'productNameSnapshot',
    'reasonForUse',
    'doseText',
    'frequencyText',
    'durationText',
    'sourceOfMedication',
    'currentlyTakingResponse',
    'sourceType'
  ] as const)
  const productName = normalizeOptionalOtcProductName(data.productNameSnapshot)
  const row = Object.freeze({
    id: parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    productNameSnapshot: productName.snapshot,
    reasonForUse: normalizeOtcReasonForUse(data.reasonForUse),
    doseText: normalizeOtcDoseText(data.doseText),
    frequencyText: normalizeOtcFrequencyText(data.frequencyText),
    durationText: normalizeOtcDurationText(data.durationText),
    sourceOfMedication: normalizeOtcSourceOfMedication(data.sourceOfMedication),
    currentlyTakingResponse: parseNullableCode(
      data.currentlyTakingResponse,
      currentlyTakingResponseSet
    ),
    sourceType: parseCode(data.sourceType, sourceTypeSet)
  })
  if (!hasMeaningfulRowValue(row)) throw new RepositoryValidationError()
  return row
}

function hasMeaningfulRowValue(row: OtcDraftRowInput): boolean {
  return (
    row.productNameSnapshot !== null ||
    row.reasonForUse !== null ||
    row.doseText !== null ||
    row.frequencyText !== null ||
    row.durationText !== null ||
    row.sourceOfMedication !== null ||
    row.currentlyTakingResponse !== null
  )
}

function parseCode<T extends string>(value: unknown, codes: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !codes.has(value as T)) throw new RepositoryValidationError()
  return value as T
}

function parseNullableCode<T extends string>(value: unknown, codes: ReadonlySet<T>): T | null {
  return value === null ? null : parseCode(value, codes)
}

function parseRequiredSafeText(value: unknown, maximumLength: number): string {
  const normalized = normalizeOptionalSafeText(value, maximumLength)
  if (normalized === null) throw new RepositoryValidationError()
  return normalized
}

function normalizeOptionalSafeText(value: unknown, maximumLength: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (
    trimmed.length > maximumLength ||
    hasUnsafeTextCharacter(trimmed) ||
    hasUnpairedSurrogate(trimmed)
  )
    throw new RepositoryValidationError()
  return trimmed
}

function parsePositiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    Object.is(value, -0)
  )
    throw new RepositoryValidationError()
  return value
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function hasUnsafeTextCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof DatabaseTransactionStateError)
    throw new DatabaseTransactionStateError(error.errorType)
  if (error instanceof RepositoryValidationError)
    return new RepositoryValidationError(error.errorType)
  return new RepositoryValidationError(getRepositoryErrorType(error))
}
