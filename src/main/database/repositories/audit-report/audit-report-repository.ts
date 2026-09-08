import type Database from 'better-sqlite3'

import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseStoredAuditMetadataJson
} from '../audit-event'
import { parseDeploymentName, parseIanaTimeZone } from '../installation'
import { parseLocalUserRole, parseUserDisplayName, parseUsername } from '../local-user'
import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError
} from '../repository-errors'
import type {
  AuditReportActorFilter,
  AuditReportActorRecord,
  AuditReportContextRecord,
  AuditReportDeploymentRecord,
  AuditReportEventRecord,
  AuditReportPageSize,
  AuditReportRepository,
  AuditReportSearchInput,
  AuditReportSearchResult
} from './audit-report-types'

const searchInputKeys = Object.freeze([
  'query',
  'occurredFromInclusive',
  'occurredToExclusive',
  'actor',
  'action',
  'entityType',
  'entityId',
  'page',
  'pageSize'
] as const)
const actorRowKeys = Object.freeze(['id', 'username', 'display_name', 'role'] as const)
const deploymentRowKeys = Object.freeze(['id', 'deployment_name', 'timezone'] as const)
const eventRowKeys = Object.freeze([
  'id',
  'action',
  'entity_type',
  'entity_id',
  'occurred_at',
  'metadata_json',
  'actor_id',
  'actor_username',
  'actor_display_name',
  'actor_role',
  'deployment_id',
  'deployment_name',
  'deployment_timezone'
] as const)

const deploymentSql = `
SELECT id, deployment_name, timezone
FROM installation
WHERE singleton_id = 1;
`

const actorsSql = `
SELECT DISTINCT actor.id, actor.username, actor.display_name, actor.role
FROM audit_log event
JOIN users actor ON actor.id = event.user_id
ORDER BY actor.display_name COLLATE NOCASE ASC, actor.username COLLATE NOCASE ASC, actor.id ASC;
`

const actionsSql = `
SELECT DISTINCT action AS value
FROM audit_log
ORDER BY action ASC;
`

const entityTypesSql = `
SELECT DISTINCT entity_type AS value
FROM audit_log
ORDER BY entity_type ASC;
`

const hasSystemEventsSql = `
SELECT EXISTS (
  SELECT 1 FROM audit_log WHERE user_id IS NULL LIMIT 1
) AS has_system_events;
`

const eventSelectSql = `
SELECT
  event.id,
  event.action,
  event.entity_type,
  event.entity_id,
  event.occurred_at,
  event.metadata_json,
  actor.id AS actor_id,
  actor.username AS actor_username,
  actor.display_name AS actor_display_name,
  actor.role AS actor_role,
  deployment.id AS deployment_id,
  deployment.deployment_name,
  deployment.timezone AS deployment_timezone
FROM audit_log event
JOIN installation deployment ON deployment.id = event.installation_id
LEFT JOIN users actor ON actor.id = event.user_id
`

