import { DatabaseTransactionStateError } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import { readDataProperties } from '../screening-encounter'
import type {
  FoodDate,
  FoodDraftOwnershipInput,
  FoodDraftRowInput,
  FoodDraftUpdateInput,
  FoodFrequencyCode,
  FoodResponse,
  FoodSourceType
} from './food-types'

export const foodResponseCodes = Object.freeze([
  'REPORTED',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
] as const satisfies readonly FoodResponse[])

export const foodFrequencyCodes = Object.freeze([
  '1_DAY',
  '2_TO_3_DAYS',
  '4_TO_6_DAYS',
  'EVERY_DAY'
] as const satisfies readonly FoodFrequencyCode[])

export const foodSourceTypes = Object.freeze([
  'PATIENT_REPORTED'
] as const satisfies readonly FoodSourceType[])

const responseCodeSet = new Set<FoodResponse>(foodResponseCodes)
const frequencyCodeSet = new Set<FoodFrequencyCode>(foodFrequencyCodes)
const sourceTypeSet = new Set<FoodSourceType>(foodSourceTypes)
const datePattern = /^\d{4}-\d{2}-\d{2}$/u
const maximumFoodNameLength = 100
const maximumPreparationNoteLength = 200

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

export function parseFoodDraftOwnershipInput(
  input: FoodDraftOwnershipInput
): FoodDraftOwnershipInput {
  try {
    const data = readDataProperties(input, ownershipKeys)
    const periodStart = parseFoodDate(data.periodStart)
    const periodEnd = parseFoodDate(data.periodEnd)
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

export function parseFoodDraftUpdateInput(input: FoodDraftUpdateInput): FoodDraftUpdateInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'expectedRowVersion',
      'foodResponse',
      'rows',
      'actorId',
      'occurredAt'
    ] as const)
    const foodResponse = parseNullableCode(data.foodResponse, responseCodeSet)
    const rows = parseFoodRows(data.rows)
    if (foodResponse !== 'REPORTED' && rows.length > 0) throw new RepositoryValidationError()
    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parsePositiveInteger(data.expectedRowVersion),
      foodResponse,
      rows,
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function normalizeFoodName(value: unknown): {
  readonly snapshot: string
  readonly normalized: string
} {
  const snapshot = parseRequiredSafeText(value, maximumFoodNameLength)
  const normalized = snapshot.replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
  if (normalized.length === 0 || normalized.length > maximumFoodNameLength)
    throw new RepositoryValidationError()
  return Object.freeze({ snapshot, normalized })
}

export function normalizePreparationNote(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return parseSafeText(trimmed, maximumPreparationNoteLength)
}

export function parseFoodDate(value: unknown): FoodDate {
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
  return value as FoodDate
}

function parseFoodRows(value: unknown): readonly FoodDraftRowInput[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  const rows = value.map(parseFoodRow)
  const ids = new Set(rows.map((row) => row.id))
  if (ids.size !== rows.length) throw new RepositoryValidationError()
  const sequences = new Set(rows.map((row) => row.sequenceNumber))
  if (sequences.size !== rows.length) throw new RepositoryValidationError()
  const normalizedNames = new Set(
    rows.map((row) => normalizeFoodName(row.foodNameSnapshot).normalized)
  )
  if (normalizedNames.size !== rows.length) throw new RepositoryValidationError()
  return Object.freeze(rows)
}

function parseFoodRow(value: unknown): FoodDraftRowInput {
  const data = readDataProperties(value, [
    'id',
    'sequenceNumber',
    'catalogCode',
    'foodNameSnapshot',
    'frequencyCode',
    'preparationNote',
    'sourceType'
  ] as const)
  const foodName = normalizeFoodName(data.foodNameSnapshot)
  return Object.freeze({
    id: parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    catalogCode: parseNullableCatalogCode(data.catalogCode),
    foodNameSnapshot: foodName.snapshot,
    frequencyCode: parseNullableCode(data.frequencyCode, frequencyCodeSet),
    preparationNote: normalizePreparationNote(data.preparationNote),
    sourceType: parseCode(data.sourceType, sourceTypeSet)
  })
}

function parseNullableCatalogCode(value: unknown): string | null {
  if (value === null) return null
  const code = parseSafeText(value, 64)
  if (!/^[A-Z][A-Z0-9_]*$/u.test(code)) throw new RepositoryValidationError()
  return code
}

function parseCode<T extends string>(value: unknown, codes: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !codes.has(value as T)) throw new RepositoryValidationError()
  return value as T
}

function parseNullableCode<T extends string>(value: unknown, codes: ReadonlySet<T>): T | null {
  return value === null ? null : parseCode(value, codes)
}

function parseRequiredSafeText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') throw new RepositoryValidationError()
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new RepositoryValidationError()
  return parseSafeText(trimmed, maximumLength)
}

function parseSafeText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    hasUnsafeTextCharacter(value) ||
    hasUnpairedSurrogate(value)
  )
    throw new RepositoryValidationError()
  return value
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
