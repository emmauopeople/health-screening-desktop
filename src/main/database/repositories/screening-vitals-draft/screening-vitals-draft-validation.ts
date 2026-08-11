import { DatabaseTransactionStateError } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import { parseNullableScreeningEncounterText, readDataProperties } from '../screening-encounter'
import type {
  InsertScreeningVitalsDraftInput,
  ScreeningVitalsDraftStatus,
  UpdateScreeningVitalsDraftInput,
  VitalsMeasurementSite,
  VitalsMeasurementTime,
  VitalsPatientPosition
} from './screening-vitals-draft-types'

interface ParsedReplaceReading {
  readonly id: string
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: VitalsMeasurementSite | null
  readonly patientPosition: VitalsPatientPosition | null
  readonly measurementTime: VitalsMeasurementTime | null
}

export interface ParsedInsertScreeningVitalsDraftInput {
  readonly id: string
  readonly encounterId: string
  readonly status: ScreeningVitalsDraftStatus
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly createdBy: string
  readonly createdAt: string
  readonly readings: readonly ParsedReplaceReading[]
}

export interface ParsedUpdateScreeningVitalsDraftInput {
  readonly id: string
  readonly expectedRowVersion: number
  readonly status: ScreeningVitalsDraftStatus
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly updatedBy: string
  readonly updatedAt: string
  readonly readings: readonly ParsedReplaceReading[]
}

const insertInputKeys = Object.freeze([
  'id',
  'encounterId',
  'status',
  'weightKg',
  'waistCm',
  'notes',
  'createdBy',
  'createdAt',
  'readings'
] as const)
const updateInputKeys = Object.freeze([
  'id',
  'expectedRowVersion',
  'status',
  'weightKg',
  'waistCm',
  'notes',
  'updatedBy',
  'updatedAt',
  'readings'
] as const)
const readingInputKeys = Object.freeze([
  'id',
  'sequenceNumber',
  'systolic',
  'diastolic',
  'pulse',
  'measurementSite',
  'patientPosition',
  'measurementTime'
] as const)
const draftStatuses = new Set<ScreeningVitalsDraftStatus>(['DRAFT', 'VITALS_COMPLETE'])
const measurementSites = new Set<VitalsMeasurementSite>([
  'RIGHT_ARM',
  'LEFT_ARM',
  'LEFT_LEG',
  'RIGHT_LEG'
])
const patientPositions = new Set<VitalsPatientPosition>(['LYING', 'STANDING', 'SITTING'])
const measurementTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/u
const maximumReadingCount = 12

export function parseInsertScreeningVitalsDraftInput(
  input: InsertScreeningVitalsDraftInput
): ParsedInsertScreeningVitalsDraftInput {
  try {
    const data = readDataProperties(input, insertInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      encounterId: parseEntityId(data.encounterId),
      status: parseDraftStatus(data.status),
      weightKg: parseOptionalPositiveReal(data.weightKg),
      waistCm: parseOptionalPositiveReal(data.waistCm),
      notes: parseNullableScreeningEncounterText(data.notes),
      createdBy: parseEntityId(data.createdBy),
      createdAt: parseUtcTimestamp(data.createdAt),
      readings: parseReadings(data.readings)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseUpdateScreeningVitalsDraftInput(
  input: UpdateScreeningVitalsDraftInput
): ParsedUpdateScreeningVitalsDraftInput {
  try {
    const data = readDataProperties(input, updateInputKeys)

    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parseDraftRowVersion(data.expectedRowVersion),
      status: parseDraftStatus(data.status),
      weightKg: parseOptionalPositiveReal(data.weightKg),
      waistCm: parseOptionalPositiveReal(data.waistCm),
      notes: parseNullableScreeningEncounterText(data.notes),
      updatedBy: parseEntityId(data.updatedBy),
      updatedAt: parseUtcTimestamp(data.updatedAt),
      readings: parseReadings(data.readings)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseScreeningVitalsDraftStatus(value: unknown): ScreeningVitalsDraftStatus {
  if (typeof value !== 'string' || !draftStatuses.has(value as ScreeningVitalsDraftStatus)) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningVitalsDraftStatus
}

export function parseVitalsMeasurementSite(value: unknown): VitalsMeasurementSite {
  if (typeof value !== 'string' || !measurementSites.has(value as VitalsMeasurementSite)) {
    throw new RepositoryValidationError()
  }

  return value as VitalsMeasurementSite
}

export function parseVitalsPatientPosition(value: unknown): VitalsPatientPosition {
  if (typeof value !== 'string' || !patientPositions.has(value as VitalsPatientPosition)) {
    throw new RepositoryValidationError()
  }

  return value as VitalsPatientPosition
}

export function parseVitalsMeasurementTime(value: unknown): VitalsMeasurementTime {
  if (typeof value !== 'string' || !measurementTimePattern.test(value)) {
    throw new RepositoryValidationError()
  }

  return value as VitalsMeasurementTime
}

export function parseScreeningVitalsDraftRowVersion(value: unknown): number {
  return parseDraftRowVersion(value)
}

function parseDraftStatus(value: unknown): ScreeningVitalsDraftStatus {
  return parseScreeningVitalsDraftStatus(value)
}

function parseReadings(value: unknown): readonly ParsedReplaceReading[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new RepositoryValidationError()
  }

  if (value.length < 1 || value.length > maximumReadingCount) {
    throw new RepositoryValidationError()
  }

  const ids = new Set<string>()
  const sequenceNumbers = new Set<number>()
  const readings = value.map((item) => parseReading(item))

  for (const reading of readings) {
    if (ids.has(reading.id) || sequenceNumbers.has(reading.sequenceNumber)) {
      throw new RepositoryValidationError()
    }

    ids.add(reading.id)
    sequenceNumbers.add(reading.sequenceNumber)
  }

  return Object.freeze(readings)
}

function parseReading(value: unknown): ParsedReplaceReading {
  const data = readDataProperties(value, readingInputKeys)

  return Object.freeze({
    id: parseEntityId(data.id),
    sequenceNumber: parseSequenceNumber(data.sequenceNumber),
    systolic: parseOptionalPositiveInteger(data.systolic),
    diastolic: parseOptionalPositiveInteger(data.diastolic),
    pulse: parseOptionalPositiveInteger(data.pulse),
    measurementSite: parseNullableMeasurementSite(data.measurementSite),
    patientPosition: parseNullablePatientPosition(data.patientPosition),
    measurementTime: parseNullableMeasurementTime(data.measurementTime)
  })
}

function parseSequenceNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseOptionalPositiveReal(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || Object.is(value, -0)) {
    throw new RepositoryValidationError()
  }

  return value
}

function parseNullableMeasurementSite(value: unknown): VitalsMeasurementSite | null {
  return value === null ? null : parseVitalsMeasurementSite(value)
}

function parseNullablePatientPosition(value: unknown): VitalsPatientPosition | null {
  return value === null ? null : parseVitalsPatientPosition(value)
}

function parseNullableMeasurementTime(value: unknown): VitalsMeasurementTime | null {
  return value === null ? null : parseVitalsMeasurementTime(value)
}

function parseDraftRowVersion(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    Object.is(value, -0)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof DatabaseTransactionStateError) {
    throw new DatabaseTransactionStateError(error.errorType)
  }

  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
  }

  return new RepositoryValidationError(getRepositoryErrorType(error))
}

export type ParsedScreeningVitalsDraftReadingInput = ParsedReplaceReading
