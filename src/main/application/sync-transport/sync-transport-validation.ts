import { createHash } from 'node:crypto'

import { parseIanaTimeZone } from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import type {
  PrepareSyncBatchInput,
  SyncJsonValue,
  SyncRecordSnapshot,
  SyncResourceType,
  SyncSourceActorSnapshot
} from './sync-transport-types'

const tokenPattern = /^chs_inst_v1_[A-Za-z0-9_-]{43}$/
const resourceOrder: Readonly<Record<SyncResourceType, number>> = Object.freeze({
  PATIENT: 0,
  SCREENING_SESSION: 1,
  SCREENING_ENCOUNTER: 2,
  VITALS: 3,
  LIFESTYLE: 4
})
const schemaByResource: Readonly<Record<SyncResourceType, SyncRecordSnapshot['schemaVersion']>> =
  Object.freeze({
    PATIENT: 'patient.v1',
    SCREENING_SESSION: 'screening-session.v1',
    SCREENING_ENCOUNTER: 'screening-encounter.v1',
    VITALS: 'vitals.v1',
    LIFESTYLE: 'lifestyle.v1'
  })

export interface ParsedSyncConfiguration {
  readonly apiBaseUrl: string
  readonly installationToken: string
  readonly tokenPrefix: string
}

export interface ParsedRetryRequest {
  readonly batchId: EntityId
  readonly errorCode: string
  readonly retryAfterMs: number
}

export function parseSyncConfiguration(value: unknown): ParsedSyncConfiguration {
  const record = exactRecord(value, ['apiBaseUrl', 'installationToken'])
  if (typeof record.apiBaseUrl !== 'string' || typeof record.installationToken !== 'string') {
    throw new Error('invalid sync configuration')
  }
  const url = new URL(record.apiBaseUrl)
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]'
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/' ||
    !tokenPattern.test(record.installationToken)
  ) {
    throw new Error('invalid sync configuration')
  }
  return Object.freeze({
    apiBaseUrl: url.origin,
    installationToken: record.installationToken,
    tokenPrefix: record.installationToken.slice(0, 20)
  })
}

export function parsePrepareSyncBatchInput(value: unknown): PrepareSyncBatchInput {
  const record = exactRecord(value, [
    'installationId',
    'locationId',
    'installationTimezone',
    'desktopApplicationVersion',
    'desktopSchemaVersion',
    'actors',
    'records',
    'outboxIds'
  ])
  if (
    typeof record.installationTimezone !== 'string' ||
    typeof record.desktopApplicationVersion !== 'string' ||
    record.desktopApplicationVersion.length < 1 ||
    record.desktopApplicationVersion.length > 64 ||
    typeof record.desktopSchemaVersion !== 'number' ||
    !Number.isSafeInteger(record.desktopSchemaVersion) ||
    record.desktopSchemaVersion < 1 ||
    !Array.isArray(record.actors) ||
    record.actors.length < 1 ||
    record.actors.length > 50 ||
    !Array.isArray(record.records) ||
    record.records.length < 1 ||
    record.records.length > 100 ||
    !Array.isArray(record.outboxIds) ||
    record.outboxIds.length < 1 ||
    record.outboxIds.length > 500
  ) {
    throw new Error('invalid sync batch')
  }
  const actors = record.actors
    .map(parseActor)
    .sort((left, right) => left.localActorId.localeCompare(right.localActorId))
  const records = record.records.map(parseRecord).sort(compareRecords)
  const outboxIds = record.outboxIds.map(parseEntityId).sort()
  if (
    new Set(actors.map((actor) => actor.localActorId)).size !== actors.length ||
    new Set(records.map((item) => item.recordId)).size !== records.length ||
    new Set(records.map((item) => `${item.resourceType}:${item.localResourceId}`)).size !==
      records.length ||
    new Set(outboxIds).size !== outboxIds.length
  ) {
    throw new Error('duplicate sync identity')
  }
  const actorIds = new Set(actors.map((actor) => actor.localActorId))
  if (records.some((item) => !actorIds.has(item.sourceActorLocalId))) {
    throw new Error('unknown sync actor')
  }
  return Object.freeze({
    installationId: parseEntityId(record.installationId),
    locationId: parseEntityId(record.locationId),
    installationTimezone: parseIanaTimeZone(record.installationTimezone),
    desktopApplicationVersion: record.desktopApplicationVersion,
    desktopSchemaVersion: record.desktopSchemaVersion,
    actors: Object.freeze(actors),
    records: Object.freeze(records),
    outboxIds: Object.freeze(outboxIds)
  })
}

