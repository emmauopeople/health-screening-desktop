import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  ScreeningSessionAlreadyExistsError
} from '../repository-errors'
import {
  parseCloseScreeningSessionInput,
  parseInsertScreeningSessionInput,
  parseReopenScreeningSessionInput,
  parseScreeningSessionDate,
  parseScreeningSessionListInput,
  parseScreeningSessionNote,
  parseScreeningSessionRowVersion,
  parseScreeningSessionStatus,
  readDataProperties
} from './screening-session-validation'
import type {
  CloseScreeningSessionInput,
  CloseScreeningSessionWriteResult,
  InsertScreeningSessionInput,
  ReopenScreeningSessionInput,
  ReopenScreeningSessionWriteResult,
  ScreeningSessionListInput,
  ScreeningSessionListResult,
  ScreeningSessionRecord,
  ScreeningSessionRepository
} from './screening-session-types'

interface ScreeningSessionReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const screeningSessionRowKeys = Object.freeze([
  'id',
  'location_id',
  'protocol_version_id',
  'session_date',
  'status',
  'notes',
  'opened_by',
  'opened_at',
  'closed_by',
  'closed_at',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'row_version'
] as const)

const countRowKeys = Object.freeze(['total'] as const)
const existsRowKeys = Object.freeze(['has_any'] as const)

const screeningSessionColumns = `
  id,
  location_id,
  protocol_version_id,
  session_date,
  status,
  notes,
  opened_by,
  opened_at,
  closed_by,
  closed_at,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
`

const selectScreeningSessionByIdSql = `
SELECT
${screeningSessionColumns}
FROM screening_sessions
WHERE id = ?;
`

const selectHasOpenScreeningSessionForLocationSql = `
SELECT EXISTS(
  SELECT 1
  FROM screening_sessions
  WHERE location_id = ?
    AND status = 'OPEN'
  LIMIT 1
) AS has_any;
`

const selectHasAnyOpenScreeningSessionSql = `
SELECT EXISTS(
  SELECT 1
  FROM screening_sessions
  WHERE status = 'OPEN'
  LIMIT 1
) AS has_any;
`

const insertScreeningSessionSql = `
INSERT INTO screening_sessions (
  id,
  location_id,
  protocol_version_id,
  session_date,
  status,
  notes,
  opened_by,
  opened_at,
  closed_by,
  closed_at,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1);
`

const insertLifecycleHistorySql = `
INSERT INTO screening_session_lifecycle_history (
  id,
  screening_session_id,
  transition_type,
  from_status,
  to_status,
  reason,
  changed_by,
  changed_at,
  prior_row_version,
  resulting_row_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`

const closeScreeningSessionSql = `
UPDATE screening_sessions
SET
  status = 'CLOSED',
  closed_by = ?,
  closed_at = ?,
  updated_by = ?,
  updated_at = ?,
  row_version = row_version + 1
WHERE id = ?
  AND row_version = ?
  AND status = 'OPEN';
`

const reopenScreeningSessionSql = `
UPDATE screening_sessions
SET
  status = 'OPEN',
  opened_by = ?,
  opened_at = ?,
  closed_by = NULL,
  closed_at = NULL,
  updated_by = ?,
  updated_at = ?,
  row_version = row_version + 1
WHERE id = ?
  AND row_version = ?
  AND status = 'CLOSED';
`

