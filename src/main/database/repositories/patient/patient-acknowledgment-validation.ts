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
  InsertPatientAcknowledgmentInput,
  PatientAcknowledgmentDecisionStatus,
  PatientAcknowledgmentHistoryInput,
  PatientAcknowledgmentHistoryStatus
} from './patient-acknowledgment-types'

export interface ParsedInsertPatientAcknowledgmentInput {
  readonly id: string
  readonly patientId: string
  readonly status: PatientAcknowledgmentDecisionStatus
  readonly note: string | null
  readonly recordedBy: string
  readonly recordedAt: string
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
}

export interface ParsedPatientAcknowledgmentHistoryInput {
  readonly patientId: string
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

const acknowledgmentHistoryStatuses = new Set<PatientAcknowledgmentHistoryStatus>([
  'NOT_REQUESTED',
  'ACKNOWLEDGED',
  'DECLINED'
])
const acknowledgmentDecisionStatuses = new Set<PatientAcknowledgmentDecisionStatus>([
  'ACKNOWLEDGED',
  'DECLINED'
])
const pageSizes = Object.freeze([25, 50, 100] as const)
const insertInputKeys = Object.freeze([
  'id',
  'patientId',
  'status',
  'note',
  'recordedBy',
  'recordedAt',
  'priorRowVersion',
  'resultingRowVersion'
] as const)
const historyInputKeys = Object.freeze(['patientId', 'page', 'pageSize'] as const)

export function parseInsertPatientAcknowledgmentInput(
  input: InsertPatientAcknowledgmentInput
): ParsedInsertPatientAcknowledgmentInput {
  try {
    const data = readDataProperties(input, insertInputKeys)
    const priorRowVersion = parsePatientAcknowledgmentRowVersion(data.priorRowVersion)
    const resultingRowVersion = parsePatientAcknowledgmentRowVersion(data.resultingRowVersion)

    if (resultingRowVersion !== priorRowVersion + 1) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patientId),
      status: parsePatientAcknowledgmentDecisionStatus(data.status),
      note: normalizePatientAcknowledgmentNote(data.note),
      recordedBy: parseEntityId(data.recordedBy),
      recordedAt: parseUtcTimestamp(data.recordedAt),
      priorRowVersion,
      resultingRowVersion
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parsePatientAcknowledgmentHistoryInput(
  input: PatientAcknowledgmentHistoryInput
): ParsedPatientAcknowledgmentHistoryInput {
  try {
    const data = readDataProperties(input, historyInputKeys)

    return Object.freeze({
      patientId: parseEntityId(data.patientId),
      page: parsePositiveInteger(data.page),
      pageSize: parsePatientAcknowledgmentPageSize(data.pageSize)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parsePatientAcknowledgmentHistoryStatus(
  value: unknown
): PatientAcknowledgmentHistoryStatus {
  if (
    typeof value !== 'string' ||
    !acknowledgmentHistoryStatuses.has(value as PatientAcknowledgmentHistoryStatus)
  ) {
    throw new RepositoryValidationError()
  }

  return value as PatientAcknowledgmentHistoryStatus
}

export function parsePatientAcknowledgmentDecisionStatus(
  value: unknown
): PatientAcknowledgmentDecisionStatus {
  if (
    typeof value !== 'string' ||
    !acknowledgmentDecisionStatuses.has(value as PatientAcknowledgmentDecisionStatus)
  ) {
    throw new RepositoryValidationError()
  }

  return value as PatientAcknowledgmentDecisionStatus
}

export function normalizePatientAcknowledgmentNote(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string' || hasUnpairedSurrogate(value)) {
    throw new RepositoryValidationError()
  }

  const normalized = value.normalize('NFKC').trim()

  if (hasUnpairedSurrogate(normalized) || hasUnsafeTextCharacter(normalized)) {
    throw new RepositoryValidationError()
  }

  if (normalized.length === 0) {
    return null
  }

  if (Array.from(normalized).length > 500) {
    throw new RepositoryValidationError()
  }

  return normalized
}

export function parsePatientAcknowledgmentRowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePatientAcknowledgmentPageSize(value: unknown): 25 | 50 | 100 {
  if (typeof value !== 'number' || !pageSizes.includes(value as (typeof pageSizes)[number])) {
    throw new RepositoryValidationError()
  }

  return value as 25 | 50 | 100
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  let descriptors: PropertyDescriptorMap

  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
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
