import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSyncAdministrationService,
  LocalSessionAuthorizationError,
  type LocalAuthenticationSessionService,
  type SyncCredentialProtector
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createProductionDatabaseMigrationRunner,
  createSyncTransportBatchRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock } from '@main/foundation/utc-clock'

const installationId = '10000000-0000-4000-8000-000000000001'
const adminId = '20000000-0000-4000-8000-000000000001'
const auditOne = '30000000-0000-4000-8000-000000000001'
const auditTwo = '30000000-0000-4000-8000-000000000002'
const now = '2026-09-04T12:00:00.000Z'
const token = `chs_inst_v1_${'A'.repeat(43)}`

const connections: Database.Database[] = []

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close()
})

describe('synchronization administration service', () => {
  it('atomically protects and audits configuration without exposing the token', () => {
    const harness = createHarness([auditOne, auditTwo])

    expect(
      harness.service.configure({
        apiBaseUrl: 'https://sync.example.org/',
        installationToken: token
      })
    ).toEqual({
      status: 'CONFIGURED',
      configuration: {
        status: 'CONFIGURED',
        apiBaseUrl: 'https://sync.example.org',
        tokenPrefix: token.slice(0, 20),
        updatedAt: now
      }
    })
    const settings = harness.connection.prepare('SELECT * FROM app_settings').all()
    expect(JSON.stringify(settings)).not.toContain(token)
    expect(harness.connection.prepare('SELECT action, metadata_json FROM audit_log').get()).toEqual(
      {
        action: 'SYNC_TRANSPORT_CONFIGURED',
        metadata_json: JSON.stringify({
          api_base_url: 'https://sync.example.org',
          credential_rotated: true,
          token_prefix: token.slice(0, 20)
        })
      }
    )
    expect(JSON.stringify(harness.service.getState())).not.toContain(token)

    expect(
      harness.service.configure({
        apiBaseUrl: 'https://central.example.org',
        installationToken: token
      })
    ).toMatchObject({ status: 'CONFIGURED' })
    expect(
      harness.connection.prepare('SELECT action FROM audit_log ORDER BY occurred_at, id').all()
    ).toEqual([{ action: 'SYNC_TRANSPORT_CONFIGURED' }, { action: 'SYNC_TRANSPORT_UPDATED' }])
  })

  it('derives a minimum-necessary status without returning payloads or local identifiers', () => {
    const harness = createHarness([auditOne])
    harness.service.configure({ apiBaseUrl: 'https://sync.example.org', installationToken: token })
    insertOutbox(harness.connection)
    insertRetryBatch(harness.connection)

    const result = harness.service.getState()
    expect(result).toEqual({
      status: 'READY',
      configuration: {
        status: 'CONFIGURED',
        apiBaseUrl: 'https://sync.example.org',
        tokenPrefix: token.slice(0, 20),
        updatedAt: now
      },
      activity: {
        state: 'RETRY_SCHEDULED',
        pendingChangeCount: 1,
        pendingAcknowledgmentCount: 0,
        lastSuccessfulSyncAt: null,
        nextRetryAt: '2026-09-04T12:05:00.000Z'
      }
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('PATIENT_CREATED')
    expect(serialized).not.toContain('40000000-0000-4000-8000-000000000001')
    expect(serialized).not.toContain('request_json')
  })

  it('fails closed for non-admin sessions, malformed settings, and unavailable protection', () => {
    const unauthorized = createHarness([], new LocalSessionAuthorizationError())
    expect(unauthorized.service.getState()).toEqual({ status: 'FORBIDDEN' })
    expect(
      unauthorized.service.configure({
        apiBaseUrl: 'https://sync.example.org',
        installationToken: token
      })
    ).toEqual({ status: 'FORBIDDEN' })

    const harness = createHarness([])
    expect(
      harness.service.configure({ apiBaseUrl: 'http://sync.example.org', installationToken: token })
    ).toEqual({ status: 'VALIDATION_FAILED' })
    harness.protector.isAvailable = () => false
    expect(
      harness.service.configure({
        apiBaseUrl: 'https://sync.example.org',
        installationToken: token
      })
    ).toEqual({ status: 'PROTECTION_UNAVAILABLE' })
    expect(harness.connection.prepare('SELECT COUNT(*) AS count FROM app_settings').get()).toEqual({
      count: 0
    })
  })
})

function createHarness(
  ids: string[],
  authError?: Error
): {
  readonly connection: Database.Database
  readonly service: ReturnType<typeof createSyncAdministrationService>
  readonly protector: {
    isAvailable(): boolean
    protect(secret: string): Uint8Array
    unprotect(value: Uint8Array): string
  }
} {
  const connection = new Database(':memory:')
  connections.push(connection)
  connection.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now }
  })(connection)
  seedIdentity(connection)
  const protector = {
    isAvailable: () => true,
    protect: (secret: string) => Buffer.from(`protected:${secret}`),
    unprotect: (value: Uint8Array) => Buffer.from(value).toString('utf8').replace('protected:', '')
  }
  const authenticationSessionService = {
    requireAnyRole: vi.fn(() => {
      if (authError !== undefined) throw authError
      return { user: { id: parseEntityId(adminId), role: 'LOCAL_ADMIN' } }
    })
  } as unknown as LocalAuthenticationSessionService
  const service = createSyncAdministrationService({
    authenticationSessionService,
    repository: createSyncTransportBatchRepository(connection),
    installationRepository: createInstallationRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => ids.shift() ?? auditOne),
      clock: createUtcClock(() => now),
      logger: { error: vi.fn() }
    }),
    credentialProtector: protector as SyncCredentialProtector
  })
  return { connection, service, protector }
}

function seedIdentity(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at)
     VALUES (1, ?, 'Test deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
  connection
    .prepare(
      `INSERT INTO users (
       id, username, username_normalized, display_name, password_hash, password_salt,
       role, is_active, must_change_password, failed_login_count, created_at, updated_at
     ) VALUES (?, 'admin', 'admin', 'Admin', 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(adminId, now, now)
}

function insertOutbox(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO sync_outbox (
       id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version,
       created_at, status, attempt_count
     ) VALUES (?, 'PATIENT', ?, 'PATIENT_CREATED', '{}', 'patient.v1', ?, 'PENDING', 0)`
    )
    .run('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', now)
}

function insertRetryBatch(connection: Database.Database): void {
  const requestJson = '{}'
  connection
    .prepare(
      `INSERT INTO sync_transport_batches (
       id, request_json, request_sha256, status, attempt_count, created_at,
       next_attempt_at, last_error_code
     ) VALUES (?, ?, ?, 'RETRY_WAIT', 1, ?, ?, 'NETWORK_ERROR')`
    )
    .run(
      '60000000-0000-4000-8000-000000000001',
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      now,
      '2026-09-04T12:05:00.000Z'
    )
}
