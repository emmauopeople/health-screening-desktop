import { Buffer } from 'node:buffer'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import type {
  AuditActionCode,
  AuditEntityType,
  AuditMetadata,
  AuditMetadataValue,
  AuditQueryLimit,
  ParsedAuditMetadata
} from './audit-event-types'

interface MetadataValidationState {
  nodeCount: number
  readonly activeObjects: WeakSet<object>
}

const auditCodePattern = /^[A-Z][A-Z0-9_]*$/
const metadataKeyPattern = /^[a-z][a-z0-9_]*$/
const reservedMetadataKeys = new Set(['__proto__', 'prototype', 'constructor'])
const maximumAuditCodeLength = 64
const minimumAuditCodeLength = 2
const maximumQueryLimit = 200
const maximumMetadataDepth = 4
const maximumMetadataNodes = 100
const maximumObjectProperties = 50
const maximumArrayElements = 50
const maximumStringCodePoints = 256
const maximumStringUtf8Bytes = 1024
const maximumMetadataJsonUtf8Bytes = 4096

export function parseAuditActionCode(value: unknown): AuditActionCode {
  return parseAuditCode(value) as AuditActionCode
}

export function parseAuditEntityType(value: unknown): AuditEntityType {
  return parseAuditCode(value) as AuditEntityType
}

export function parseAuditQueryLimit(value: unknown): AuditQueryLimit {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumQueryLimit
  ) {
    throw new RepositoryValidationError()
  }

  return value as AuditQueryLimit
}

export function parseAuditMetadata(value: unknown): ParsedAuditMetadata {
  try {
    const state: MetadataValidationState = {
      nodeCount: 0,
      activeObjects: new WeakSet()
    }
    const metadata = validateRootMetadata(value, state)
    const metadataJson = JSON.stringify(metadata)

    if (Buffer.byteLength(metadataJson, 'utf8') > maximumMetadataJsonUtf8Bytes) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({
      metadata,
      metadataJson
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseStoredAuditMetadataJson(value: unknown): ParsedAuditMetadata {
  try {
    if (typeof value !== 'string') {
      throw new RepositoryValidationError()
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new RepositoryValidationError(getRepositoryErrorType(error))
    }

    const metadata = parseAuditMetadata(parsed)

    if (metadata.metadataJson !== value) {
      throw new RepositoryValidationError()
    }

    return metadata
  } catch (error) {
    throw toValidationError(error)
  }
}

function parseAuditCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    hasUnpairedSurrogate(value) ||
    value.length < minimumAuditCodeLength ||
    value.length > maximumAuditCodeLength ||
    !auditCodePattern.test(value)
  ) {
    throw new RepositoryValidationError()
  }

  return value
}

function validateRootMetadata(value: unknown, state: MetadataValidationState): AuditMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  return validateMetadataObject(value, 0, state)
}

function validateMetadataValue(
  value: unknown,
  depth: number,
  state: MetadataValidationState
): AuditMetadataValue {
  if (value === null || typeof value === 'boolean') {
    claimMetadataNode(depth, state)
    return value
  }

  if (typeof value === 'number') {
    claimMetadataNode(depth, state)

    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new RepositoryValidationError()
    }

    return value
  }

  if (typeof value === 'string') {
    claimMetadataNode(depth, state)
    validateMetadataString(value)

    return value
  }

  if (typeof value !== 'object' || value === undefined) {
    throw new RepositoryValidationError()
  }

  if (Array.isArray(value)) {
    return validateMetadataArray(value, depth, state)
  }

  return validateMetadataObject(value, depth, state)
}

function validateMetadataObject(
  value: object,
  depth: number,
  state: MetadataValidationState
): AuditMetadata {
  claimMetadataNode(depth, state)
  assertOrdinaryMetadataObject(value)

  if (state.activeObjects.has(value)) {
    throw new RepositoryValidationError()
  }

  state.activeObjects.add(value)

  try {
    const descriptors = readPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)

    if (keys.length > maximumObjectProperties) {
      throw new RepositoryValidationError()
    }

    const stringKeys: string[] = []

    for (const key of keys) {
      if (typeof key !== 'string' || !isSafeMetadataKey(key)) {
        throw new RepositoryValidationError()
      }

      stringKeys.push(key)
    }

    stringKeys.sort()

    const canonical: Record<string, AuditMetadataValue> = Object.create(null)

    for (const key of stringKeys) {
      const descriptor = descriptors[key]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryValidationError()
      }

      canonical[key] = validateMetadataValue(descriptor.value, depth + 1, state)
    }

    return deepFreeze(canonical) as AuditMetadata
  } finally {
    state.activeObjects.delete(value)
  }
}

function validateMetadataArray(
  value: readonly unknown[],
  depth: number,
  state: MetadataValidationState
): readonly AuditMetadataValue[] {
  claimMetadataNode(depth, state)

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
      lengthDescriptor.value > maximumArrayElements
    ) {
      throw new RepositoryValidationError()
    }

    const length = lengthDescriptor.value as number
    const expectedKeys = new Set<PropertyKey>(['length'])
    const canonical: AuditMetadataValue[] = []

    for (let index = 0; index < length; index += 1) {
      const propertyName = String(index)
      const descriptor = descriptors[propertyName]
      expectedKeys.add(propertyName)

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryValidationError()
      }

      canonical.push(validateMetadataValue(descriptor.value, depth + 1, state))
    }

    const keys = Reflect.ownKeys(descriptors)

    if (keys.length !== expectedKeys.size || !keys.every((key) => expectedKeys.has(key))) {
      throw new RepositoryValidationError()
    }

    return deepFreeze(canonical) as readonly AuditMetadataValue[]
  } finally {
    state.activeObjects.delete(value)
  }
}

function claimMetadataNode(depth: number, state: MetadataValidationState): void {
  if (depth > maximumMetadataDepth) {
    throw new RepositoryValidationError()
  }

  state.nodeCount += 1

  if (state.nodeCount > maximumMetadataNodes) {
    throw new RepositoryValidationError()
  }
}

function assertOrdinaryMetadataObject(value: object): void {
  let prototype: unknown

  try {
    prototype = Object.getPrototypeOf(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }

  if (prototype !== Object.prototype && prototype !== null) {
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
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function isSafeMetadataKey(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= maximumAuditCodeLength &&
    !reservedMetadataKeys.has(value) &&
    metadataKeyPattern.test(value)
  )
}

function validateMetadataString(value: string): void {
  if (
    hasUnpairedSurrogate(value) ||
    hasUnsafeTextCharacter(value) ||
    Array.from(value).length > maximumStringCodePoints ||
    Buffer.byteLength(value, 'utf8') > maximumStringUtf8Bytes
  ) {
    throw new RepositoryValidationError()
  }
}

function deepFreeze<T extends AuditMetadataValue>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue)
  }

  return Object.freeze(value)
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
