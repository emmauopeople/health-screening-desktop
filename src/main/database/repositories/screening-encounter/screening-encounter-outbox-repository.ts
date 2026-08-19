import { Buffer } from 'node:buffer'
import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import type {
  InsertScreeningEncounterOutboxInput,
  ScreeningEncounterOutboxOperation,
  ScreeningEncounterOutboxPayload,
  ScreeningEncounterOutboxPayloadSchemaVersion,
  ScreeningEncounterOutboxPayloadValue,
  ScreeningEncounterOutboxRepository
} from './screening-encounter-outbox-types'

interface PayloadValidationState {
  nodeCount: number
  readonly activeObjects: WeakSet<object>
}

interface ParsedScreeningEncounterOutboxInput {
  readonly id: string
  readonly aggregateId: string
  readonly operation: ScreeningEncounterOutboxOperation
  readonly payloadSchemaVersion: ScreeningEncounterOutboxPayloadSchemaVersion
  readonly createdAt: string
  readonly payloadJson: string
}

const inputKeys = Object.freeze([
  'id',
  'aggregateId',
  'operation',
  'payloadSchemaVersion',
  'createdAt',
  'payload'
] as const)
const approvedOperationSchemas = new Map<
  ScreeningEncounterOutboxOperation,
  ScreeningEncounterOutboxPayloadSchemaVersion
>([
  ['SCREENING_ENCOUNTER_STARTED', 'screening-encounter.start.v1'],
  ['SCREENING_VITALS_DRAFT_SAVED', 'screening-encounter.vitals-draft-saved.v1'],
  ['SCREENING_VITALS_STEP_COMPLETED', 'screening-encounter.vitals-step-completed.v1'],
  [
    'SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED',
    'screening-encounter.lifestyle-alcohol-baseline-created.v1'
  ],
  [
    'SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED',
    'screening-encounter.lifestyle-tobacco-baseline-created.v1'
  ],
  [
    'SCREENING_LIFESTYLE_WORK_BASELINE_CREATED',
    'screening-encounter.lifestyle-work-baseline-created.v1'
  ],
  ['SCREENING_LIFESTYLE_DRAFT_SAVED', 'screening-encounter.lifestyle-draft-saved.v1'],
  ['SCREENING_LIFESTYLE_STEP_COMPLETED', 'screening-encounter.lifestyle-step-completed.v1'],
  ['SCREENING_LIFESTYLE_REOPENED', 'screening-encounter.lifestyle-reopened.v1'],
  ['SCREENING_FOOD_DRAFT_SAVED', 'screening-encounter.food-draft-saved.v1'],
  ['SCREENING_OTC_DRAFT_SAVED', 'screening-encounter.otc-draft-saved.v1']
])
const maximumPayloadDepth = 4
const maximumPayloadNodes = 80
const maximumPayloadObjectProperties = 40
const maximumPayloadArrayElements = 50
const maximumPayloadStringCodePoints = 500
const maximumPayloadStringUtf8Bytes = 2_048
const maximumPayloadJsonUtf8Bytes = 6_144
const payloadKeyPattern = /^[a-z][a-z0-9_]*$/u
const reservedPayloadKeys = new Set(['__proto__', 'prototype', 'constructor'])

const insertOutboxSql = `
INSERT INTO sync_outbox (
  id,
  aggregate_type,
  aggregate_id,
  operation,
  payload_json,
  payload_schema_version,
  created_at,
  status,
  attempt_count,
  next_attempt_at,
  last_error_code,
  last_error_message,
  sent_at
) VALUES (?, 'SCREENING_ENCOUNTER', ?, ?, ?, ?, ?, 'PENDING', 0, NULL, NULL, NULL, NULL);
`

export function createScreeningEncounterOutboxRepository(
  connection: Database.Database
): ScreeningEncounterOutboxRepository {
  void connection

  return Object.freeze({
    insert(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertScreeningEncounterOutboxInput
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const parsed = parseInsertScreeningEncounterOutboxInput(input)

      try {
        scopedConnection
          .prepare<[string, string, string, string, string, string]>(insertOutboxSql)
          .run(
            parsed.id,
            parsed.aggregateId,
            parsed.operation,
            parsed.payloadJson,
            parsed.payloadSchemaVersion,
            parsed.createdAt
          )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        throw new RepositoryWriteError(getRepositoryErrorType(error))
      }
    }
  })
}

function parseInsertScreeningEncounterOutboxInput(
  input: InsertScreeningEncounterOutboxInput
): ParsedScreeningEncounterOutboxInput {
  try {
    const data = readDataProperties(input, inputKeys)

    const operation = parseScreeningEncounterOutboxOperation(data.operation)
    const payloadSchemaVersion = parseScreeningEncounterOutboxPayloadSchemaVersion(
      data.payloadSchemaVersion
    )

    if (approvedOperationSchemas.get(operation) !== payloadSchemaVersion) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      id: parseEntityId(data.id),
      aggregateId: parseEntityId(data.aggregateId),
      operation,
      payloadSchemaVersion,
      createdAt: parseUtcTimestamp(data.createdAt),
      payloadJson: createCanonicalPayloadJson(data.payload)
    })
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }

    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function parseScreeningEncounterOutboxOperation(value: unknown): ScreeningEncounterOutboxOperation {
  if (
    typeof value !== 'string' ||
    !approvedOperationSchemas.has(value as ScreeningEncounterOutboxOperation)
  ) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningEncounterOutboxOperation
}

function parseScreeningEncounterOutboxPayloadSchemaVersion(
  value: unknown
): ScreeningEncounterOutboxPayloadSchemaVersion {
  if (
    typeof value !== 'string' ||
    !Array.from(approvedOperationSchemas.values()).includes(
      value as ScreeningEncounterOutboxPayloadSchemaVersion
    )
  ) {
    throw new RepositoryValidationError()
  }

  return value as ScreeningEncounterOutboxPayloadSchemaVersion
}

