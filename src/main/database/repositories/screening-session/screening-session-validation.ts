import { DatabaseTransactionStateError } from '@main/database/transaction'
import {
  getRepositoryErrorType,
  isRepositoryError,
  rebuildRepositoryError,
  RepositoryValidationError
} from '@main/database/repositories/repository-errors'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import type {
  CloseScreeningSessionInput,
  InsertScreeningSessionInput,
  ReopenScreeningSessionInput,
  ScreeningSessionDate,
  ScreeningSessionListInput,
  ScreeningSessionStatus
} from './screening-session-types'

export interface ParsedInsertScreeningSessionInput {
  readonly id: string
  readonly lifecycleHistoryId: string
  readonly locationId: string
  readonly protocolVersionId: string
  readonly sessionDate: string
  readonly notes: string | null
  readonly createdBy: string
  readonly createdAt: string
}

export interface ParsedCloseScreeningSessionInput {
  readonly id: string
  readonly lifecycleHistoryId: string
  readonly expectedRowVersion: number
  readonly closedBy: string
  readonly closedAt: string
  readonly reason: string | null
}

export interface ParsedReopenScreeningSessionInput {
  readonly id: string
  readonly lifecycleHistoryId: string
  readonly expectedRowVersion: number
  readonly reopenedBy: string
  readonly reopenedAt: string
  readonly reason: string
}

export interface ParsedScreeningSessionListInput {
  readonly locationId: string | null
  readonly status: ScreeningSessionStatus | null
  readonly dateFrom: string | null
  readonly dateTo: string | null
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly offset: number
}

const pageSizes = Object.freeze([25, 50, 100] as const)
const statuses = new Set<ScreeningSessionStatus>(['OPEN', 'CLOSED'])
const insertInputKeys = Object.freeze([
  'id',
  'lifecycleHistoryId',
  'locationId',
  'protocolVersionId',
  'sessionDate',
  'notes',
  'createdBy',
  'createdAt'
] as const)
const closeInputKeys = Object.freeze([
  'id',
  'lifecycleHistoryId',
  'expectedRowVersion',
  'closedBy',
  'closedAt',
  'reason'
] as const)
const reopenInputKeys = Object.freeze([
  'id',
  'lifecycleHistoryId',
  'expectedRowVersion',
  'reopenedBy',
  'reopenedAt',
  'reason'
] as const)
const listInputKeys = Object.freeze([
  'locationId',
  'status',
  'dateFrom',
  'dateTo',
  'page',
  'pageSize'
] as const)

export function parseInsertScreeningSessionInput(
  input: InsertScreeningSessionInput
): ParsedInsertScreeningSessionInput {
  try {
    const data = readDataProperties(input, insertInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      lifecycleHistoryId: parseEntityId(data.lifecycleHistoryId),
      locationId: parseEntityId(data.locationId),
      protocolVersionId: parseEntityId(data.protocolVersionId),
      sessionDate: parseScreeningSessionDate(data.sessionDate),
      notes: parseScreeningSessionNote(data.notes),
      createdBy: parseEntityId(data.createdBy),
      createdAt: parseUtcTimestamp(data.createdAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseCloseScreeningSessionInput(
  input: CloseScreeningSessionInput
): ParsedCloseScreeningSessionInput {
  try {
    const data = readDataProperties(input, closeInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      lifecycleHistoryId: parseEntityId(data.lifecycleHistoryId),
      expectedRowVersion: parseScreeningSessionRowVersion(data.expectedRowVersion),
      closedBy: parseEntityId(data.closedBy),
      closedAt: parseUtcTimestamp(data.closedAt),
      reason: parseScreeningSessionCloseReason(data.reason)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseReopenScreeningSessionInput(
  input: ReopenScreeningSessionInput
): ParsedReopenScreeningSessionInput {
  try {
    const data = readDataProperties(input, reopenInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      lifecycleHistoryId: parseEntityId(data.lifecycleHistoryId),
      expectedRowVersion: parseScreeningSessionRowVersion(data.expectedRowVersion),
      reopenedBy: parseEntityId(data.reopenedBy),
      reopenedAt: parseUtcTimestamp(data.reopenedAt),
      reason: parseScreeningSessionReopenReason(data.reason)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseScreeningSessionListInput(
  input: ScreeningSessionListInput
): ParsedScreeningSessionListInput {
  try {
    const data = readDataProperties(input, listInputKeys)
    const locationId = data.locationId === null ? null : parseEntityId(data.locationId)
    const status = data.status === null ? null : parseScreeningSessionStatus(data.status)
    const dateFrom = data.dateFrom === null ? null : parseScreeningSessionDate(data.dateFrom)
    const dateTo = data.dateTo === null ? null : parseScreeningSessionDate(data.dateTo)
    const page = parsePositiveSafeInteger(data.page)
    const pageSize = parseScreeningSessionPageSize(data.pageSize)
    const offset = (page - 1) * pageSize

    if (
      (dateFrom !== null && dateTo !== null && dateFrom > dateTo) ||
      !Number.isSafeInteger(offset)
    ) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      locationId,
      status,
      dateFrom,
      dateTo,
      page,
      pageSize,
      offset
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseScreeningSessionStatus(value: unknown): ScreeningSessionStatus {
  if (typeof value !== 'string' || !statuses.has(value as ScreeningSessionStatus)) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningSessionStatus
}

export function parseScreeningSessionDate(value: unknown): ScreeningSessionDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RepositoryValidationError()
  }

  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningSessionDate
}

export function parseScreeningSessionRowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

export function parseScreeningSessionNote(value: unknown): string | null {
  return parseOptionalText(value, { requireNonblankWhenPresent: true })
}

export function parseScreeningSessionCloseReason(value: unknown): string | null {
  return parseOptionalText(value, { requireNonblankWhenPresent: true })
}

export function parseScreeningSessionReopenReason(value: unknown): string {
  if (value === null) {
    throw new RepositoryValidationError()
  }

  const reason = parseOptionalText(value, { requireNonblankWhenPresent: true })

  if (reason === null) {
    throw new RepositoryValidationError()
  }

  return reason
}

export function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  let isArray: boolean

  try {
    isArray = Array.isArray(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (typeof value !== 'object' || value === null || isArray) {
    throw new RepositoryValidationError()
  }

  let prototype: unknown
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}

function parseOptionalText(
  value: unknown,
  options: { readonly requireNonblankWhenPresent: boolean }
): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || hasUnpairedSurrogate(value) || hasUnsafeTextCharacter(value)) {
    throw new RepositoryValidationError()
  }

  if (Array.from(value).length > 500) {
    throw new RepositoryValidationError()
  }

  if (options.requireNonblankWhenPresent && value.trim().length === 0) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePositiveSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseScreeningSessionPageSize(value: unknown): 25 | 50 | 100 {
  if (typeof value !== 'number' || !pageSizes.includes(value as (typeof pageSizes)[number])) {
    throw new RepositoryValidationError()
  }

  return value as 25 | 50 | 100
}

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof DatabaseTransactionStateError) {
    throw new DatabaseTransactionStateError(error.errorType)
  }

  if (isRepositoryError(error)) {
    const rebuilt = rebuildRepositoryError(error)

    if (rebuilt instanceof RepositoryValidationError) {
      return rebuilt
    }

    return new RepositoryValidationError(rebuilt.errorType)
  }

  return new RepositoryValidationError(getRepositoryErrorType(error))
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (!Number.isSafeInteger(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
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
