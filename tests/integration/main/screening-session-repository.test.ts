import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createScreeningSessionRepository,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError,
  ScreeningSessionAlreadyExistsError,
  parseScreeningSessionDate,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InsertScreeningSessionInput,
  type ScreeningSessionRecord,
  type ScreeningSessionRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T13:34:56.789Z'
const secondLater = '2026-07-29T14:34:56.789Z'
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '22222222-2222-4222-8222-222222222222'
const locationId = '33333333-3333-4333-8333-333333333333'
const secondLocationId = '44444444-4444-4444-8444-444444444444'
const protocolVersionId = '55555555-5555-4555-8555-555555555555'
const sessionId = '66666666-6666-4666-8666-666666666666'
const secondSessionId = '77777777-7777-4777-8777-777777777777'
const lifecycleHistoryId = '88888888-8888-4888-8888-888888888888'
const secondLifecycleHistoryId = '99999999-9999-4999-8999-999999999999'
const thirdLifecycleHistoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fourthLifecycleHistoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const generatedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('screening session repository', () => {
  it('inserts an OPEN session and CREATED lifecycle row atomically', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)

      const inserted = executor.run((context) =>
        repository.insert(
          context.connection,
          createInsertInput({ notes: '  Mobile screening day  ' })
        )
      )

      expect(inserted).toEqual(createExpectedSession({ notes: '  Mobile screening day  ' }))
      expect(Object.isFrozen(inserted)).toBe(true)
      expect(readRawLifecycleHistory(connection, sessionId)).toEqual([
        {
          id: lifecycleHistoryId,
          screening_session_id: sessionId,
          transition_type: 'CREATED',
          from_status: null,
          to_status: 'OPEN',
          reason: null,
          changed_by: userId,
          changed_at: now,
          prior_row_version: null,
          resulting_row_version: 1
        }
      ])
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
      expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(1)
    })
  })

  it('classifies only location/date uniqueness as ScreeningSessionAlreadyExistsError', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      insertRawLocation(connection, { id: secondLocationId, name: 'Second Site' })

      executor.run((context) => repository.insert(context.connection, createInsertInput()))

      const duplicateError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createInsertInput({
              id: secondSessionId,
              lifecycleHistoryId: secondLifecycleHistoryId
            })
          )
        )
      )

      expect(duplicateError).toBeInstanceOf(ScreeningSessionAlreadyExistsError)
      expectSafeControlledError(duplicateError)

      const lifecycleCollisionError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createInsertInput({
              id: secondSessionId,
              lifecycleHistoryId,
              locationId: secondLocationId
            })
          )
        )
      )

      expect(lifecycleCollisionError).toBeInstanceOf(RepositoryWriteError)
      expect(lifecycleCollisionError).not.toBeInstanceOf(ScreeningSessionAlreadyExistsError)
      expectSafeControlledError(lifecycleCollisionError)
      expect(repository.getById(parseEntityId(secondSessionId))).toBeNull()
    })
  })

  it('allows concurrent OPEN sessions at different locations', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      insertRawLocation(connection, { id: secondLocationId, name: 'Second Site' })

      executor.run((context) => repository.insert(context.connection, createInsertInput()))
      executor.run((context) =>
        repository.insert(
          context.connection,
          createInsertInput({
            id: secondSessionId,
            lifecycleHistoryId: secondLifecycleHistoryId,
            locationId: secondLocationId
          })
        )
      )

      expect(readTableCount(connection, 'screening_sessions')).toBe(2)
      expect(
        repository.list({
          locationId: null,
          status: 'OPEN',
          dateFrom: parseScreeningSessionDate('2026-07-29'),
          dateTo: parseScreeningSessionDate('2026-07-29'),
          page: 1,
          pageSize: 25
        }).total
      ).toBe(2)
    })
  })

  it('gets and lists sessions with deterministic filters, ordering, and frozen pages', async () => {
    await withScreeningSessionRepository(({ connection, repository }) => {
      insertReferences(connection)
      insertRawLocation(connection, { id: secondLocationId, name: 'Second Site' })
      insertRawSession(connection, { id: sessionId, session_date: '2026-07-29' })
      insertRawSession(connection, {
        id: secondSessionId,
        location_id: secondLocationId,
        session_date: '2026-07-30'
      })
      insertRawSession(connection, {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        session_date: '2026-07-30',
        status: 'CLOSED',
        closed_by: userId,
        closed_at: later,
        updated_by: userId,
        updated_at: later,
        row_version: 2
      })

      expect(repository.getById(parseEntityId(sessionId))).toEqual(createExpectedSession())
      expect(repository.getById(parseEntityId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))).toBeNull()

      const page = repository.list({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: 1,
        pageSize: 25
      })

      expect(page.total).toBe(3)
      expect(page.items.map((item) => item.id)).toEqual([
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        secondSessionId,
        sessionId
      ])
      expect(Object.isFrozen(page)).toBe(true)
      expect(Object.isFrozen(page.items)).toBe(true)
      expect(Object.isFrozen(page.items[0])).toBe(true)

      expect(
        repository
          .list({
            locationId: parseEntityId(secondLocationId),
            status: 'OPEN',
            dateFrom: parseScreeningSessionDate('2026-07-30'),
            dateTo: parseScreeningSessionDate('2026-07-30'),
            page: 1,
            pageSize: 50
          })
          .items.map((item) => item.id)
      ).toEqual([secondSessionId])

      expect(
        repository.list({
          locationId: null,
          status: null,
          dateFrom: null,
          dateTo: null,
          page: 2,
          pageSize: 100
        }).items
      ).toEqual([])
      expect(() =>
        repository.list({
          locationId: null,
          status: null,
          dateFrom: parseScreeningSessionDate('2026-07-31'),
          dateTo: parseScreeningSessionDate('2026-07-30'),
          page: 1,
          pageSize: 25
        })
      ).toThrow(RepositoryValidationError)
    })
  })

  it('closes sessions with compare-and-set semantics and appends lifecycle history only on success', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      executor.run((context) => repository.insert(context.connection, createInsertInput()))

      const closed = executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
          expectedRowVersion: 1,
          closedBy: parseEntityId(secondUserId),
          closedAt: parseUtcTimestamp(later),
          reason: '  Weather closed the site  '
        })
      )

      expect(closed).toMatchObject({
        status: 'CLOSED',
        session: {
          id: sessionId,
          status: 'CLOSED',
          openedBy: userId,
          openedAt: now,
          closedBy: secondUserId,
          closedAt: later,
          updatedBy: secondUserId,
          updatedAt: later,
          rowVersion: 2
        }
      })
      expect(
        readRawLifecycleHistory(connection, sessionId).map((row) => row.transition_type)
      ).toEqual(['CREATED', 'CLOSED'])

      const conflict = executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 1,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(secondLater),
          reason: null
        })
      )
      expect(conflict).toMatchObject({
        status: 'SESSION_VERSION_CONFLICT',
        session: { rowVersion: 2 }
      })

      const alreadyClosed = executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 2,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(secondLater),
          reason: null
        })
      )
      expect(alreadyClosed).toMatchObject({ status: 'ALREADY_CLOSED' })
      expect(readRawLifecycleHistory(connection, sessionId)).toHaveLength(2)

      const notFound = executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 1,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(secondLater),
          reason: null
        })
      )
      expect(notFound).toEqual({ status: 'NOT_FOUND' })
    })
  })

  it('reopens sessions with required reasons and repeated lifecycle row versions', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      executor.run((context) => repository.insert(context.connection, createInsertInput()))
      executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
          expectedRowVersion: 1,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(later),
          reason: null
        })
      )

      const reopened = executor.run((context) =>
        repository.reopen(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 2,
          reopenedBy: parseEntityId(secondUserId),
          reopenedAt: parseUtcTimestamp(secondLater),
          reason: '  Continued registration  '
        })
      )

      expect(reopened).toMatchObject({
        status: 'REOPENED',
        session: {
          status: 'OPEN',
          openedBy: secondUserId,
          openedAt: secondLater,
          closedBy: null,
          closedAt: null,
          updatedBy: secondUserId,
          updatedAt: secondLater,
          rowVersion: 3
        }
      })
      expect(() =>
        executor.run((context) =>
          repository.reopen(context.connection, {
            id: parseEntityId(sessionId),
            lifecycleHistoryId: parseEntityId(fourthLifecycleHistoryId),
            expectedRowVersion: 3,
            reopenedBy: parseEntityId(userId),
            reopenedAt: parseUtcTimestamp(secondLater),
            reason: '   '
          })
        )
      ).toThrow(RepositoryValidationError)

      const alreadyOpen = executor.run((context) =>
        repository.reopen(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(fourthLifecycleHistoryId),
          expectedRowVersion: 3,
          reopenedBy: parseEntityId(userId),
          reopenedAt: parseUtcTimestamp(secondLater),
          reason: 'Open again'
        })
      )

      expect(alreadyOpen).toMatchObject({ status: 'ALREADY_OPEN' })
      expect(
        readRawLifecycleHistory(connection, sessionId).map((row) => row.resulting_row_version)
      ).toEqual([1, 2, 3])

      executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(fourthLifecycleHistoryId),
          expectedRowVersion: 3,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp('2026-07-29T15:34:56.789Z'),
          reason: 'Final close'
        })
      )
      expect(
        readRawLifecycleHistory(connection, sessionId).map((row) => row.transition_type)
      ).toEqual(['CREATED', 'CLOSED', 'REOPENED', 'CLOSED'])
    })
  })

  it('rolls back session and history writes when surrounding transaction work fails', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)

      expect(() =>
        executor.run((context) => {
          repository.insert(context.connection, createInsertInput())
          throw new Error('C:\\secret\\after-insert.txt')
        })
      ).toThrow()

      expect(readTableCount(connection, 'screening_sessions')).toBe(0)
      expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(0)

      executor.run((context) => repository.insert(context.connection, createInsertInput()))
      insertRawLocation(connection, { id: secondLocationId, name: 'Second Site' })

      expect(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createInsertInput({
              id: secondSessionId,
              lifecycleHistoryId,
              locationId: secondLocationId
            })
          )
        )
      ).toThrow(RepositoryWriteError)

      expect(repository.getById(parseEntityId(secondSessionId))).toBeNull()
      expect(readRawLifecycleHistory(connection, secondSessionId)).toEqual([])
    })
  })

  it('requires authentic active transaction capabilities before hostile input inspection', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)

      connection.exec('BEGIN IMMEDIATE')
      try {
        const error = captureError(() =>
          repository.insert(
            connection as unknown as DatabaseTransactionConnection,
            createHostileInsertInput()
          )
        )

        expect(error).toBeInstanceOf(DatabaseTransactionStateError)
        expect(error).not.toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      const fabricatedError = captureError(() =>
        repository.insert(createFabricatedScopedConnection(connection), createHostileInsertInput())
      )
      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)

      let retained: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        retained = context.connection
        return undefined
      })

      const expiredError = captureError(() =>
        repository.getByIdForWrite(retained!, parseEntityId(sessionId))
      )
      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expect(expiredError).not.toBeInstanceOf(RepositoryValidationError)
    })
  })

  it('fails closed when persisted current-state rows violate repository invariants', async () => {
    await withScreeningSessionRepository(({ connection, repository }) => {
      insertReferences(connection)
      connection.pragma('ignore_check_constraints = ON')
      try {
        insertRawSession(connection, { status: 'BROKEN' })
      } finally {
        connection.pragma('ignore_check_constraints = OFF')
      }

      const error = captureError(() => repository.getById(parseEntityId(sessionId)))

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })
  })
})

