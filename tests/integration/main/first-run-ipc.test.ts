import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createProductionFirstRunBootstrapService,
  type FirstRunBootstrapService
} from '@main/application'
import {
  createProductionDatabaseMigrationRunner,
  type DatabaseTransactionLogger
} from '@main/database'
import {
  createFirstRunIpcHandlers,
  type FirstRunIpcOperationalLogger
} from '@main/ipc/handlers/first-run-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createFirstRunFailure,
  createIpcSuccess,
  type FirstRunInitializeRequest
} from '@shared/ipc'

const temporarySecret = 'ValidPassw0rd!'
const validRequest: FirstRunInitializeRequest = {
  deploymentName: 'Cameroon Pilot',
  timeZone: 'Africa/Douala',
  administrator: {
    username: 'Admin.User',
    displayName: 'Admin User',
    temporaryPassword: temporarySecret
  },
  initialLocation: {
    name: 'Central Church',
    locationType: 'CHURCH',
    village: 'Messa',
    subdivision: 'Yaounde I',
    region: 'Centre',
    directions: 'Opposite market gate.'
  }
}

describe('first-run IPC integration', () => {
  it('exposes the production bootstrap service through safe first-run handlers', async () => {
    await withMigratedDatabase(async ({ connection, service, logger }) => {
      const handlers = createFirstRunIpcHandlers({
        navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
        firstRunBootstrapService: service,
        logger
      })

      await expect(handlers.getState(createAllowedEvent(), {})).resolves.toEqual(
        createIpcSuccess({ status: 'REQUIRED' })
      )
      expect(service.getState).toHaveBeenCalledTimes(1)
      expect(readBootstrapCounts(connection)).toMatchObject({
        installation: 0,
        installation_location_configuration: 0,
        users: 0,
        locations: 0,
        audit_log: 0,
        app_settings: 0,
        protocol_versions: 0,
        patients: 0,
        sync_outbox: 0
      })

      const initializeResult = await handlers.initialize(createAllowedEvent(), validRequest)

      expect(initializeResult).toEqual(
        createIpcSuccess({
          status: 'INITIALIZED',
          deploymentName: 'Cameroon Pilot',
          timeZone: 'Africa/Douala'
        })
      )
      expect(service.initialize).toHaveBeenCalledTimes(1)
      expect(readBootstrapCounts(connection)).toMatchObject({
        installation: 1,
        installation_location_configuration: 1,
        users: 1,
        locations: 1,
        audit_log: 4,
        app_settings: 0,
        protocol_versions: 0,
        patients: 0,
        sync_outbox: 0
      })
      expect(readRawAuditRows(connection).map((row) => row.action)).toEqual([
        'INSTALLATION_INITIALIZED',
        'LOCAL_USER_CREATED',
        'LOCATION_CREATED',
        'INSTALLATION_LOCATION_ASSIGNED'
      ])

      await expect(handlers.getState(createAllowedEvent(), {})).resolves.toEqual(
        createIpcSuccess({
          status: 'INITIALIZED',
          deploymentName: 'Cameroon Pilot',
          timeZone: 'Africa/Douala'
        })
      )

      await expect(handlers.initialize(createAllowedEvent(), validRequest)).resolves.toEqual(
        createFirstRunFailure('FIRST_RUN_ALREADY_INITIALIZED')
      )
      expect(readBootstrapCounts(connection)).toMatchObject({
        installation: 1,
        installation_location_configuration: 1,
        users: 1,
        locations: 1,
        audit_log: 4
      })

      const countsBeforeForbidden = readBootstrapCounts(connection)

      await expect(
        handlers.initialize(createForbiddenEvent(), { extra: 'do not parse' })
      ).resolves.toEqual(createFirstRunFailure('IPC_FORBIDDEN'))
      expect(readBootstrapCounts(connection)).toEqual(countsBeforeForbidden)
      expect(service.initialize).toHaveBeenCalledTimes(2)

      expectSafeResponseAndLogs(initializeResult, logger)
    })
  })
})

interface IntegrationContext {
  readonly connection: Database.Database
  readonly service: FirstRunBootstrapService & {
    readonly getState: ReturnType<typeof vi.fn<FirstRunBootstrapService['getState']>>
    readonly initialize: ReturnType<typeof vi.fn<FirstRunBootstrapService['initialize']>>
  }
  readonly logger: TestLogger
}

interface TestLogger extends FirstRunIpcOperationalLogger, DatabaseTransactionLogger {
  info: {
    (message: string): void
    mock: { calls: unknown[][] }
  }
  warn: FirstRunIpcOperationalLogger['warn'] & {
    mock: { calls: unknown[][] }
  }
  error: FirstRunIpcOperationalLogger['error'] & {
    mock: { calls: unknown[][] }
  }
}

async function withMigratedDatabase(
  test: (context: IntegrationContext) => Promise<void> | void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-015-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)
  const logger = createLogger()

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger,
      clock: { now: () => '2026-07-29T00:00:00.000Z' }
    })(connection)

    const productionService = createProductionFirstRunBootstrapService({
      connection,
      logger
    })
    const service = {
      getState: vi.fn(() => productionService.getState()),
      initialize: vi.fn((request) => productionService.initialize(request))
    } as FirstRunBootstrapService & {
      readonly getState: ReturnType<typeof vi.fn<FirstRunBootstrapService['getState']>>
      readonly initialize: ReturnType<typeof vi.fn<FirstRunBootstrapService['initialize']>>
    }

    await test({ connection, service, logger })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function readBootstrapCounts(connection: Database.Database): Record<string, number> {
  return {
    installation: readTableCount(connection, 'installation'),
    installation_location_configuration: readTableCount(
      connection,
      'installation_location_configuration'
    ),
    users: readTableCount(connection, 'users'),
    locations: readTableCount(connection, 'locations'),
    audit_log: readTableCount(connection, 'audit_log'),
    app_settings: readTableCount(connection, 'app_settings'),
    protocol_versions: readTableCount(connection, 'protocol_versions'),
    patients: readTableCount(connection, 'patients'),
    sync_outbox: readTableCount(connection, 'sync_outbox')
  }
}

function readRawAuditRows(connection: Database.Database): readonly { action: unknown }[] {
  return connection.prepare('SELECT action FROM audit_log ORDER BY rowid ASC').all() as readonly {
    action: unknown
  }[]
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const result = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return result.count
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function createAllowedEvent(): IpcSenderValidationEvent {
  return createEvent('http://localhost:5173/')
}

function createForbiddenEvent(): IpcSenderValidationEvent {
  return createEvent('https://example.invalid/')
}

function createEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function expectSafeResponseAndLogs(response: unknown, logger: TestLogger): void {
  const serialized = JSON.stringify(response)
  const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

  for (const unsafeFragment of [
    temporarySecret,
    'Admin.User',
    'Admin User',
    'Central Church',
    'Messa',
    'Yaounde',
    'Centre',
    'Opposite',
    'INSTALLATION_INITIALIZED',
    'LOCAL_USER_CREATED',
    'LOCATION_CREATED',
    'bootstrap',
    'passwordHash',
    'passwordSalt',
    'SELECT',
    'INSERT',
    'health-screening.sqlite3',
    '2026-07-29T',
    '11111111-'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
    expect(logs).not.toContain(unsafeFragment)
  }
}
