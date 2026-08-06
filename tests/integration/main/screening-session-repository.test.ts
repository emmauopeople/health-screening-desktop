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
  type CloseScreeningSessionInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InsertScreeningSessionInput,
  type ReopenScreeningSessionInput,
  type ScreeningSessionRecord,
  type ScreeningSessionRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T13:34:56.789Z'
const secondLater = '2026-07-29T14:34:56.789Z'
const thirdLater = '2026-07-29T15:34:56.789Z'
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '22222222-2222-4222-8222-222222222222'
const locationId = '33333333-3333-4333-8333-333333333333'
const secondLocationId = '44444444-4444-4444-8444-444444444444'
const thirdLocationId = '12121212-1212-4212-8212-121212121212'
const protocolVersionId = '55555555-5555-4555-8555-555555555555'
const sessionId = '66666666-6666-4666-8666-666666666666'
const secondSessionId = '77777777-7777-4777-8777-777777777777'
const thirdSessionId = '13131313-1313-4313-8313-131313131313'
const fourthSessionId = '14141414-1414-4414-8414-141414141414'
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

  it('accepts transition row versions only when the resulting version remains safe', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      insertRawSession(connection, { row_version: Number.MAX_SAFE_INTEGER - 1 })
      insertRawLifecycleHistory(connection, {
        id: lifecycleHistoryId,
        resulting_row_version: 1
      })

      const accepted = executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
          expectedRowVersion: Number.MAX_SAFE_INTEGER - 1,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(later),
          reason: null
        })
      )

      expect(accepted).toMatchObject({
        status: 'CLOSED',
        session: {
          rowVersion: Number.MAX_SAFE_INTEGER,
          status: 'CLOSED'
        }
      })
    })
  })

  it('rejects unsafe close and reopen transition row versions without mutation', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      insertRawSession(connection, { row_version: Number.MAX_SAFE_INTEGER })
      insertRawLifecycleHistory(connection, {
        id: lifecycleHistoryId,
        resulting_row_version: 1
      })
      const originalRow = readRawSession(connection, sessionId)
      const originalHistory = readRawLifecycleHistory(connection, sessionId)

      const closeError = captureError(() =>
        executor.run((context) =>
          repository.close(context.connection, {
            id: parseEntityId(sessionId),
            lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
            expectedRowVersion: Number.MAX_SAFE_INTEGER,
            closedBy: parseEntityId(userId),
            closedAt: parseUtcTimestamp(later),
            reason: null
          })
        )
      )

      expect(closeError).toBeInstanceOf(RepositoryValidationError)
      expect(readRawSession(connection, sessionId)).toEqual(originalRow)
      expect(readRawLifecycleHistory(connection, sessionId)).toEqual(originalHistory)

      updateRawSession(connection, {
        status: 'CLOSED',
        closed_by: userId,
        closed_at: later,
        updated_by: userId,
        updated_at: later,
        row_version: Number.MAX_SAFE_INTEGER
      })
      const closedRow = readRawSession(connection, sessionId)
      const historyAfterCloseRejection = readRawLifecycleHistory(connection, sessionId)

      const reopenError = captureError(() =>
        executor.run((context) =>
          repository.reopen(context.connection, {
            id: parseEntityId(sessionId),
            lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
            expectedRowVersion: Number.MAX_SAFE_INTEGER,
            reopenedBy: parseEntityId(userId),
            reopenedAt: parseUtcTimestamp(secondLater),
            reason: 'Reopen'
          })
        )
      )

      expect(reopenError).toBeInstanceOf(RepositoryValidationError)
      expect(readRawSession(connection, sessionId)).toEqual(closedRow)
      expect(readRawLifecycleHistory(connection, sessionId)).toEqual(historyAfterCloseRejection)
    })
  })

  it('rejects unsafe transition row versions before preparing update SQL', () => {
    const fakeConnection = createFakeExecutorConnection()
    const fakeRepository = createScreeningSessionRepository(
      fakeConnection as unknown as Database.Database
    )
    const fakeExecutor = createExecutorForConnection(fakeConnection as unknown as Database.Database)

    expect(() =>
      fakeExecutor.run((context) =>
        fakeRepository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(lifecycleHistoryId),
          expectedRowVersion: Number.MAX_SAFE_INTEGER,
          closedBy: parseEntityId(userId),
          closedAt: parseUtcTimestamp(now),
          reason: null
        })
      )
    ).toThrow(RepositoryValidationError)
    expect(fakeConnection.preparedSql).toEqual([])

    expect(() =>
      fakeExecutor.run((context) =>
        fakeRepository.reopen(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
          expectedRowVersion: Number.MAX_SAFE_INTEGER,
          reopenedBy: parseEntityId(userId),
          reopenedAt: parseUtcTimestamp(now),
          reason: 'Reopen'
        })
      )
    ).toThrow(RepositoryValidationError)
    expect(fakeConnection.preparedSql).toEqual([])
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

  it('lists sessions with bounded page sizes, individual filters, totals, and overflow protection', async () => {
    await withScreeningSessionRepository(({ connection, repository }) => {
      seedListRows(connection)

      for (const pageSize of [25, 50, 100] as const) {
        const result = repository.list({
          locationId: null,
          status: null,
          dateFrom: null,
          dateTo: null,
          page: 1,
          pageSize
        })

        expect(result.pageSize).toBe(pageSize)
        expect(result.total).toBe(4)
      }

      expect(
        repository
          .list({
            locationId: null,
            status: null,
            dateFrom: null,
            dateTo: null,
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([secondSessionId, thirdSessionId, sessionId, fourthSessionId])
      expect(
        repository
          .list({
            locationId: parseEntityId(secondLocationId),
            status: null,
            dateFrom: null,
            dateTo: null,
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([secondSessionId])
      expect(
        repository
          .list({
            locationId: null,
            status: 'CLOSED',
            dateFrom: null,
            dateTo: null,
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([thirdSessionId, fourthSessionId])
      expect(
        repository
          .list({
            locationId: null,
            status: null,
            dateFrom: parseScreeningSessionDate('2026-07-29'),
            dateTo: null,
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([secondSessionId, thirdSessionId, sessionId])
      expect(
        repository
          .list({
            locationId: null,
            status: null,
            dateFrom: null,
            dateTo: parseScreeningSessionDate('2026-07-29'),
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([sessionId, fourthSessionId])
      expect(
        repository
          .list({
            locationId: parseEntityId(secondLocationId),
            status: 'OPEN',
            dateFrom: parseScreeningSessionDate('2026-07-30'),
            dateTo: parseScreeningSessionDate('2026-07-30'),
            page: 1,
            pageSize: 25
          })
          .items.map((item) => item.id)
      ).toEqual([secondSessionId])

      const emptyPage = repository.list({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: 2,
        pageSize: 25
      })
      expect(emptyPage.items).toEqual([])
      expect(emptyPage.total).toBe(4)

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

    const fakeConnection = createFakeExecutorConnection()
    const fakeRepository = createScreeningSessionRepository(
      fakeConnection as unknown as Database.Database
    )

    expect(() =>
      fakeRepository.list({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 100
      })
    ).toThrow(RepositoryValidationError)
    expect(fakeConnection.preparedSql).toEqual([])
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

  it('rolls back close state changes when lifecycle history insertion fails', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      executor.run((context) => repository.insert(context.connection, createInsertInput()))

      const error = captureError(() =>
        executor.run((context) =>
          repository.close(context.connection, {
            id: parseEntityId(sessionId),
            lifecycleHistoryId: parseEntityId(lifecycleHistoryId),
            expectedRowVersion: 1,
            closedBy: parseEntityId(secondUserId),
            closedAt: parseUtcTimestamp(later),
            reason: 'Close collision'
          })
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(error).not.toBeInstanceOf(ScreeningSessionAlreadyExistsError)
      expect(readRawSession(connection, sessionId)).toMatchObject({
        status: 'OPEN',
        closed_by: null,
        closed_at: null,
        row_version: 1
      })
      expect(
        readRawLifecycleHistory(connection, sessionId).map((row) => row.transition_type)
      ).toEqual(['CREATED'])
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
          reason: '  Initial close  '
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
          closedAt: parseUtcTimestamp(thirdLater),
          reason: 'Final close'
        })
      )
      expect(readRawSession(connection, sessionId)).toMatchObject({
        status: 'CLOSED',
        row_version: 4
      })
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
        },
        {
          id: secondLifecycleHistoryId,
          screening_session_id: sessionId,
          transition_type: 'CLOSED',
          from_status: 'OPEN',
          to_status: 'CLOSED',
          reason: '  Initial close  ',
          changed_by: userId,
          changed_at: later,
          prior_row_version: 1,
          resulting_row_version: 2
        },
        {
          id: thirdLifecycleHistoryId,
          screening_session_id: sessionId,
          transition_type: 'REOPENED',
          from_status: 'CLOSED',
          to_status: 'OPEN',
          reason: '  Continued registration  ',
          changed_by: secondUserId,
          changed_at: secondLater,
          prior_row_version: 2,
          resulting_row_version: 3
        },
        {
          id: fourthLifecycleHistoryId,
          screening_session_id: sessionId,
          transition_type: 'CLOSED',
          from_status: 'OPEN',
          to_status: 'CLOSED',
          reason: 'Final close',
          changed_by: userId,
          changed_at: thirdLater,
          prior_row_version: 3,
          resulting_row_version: 4
        }
      ])
    })
  })

  it('returns reopen conflict and not-found results without changing state or history', async () => {
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
      const closedRow = readRawSession(connection, sessionId)
      const closedHistory = readRawLifecycleHistory(connection, sessionId)

      const conflict = executor.run((context) =>
        repository.reopen(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 1,
          reopenedBy: parseEntityId(secondUserId),
          reopenedAt: parseUtcTimestamp(secondLater),
          reason: 'Retry after conflict'
        })
      )

      expect(conflict).toMatchObject({
        status: 'SESSION_VERSION_CONFLICT',
        session: { id: sessionId, rowVersion: 2, status: 'CLOSED' }
      })
      if (conflict.status === 'SESSION_VERSION_CONFLICT') {
        expect(Object.isFrozen(conflict.session)).toBe(true)
      }
      expect(readRawSession(connection, sessionId)).toEqual(closedRow)
      expect(readRawLifecycleHistory(connection, sessionId)).toEqual(closedHistory)

      const notFound = executor.run((context) =>
        repository.reopen(context.connection, {
          id: parseEntityId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
          lifecycleHistoryId: parseEntityId(thirdLifecycleHistoryId),
          expectedRowVersion: 1,
          reopenedBy: parseEntityId(secondUserId),
          reopenedAt: parseUtcTimestamp(secondLater),
          reason: 'Missing session'
        })
      )

      expect(notFound).toEqual({ status: 'NOT_FOUND' })
      expect(readRawSession(connection, sessionId)).toEqual(closedRow)
      expect(readRawLifecycleHistory(connection, sessionId)).toEqual(closedHistory)
    })
  })

  it('rolls back reopen state changes when lifecycle history insertion fails', async () => {
    await withScreeningSessionRepository(({ connection, repository, executor }) => {
      insertReferences(connection)
      executor.run((context) => repository.insert(context.connection, createInsertInput()))
      executor.run((context) =>
        repository.close(context.connection, {
          id: parseEntityId(sessionId),
          lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
          expectedRowVersion: 1,
          closedBy: parseEntityId(secondUserId),
          closedAt: parseUtcTimestamp(later),
          reason: 'Original close'
        })
      )

      const error = captureError(() =>
        executor.run((context) =>
          repository.reopen(context.connection, {
            id: parseEntityId(sessionId),
            lifecycleHistoryId: parseEntityId(secondLifecycleHistoryId),
            expectedRowVersion: 2,
            reopenedBy: parseEntityId(userId),
            reopenedAt: parseUtcTimestamp(secondLater),
            reason: 'Reopen collision'
          })
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(error).not.toBeInstanceOf(ScreeningSessionAlreadyExistsError)
      expect(readRawSession(connection, sessionId)).toMatchObject({
        status: 'CLOSED',
        closed_by: secondUserId,
        closed_at: later,
        row_version: 2
      })
      expect(
        readRawLifecycleHistory(connection, sessionId).map((row) => row.transition_type)
      ).toEqual(['CREATED', 'CLOSED'])
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

      let retained: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        retained = context.connection
        return undefined
      })

      for (const operation of createCapabilityFirstOperations(repository)) {
        const rawHostile = operation.createHostileInput()
        connection.exec('BEGIN IMMEDIATE')
        try {
          const error = captureError(() =>
            operation.run(connection as unknown as DatabaseTransactionConnection, rawHostile.value)
          )

          expect(error, `${operation.name} raw`).toBeInstanceOf(DatabaseTransactionStateError)
          expect(error, `${operation.name} raw`).not.toBeInstanceOf(RepositoryValidationError)
          expect(rawHostile.wasInspected(), `${operation.name} raw`).toBe(false)
          expectSafeControlledError(error)
        } finally {
          if (connection.inTransaction) {
            connection.exec('ROLLBACK')
          }
        }

        const fabricatedHostile = operation.createHostileInput()
        const fabricatedError = captureError(() =>
          operation.run(createFabricatedScopedConnection(connection), fabricatedHostile.value)
        )
        expect(fabricatedError, `${operation.name} fabricated`).toBeInstanceOf(
          DatabaseTransactionStateError
        )
        expect(fabricatedError, `${operation.name} fabricated`).not.toBeInstanceOf(
          RepositoryValidationError
        )
        expect(fabricatedHostile.wasInspected(), `${operation.name} fabricated`).toBe(false)

        const expiredHostile = operation.createHostileInput()
        const expiredError = captureError(() => operation.run(retained!, expiredHostile.value))
        expect(expiredError, `${operation.name} expired`).toBeInstanceOf(
          DatabaseTransactionStateError
        )
        expect(expiredError, `${operation.name} expired`).not.toBeInstanceOf(
          RepositoryValidationError
        )
        expect(expiredHostile.wasInspected(), `${operation.name} expired`).toBe(false)
      }
    })
  })

  it('fails closed when persisted current-state rows violate repository invariants', async () => {
    const scenarios: ReadonlyArray<{
      readonly name: string
      readonly override: Partial<RawSessionRow>
      readonly ignoreChecks?: boolean
      readonly disableForeignKeys?: boolean
      readonly readWithList?: boolean
    }> = [
      {
        name: 'malformed session ID',
        override: { id: 'not-a-uuid' },
        readWithList: true
      },
      {
        name: 'malformed location ID',
        override: { location_id: 'not-a-uuid' },
        disableForeignKeys: true
      },
      {
        name: 'malformed protocol ID',
        override: { protocol_version_id: 'not-a-uuid' },
        disableForeignKeys: true
      },
      {
        name: 'malformed UTC timestamp',
        override: { opened_at: 'not-a-timestamp' }
      },
      {
        name: 'OPEN with close metadata',
        override: { closed_by: userId, closed_at: later },
        ignoreChecks: true
      },
      {
        name: 'CLOSED missing close metadata',
        override: { status: 'CLOSED' },
        ignoreChecks: true
      },
      {
        name: 'rowVersion zero',
        override: { row_version: 0 },
        ignoreChecks: true
      },
      {
        name: 'rowVersion above safe integer',
        override: { row_version: Number.MAX_SAFE_INTEGER + 1 }
      },
      {
        name: 'blank notes',
        override: { notes: '   ' }
      },
      {
        name: 'invalid status',
        override: { status: 'BROKEN' },
        ignoreChecks: true
      }
    ]

    for (const scenario of scenarios) {
      await withScreeningSessionRepository(({ connection, repository }) => {
        insertReferences(connection)
        insertMalformedSessionFixture(connection, scenario)

        const error = captureError(() => {
          if (scenario.readWithList === true) {
            repository.list({
              locationId: null,
              status: null,
              dateFrom: null,
              dateTo: null,
              page: 1,
              pageSize: 25
            })
            return
          }

          repository.getById(parseEntityId(sessionId))
        })

        expect(error, scenario.name).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeControlledError(error)
      })
    }
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

interface HostileInput<T> {
  readonly value: T
  wasInspected(): boolean
}

interface CapabilityFirstOperation {
  readonly name: string
  createHostileInput(): HostileInput<unknown>
  run(connection: DatabaseTransactionConnection, value: unknown): void
}

function createCapabilityFirstOperations(
  repository: ScreeningSessionRepository
): readonly CapabilityFirstOperation[] {
  return Object.freeze([
    {
      name: 'insert',
      createHostileInput: () => createHostileInput(createInsertInput()),
      run: (connection, value) => {
        repository.insert(connection, value as InsertScreeningSessionInput)
      }
    },
    {
      name: 'close',
      createHostileInput: () => createHostileInput(createCloseInput()),
      run: (connection, value) => {
        repository.close(connection, value as CloseScreeningSessionInput)
      }
    },
    {
      name: 'reopen',
      createHostileInput: () => createHostileInput(createReopenInput()),
      run: (connection, value) => {
        repository.reopen(connection, value as ReopenScreeningSessionInput)
      }
    },
    {
      name: 'getByIdForWrite',
      createHostileInput: () => createHostileInput({ id: sessionId }),
      run: (connection, value) => {
        repository.getByIdForWrite(connection, value as never)
      }
    }
  ])
}

function createHostileInput<T extends object>(input: T): HostileInput<T> {
  let inspected = false

  return Object.freeze({
    value: new Proxy(input, {
      getPrototypeOf() {
        inspected = true
        throw new Error('C:\\secret\\input-prototype.txt')
      },
      ownKeys() {
        inspected = true
        throw new Error('C:\\secret\\input-ownKeys.txt')
      },
      getOwnPropertyDescriptor() {
        inspected = true
        throw new Error('C:\\secret\\input-descriptor.txt')
      },
      get() {
        inspected = true
        throw new Error('C:\\secret\\input-get.txt')
      }
    }),
    wasInspected: () => inspected
  })
}

function createCloseInput(
  override: Partial<Record<keyof CloseScreeningSessionInput, unknown>> = {}
): CloseScreeningSessionInput {
  const raw = {
    id: sessionId,
    lifecycleHistoryId: secondLifecycleHistoryId,
    expectedRowVersion: 1,
    closedBy: userId,
    closedAt: later,
    reason: null,
    ...override
  }

  return {
    id: parseEntityId(raw.id),
    lifecycleHistoryId: parseEntityId(raw.lifecycleHistoryId),
    expectedRowVersion: raw.expectedRowVersion as number,
    closedBy: parseEntityId(raw.closedBy),
    closedAt: parseUtcTimestamp(raw.closedAt),
    reason: raw.reason as string | null
  }
}

function createReopenInput(
  override: Partial<Record<keyof ReopenScreeningSessionInput, unknown>> = {}
): ReopenScreeningSessionInput {
  const raw = {
    id: sessionId,
    lifecycleHistoryId: thirdLifecycleHistoryId,
    expectedRowVersion: 2,
    reopenedBy: userId,
    reopenedAt: secondLater,
    reason: 'Reopen',
    ...override
  }

  return {
    id: parseEntityId(raw.id),
    lifecycleHistoryId: parseEntityId(raw.lifecycleHistoryId),
    expectedRowVersion: raw.expectedRowVersion as number,
    reopenedBy: parseEntityId(raw.reopenedBy),
    reopenedAt: parseUtcTimestamp(raw.reopenedAt),
    reason: raw.reason as string
  }
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

function updateRawSession(
  connection: Database.Database,
  override: Partial<RawSessionRow> = {}
): void {
  const existing = readRawSession(connection, override.id ?? sessionId)

  if (existing === undefined) {
    throw new Error('Expected raw session fixture')
  }

  const row = { ...existing, ...override }

  connection
    .prepare(
      `UPDATE screening_sessions
      SET location_id = ?,
        protocol_version_id = ?,
        session_date = ?,
        status = ?,
        notes = ?,
        opened_by = ?,
        opened_at = ?,
        closed_by = ?,
        closed_at = ?,
        created_by = ?,
        created_at = ?,
        updated_by = ?,
        updated_at = ?,
        row_version = ?
      WHERE id = ?`
    )
    .run(
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
      row.row_version,
      row.id
    )
}

function readRawSession(connection: Database.Database, id: string): RawSessionRow | undefined {
  return connection
    .prepare(
      `SELECT
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
      FROM screening_sessions
      WHERE id = ?`
    )
    .get(id) as RawSessionRow | undefined
}

function insertRawLifecycleHistory(
  connection: Database.Database,
  override: Partial<RawLifecycleHistoryRow> = {}
): void {
  const row: RawLifecycleHistoryRow = {
    id: lifecycleHistoryId,
    screening_session_id: sessionId,
    transition_type: 'CREATED',
    from_status: null,
    to_status: 'OPEN',
    reason: null,
    changed_by: userId,
    changed_at: now,
    prior_row_version: null,
    resulting_row_version: 1,
    ...override
  }

  connection
    .prepare(
      `INSERT INTO screening_session_lifecycle_history (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.screening_session_id,
      row.transition_type,
      row.from_status,
      row.to_status,
      row.reason,
      row.changed_by,
      row.changed_at,
      row.prior_row_version,
      row.resulting_row_version
    )
}

function seedListRows(connection: Database.Database): void {
  insertReferences(connection)
  insertRawLocation(connection, { id: secondLocationId, name: 'Second Site' })
  insertRawLocation(connection, { id: thirdLocationId, name: 'Third Site' })
  insertRawSession(connection, { id: sessionId, session_date: '2026-07-29' })
  insertRawSession(connection, {
    id: secondSessionId,
    location_id: secondLocationId,
    session_date: '2026-07-30'
  })
  insertRawSession(connection, {
    id: thirdSessionId,
    location_id: thirdLocationId,
    session_date: '2026-07-30',
    status: 'CLOSED',
    closed_by: secondUserId,
    closed_at: later,
    updated_by: secondUserId,
    updated_at: later,
    row_version: 2
  })
  insertRawSession(connection, {
    id: fourthSessionId,
    session_date: '2026-07-28',
    status: 'CLOSED',
    closed_by: userId,
    closed_at: later,
    updated_by: userId,
    updated_at: later,
    row_version: 2
  })
}

function insertMalformedSessionFixture(
  connection: Database.Database,
  scenario: {
    readonly override: Partial<RawSessionRow>
    readonly ignoreChecks?: boolean
    readonly disableForeignKeys?: boolean
  }
): void {
  const originalIgnoreChecks = connection.pragma('ignore_check_constraints', {
    simple: true
  }) as number
  const originalForeignKeys = connection.pragma('foreign_keys', { simple: true }) as number

  try {
    if (scenario.ignoreChecks === true) {
      connection.pragma('ignore_check_constraints = ON')
    }

    if (scenario.disableForeignKeys === true) {
      connection.pragma('foreign_keys = OFF')
    }

    insertRawSession(connection, scenario.override)
  } finally {
    connection.pragma(`ignore_check_constraints = ${originalIgnoreChecks === 1 ? 'ON' : 'OFF'}`)
    connection.pragma(`foreign_keys = ${originalForeignKeys === 1 ? 'ON' : 'OFF'}`)
  }
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

interface FakeExecutorConnection extends Database.Database {
  readonly preparedSql: readonly string[]
}

function createFakeExecutorConnection(): FakeExecutorConnection {
  const preparedSql: string[] = []
  let inTransaction = false

  return {
    get open(): boolean {
      return true
    },
    get inTransaction(): boolean {
      return inTransaction
    },
    exec(sql: string): Database.Database {
      if (sql === 'BEGIN IMMEDIATE') {
        inTransaction = true
        return this as unknown as Database.Database
      }

      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        inTransaction = false
        return this as unknown as Database.Database
      }

      return this as unknown as Database.Database
    },
    prepare(sql: string): Database.Statement {
      preparedSql.push(sql)

      return {
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        get: vi.fn(() => undefined),
        all: vi.fn(() => [])
      } as unknown as Database.Statement
    },
    preparedSql
  } as unknown as FakeExecutorConnection
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
