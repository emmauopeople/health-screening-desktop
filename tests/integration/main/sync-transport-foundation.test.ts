import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSyncTransportFoundationService,
  type SyncCredentialProtector,
  type SyncTransportFoundationService
} from '@main/application/sync-transport'
import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createSyncTransportBatchRepository
} from '@main/database'
import { createEntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock } from '@main/foundation/utc-clock'

const installationId = '10000000-0000-4000-8000-000000000001'
const locationId = '20000000-0000-4000-8000-000000000001'
const actorId = '30000000-0000-4000-8000-000000000001'
const patientId = '40000000-0000-4000-8000-000000000001'
const lifestyleId = '50000000-0000-4000-8000-000000000001'
const patientRecordId = '60000000-0000-4000-8000-000000000001'
const lifestyleRecordId = '60000000-0000-4000-8000-000000000002'
const outboxOne = '70000000-0000-4000-8000-000000000001'
const outboxTwo = '70000000-0000-4000-8000-000000000002'
const outboxThree = '70000000-0000-4000-8000-000000000003'
const batchId = '80000000-0000-4000-8000-000000000001'
const attemptOne = '90000000-0000-4000-8000-000000000001'
const attemptTwo = '90000000-0000-4000-8000-000000000002'
const token = `chs_inst_v1_${'A'.repeat(43)}`
const initialNow = '2026-09-03T08:00:00.000Z'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

describe('desktop sync transport foundation', () => {
  it('protects configuration and never persists or returns the plaintext token', async () => {
    const harness = await createHarness([batchId])

    expect(
      harness.service.configure({
        apiBaseUrl: 'https://sync.example.org/',
        installationToken: token
      })
    ).toEqual({
      status: 'CONFIGURED',
      apiBaseUrl: 'https://sync.example.org',
      tokenPrefix: token.slice(0, 20),
      updatedAt: initialNow
    })
    expect(harness.service.getConfigurationState()).toEqual({
      status: 'CONFIGURED',
      apiBaseUrl: 'https://sync.example.org',
      tokenPrefix: token.slice(0, 20),
      updatedAt: initialNow
    })
    expect(JSON.stringify(readSettings(harness.connection))).not.toContain(token)
    expect(harness.service.loadCredentialForTransport()).toEqual({
      apiBaseUrl: 'https://sync.example.org',
      installationToken: token
    })
    expect(
      harness.service.configure({
        apiBaseUrl: 'http://sync.example.org/',
        installationToken: token
      })
    ).toEqual({ status: 'VALIDATION_FAILED' })
    expect(readSettings(harness.connection)).toHaveLength(1)
  })

  it('persists deterministic dependency order and reuses exact bytes across retry and restart', async () => {
    const harness = await createHarness([batchId, attemptOne, attemptTwo])
    insertOutbox(harness.connection, outboxThree, lifestyleId, 'SCREENING_LIFESTYLE_STEP_COMPLETED')
    insertOutbox(harness.connection, outboxOne, patientId, 'PATIENT_CREATED')
    insertOutbox(harness.connection, outboxTwo, patientId, 'PATIENT_ACKNOWLEDGMENT_RECORDED')

    expect(harness.service.prepareBatch(batchInput())).toEqual({
      status: 'PREPARED',
      batchId,
      requestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      recordCount: 2,
      signalCount: 3
    })
    const stored = readBatch(harness.connection)
    const request = JSON.parse(stored.request_json) as { records: { resourceType: string }[] }
    expect(request.records.map((record) => record.resourceType)).toEqual(['PATIENT', 'LIFESTYLE'])
    expect(() =>
      harness.connection
        .prepare('UPDATE sync_transport_batches SET request_json = \'{"changed":true}\'')
        .run()
    ).toThrow()
    expect(readOutboxStatuses(harness.connection)).toEqual([
      { id: outboxOne, status: 'IN_FLIGHT' },
      { id: outboxTwo, status: 'IN_FLIGHT' },
      { id: outboxThree, status: 'IN_FLIGHT' }
    ])

    const firstClaim = harness.service.claimNextBatch()
    expect(firstClaim).toMatchObject({
      status: 'CLAIMED',
      batchId,
      attemptId: attemptOne,
      requestJson: stored.request_json,
      requestSha256: stored.request_sha256,
      attemptCount: 1
    })
    expect(
      harness.service.scheduleRetry({
        batchId,
        errorCode: 'NETWORK_UNAVAILABLE',
        retryAfterMs: 1000
      })
    ).toEqual({
      status: 'RETRY_SCHEDULED',
      batchId,
      nextAttemptAt: '2026-09-03T08:00:01.000Z'
    })

    harness.connection.close()
    harness.setNow('2026-09-03T08:00:01.000Z')
    const reopened = new Database(harness.databasePath)
    reopened.pragma('foreign_keys = ON')
    const restarted = createService(reopened, harness.ids, harness.now, protector())
    const secondClaim = restarted.claimNextBatch()
    expect(secondClaim).toMatchObject({
      status: 'CLAIMED',
      batchId,
      attemptId: attemptTwo,
      requestJson: stored.request_json,
      requestSha256: stored.request_sha256,
      attemptCount: 2
    })
    reopened.close()
  })

  it('recovers an expired lease without creating a new batch or changing request bytes', async () => {
    const harness = await createHarness([batchId, attemptOne, attemptTwo])
    insertOutbox(harness.connection, outboxOne, patientId, 'PATIENT_CREATED')
    expect(harness.service.prepareBatch({ ...batchInput(), outboxIds: [outboxOne] })).toMatchObject(
      {
        status: 'PREPARED',
        batchId
      }
    )
    const original = readBatch(harness.connection)
    expect(harness.service.claimNextBatch(1000)).toMatchObject({ status: 'CLAIMED' })

    harness.setNow('2026-09-03T08:00:02.000Z')
    expect(harness.service.recoverExpiredLeases()).toBe(1)
    expect(readBatch(harness.connection)).toMatchObject({
      id: batchId,
      request_json: original.request_json,
      request_sha256: original.request_sha256,
      status: 'RETRY_WAIT',
      last_error_code: 'LEASE_EXPIRED'
    })
    harness.setNow('2026-09-03T08:00:07.000Z')
    expect(harness.service.claimNextBatch()).toMatchObject({
      status: 'CLAIMED',
      batchId,
      attemptId: attemptTwo,
      requestJson: original.request_json,
      attemptCount: 2
    })
  })

  it('rolls back the batch and reservations when any outbox signal is unavailable', async () => {
    const harness = await createHarness([batchId])
    insertOutbox(harness.connection, outboxOne, patientId, 'PATIENT_CREATED')

    expect(
      harness.service.prepareBatch({
        ...batchInput(),
        outboxIds: [outboxOne, outboxTwo]
      })
    ).toEqual({ status: 'UNAVAILABLE' })
    expect(readTableCount(harness.connection, 'sync_transport_batches')).toBe(0)
    expect(readTableCount(harness.connection, 'sync_transport_batch_items')).toBe(0)
    expect(readOutboxStatuses(harness.connection)).toEqual([{ id: outboxOne, status: 'PENDING' }])
  })
})

