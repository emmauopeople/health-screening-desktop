import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createProductionDatabaseMigrationRunner,
  InstallationLocationConfigurationAlreadyExistsError,
  RepositoryValidationError,
  RepositoryWriteError,
  type DatabaseTransactionConnection,
  type InstallationLocationConfigurationRepository,
  type SynchronousTransactionResult
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-10T12:00:00.000Z'
const later = '2026-08-10T13:00:00.000Z'
const installationId = '62000000-0000-4000-8000-000000000001'
const adminId = '62000000-0000-4000-8000-000000000002'
const locationId = '62000000-0000-4000-8000-000000000003'
const secondLocationId = '62000000-0000-4000-8000-000000000004'

describe('installation location configuration repository', () => {
  it('inserts and reads the singleton configured location record', async () => {
    await withRepository(({ connection, repository }) => {
      seedBaseGraph(connection)

      const created = transaction(connection, (transactionConnection) =>
        repository.insert(transactionConnection, {
          installationId: parseEntityId(installationId),
          locationId: parseEntityId(locationId),
          configuredAt: now as UtcTimestamp,
          configuredBy: parseEntityId(adminId)
        })
      )

      expect(created).toEqual({
        singletonId: 1,
        installationId,
        locationId,
        configuredAt: now,
        configuredBy: adminId,
        updatedAt: now,
        updatedBy: adminId,
        rowVersion: 1
      })
      expect(repository.get()).toEqual(created)
      expect(Object.isFrozen(created)).toBe(true)
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(1)
    })
  })

  it('rejects duplicate singleton inserts without mutating the canonical row', async () => {
    await withRepository(({ connection, repository }) => {
      seedBaseGraph(connection)
      insertConfigurationWithRepository(connection, repository, locationId)

      const error = captureError(() =>
        insertConfigurationWithRepository(connection, repository, secondLocationId)
      )

      expect(error).toBeInstanceOf(InstallationLocationConfigurationAlreadyExistsError)
      expect(repository.get()?.locationId).toBe(locationId)
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(1)
      expect(JSON.stringify(error)).not.toContain('installation_location_configuration')
      expect(JSON.stringify(error)).not.toContain('SQLITE')
    })
  })

  it('updates location with optimistic row-version protection', async () => {
    await withRepository(({ connection, repository }) => {
      seedBaseGraph(connection)
      insertConfigurationWithRepository(connection, repository, locationId)

      const updated = transaction(connection, (transactionConnection) =>
        repository.updateLocation(transactionConnection, {
          locationId: parseEntityId(secondLocationId),
          updatedAt: later as UtcTimestamp,
          updatedBy: parseEntityId(adminId),
          expectedRowVersion: 1
        })
      )

      expect(updated).toMatchObject({
        status: 'UPDATED',
        configuration: {
          locationId: secondLocationId,
          configuredAt: now,
          configuredBy: adminId,
          updatedAt: later,
          updatedBy: adminId,
          rowVersion: 2
        }
      })

      const conflict = transaction(connection, (transactionConnection) =>
        repository.updateLocation(transactionConnection, {
          locationId: parseEntityId(locationId),
          updatedAt: later as UtcTimestamp,
          updatedBy: parseEntityId(adminId),
          expectedRowVersion: 1
        })
      )

      expect(conflict).toMatchObject({
        status: 'CONFIGURATION_VERSION_CONFLICT',
        configuration: {
          locationId: secondLocationId,
          rowVersion: 2
        }
      })
      expect(repository.get()?.locationId).toBe(secondLocationId)
    })
  })

  it('strictly validates input and maps unrelated write failures safely', async () => {
    await withRepository(({ connection, repository }) => {
      seedBaseGraph(connection)

      expect(() =>
        transaction(connection, (transactionConnection) =>
          repository.insert(transactionConnection, {
            installationId: parseEntityId(installationId),
            locationId: parseEntityId(locationId),
            configuredAt: now as UtcTimestamp,
            configuredBy: parseEntityId(adminId),
            userId: parseEntityId(adminId)
          } as never)
        )
      ).toThrow(RepositoryValidationError)

      const error = captureError(() =>
        transaction(connection, (transactionConnection) =>
          repository.insert(transactionConnection, {
            installationId: parseEntityId(installationId),
            locationId: parseEntityId('62000000-0000-4000-8000-000000000099'),
            configuredAt: now as UtcTimestamp,
            configuredBy: parseEntityId(adminId)
          })
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(JSON.stringify(error)).not.toContain('FOREIGN')
      expect(JSON.stringify(error)).not.toContain('locations')
      expect(repository.get()).toBeNull()
    })
  })
})

async function withRepository(
  test: (context: {
    readonly connection: Database.Database
    readonly repository: InstallationLocationConfigurationRepository
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029c-p0-config-repository-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => now)
    })(connection)

    test({
      connection,
      repository: createInstallationLocationConfigurationRepository(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function insertConfigurationWithRepository(
  connection: Database.Database,
  repository: InstallationLocationConfigurationRepository,
  configuredLocationId: string
): void {
  transaction(connection, (transactionConnection) => {
    repository.insert(transactionConnection, {
      installationId: parseEntityId(installationId),
      locationId: parseEntityId(configuredLocationId),
      configuredAt: now as UtcTimestamp,
      configuredBy: parseEntityId(adminId)
    })
  })
}

function seedBaseGraph(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
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
      ) VALUES (?, 'admin', 'admin', 'Admin User', 'hash', 'salt',
        'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(adminId, now, now)
  insertLocation(connection, locationId, 'Site One')
  insertLocation(connection, secondLocationId, 'Site Two')
}

function insertLocation(connection: Database.Database, id: string, name: string): void {
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
      ) VALUES (?, ?, ?, 'COMMUNITY_SITE', 1, ?, ?, ?, ?)`
    )
    .run(id, name, name.toLowerCase(), adminId, now, adminId, now)
}

function transaction<T>(
  connection: Database.Database,
  work: (transactionConnection: DatabaseTransactionConnection) => SynchronousTransactionResult<T>
): SynchronousTransactionResult<T> {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: createEntityIdGenerator(() => '62000000-0000-4000-8000-000000000050'),
    clock: createUtcClock(() => now),
    logger: { error: vi.fn() }
  }).run((context) => work(context.connection))
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS total FROM "${tableName.replaceAll('"', '""')}"`)
    .get() as { total: number }

  return row.total
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