export function createScreeningSessionRepository(
  connection: Database.Database
): ScreeningSessionRepository {
  return Object.freeze({
    getById(id: ScreeningSessionRecord['id']): ScreeningSessionRecord | null {
      const parsedId = parseReadEntityId(id)

      try {
        return readScreeningSession(connection, parsedId, (error) => new RepositoryReadError(error))
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getByIdForWrite(
      scopedConnection: DatabaseTransactionConnection,
      id: ScreeningSessionRecord['id']
    ): ScreeningSessionRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readScreeningSession(
          scopedConnection,
          parseReadEntityId(id),
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    hasOpenForLocationForWrite(
      scopedConnection: DatabaseTransactionConnection,
      locationId: ScreeningSessionRecord['locationId']
    ): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return decodeExistsRow(
          scopedConnection
            .prepare<[string]>(selectHasOpenScreeningSessionForLocationSql)
            .get(parseReadEntityId(locationId))
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    hasAnyOpenForWrite(scopedConnection: DatabaseTransactionConnection): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return decodeExistsRow(scopedConnection.prepare(selectHasAnyOpenScreeningSessionSql).get())
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    list(input: ScreeningSessionListInput): ScreeningSessionListResult {
      const parsed = parseScreeningSessionListInput(input)
      const query = buildListQuery(parsed)

      try {
        const total = decodeCountRow(connection.prepare(query.countSql).get(...query.params))
        const items = decodeScreeningSessionRows(
          connection.prepare(query.itemsSql).all(...query.params, parsed.pageSize, parsed.offset),
          parsed.pageSize
        )

        return Object.freeze({
          items,
          page: parsed.page,
          pageSize: parsed.pageSize,
          total
        })
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    insert(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertScreeningSessionInput
    ): ScreeningSessionRecord {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseInsertScreeningSessionInput(input)

        scopedConnection
          .prepare<
            [
              string,
              string,
              string,
              string,
              string | null,
              string,
              string,
              string,
              string,
              string,
              string
            ]
          >(insertScreeningSessionSql)
          .run(
            parsed.id,
            parsed.locationId,
            parsed.protocolVersionId,
            parsed.sessionDate,
            parsed.notes,
            parsed.createdBy,
            parsed.createdAt,
            parsed.createdBy,
            parsed.createdAt,
            parsed.createdBy,
            parsed.createdAt
          )
        insertLifecycleHistory(scopedConnection, {
          id: parsed.lifecycleHistoryId,
          screeningSessionId: parsed.id,
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: parsed.createdBy,
          changedAt: parsed.createdAt,
          priorRowVersion: null,
          resultingRowVersion: 1
        })

        const created = readScreeningSessionAfterWrite(scopedConnection, parsed.id)

        if (created === null) {
          throw new RepositoryWriteError()
        }

        return created
      } catch (error) {
        throw toWriteError(error)
      }
    },

    close(
      scopedConnection: DatabaseTransactionConnection,
      input: CloseScreeningSessionInput
    ): CloseScreeningSessionWriteResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseCloseScreeningSessionInput(input)
        const result = scopedConnection
          .prepare<[string, string, string, string, string, number]>(closeScreeningSessionSql)
          .run(
            parsed.closedBy,
            parsed.closedAt,
            parsed.closedBy,
            parsed.closedAt,
            parsed.id,
            parsed.expectedRowVersion
          )

        if (result.changes === 0) {
          return resolveCloseZeroRowResult(scopedConnection, parsed.id, parsed.expectedRowVersion)
        }

        const resultingRowVersion = parsed.expectedRowVersion + 1
        insertLifecycleHistory(scopedConnection, {
          id: parsed.lifecycleHistoryId,
          screeningSessionId: parsed.id,
          transitionType: 'CLOSED',
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          reason: parsed.reason,
          changedBy: parsed.closedBy,
          changedAt: parsed.closedAt,
          priorRowVersion: parsed.expectedRowVersion,
          resultingRowVersion
        })

        const session = readScreeningSessionAfterWrite(scopedConnection, parsed.id)

        if (session === null || session.rowVersion !== resultingRowVersion) {
          throw new RepositoryWriteError()
        }

        return Object.freeze({ status: 'CLOSED' as const, session })
      } catch (error) {
        throw toWriteError(error)
      }
    },

    reopen(
      scopedConnection: DatabaseTransactionConnection,
      input: ReopenScreeningSessionInput
    ): ReopenScreeningSessionWriteResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseReopenScreeningSessionInput(input)
        const result = scopedConnection
          .prepare<[string, string, string, string, string, number]>(reopenScreeningSessionSql)
          .run(
            parsed.reopenedBy,
            parsed.reopenedAt,
            parsed.reopenedBy,
            parsed.reopenedAt,
            parsed.id,
            parsed.expectedRowVersion
          )

        if (result.changes === 0) {
          return resolveReopenZeroRowResult(scopedConnection, parsed.id, parsed.expectedRowVersion)
        }

        const resultingRowVersion = parsed.expectedRowVersion + 1
        insertLifecycleHistory(scopedConnection, {
          id: parsed.lifecycleHistoryId,
          screeningSessionId: parsed.id,
          transitionType: 'REOPENED',
          fromStatus: 'CLOSED',
          toStatus: 'OPEN',
          reason: parsed.reason,
          changedBy: parsed.reopenedBy,
          changedAt: parsed.reopenedAt,
          priorRowVersion: parsed.expectedRowVersion,
          resultingRowVersion
        })

        const session = readScreeningSessionAfterWrite(scopedConnection, parsed.id)

        if (session === null || session.rowVersion !== resultingRowVersion) {
          throw new RepositoryWriteError()
        }

        return Object.freeze({ status: 'REOPENED' as const, session })
      } catch (error) {
        throw toWriteError(error)
      }
    }
  })
}

function buildListQuery(input: {
  readonly locationId: string | null
  readonly status: string | null
  readonly dateFrom: string | null
  readonly dateTo: string | null
}): {
  readonly countSql: string
  readonly itemsSql: string
  readonly params: readonly unknown[]
} {
  const clauses: string[] = []
  const params: unknown[] = []

  if (input.locationId !== null) {
    clauses.push('location_id = ?')
    params.push(input.locationId)
  }

  if (input.status !== null) {
    clauses.push('status = ?')
    params.push(input.status)
  }

  if (input.dateFrom !== null) {
    clauses.push('session_date >= ?')
    params.push(input.dateFrom)
  }

  if (input.dateTo !== null) {
    clauses.push('session_date <= ?')
    params.push(input.dateTo)
  }

  const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`

  return Object.freeze({
    countSql: `SELECT COUNT(*) AS total FROM screening_sessions ${whereClause};`,
    itemsSql: `SELECT
${screeningSessionColumns}
FROM screening_sessions
${whereClause}
ORDER BY session_date DESC, id DESC
LIMIT ? OFFSET ?;`,
    params: Object.freeze(params)
  })
}

function resolveCloseZeroRowResult(
  connection: DatabaseTransactionConnection,
  id: string,
  expectedRowVersion: number
): CloseScreeningSessionWriteResult {
  const latest = readScreeningSessionAfterWrite(connection, id)

  if (latest === null) {
    return Object.freeze({ status: 'NOT_FOUND' as const })
  }

  if (latest.rowVersion !== expectedRowVersion) {
    return Object.freeze({ status: 'SESSION_VERSION_CONFLICT' as const, session: latest })
  }

  if (latest.status === 'CLOSED') {
    return Object.freeze({ status: 'ALREADY_CLOSED' as const, session: latest })
  }

  throw new RepositoryDataIntegrityError()
}

function resolveReopenZeroRowResult(
  connection: DatabaseTransactionConnection,
  id: string,
  expectedRowVersion: number
): ReopenScreeningSessionWriteResult {
  const latest = readScreeningSessionAfterWrite(connection, id)

  if (latest === null) {
    return Object.freeze({ status: 'NOT_FOUND' as const })
  }

  if (latest.rowVersion !== expectedRowVersion) {
    return Object.freeze({ status: 'SESSION_VERSION_CONFLICT' as const, session: latest })
  }

  if (latest.status === 'OPEN') {
    return Object.freeze({ status: 'ALREADY_OPEN' as const, session: latest })
  }

  throw new RepositoryDataIntegrityError()
}

function readScreeningSessionAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): ScreeningSessionRecord | null {
  return readScreeningSession(connection, id, (error) => new RepositoryWriteError(error))
}

function readScreeningSession(
  connection: ScreeningSessionReadConnection,
  id: string,
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): ScreeningSessionRecord | null {
  try {
    const row = connection.prepare(selectScreeningSessionByIdSql).get(id)

    return row === undefined ? null : decodeScreeningSessionRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function insertLifecycleHistory(
  connection: DatabaseTransactionConnection,
  input: {
    readonly id: string
    readonly screeningSessionId: string
    readonly transitionType: 'CREATED' | 'CLOSED' | 'REOPENED'
    readonly fromStatus: 'OPEN' | 'CLOSED' | null
    readonly toStatus: 'OPEN' | 'CLOSED'
    readonly reason: string | null
    readonly changedBy: string
    readonly changedAt: string
    readonly priorRowVersion: number | null
    readonly resultingRowVersion: number
  }
): void {
  connection
    .prepare<
      [
        string,
        string,
        string,
        string | null,
        string,
        string | null,
        string,
        string,
        number | null,
        number
      ]
    >(insertLifecycleHistorySql)
    .run(
      input.id,
      input.screeningSessionId,
      input.transitionType,
      input.fromStatus,
      input.toStatus,
      input.reason,
      input.changedBy,
      input.changedAt,
      input.priorRowVersion,
      input.resultingRowVersion
    )
}

function decodeScreeningSessionRows(
  rows: unknown,
  maximumLength: number
): readonly ScreeningSessionRecord[] {
  try {
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      throw new RepositoryDataIntegrityError()
    }

    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
    const lengthDescriptor = descriptors.length

    if (
      lengthDescriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength
    ) {
      throw new RepositoryDataIntegrityError()
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
      throw new RepositoryDataIntegrityError()
    }

    const records: ScreeningSessionRecord[] = []

    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RepositoryDataIntegrityError()
      }

      records.push(decodeScreeningSessionRow(descriptor.value))
    }

    return Object.freeze(records)
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeScreeningSessionRow(row: unknown): ScreeningSessionRecord {
  try {
    const data = readDataProperties(row, screeningSessionRowKeys)
    const id = parseEntityId(data.id)
    const locationId = parseEntityId(data.location_id)
    const protocolVersionId = parseEntityId(data.protocol_version_id)
    const sessionDate = parseScreeningSessionDate(data.session_date)
    const status = parseScreeningSessionStatus(data.status)
    const notes = parseScreeningSessionNote(data.notes)
    const openedBy = parseEntityId(data.opened_by)
    const openedAt = parseUtcTimestamp(data.opened_at)
    const closedBy = data.closed_by === null ? null : parseEntityId(data.closed_by)
    const closedAt = data.closed_at === null ? null : parseUtcTimestamp(data.closed_at)
    const createdBy = parseEntityId(data.created_by)
    const createdAt = parseUtcTimestamp(data.created_at)
    const updatedBy = parseEntityId(data.updated_by)
    const updatedAt = parseUtcTimestamp(data.updated_at)
    const rowVersion = parseScreeningSessionRowVersion(data.row_version)

    if (
      openedAt < createdAt ||
      updatedAt < createdAt ||
      (status === 'OPEN' && (closedBy !== null || closedAt !== null)) ||
      (status === 'CLOSED' && (closedBy === null || closedAt === null)) ||
      (status === 'CLOSED' && closedAt !== null && closedAt < openedAt)
    ) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze({
      id,
      locationId,
      protocolVersionId,
      sessionDate,
      status,
      notes,
      openedBy,
      openedAt,
      closedBy,
      closedAt,
      createdBy,
      createdAt,
      updatedBy,
      updatedAt,
      rowVersion
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeCountRow(row: unknown): number {
  try {
    const data = readDataProperties(row, countRowKeys)

    if (typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0) {
      throw new RepositoryDataIntegrityError()
    }

    return data.total
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeExistsRow(row: unknown): boolean {
  try {
    const data = readDataProperties(row, existsRowKeys)

    if (data.has_any === 0) {
      return false
    }

    if (data.has_any === 1) {
      return true
    }

    throw new RepositoryDataIntegrityError()
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function parseReadEntityId(value: unknown): string {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function toWriteError(error: unknown): Error {
  if (error instanceof DatabaseTransactionStateError) {
    return new DatabaseTransactionStateError(error.errorType)
  }

  if (error instanceof ScreeningSessionAlreadyExistsError) {
    return new ScreeningSessionAlreadyExistsError(error.errorType)
  }

  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }

  if (error instanceof RepositoryWriteError) {
    return new RepositoryWriteError(error.errorType)
  }

  if (isLocationDateUniqueConstraintError(error)) {
    return new ScreeningSessionAlreadyExistsError(getRepositoryErrorType(error))
  }

  return new RepositoryWriteError(getRepositoryErrorType(error))
}

function isLocationDateUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  let code: unknown
  let message: unknown

  try {
    code = Object.getOwnPropertyDescriptor(error, 'code')?.value
    message = Object.getOwnPropertyDescriptor(error, 'message')?.value
  } catch {
    return false
  }

  return (
    (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') &&
    typeof message === 'string' &&
    message.includes('screening_sessions.location_id') &&
    message.includes('screening_sessions.session_date')
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