interface MigratedDatabaseContext {
  readonly connection: Database.Database
  readonly repository: ScreeningSessionRepository
  readonly executor: DatabaseTransactionExecutor
}

interface RawSessionRow {
  readonly id: string
  readonly location_id: string
  readonly protocol_version_id: string
  readonly session_date: string
  readonly status: string
  readonly notes: string | null
  readonly opened_by: string
  readonly opened_at: string
  readonly closed_by: string | null
  readonly closed_at: string | null
  readonly created_by: string
  readonly created_at: string
  readonly updated_by: string
  readonly updated_at: string
  readonly row_version: number
}

interface RawLifecycleHistoryRow {
  readonly id: string
  readonly screening_session_id: string
  readonly transition_type: string
  readonly from_status: string | null
  readonly to_status: string
  readonly reason: string | null
  readonly changed_by: string
  readonly changed_at: string
  readonly prior_row_version: number | null
  readonly resulting_row_version: number
}

async function withScreeningSessionRepository(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd027-screening-session-repository-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: createFixedClock()
    })(connection)
    await test({
      connection,
      repository: createScreeningSessionRepository(connection),
      executor: createExecutorForConnection(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createInsertInput(
  override: Partial<Record<keyof InsertScreeningSessionInput, unknown>> = {}
): InsertScreeningSessionInput {
  const raw = {
    id: sessionId,
    lifecycleHistoryId,
    locationId,
    protocolVersionId,
    sessionDate: '2026-07-29',
    notes: null,
    createdBy: userId,
    createdAt: now,
    ...override
  }

  return {
    id: parseEntityId(raw.id),
    lifecycleHistoryId: parseEntityId(raw.lifecycleHistoryId),
    locationId: parseEntityId(raw.locationId),
    protocolVersionId: parseEntityId(raw.protocolVersionId),
    sessionDate: parseScreeningSessionDate(raw.sessionDate),
    notes: raw.notes as string | null,
    createdBy: parseEntityId(raw.createdBy),
    createdAt: parseUtcTimestamp(raw.createdAt)
  }
}

function createHostileInsertInput(): InsertScreeningSessionInput {
  const input = { ...createInsertInput() }

  return new Proxy(input, {
    getPrototypeOf() {
      throw new Error('C:\\secret\\input-prototype.txt')
    }
  }) as InsertScreeningSessionInput
}

function createExpectedSession(
  override: Partial<Record<keyof ScreeningSessionRecord, unknown>> = {}
): ScreeningSessionRecord {
  return {
    id: parseEntityId(sessionId),
    locationId: parseEntityId(locationId),
    protocolVersionId: parseEntityId(protocolVersionId),
    sessionDate: parseScreeningSessionDate('2026-07-29'),
    status: 'OPEN',
    notes: null,
    openedBy: parseEntityId(userId),
    openedAt: parseUtcTimestamp(now),
    closedBy: null,
    closedAt: null,
    createdBy: parseEntityId(userId),
    createdAt: parseUtcTimestamp(now),
    updatedBy: parseEntityId(userId),
    updatedAt: parseUtcTimestamp(now),
    rowVersion: 1,
    ...override
  } as ScreeningSessionRecord
}

function insertReferences(connection: Database.Database): void {
  insertRawUser(connection)
  insertRawUser(connection, { id: secondUserId, username: 'second-admin' })
  insertRawLocation(connection)
  insertRawProtocolVersion(connection)
}

function insertRawUser(
  connection: Database.Database,
  override: { readonly id?: string; readonly username?: string } = {}
): void {
  const id = override.id ?? userId
  const username = override.username ?? 'session-admin'

  connection
    .prepare(
      `INSERT INTO users (
        id,
        username,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        role,
        is_active,
        must_change_password,
        failed_login_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(id, username, username.toLowerCase(), 'Session Admin', now, now)
}

function insertRawLocation(
  connection: Database.Database,
  override: {
    readonly id?: string
    readonly name?: string
    readonly isActive?: number
  } = {}
): void {
  const id = override.id ?? locationId
  const name = override.name ?? 'Central Church'

  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, 'CHURCH', ?, ?, ?, ?, ?)`
    )
    .run(id, name, name.toLowerCase(), override.isActive ?? 1, userId, now, userId, now)
}

function insertRawProtocolVersion(
  connection: Database.Database,
  override: { readonly id?: string; readonly status?: string } = {}
): void {
  connection
    .prepare(
      `INSERT INTO protocol_versions (
        id,
        protocol_key,
        version_label,
        status,
        configuration_json,
        checksum,
        imported_by,
        imported_at,
        activated_by,
        activated_at,
        created_at
      ) VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      override.id ?? protocolVersionId,
      `screening-${override.id ?? protocolVersionId}`,
      '1.0.0',
      override.status ?? 'ACTIVE',
      `checksum-${override.id ?? protocolVersionId}`,
      userId,
      now,
      userId,
      now,
      now
    )
}

function insertRawSession(
  connection: Database.Database,
  override: Partial<RawSessionRow> = {}
): void {
  const row: RawSessionRow = {
    id: sessionId,
    location_id: locationId,
    protocol_version_id: protocolVersionId,
    session_date: '2026-07-29',
    status: 'OPEN',
    notes: null,
    opened_by: userId,
    opened_at: now,
    closed_by: null,
    closed_at: null,
    created_by: userId,
    created_at: now,
    updated_by: userId,
    updated_at: now,
    row_version: 1,
    ...override
  }

  connection
    .prepare(
      `INSERT INTO screening_sessions (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.location_id,
      row.protocol_version_id,
      row.session_date,
      row.status,
      row.notes,
      row.opened_by,
      row.opened_at,
      row.closed_by,
      row.closed_at,
      row.created_by,
      row.created_at,
      row.updated_by,
      row.updated_at,
      row.row_version
    )
}

function readRawLifecycleHistory(
  connection: Database.Database,
  id: string
): readonly RawLifecycleHistoryRow[] {
  return connection
    .prepare(
      `SELECT
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
      FROM screening_session_lifecycle_history
      WHERE screening_session_id = ?
      ORDER BY changed_at ASC, id ASC`
    )
    .all(id) as readonly RawLifecycleHistoryRow[]
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS count FROM "${tableName.replaceAll('"', '""')}"`)
    .get() as { count: number }

  return row.count
}

function createExecutorForConnection(connection: Database.Database): DatabaseTransactionExecutor {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: createFixedIdGenerator(),
    clock: createFixedClock(),
    logger: {
      error: vi.fn<(message: string) => void>()
    }
  })
}

function createFixedIdGenerator(): EntityIdGenerator {
  return {
    generate: () => parseEntityId(generatedId)
  }
}

function createFixedClock(): UtcClock {
  return createUtcClock(() => now)
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function createFabricatedScopedConnection(
  connection: Database.Database
): DatabaseTransactionConnection {
  const fabricated = {
    open: connection.open,
    inTransaction: connection.inTransaction,
    prepare: connection.prepare.bind(
      connection
    ) as unknown as DatabaseTransactionConnection['prepare'],
    exec(): DatabaseTransactionConnection {
      return fabricated
    }
  } as unknown as DatabaseTransactionConnection

  return fabricated
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}

function expectSafeControlledError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).toBeInstanceOf(Error)
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    'secret',
    'C:\\',
    'SELECT',
    'INSERT',
    'UPDATE',
    'screening_sessions',
    'screening_session_lifecycle_history',
    'Mobile screening day',
    'Weather closed the site',
    userId,
    secondUserId,
    locationId,
    secondLocationId,
    protocolVersionId,
    sessionId,
    secondSessionId,
    lifecycleHistoryId,
    secondLifecycleHistoryId,
    now,
    later
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}