export function createAuditReportRepository(connection: Database.Database): AuditReportRepository {
  return Object.freeze({
    getContext(): AuditReportContextRecord {
      try {
        const deploymentRow = connection.prepare(deploymentSql).get()
        if (deploymentRow === undefined) throw new RepositoryDataIntegrityError()

        return Object.freeze({
          deployment: decodeDeployment(deploymentRow),
          actors: decodeRows(connection.prepare(actorsSql).all(), decodeActor),
          actions: decodeValueRows(connection.prepare(actionsSql).all(), parseAuditActionCode),
          entityTypes: decodeValueRows(
            connection.prepare(entityTypesSql).all(),
            parseAuditEntityType
          ),
          hasSystemEvents: decodeSystemEvents(connection.prepare(hasSystemEventsSql).get())
        })
      } catch (error) {
        throw toReadError(error)
      }
    },

    search(input: AuditReportSearchInput): AuditReportSearchResult {
      const parsed = parseSearchInput(input)
      const where: string[] = []
      const parameters: unknown[] = []

      if (parsed.occurredFromInclusive !== null) {
        where.push('event.occurred_at >= ?')
        parameters.push(parsed.occurredFromInclusive)
      }
      if (parsed.occurredToExclusive !== null) {
        where.push('event.occurred_at < ?')
        parameters.push(parsed.occurredToExclusive)
      }
      if (parsed.actor.kind === 'SYSTEM') {
        where.push('event.user_id IS NULL')
      } else if (parsed.actor.kind === 'USER') {
        where.push('event.user_id = ?')
        parameters.push(parsed.actor.userId)
      }
      if (parsed.action !== null) {
        where.push('event.action = ?')
        parameters.push(parsed.action)
      }
      if (parsed.entityType !== null) {
        where.push('event.entity_type = ?')
        parameters.push(parsed.entityType)
      }
      if (parsed.entityId !== null) {
        where.push('event.entity_id = ?')
        parameters.push(parsed.entityId)
      }
      if (parsed.query !== '') {
        where.push(`(
          lower(event.action) LIKE ? ESCAPE '\\'
          OR lower(event.entity_type) LIKE ? ESCAPE '\\'
          OR lower(COALESCE(event.entity_id, '')) LIKE ? ESCAPE '\\'
          OR lower(COALESCE(actor.display_name, '')) LIKE ? ESCAPE '\\'
          OR lower(COALESCE(actor.username, '')) LIKE ? ESCAPE '\\'
        )`)
        const pattern = `%${escapeLike(parsed.query.toLowerCase())}%`
        const codePattern = `%${escapeLike(parsed.query.toLowerCase().replace(/\s+/gu, '_'))}%`
        parameters.push(codePattern, codePattern, pattern, pattern, pattern)
      }

      const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`
      const offset = (parsed.page - 1) * parsed.pageSize

      try {
        const rows = connection
          .prepare(
            `${eventSelectSql}
             ${whereSql}
             ORDER BY event.occurred_at DESC, event.id DESC
             LIMIT ? OFFSET ?;`
          )
          .all(...parameters, parsed.pageSize, offset)
        const countRow = connection
          .prepare(
            `SELECT COUNT(*) AS total
             FROM audit_log event
             LEFT JOIN users actor ON actor.id = event.user_id
             ${whereSql};`
          )
          .get(...parameters)

        return Object.freeze({
          items: decodeRows(rows, decodeEvent),
          page: parsed.page,
          pageSize: parsed.pageSize,
          total: decodeCount(countRow)
        })
      } catch (error) {
        throw toReadError(error)
      }
    }
  })
}

function parseSearchInput(input: AuditReportSearchInput): AuditReportSearchInput {
  try {
    const data = readDataProperties(input, searchInputKeys)
    const query = parseQuery(data.query)
    const occurredFromInclusive = parseNullableTimestamp(data.occurredFromInclusive)
    const occurredToExclusive = parseNullableTimestamp(data.occurredToExclusive)
    const actor = parseActorFilter(data.actor)
    const action = data.action === null ? null : parseAuditActionCode(data.action)
    const entityType = data.entityType === null ? null : parseAuditEntityType(data.entityType)
    const entityId = data.entityId === null ? null : parseEntityId(data.entityId)
    const page = parsePage(data.page)
    const pageSize = parsePageSize(data.pageSize)

    if (
      occurredFromInclusive !== null &&
      occurredToExclusive !== null &&
      occurredFromInclusive >= occurredToExclusive
    ) {
      throw new RepositoryValidationError()
    }
    if (entityId !== null && entityType === null) throw new RepositoryValidationError()

    return Object.freeze({
      query,
      occurredFromInclusive,
      occurredToExclusive,
      actor,
      action,
      entityType,
      entityId,
      page,
      pageSize
    })
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw new RepositoryValidationError(error.errorType)
    }
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function parseActorFilter(value: unknown): AuditReportActorFilter {
  const kindData = readDataProperties(value, null)
  if (kindData.kind === 'ALL' || kindData.kind === 'SYSTEM') {
    readDataProperties(value, ['kind'])
    return Object.freeze({ kind: kindData.kind })
  }
  if (kindData.kind === 'USER') {
    const data = readDataProperties(value, ['kind', 'userId'])
    return Object.freeze({ kind: 'USER', userId: parseEntityId(data.userId) })
  }
  throw new RepositoryValidationError()
}

function parseQuery(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim()) throw new RepositoryValidationError()
  if ([...value].length > 100 || hasDisallowedQueryCharacter(value)) {
    throw new RepositoryValidationError()
  }
  return value
}

function hasDisallowedQueryCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return (
      codePoint === undefined ||
      codePoint <= 31 ||
      codePoint === 127 ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    )
  })
}

function parseNullableTimestamp(value: unknown): ReturnType<typeof parseUtcTimestamp> | null {
  return value === null ? null : parseUtcTimestamp(value)
}

function parsePage(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 10000) {
    throw new RepositoryValidationError()
  }
  return value as number
}

function parsePageSize(value: unknown): AuditReportPageSize {
  if (value !== 25 && value !== 50 && value !== 100) throw new RepositoryValidationError()
  return value
}

function decodeEvent(value: unknown): AuditReportEventRecord {
  const data = readDataProperties(value, eventRowKeys)
  const actorValues = [data.actor_id, data.actor_username, data.actor_display_name, data.actor_role]
  const hasNullActor = actorValues.some((item) => item === null)
  const hasPresentActor = actorValues.some((item) => item !== null)
  if (hasNullActor && hasPresentActor) throw new RepositoryDataIntegrityError()

  return Object.freeze({
    id: parseEntityId(data.id),
    action: parseAuditActionCode(data.action),
    entityType: parseAuditEntityType(data.entity_type),
    entityId: data.entity_id === null ? null : parseEntityId(data.entity_id),
    occurredAt: parseUtcTimestamp(data.occurred_at),
    actor:
      data.actor_id === null
        ? null
        : Object.freeze({
            id: parseEntityId(data.actor_id),
            username: parseUsername(data.actor_username),
            displayName: parseUserDisplayName(data.actor_display_name),
            role: parseLocalUserRole(data.actor_role)
          }),
    deployment: Object.freeze({
      id: parseEntityId(data.deployment_id),
      name: parseDeploymentName(data.deployment_name),
      timeZone: parseIanaTimeZone(data.deployment_timezone)
    }),
    metadata: parseStoredAuditMetadataJson(data.metadata_json).metadata
  })
}

function decodeActor(value: unknown): AuditReportActorRecord {
  const data = readDataProperties(value, actorRowKeys)
  return Object.freeze({
    id: parseEntityId(data.id),
    username: parseUsername(data.username),
    displayName: parseUserDisplayName(data.display_name),
    role: parseLocalUserRole(data.role)
  })
}

function decodeDeployment(value: unknown): AuditReportDeploymentRecord {
  const data = readDataProperties(value, deploymentRowKeys)
  return Object.freeze({
    id: parseEntityId(data.id),
    name: parseDeploymentName(data.deployment_name),
    timeZone: parseIanaTimeZone(data.timezone)
  })
}

function decodeValueRows<TValue>(
  rows: unknown,
  parse: (value: unknown) => TValue
): readonly TValue[] {
  return decodeRows(rows, (row) => parse(readDataProperties(row, ['value']).value))
}

function decodeRows<TValue>(rows: unknown, decode: (row: unknown) => TValue): readonly TValue[] {
  if (!Array.isArray(rows)) throw new RepositoryDataIntegrityError()
  return Object.freeze(rows.map((row) => decode(row)))
}

function decodeSystemEvents(value: unknown): boolean {
  const data = readDataProperties(value, ['has_system_events'])
  if (data.has_system_events !== 0 && data.has_system_events !== 1) {
    throw new RepositoryDataIntegrityError()
  }
  return data.has_system_events === 1
}

function decodeCount(value: unknown): number {
  const data = readDataProperties(value, ['total'])
  if (!Number.isSafeInteger(data.total) || (data.total as number) < 0) {
    throw new RepositoryDataIntegrityError()
  }
  return data.total as number
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[] | null
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryDataIntegrityError()
  }
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryDataIntegrityError()
  }
  const keys = Reflect.ownKeys(descriptors)
  if (
    expectedKeys !== null &&
    (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key)))
  ) {
    throw new RepositoryDataIntegrityError()
  }
  const data: Record<string, unknown> = {}
  for (const key of expectedKeys ?? keys) {
    if (typeof key !== 'string') throw new RepositoryDataIntegrityError()
    const descriptor = descriptors[key]
    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryDataIntegrityError()
    }
    data[key] = descriptor.value
  }
  return data
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&')
}

function toReadError(error: unknown): RepositoryReadError | RepositoryDataIntegrityError {
  if (error instanceof RepositoryDataIntegrityError || error instanceof RepositoryValidationError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }
  return new RepositoryReadError(getRepositoryErrorType(error))
}
