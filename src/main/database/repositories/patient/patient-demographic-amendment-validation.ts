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
  InsertPatientDemographicAmendmentInput,
  PatientDemographicAmendmentChangeInput,
  PatientDemographicAmendmentFieldName,
  PatientDemographicAmendmentHistoryInput,
  PatientDemographicAmendmentReasonCode,
  PatientDemographicAmendmentValue
} from './patient-demographic-amendment-types'

export interface ParsedPatientDemographicAmendmentChangeInput {
  readonly fieldName: PatientDemographicAmendmentFieldName
  readonly previousValue: PatientDemographicAmendmentValue
  readonly newValue: PatientDemographicAmendmentValue
  readonly previousValueJson: string
  readonly newValueJson: string
}

export interface ParsedInsertPatientDemographicAmendmentInput {
  readonly id: string
  readonly patientId: string
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
  readonly reasonCode: PatientDemographicAmendmentReasonCode
  readonly reasonNote: string | null
  readonly amendedBy: string
  readonly amendedAt: string
  readonly changes: readonly ParsedPatientDemographicAmendmentChangeInput[]
}

export interface ParsedPatientDemographicAmendmentHistoryInput {
  readonly patientId: string
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export const patientDemographicAmendmentFieldOrder = Object.freeze([
  'given_name',
  'family_name',
  'other_names',
  'date_of_birth',
  'approximate_age_years',
  'age_as_of_date',
  'sex',
  'village',
  'quarter',
  'phone',
  'alternate_contact_name',
  'alternate_contact_phone',
  'residence_notes',
  'status'
] as const satisfies readonly PatientDemographicAmendmentFieldName[])

const patientDemographicAmendmentReasonCodes = Object.freeze([
  'DATA_ENTRY_CORRECTION',
  'PATIENT_REPORTED_CHANGE',
  'CONTACT_INFORMATION_UPDATE',
  'RESIDENCE_INFORMATION_UPDATE',
  'STATUS_CHANGE',
  'OTHER'
] as const satisfies readonly PatientDemographicAmendmentReasonCode[])

const pageSizes = Object.freeze([25, 50, 100] as const)
const validFields = new Set<PatientDemographicAmendmentFieldName>(
  patientDemographicAmendmentFieldOrder
)
const fieldOrderIndex = new Map(
  patientDemographicAmendmentFieldOrder.map((fieldName, index) => [fieldName, index])
)
const validReasonCodes = new Set<PatientDemographicAmendmentReasonCode>(
  patientDemographicAmendmentReasonCodes
)
const validSexValues = new Set(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'])
const validStatusValues = new Set(['ACTIVE', 'INACTIVE'])

const insertInputKeys = Object.freeze([
  'id',
  'patientId',
  'priorRowVersion',
  'resultingRowVersion',
  'reasonCode',
  'reasonNote',
  'amendedBy',
  'amendedAt',
  'changes'
] as const)
const changeInputKeys = Object.freeze(['fieldName', 'previousValue', 'newValue'] as const)
const historyInputKeys = Object.freeze(['patientId', 'page', 'pageSize'] as const)

export function parseInsertPatientDemographicAmendmentInput(
  input: InsertPatientDemographicAmendmentInput
): ParsedInsertPatientDemographicAmendmentInput {
  try {
    const data = readDataProperties(input, insertInputKeys)
    const id = parseEntityId(data.id)
    const patientId = parseEntityId(data.patientId)
    const priorRowVersion = parsePatientDemographicAmendmentRowVersion(data.priorRowVersion)
    const resultingRowVersion = parsePatientDemographicAmendmentRowVersion(data.resultingRowVersion)
    const reasonCode = parsePatientDemographicAmendmentReasonCode(data.reasonCode)
    const reasonNote = normalizePatientDemographicAmendmentReasonNote(data.reasonNote)
    const amendedBy = parseEntityId(data.amendedBy)
    const amendedAt = parseUtcTimestamp(data.amendedAt)
    const changes = parsePatientDemographicAmendmentChanges(data.changes)

    if (resultingRowVersion !== priorRowVersion + 1) {
      throw new RepositoryValidationError()
    }

    if (reasonCode === 'OTHER' && reasonNote === null) {
      throw new RepositoryValidationError()
    }

    if (changes.some((change) => change.fieldName === 'status') && reasonNote === null) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      id,
      patientId,
      priorRowVersion,
      resultingRowVersion,
      reasonCode,
      reasonNote,
      amendedBy,
      amendedAt,
      changes
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parsePatientDemographicAmendmentHistoryInput(
  input: PatientDemographicAmendmentHistoryInput
): ParsedPatientDemographicAmendmentHistoryInput {
  try {
    const data = readDataProperties(input, historyInputKeys)

    return Object.freeze({
      patientId: parseEntityId(data.patientId),
      page: parsePositiveInteger(data.page),
      pageSize: parsePatientDemographicAmendmentPageSize(data.pageSize)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parsePatientDemographicAmendmentReasonCode(
  value: unknown
): PatientDemographicAmendmentReasonCode {
  if (
    typeof value !== 'string' ||
    !validReasonCodes.has(value as PatientDemographicAmendmentReasonCode)
  ) {
    throw new RepositoryValidationError()
  }

  return value as PatientDemographicAmendmentReasonCode
}

export function parsePatientDemographicAmendmentFieldName(
  value: unknown
): PatientDemographicAmendmentFieldName {
  if (
    typeof value !== 'string' ||
    !validFields.has(value as PatientDemographicAmendmentFieldName)
  ) {
    throw new RepositoryValidationError()
  }

  return value as PatientDemographicAmendmentFieldName
}

export function parsePatientDemographicAmendmentRowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

export function normalizePatientDemographicAmendmentReasonNote(value: unknown): string | null {
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

export function parsePatientDemographicAmendmentValueForField(
  fieldName: PatientDemographicAmendmentFieldName,
  value: unknown
): PatientDemographicAmendmentValue {
  if (fieldName === 'approximate_age_years') {
    if (value === null) {
      return null
    }

    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 120) {
      throw new RepositoryValidationError()
    }

    return value
  }

  if (fieldName === 'sex') {
    if (typeof value !== 'string' || !validSexValues.has(value)) {
      throw new RepositoryValidationError()
    }

    return value
  }

  if (fieldName === 'status') {
    if (typeof value !== 'string' || !validStatusValues.has(value)) {
      throw new RepositoryValidationError()
    }

    return value
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new RepositoryValidationError()
  }

  return value
}

export function canonicalizePatientDemographicAmendmentValue(
  value: PatientDemographicAmendmentValue
): string {
  if (value === null) {
    return 'null'
  }

  return JSON.stringify(value)
}

export function comparePatientDemographicAmendmentFields(
  left: PatientDemographicAmendmentFieldName,
  right: PatientDemographicAmendmentFieldName
): number {
  return getFieldOrderIndex(left) - getFieldOrderIndex(right)
}

function parsePatientDemographicAmendmentChanges(
  value: unknown
): readonly ParsedPatientDemographicAmendmentChangeInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RepositoryValidationError()
  }

  if (value.length > patientDemographicAmendmentFieldOrder.length) {
    throw new RepositoryValidationError()
  }

  const seenFields = new Set<PatientDemographicAmendmentFieldName>()
  const changes = value.map(parsePatientDemographicAmendmentChange)

  for (const change of changes) {
    if (seenFields.has(change.fieldName)) {
      throw new RepositoryValidationError()
    }

    seenFields.add(change.fieldName)
  }

  return Object.freeze(
    [...changes].sort((left, right) =>
      comparePatientDemographicAmendmentFields(left.fieldName, right.fieldName)
    )
  )
}

function parsePatientDemographicAmendmentChange(
  value: PatientDemographicAmendmentChangeInput
): ParsedPatientDemographicAmendmentChangeInput {
  const data = readDataProperties(value, changeInputKeys)
  const fieldName = parsePatientDemographicAmendmentFieldName(data.fieldName)
  const previousValue = parsePatientDemographicAmendmentValueForField(fieldName, data.previousValue)
  const newValue = parsePatientDemographicAmendmentValueForField(fieldName, data.newValue)
  const previousValueJson = canonicalizePatientDemographicAmendmentValue(previousValue)
  const newValueJson = canonicalizePatientDemographicAmendmentValue(newValue)

  if (previousValueJson === newValueJson) {
    throw new RepositoryValidationError()
  }

  return Object.freeze({
    fieldName,
    previousValue,
    newValue,
    previousValueJson,
    newValueJson
  })
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryValidationError()
  }

  return value
}

function parsePatientDemographicAmendmentPageSize(value: unknown): 25 | 50 | 100 {
  if (typeof value !== 'number' || !pageSizes.includes(value as (typeof pageSizes)[number])) {
    throw new RepositoryValidationError()
  }

  return value as 25 | 50 | 100
}

function getFieldOrderIndex(fieldName: PatientDemographicAmendmentFieldName): number {
  const index = fieldOrderIndex.get(fieldName)

  if (index === undefined) {
    throw new RepositoryValidationError()
  }

  return index
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
