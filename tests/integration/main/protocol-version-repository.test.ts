import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createProtocolVersionRepository,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type ProtocolVersionRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, type UtcClock } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const userId = '11111111-1111-4111-8111-111111111111'
const activeProtocolId = '22222222-2222-4222-8222-222222222222'
const draftProtocolId = '33333333-3333-4333-8333-333333333333'
const secondActiveProtocolId = '44444444-4444-4444-8444-444444444444'
const missingProtocolId = '55555555-5555-4555-8555-555555555555'
const generatedId = '66666666-6666-4666-8666-666666666666'

describe('protocol version repository', () => {
  it('reads protocol references only through an active transaction connection', async () => {
    await withProtocolRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawProtocolVersion(connection, { id: activeProtocolId, status: 'ACTIVE' })
      insertRawProtocolVersion(connection, { id: draftProtocolId, status: 'DRAFT' })

      const result = executor.run((context) => ({
        activeById: repository.getByIdForWrite(context.connection, parseEntityId(activeProtocolId)),
        draftById: repository.getByIdForWrite(context.connection, parseEntityId(draftProtocolId)),
        active: repository.getActiveForWrite(context.connection),
        missing: repository.getByIdForWrite(context.connection, parseEntityId(missingProtocolId))
      }))

      expect(result).toEqual({
        activeById: { id: activeProtocolId, status: 'ACTIVE' },
        draftById: { id: draftProtocolId, status: 'DRAFT' },
        active: { id: activeProtocolId, status: 'ACTIVE' },
        missing: null
      })
      expect(Object.isFrozen(result.activeById)).toBe(true)
      expect(Object.isFrozen(result.active)).toBe(true)

      let retained: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        retained = context.connection
        return undefined
      })
      expect(() => repository.getByIdForWrite(retained!, parseEntityId(activeProtocolId))).toThrow(
        DatabaseTransactionStateError
      )

      connection.exec('BEGIN IMMEDIATE')
      try {
        const error = captureError(() =>
          repository.getByIdForWrite(
            connection as unknown as DatabaseTransactionConnection,
            'not-a-uuid' as never
          )
        )
        expect(error).toBeInstanceOf(DatabaseTransactionStateError)
        expect(error).not.toBeInstanceOf(RepositoryValidationError)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }
    })
  })

  it('returns null when no ACTIVE protocol exists and fails closed for multiple ACTIVE rows', async () => {
    await withProtocolRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawProtocolVersion(connection, { id: draftProtocolId, status: 'DRAFT' })

      expect(executor.run((context) => repository.getActiveForWrite(context.connection))).toBeNull()

      connection.prepare('DROP INDEX ux_protocol_versions_one_active').run()
      insertRawProtocolVersion(connection, { id: activeProtocolId, status: 'ACTIVE' })
      insertRawProtocolVersion(connection, { id: secondActiveProtocolId, status: 'ACTIVE' })

      const error = captureError(() =>
        executor.run((context) => repository.getActiveForWrite(context.connection))
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })
  })

  it('fails closed when persisted protocol references violate the trusted row contract', async () => {
    await withProtocolRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      connection.pragma('ignore_check_constraints = ON')
      try {
        insertRawProtocolVersion(connection, { id: activeProtocolId, status: 'BROKEN' })
      } finally {
        connection.pragma('ignore_check_constraints = OFF')
      }

      const error = captureError(() =>
        executor.run((context) =>
          repository.getByIdForWrite(context.connection, parseEntityId(activeProtocolId))
        )
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })
  })
})

interface MigratedDatabaseContext {
  readonly connection: Database.Database
  readonly repository: ProtocolVersionRepository
  readonly executor: DatabaseTransactionExecutor
}

async function withProtocolRepository(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd027-protocol-version-repository-'))
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
    deactivateBaselineProtocol(connection)
    await test({
      connection,
      repository: createProtocolVersionRepository(connection),
      executor: createExecutorForConnection(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function deactivateBaselineProtocol(connection: Database.Database): void {
  connection
    .prepare(
      "UPDATE protocol_versions SET status = 'INACTIVE' WHERE protocol_key = 'health-screening-baseline'"
    )
    .run()
}

function insertRawUser(connection: Database.Database): void {
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
      ) VALUES (?, 'protocol-admin', 'protocol-admin', 'Protocol Admin', 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(userId, now, now)
}

function insertRawProtocolVersion(
  connection: Database.Database,
  override: { readonly id: string; readonly status: string }
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
      override.id,
      `screening-${override.id}`,
      `label-${override.id}`,
      override.status,
      `checksum-${override.id}`,
      userId,
      now,
      override.status === 'ACTIVE' ? userId : null,
      override.status === 'ACTIVE' ? now : null,
      now
    )
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
    'SELECT',
    'protocol_versions',
    'C:\\',
    'secret',
    userId,
    activeProtocolId,
    draftProtocolId,
    secondActiveProtocolId,
    now
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}