export function createCanonicalBatchRequest(
  input: PrepareSyncBatchInput,
  batchId: EntityId,
  createdAt: string
): { readonly json: string; readonly sha256: string } {
  const request = {
    contractVersion: '1.0',
    batchId,
    installationId: input.installationId,
    locationId: input.locationId,
    installationTimezone: input.installationTimezone,
    desktopApplicationVersion: input.desktopApplicationVersion,
    desktopSchemaVersion: input.desktopSchemaVersion,
    createdAt: parseUtcTimestamp(createdAt),
    actors: input.actors,
    records: input.records
  }
  const json = JSON.stringify(canonicalizeJson(request, 0, { count: 0 }))
  if (Buffer.byteLength(json, 'utf8') > 1024 * 1024) throw new Error('sync batch too large')
  return Object.freeze({ json, sha256: createHash('sha256').update(json).digest('hex') })
}

export function parseRetryRequest(value: unknown): ParsedRetryRequest {
  const record = exactRecord(value, ['batchId', 'errorCode', 'retryAfterMs'])
  if (
    typeof record.errorCode !== 'string' ||
    !/^[A-Z0-9_]{1,64}$/.test(record.errorCode) ||
    typeof record.retryAfterMs !== 'number' ||
    !Number.isSafeInteger(record.retryAfterMs) ||
    record.retryAfterMs < 1_000 ||
    record.retryAfterMs > 24 * 60 * 60 * 1000
  ) {
    throw new Error('invalid retry request')
  }
  return Object.freeze({
    batchId: parseEntityId(record.batchId),
    errorCode: record.errorCode,
    retryAfterMs: record.retryAfterMs
  })
}

export function addMilliseconds(timestamp: string, durationMs: number): string {
  return new Date(new Date(parseUtcTimestamp(timestamp)).getTime() + durationMs).toISOString()
}

function parseActor(value: unknown): SyncSourceActorSnapshot {
  const record = exactRecord(value, ['localActorId', 'displayName', 'role', 'active', 'updatedAt'])
  if (
    typeof record.displayName !== 'string' ||
    record.displayName.trim() !== record.displayName ||
    record.displayName.length < 1 ||
    record.displayName.length > 120 ||
    !['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'].includes(String(record.role)) ||
    typeof record.active !== 'boolean'
  ) {
    throw new Error('invalid actor')
  }
  return Object.freeze({
    localActorId: parseEntityId(record.localActorId),
    displayName: record.displayName,
    role: record.role as SyncSourceActorSnapshot['role'],
    active: record.active,
    updatedAt: parseUtcTimestamp(record.updatedAt)
  })
}

function parseRecord(value: unknown): SyncRecordSnapshot {
  const record = exactRecord(value, [
    'recordId',
    'resourceType',
    'localResourceId',
    'sourceRevision',
    'schemaVersion',
    'operation',
    'capturedAt',
    'sourceActorLocalId',
    'payload'
  ])
  const resourceType = parseResourceType(record.resourceType)
  if (
    record.schemaVersion !== schemaByResource[resourceType] ||
    record.operation !== 'UPSERT' ||
    typeof record.sourceRevision !== 'number' ||
    !Number.isSafeInteger(record.sourceRevision) ||
    record.sourceRevision < 1 ||
    !isPlainRecord(record.payload)
  ) {
    throw new Error('invalid record')
  }
  return Object.freeze({
    recordId: parseEntityId(record.recordId),
    resourceType,
    localResourceId: parseEntityId(record.localResourceId),
    sourceRevision: record.sourceRevision,
    schemaVersion: schemaByResource[resourceType],
    operation: 'UPSERT',
    capturedAt: parseUtcTimestamp(record.capturedAt),
    sourceActorLocalId: parseEntityId(record.sourceActorLocalId),
    payload: canonicalizeJson(record.payload, 0, { count: 0 }) as Readonly<{
      [key: string]: SyncJsonValue
    }>
  })
}

function parseResourceType(value: unknown): SyncResourceType {
  if (!Object.prototype.hasOwnProperty.call(resourceOrder, String(value))) {
    throw new Error('unsupported resource')
  }
  return value as SyncResourceType
}

function compareRecords(left: SyncRecordSnapshot, right: SyncRecordSnapshot): number {
  return (
    resourceOrder[left.resourceType] - resourceOrder[right.resourceType] ||
    left.localResourceId.localeCompare(right.localResourceId) ||
    left.sourceRevision - right.sourceRevision
  )
}

function canonicalizeJson(value: unknown, depth: number, state: { count: number }): SyncJsonValue {
  state.count += 1
  if (state.count > 20_000 || depth > 20) throw new Error('json bounds exceeded')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('invalid number')
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => canonicalizeJson(item, depth + 1, state)))
  }
  if (!isPlainRecord(value)) throw new Error('invalid json value')
  const result: Record<string, SyncJsonValue> = Object.create(null)
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error('unsafe json key')
    }
    result[key] = canonicalizeJson(value[key], depth + 1, state)
  }
  return Object.freeze(result)
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('invalid object')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('invalid object keys')
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