async function createHarness(ids: readonly string[]): Promise<{
  readonly databasePath: string
  readonly connection: Database.Database
  readonly service: SyncTransportFoundationService
  readonly ids: string[]
  readonly now: { value: string }
  setNow(value: string): void
}> {
  const directory = await mkdtemp(join(tmpdir(), 'hsw013a-sync-transport-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)
  connection.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => initialNow }
  })(connection)
  const idQueue = [...ids]
  const now = { value: initialNow }
  cleanup.push(async () => {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  })
  return {
    databasePath,
    connection,
    service: createService(connection, idQueue, now, protector()),
    ids: idQueue,
    now,
    setNow(value: string): void {
      now.value = value
    }
  }
}

function createService(
  connection: Database.Database,
  ids: string[],
  now: { value: string },
  credentialProtector: SyncCredentialProtector
): SyncTransportFoundationService {
  const clock = createUtcClock(() => now.value)
  return createSyncTransportFoundationService({
    repository: createSyncTransportBatchRepository(connection),
    credentialProtector,
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      clock,
      idGenerator: createEntityIdGenerator(
        () => ids.shift() ?? 'f0000000-0000-4000-8000-000000000001'
      ),
      logger: { error: vi.fn() }
    })
  })
}

function protector(): SyncCredentialProtector {
  return Object.freeze({
    isAvailable: () => true,
    protect: (secret: string) => Buffer.from(`protected:${secret}`, 'utf8'),
    unprotect: (ciphertext: Uint8Array) =>
      Buffer.from(ciphertext)
        .toString('utf8')
        .replace(/^protected:/, '')
  })
}

function batchInput(): Record<string, unknown> {
  return {
    installationId,
    locationId,
    installationTimezone: 'Africa/Douala',
    desktopApplicationVersion: '1.0.0',
    desktopSchemaVersion: 19,
    actors: [
      {
        localActorId: actorId,
        displayName: 'Synthetic Nurse',
        role: 'NURSE',
        active: true,
        updatedAt: initialNow
      }
    ],
    records: [
      {
        recordId: lifestyleRecordId,
        resourceType: 'LIFESTYLE',
        localResourceId: lifestyleId,
        sourceRevision: 1,
        schemaVersion: 'lifestyle.v1',
        operation: 'UPSERT',
        capturedAt: initialNow,
        sourceActorLocalId: actorId,
        payload: { status: 'COMPLETE' }
      },
      {
        recordId: patientRecordId,
        resourceType: 'PATIENT',
        localResourceId: patientId,
        sourceRevision: 2,
        schemaVersion: 'patient.v1',
        operation: 'UPSERT',
        capturedAt: initialNow,
        sourceActorLocalId: actorId,
        payload: { status: 'ACTIVE' }
      }
    ],
    outboxIds: [outboxThree, outboxOne, outboxTwo]
  }
}

function insertOutbox(
  connection: Database.Database,
  id: string,
  aggregateId: string,
  operation: string
): void {
  connection
    .prepare(
      `INSERT INTO sync_outbox (
         id, aggregate_type, aggregate_id, operation, payload_json,
         payload_schema_version, created_at, status, attempt_count
       ) VALUES (?, 'TEST', ?, ?, '{}', 'test.v1', ?, 'PENDING', 0)`
    )
    .run(id, aggregateId, operation, initialNow)
}

function readSettings(connection: Database.Database): unknown[] {
  return connection.prepare('SELECT * FROM app_settings').all()
}

function readBatch(connection: Database.Database): {
  id: string
  request_json: string
  request_sha256: string
  status: string
  last_error_code: string | null
} {
  return connection.prepare('SELECT * FROM sync_transport_batches').get() as {
    id: string
    request_json: string
    request_sha256: string
    status: string
    last_error_code: string | null
  }
}

function readOutboxStatuses(connection: Database.Database): unknown[] {
  return connection.prepare('SELECT id, status FROM sync_outbox ORDER BY id').all()
}

function readTableCount(connection: Database.Database, tableName: string): number {
  return Number(
    (connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number })
      .count
  )
}