function createCanonicalPayloadJson(value: unknown): string {
  const payload = validatePayloadRoot(value, {
    nodeCount: 0,
    activeObjects: new WeakSet()
  })
  const payloadJson = JSON.stringify(payload)

  if (Buffer.byteLength(payloadJson, 'utf8') > maximumPayloadJsonUtf8Bytes) {
    throw new RepositoryValidationError()
  }

  return payloadJson
}

function validatePayloadRoot(
  value: unknown,
  state: PayloadValidationState
): ScreeningEncounterOutboxPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  return validatePayloadObject(value, 0, state)
}

function validatePayloadValue(
  value: unknown,
  depth: number,
  state: PayloadValidationState
): ScreeningEncounterOutboxPayloadValue {
  if (value === null || typeof value === 'boolean') {
    claimPayloadNode(depth, state)
    return value
  }

  if (typeof value === 'number') {
    claimPayloadNode(depth, state)

    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new RepositoryValidationError()
    }

    return value
  }

  if (typeof value === 'string') {
    claimPayloadNode(depth, state)
    validatePayloadString(value)

    return value
  }

  if (typeof value !== 'object' || value === undefined) {
    throw new RepositoryValidationError()
  }

  if (Array.isArray(value)) {
    return validatePayloadArray(value, depth, state)
  }

  return validatePayloadObject(value, depth, state)
}

function validatePayloadObject(
  value: object,
  depth: number,
  state: PayloadValidationState
): ScreeningEncounterOutboxPayload {
  claimPayloadNode(depth, state)
  assertOrdinaryPayloadObject(value)

  if (state.activeObjects.has(value)) {
    throw new RepositoryValidationError()
  }

  state.activeObjects.add(value)

  try {
    const descriptors = readPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)

    if (keys.length > maximumPayloadObjectProperties) {
      throw new RepositoryValidationError()
    }

    const stringKeys: string[] = []

    for (const key of keys) {
      if (typeof key !== 'string' || !isSafePayloadKey(key)) {
        throw new RepositoryValidationError()
      }

      stringKeys.push(key)
    }

    stringKeys.sort()

    const canonical: Record<string, ScreeningEncounterOutboxPayloadValue> = Object.create(null)

    for (const key of stringKeys) {
      const descriptor = descriptors[key]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryValidationError()
      }

      canonical[key] = validatePayloadValue(descriptor.value, depth + 1, state)
    }

    return deepFreeze(canonical) as ScreeningEncounterOutboxPayload
  } finally {
    state.activeObjects.delete(value)
  }
}

function validatePayloadArray(
  value: readonly unknown[],
  depth: number,
  state: PayloadValidationState
): readonly ScreeningEncounterOutboxPayloadValue[] {
  claimPayloadNode(depth, state)
  assertOrdinaryPayloadArray(value)

  if (state.activeObjects.has(value)) {
    throw new RepositoryValidationError()
  }

  state.activeObjects.add(value)

  try {
    const descriptors = readPropertyDescriptors(value)
    const lengthDescriptor = descriptors.length

    if (
      lengthDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumPayloadArrayElements
    ) {
      throw new RepositoryValidationError()
    }

    const length = lengthDescriptor.value as number
    const propertyNames = Object.getOwnPropertyNames(descriptors)

    if (
      propertyNames.length !== length + 1 ||
      propertyNames.some(
        (propertyName) => propertyName !== 'length' && !isCanonicalArrayIndex(propertyName, length)
      ) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')
    ) {
      throw new RepositoryValidationError()
    }

    const canonical: ScreeningEncounterOutboxPayloadValue[] = []

    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryValidationError()
      }

      canonical.push(validatePayloadValue(descriptor.value, depth + 1, state))
    }

    return deepFreeze(canonical) as readonly ScreeningEncounterOutboxPayloadValue[]
  } finally {
    state.activeObjects.delete(value)
  }
}

function claimPayloadNode(depth: number, state: PayloadValidationState): void {
  if (depth > maximumPayloadDepth) {
    throw new RepositoryValidationError()
  }

  state.nodeCount += 1

  if (state.nodeCount > maximumPayloadNodes) {
    throw new RepositoryValidationError()
  }
}

function readDataProperties(
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

function assertOrdinaryPayloadObject(value: object): void {
  let prototype: unknown

  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new RepositoryValidationError()
  }
}

function assertOrdinaryPayloadArray(value: object): void {
  let prototype: unknown

  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Array.prototype) {
    throw new RepositoryValidationError()
  }
}

function readPropertyDescriptors(
  value: object
): Record<PropertyKey, PropertyDescriptor | undefined> {
  try {
    return Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
  } catch {
    throw new RepositoryValidationError()
  }
}

function validatePayloadString(value: string): void {
  if (
    hasUnpairedSurrogate(value) ||
    hasUnsafeTextCharacter(value) ||
    Array.from(value).length > maximumPayloadStringCodePoints ||
    Buffer.byteLength(value, 'utf8') > maximumPayloadStringUtf8Bytes
  ) {
    throw new RepositoryValidationError()
  }
}

function isSafePayloadKey(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    !reservedPayloadKeys.has(value) &&
    payloadKeyPattern.test(value)
  )
}

function isCanonicalArrayIndex(value: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    return false
  }

  const numeric = Number(value)

  return (
    Number.isSafeInteger(numeric) && numeric >= 0 && numeric < length && String(numeric) === value
  )
}

function deepFreeze<T extends ScreeningEncounterOutboxPayloadValue>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue)
  }

  return Object.freeze(value)
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
