import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createAuditReportRepository,
  createProductionDatabaseMigrationRunner,
  RepositoryDataIntegrityError
} from '@main/database'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-09-08T12:00:00.000Z' as UtcTimestamp
const prefix = '76000000-0000-4000-8000-0000000000'
const id = (suffix: number): string => `${prefix}${String(suffix).padStart(2, '0')}`

describe('audit report repository', () => {
  it('loads deterministic deployment, actor, action, and entity filter options', async () => {
    await withDatabase((connection) => {
      const context = createAuditReportRepository(connection).getContext()

      expect(context).toMatchObject({
        deployment: { id: id(1), name: 'Cameroon Pilot', timeZone: 'Africa/Douala' },
        actors: [
          { id: id(2), displayName: 'Admin User', role: 'LOCAL_ADMIN' },
          { id: id(3), displayName: 'Nurse User', role: 'NURSE' }
        ],
        actions: ['PATIENT_CREATED', 'PATIENT_UPDATED', 'REFERRAL_STATUS_UPDATED'],
        entityTypes: ['PATIENT', 'REFERRAL'],
        hasSystemEvents: true
      })
      expect(Object.isFrozen(context)).toBe(true)
      expect(Object.isFrozen(context.actors)).toBe(true)
    })
  })

  it('searches exact filters with stable ordering, pagination, and totals', async () => {
    await withDatabase((connection) => {
      const repository = createAuditReportRepository(connection)
      const base = {
        query: '',
        occurredFromInclusive: null,
        occurredToExclusive: null,
        actor: { kind: 'ALL' as const },
        action: null,
        entityType: null,
        entityId: null,
        page: 1,
        pageSize: 25 as const
      }

      expect(repository.search(base)).toMatchObject({
        total: 4,
        page: 1,
        items: [
          { id: id(13), action: 'PATIENT_UPDATED', actor: { displayName: 'Nurse User' } },
          { id: id(12), action: 'REFERRAL_STATUS_UPDATED' },
          { id: id(11), action: 'PATIENT_CREATED' },
          { id: id(10), actor: null }
        ]
      })

      expect(repository.search({ ...base, actor: { kind: 'USER', userId: id(3) } })).toMatchObject({
        total: 2,
        items: [{ id: id(13) }, { id: id(12) }]
      })
      expect(repository.search({ ...base, actor: { kind: 'SYSTEM' } })).toMatchObject({
        total: 1,
        items: [{ id: id(10), actor: null }]
      })
      expect(repository.search({ ...base, query: 'referral status' })).toMatchObject({
        total: 1,
        items: [{ id: id(12) }]
      })
      expect(repository.search({ ...base, query: 'referral_status' })).toMatchObject({
        total: 1,
        items: [{ id: id(12) }]
      })
      expect(
        repository.search({
          ...base,
          occurredFromInclusive: '2026-09-08T10:30:00.000Z',
          occurredToExclusive: '2026-09-08T12:00:00.000Z',
          entityType: 'PATIENT',
          entityId: id(20)
        })
      ).toMatchObject({ total: 1, items: [{ id: id(13) }] })
      expect(repository.search({ ...base, page: 2 })).toMatchObject({
        total: 4,
        page: 2,
        items: []
      })
    })
  })

  it('fails closed when persisted audit metadata is noncanonical', async () => {
    await withDatabase((connection) => {
      connection
        .prepare('UPDATE audit_log SET metadata_json = ? WHERE id = ?')
        .run('{"z":1,"a":2}', id(13))

      expect(() =>
        createAuditReportRepository(connection).search({
          query: '',
          occurredFromInclusive: null,
          occurredToExclusive: null,
          actor: { kind: 'ALL' },
          action: null,
          entityType: null,
          entityId: null,
          page: 1,
          pageSize: 25
        })
      ).toThrow(RepositoryDataIntegrityError)
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd066a-audit-report-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seed(connection)
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function seed(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(id(1), 'Cameroon Pilot', 'Africa/Douala', now, now)
  insertUser(connection, id(2), 'admin', 'Admin User', 'LOCAL_ADMIN')
  insertUser(connection, id(3), 'nurse', 'Nurse User', 'NURSE')
  insertEvent(
    connection,
    id(10),
    null,
    'PATIENT_CREATED',
    'PATIENT',
    id(20),
    '2026-09-08T09:00:00.000Z',
    '{}'
  )
  insertEvent(
    connection,
    id(11),
    id(2),
    'PATIENT_CREATED',
    'PATIENT',
    id(20),
    '2026-09-08T10:00:00.000Z',
    '{"source":"LOCAL"}'
  )
  insertEvent(
    connection,
    id(12),
    id(3),
    'REFERRAL_STATUS_UPDATED',
    'REFERRAL',
    id(21),
    '2026-09-08T11:00:00.000Z',
    '{"from_status":"OPEN","to_status":"CONTACTED"}'
  )
  insertEvent(
    connection,
    id(13),
    id(3),
    'PATIENT_UPDATED',
    'PATIENT',
    id(20),
    '2026-09-08T11:00:00.000Z',
    '{"changed":true}'
  )
}

function insertUser(
  connection: Database.Database,
  userId: string,
  username: string,
  displayName: string,
  role: 'LOCAL_ADMIN' | 'NURSE'
): void {
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(userId, username, username, displayName, 'hash', 'salt', role, now, now)
}

function insertEvent(
  connection: Database.Database,
  eventId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  occurredAt: string,
  metadataJson: string
): void {
  connection
    .prepare(
      'INSERT INTO audit_log (id, installation_id, user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(eventId, id(1), userId, action, entityType, entityId, occurredAt, metadataJson)
}
