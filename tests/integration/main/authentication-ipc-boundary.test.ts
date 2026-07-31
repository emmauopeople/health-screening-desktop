import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createProductionFirstRunBootstrapService,
  createProductionLocalAuthenticationSessionService
} from '@main/application'
import {
  createProductionDatabaseMigrationRunner,
  type DatabaseTransactionLogger
} from '@main/database'
import {
  createAuthenticationIpcHandlers,
  type AuthenticationIpcOperationalLogger,
  type AuthenticationSessionPublisher
} from '@main/ipc/authentication'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  type FirstRunInitializeRequest,
  type PublicAuthenticationSession
} from '@shared/ipc'

const temporaryPassword = 'TemporaryPassw0rd!'
const replacementPassword = 'ReplacementPassw0rd!'
const validFirstRunRequest: FirstRunInitializeRequest = {
  deploymentName: 'Cameroon Pilot',
  timeZone: 'Africa/Douala',
  administrator: {
    username: 'Admin.User',
    displayName: 'Admin User',
    temporaryPassword
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

describe('authentication IPC integration boundary', () => {
  it('exposes the production local session service through minimized IPC state', async () => {
    await withMigratedDatabase(async ({ connection, logger }) => {
      const firstRunService = createProductionFirstRunBootstrapService({
        connection,
        logger
      })
      await firstRunService.initialize(validFirstRunRequest)

      const sessionService = await createProductionLocalAuthenticationSessionService({
        connection,
        logger
      })
      const published: PublicAuthenticationSession[] = []
      const handlers = createAuthenticationIpcHandlers({
        navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
        authenticationSessionService: sessionService,
        sessionPublisher: createPublisher(published),
        logger
      })

      await expect(handlers.getSession(createAllowedEvent(), {})).resolves.toEqual(
        createIpcSuccess({ status: 'SIGNED_OUT', revision: 0 })
      )

      const passwordChangeRequired = await handlers.login(createAllowedEvent(), {
        username: 'Admin.User',
        password: temporaryPassword
      })

      expect(passwordChangeRequired).toEqual(
        createIpcSuccess({
          status: 'PASSWORD_CHANGE_REQUIRED',
          user: {
            username: 'Admin.User',
            displayName: 'Admin User',
            role: 'LOCAL_ADMIN'
          },
          expiresAt: expect.stringMatching(/Z$/u),
          revision: 1
        })
      )
      expect(JSON.stringify(passwordChangeRequired)).not.toContain('22222222')
      expect(JSON.stringify(passwordChangeRequired)).not.toContain('password_hash')

      const active = await handlers.changeRequiredPassword(createAllowedEvent(), {
        currentPassword: temporaryPassword,
        newPassword: replacementPassword,
        confirmNewPassword: replacementPassword
      })

      expect(active).toMatchObject({
        ok: true,
        data: {
          status: 'ACTIVE',
          user: {
            username: 'Admin.User',
            displayName: 'Admin User',
            role: 'LOCAL_ADMIN'
          }
        }
      })

      await expect(handlers.lock(createAllowedEvent(), {})).resolves.toMatchObject({
        ok: true,
        data: {
          status: 'LOCKED',
          reason: 'MANUAL'
        }
      })
      await expect(
        handlers.unlock(createAllowedEvent(), { password: 'WrongPassw0rd!' })
      ).resolves.toEqual(
        createIpcSuccess({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS',
          retryAt: null
        })
      )
      await expect(
        handlers.unlock(createAllowedEvent(), { password: replacementPassword })
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: 'ACTIVE'
        }
      })
      await expect(handlers.logout(createAllowedEvent(), {})).resolves.toEqual(
        createIpcSuccess({ status: 'SIGNED_OUT', revision: 5 })
      )

      expect(published.map((session) => session.status)).toEqual([
        'PASSWORD_CHANGE_REQUIRED',
        'ACTIVE',
        'LOCKED',
        'ACTIVE',
        'SIGNED_OUT'
      ])
      expect(listSessionTables(connection)).toEqual([])
      expectSafeResponsesAndLogs([...published, active], logger)
    })
  }, 20000)
})

interface IntegrationContext {
  readonly connection: Database.Database
  readonly logger: TestLogger
}

interface TestLogger extends AuthenticationIpcOperationalLogger, DatabaseTransactionLogger {
  info: {
    (message: string): void
    mock: { calls: unknown[][] }
  }
  warn: AuthenticationIpcOperationalLogger['warn'] & {
    mock: { calls: unknown[][] }
  }
  error: AuthenticationIpcOperationalLogger['error'] & {
    mock: { calls: unknown[][] }
  }
}

async function withMigratedDatabase(
  test: (context: IntegrationContext) => Promise<void> | void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-022-auth-ipc-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)
  const logger = createLogger()

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger,
      clock: { now: () => '2026-07-31T12:00:00.000Z' }
    })(connection)

    await test({ connection, logger })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createPublisher(published: PublicAuthenticationSession[]): AuthenticationSessionPublisher {
  return {
    publish: vi.fn((session: PublicAuthenticationSession) => {
      published.push(session)
    }),
    dispose: vi.fn()
  }
}

function listSessionTables(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND (
           lower(name) = 'sessions'
           OR lower(name) LIKE '%auth%session%'
           OR lower(name) LIKE '%local%session%'
         )
       ORDER BY name`
    )
    .all() as Array<{ readonly name: string }>

  return rows.map((row) => row.name)
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function createAllowedEvent(): IpcSenderValidationEvent {
  const mainFrame = { url: 'http://localhost:5173/' }

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

function expectSafeResponsesAndLogs(response: unknown, logger: TestLogger): void {
  const serializedResponse = JSON.stringify(response)
  const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

  for (const unsafeFragment of [
    temporaryPassword,
    replacementPassword,
    'password_hash',
    'password_salt',
    'passwordHash',
    'passwordSalt',
    '22222222-',
    'health-screening.sqlite3',
    'SELECT',
    'INSERT'
  ]) {
    expect(serializedResponse).not.toContain(unsafeFragment)
    expect(logs).not.toContain(unsafeFragment)
  }
}
