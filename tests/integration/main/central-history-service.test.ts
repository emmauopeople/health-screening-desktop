import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCentralHistoryService,
  type CentralHistoryService
} from '@main/application/central-history/central-history-service'
import type {
  HistoryFetchResult,
  HistoryHttpClient
} from '@main/application/central-history/history-http-client'
import type { LocalAuthenticationSessionService } from '@main/application/authentication/session/local-session-types'
import { createProductionDatabaseMigrationRunner } from '@main/database'
import { createUtcClock } from '@main/foundation/utc-clock'
import {
  isHistoryPage,
  historyResourceTypes,
  type HistoryPage
} from '@shared/central-history/contract.mjs'
import {
  allDomainHistory,
  historyFixture,
  historyUuid
} from '../../fixtures/central-history/history-fixture'

const now = '2026-09-17T12:00:00.000Z'
const localPatient = historyUuid(1)
const admin = historyUuid(2)
const location = historyUuid(3)
const installation = historyUuid(4)
const token = `chs_inst_v1_${'A'.repeat(43)}`
const readRequest = { patientId: localPatient, reasonCode: 'CARE_DELIVERY' as const }
const refreshRequest = { ...readRequest, fromDate: '2026-09-01', toDate: '2026-09-17' }
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

interface CacheHarness {
  readonly connection: Database.Database
  readonly service: CentralHistoryService
  http: ReturnType<typeof vi.fn<HistoryHttpClient>>
  configure(secret?: string, origin?: string): void
  setRole(value: string): void
  setUser(value: string): void
  lock(): void
  unlock(): void
  time(value: string): void
  reopen(): void
}
function harness(file = ':memory:'): CacheHarness {
  let connection = new Database(file)
  connection.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now }
  })(connection)
  connection
    .prepare("INSERT INTO installation VALUES (1, ?, 'Test desktop', 'UTC', ?, ?)")
    .run(installation, now, now)
  for (const id of [admin, historyUuid(5)])
    connection
      .prepare(
        `INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
    role, is_active, must_change_password, failed_login_count, created_at, updated_at)
    VALUES (?, ?, ?, 'Synthetic admin', 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
      )
      .run(id, id, id, now, now)
  connection
    .prepare(
      `INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at)
    VALUES (?, 'Synthetic clinic', 'synthetic clinic', 'CLINIC', 1, ?, ?, ?, ?)`
    )
    .run(location, admin, now, admin, now)
  connection
    .prepare('INSERT INTO installation_location_configuration VALUES (1, ?, ?, ?, ?, ?, ?, 1)')
    .run(installation, location, now, admin, now, admin)
  connection
    .prepare(
      `INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at)
    VALUES (?, 'PT-000001', 'Synthetic Patient', 'synthetic patient', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(localPatient, admin, now, admin, now)
  const page = historyFixture()
  connection
    .prepare(
      `INSERT INTO patient_identifiers (id, patient_id, identifier_type, issuer, identifier_value, is_primary, created_by, created_at)
    VALUES (?, ?, 'CHS_MEDICAL_ID', 'CHS_CENTRAL', ?, 1, ?, ?)`
    )
    .run(historyUuid(6), localPatient, page.patient.chsMedicalId, admin, now)
  connection
    .prepare(
      `INSERT INTO sync_patient_identity_links (patient_id, central_person_id, chs_medical_id, source_revision, resolution_reference, applied_at)
    VALUES (?, ?, ?, 1, NULL, ?)`
    )
    .run(localPatient, page.personId, page.patient.chsMedicalId, now)
  let role = 'LOCAL_ADMIN',
    userId = admin,
    active = true,
    authenticatedAt = now,
    currentTime = now
  const auth = {
    requireAnyRole: (roles: string[]) => {
      if (!active || !roles.includes(role)) throw new Error('Authentication required')
      return { user: { id: userId, role }, authenticatedAt }
    },
    getSnapshot: () => ({ status: active ? 'ACTIVE' : 'LOCKED', user: { id: userId, role } })
  } as unknown as LocalAuthenticationSessionService
  const credentialProtector = {
    isAvailable: () => true,
    protect: (secret: string) => Buffer.from(secret),
    unprotect: (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8')
  }
  function configure(secret = token, origin = 'https://central.example.org'): void {
    connection
      .prepare(
        `INSERT OR REPLACE INTO app_settings VALUES ('sync.transport.configuration.v1', ?, ?, 'SECRET')`
      )
      .run(
        JSON.stringify({
          apiBaseUrl: origin,
          protectedToken: Buffer.from(secret).toString('base64'),
          tokenPrefix: secret.slice(0, 20),
          updatedAt: now
        }),
        now
      )
  }
  configure()
  const http = vi.fn<HistoryHttpClient>().mockResolvedValue({ status: 'RECEIVED', page })
  const createService = (): CentralHistoryService =>
    createCentralHistoryService({
      connection,
      authenticationSessionService: auth,
      credentialProtector,
      clock: createUtcClock(() => currentTime),
      httpClient: http
    })
  let service = createService()
  cleanups.push(() => connection.close())
  return {
    get connection() {
      return connection
    },
    get service() {
      return service
    },
    http,
    configure,
    setRole: (value: string) => {
      role = value
    },
    setUser: (value: string) => {
      userId = value
    },
    lock: () => {
      active = false
    },
    unlock: () => {
      active = true
      authenticatedAt = '2026-09-17T12:01:00.000Z'
    },
    time: (value: string) => {
      currentTime = value
    },
    reopen: () => {
      connection.close()
      connection = new Database(file)
      connection.pragma('foreign_keys = ON')
      service = createService()
    }
  }
}

function clinicalState(db: Database.Database): unknown {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'central_history_%' AND name != 'audit_log' ORDER BY name"
    )
    .all() as { name: string }[]
  return tables.map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name}"`).all() }))
}
function itemsPage(count: number): HistoryPage {
  const base = historyFixture()
  return {
    ...base,
    items: Array.from({ length: count }, (_, i) => ({
      ...base.items[0]!,
      resourceId: historyUuid(1000 - i)
    }))
  }
}

describe('central history cache and authorization', () => {
  it('retrieves all eleven domains with main-derived identity and never writes clinical tables or outbox', async () => {
    const h = harness()
    const page = allDomainHistory()
    expect(isHistoryPage(page)).toBe(true)
    expect(new Set(page.items.map((item) => item.resourceType))).toEqual(
      new Set(historyResourceTypes)
    )
    h.http.mockResolvedValue({ status: 'RECEIVED', page })
    const before = clinicalState(h.connection)
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'COMPLETE', downloaded: 11 })
    expect(h.http).toHaveBeenCalledWith(
      { apiBaseUrl: 'https://central.example.org', installationToken: token },
      expect.objectContaining({
        personId: page.personId,
        localPatientId: localPatient,
        requesterLocalActorId: admin,
        limit: 50,
        reasonCode: 'CARE_DELIVERY'
      })
    )
    const saved = h.service.read(readRequest)
    expect(saved).toMatchObject({ status: 'READY', total: 11, page })
    expect(clinicalState(h.connection)).toEqual(before)
    const audits = h.connection.prepare('SELECT action, metadata_json FROM audit_log').all()
    expect(audits).toHaveLength(3)
    expect(JSON.stringify(audits)).not.toMatch(/Synthetic|Amlodipine|chs_inst/)
  })

  it('survives a process restart mid-download and atomically promotes without duplicate history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'central-history-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const h = harness(join(directory, 'test.sqlite'))
    const original = historyFixture()
    expect((await h.service.refresh(refreshRequest)).status).toBe('COMPLETE')
    const items = itemsPage(30)
    h.http.mockResolvedValueOnce({
      status: 'RECEIVED',
      page: { ...items, items: items.items.slice(0, 20), nextCursor: historyUuid(99) }
    })
    expect(await h.service.refresh({ ...refreshRequest, restart: true })).toEqual({
      status: 'IN_PROGRESS',
      downloaded: 20
    })
    expect(h.service.read(readRequest)).toMatchObject({ status: 'READY', page: original })
    h.reopen()
    h.http.mockResolvedValueOnce({ status: 'OFFLINE' })
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'OFFLINE' })
    h.http.mockResolvedValueOnce({
      status: 'RECEIVED',
      page: { ...items, items: items.items.slice(20), nextCursor: null }
    })
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'COMPLETE', downloaded: 30 })
    expect(h.http.mock.calls.at(-1)?.[1].cursor).toBe(historyUuid(99))
    const first = h.service.read(readRequest)
    expect(first).toMatchObject({ status: 'READY', total: 30, nextOffset: 25 })
    if (first.status !== 'READY') throw new Error('Expected cache')
    const second = h.service.read({ ...readRequest, offset: 25, snapshotId: first.snapshotId })
    expect(second).toMatchObject({
      status: 'READY',
      total: 30,
      nextOffset: null,
      page: { items: items.items.slice(25) }
    })
    expect(h.connection.prepare('SELECT COUNT(*) n FROM central_history_snapshots').get()).toEqual({
      n: 1
    })
    h.reopen()
    h.http.mockResolvedValue({ status: 'OFFLINE' })
    expect(h.service.read(readRequest)).toMatchObject({ status: 'READY', total: 30 })
  })

  it.each(['OFFLINE', 'CURSOR_STALE', 'INVALID_RESPONSE', 'UNAVAILABLE'] as const)(
    'preserves the complete cache on %s',
    async (outcome) => {
      const h = harness()
      await h.service.refresh(refreshRequest)
      const before = h.service.read(readRequest)
      h.http.mockResolvedValue({ status: outcome })
      expect(await h.service.refresh({ ...refreshRequest, restart: true })).toEqual({
        status: outcome
      })
      expect(h.service.read(readRequest)).toEqual(before)
    }
  )

  it('invalidates cached access on a central denial, including caches belonging to other users', async () => {
    const h = harness()
    await h.service.refresh(refreshRequest)
    h.setUser(historyUuid(5))
    await h.service.refresh(refreshRequest)
    h.http.mockResolvedValue({ status: 'ACCESS_DENIED' })
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'ACCESS_DENIED' })
    h.setUser(admin)
    expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    expect(h.connection.prepare('SELECT COUNT(*) n FROM central_history_items').get()).toEqual({
      n: 0
    })
  })

  it('binds the cache to the local user, credential, location and accepted patient revision', async () => {
    const h = harness()
    await h.service.refresh(refreshRequest)
    h.setUser(historyUuid(5))
    expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    h.setUser(admin)
    h.configure(`chs_inst_v1_${'B'.repeat(43)}`)
    expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    h.configure()
    h.connection.prepare('UPDATE installation_location_configuration SET row_version = 2').run()
    expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    h.connection.prepare('UPDATE patients SET row_version = 2').run()
    expect(h.service.read(readRequest)).toEqual({ status: 'IDENTITY_NOT_READY' })
    expect((await h.service.refresh(refreshRequest)).status).toBe('IDENTITY_NOT_READY')
  })

  it('requires a confirmed identity rather than possession of a Medical ID', async () => {
    const h = harness()
    h.connection.prepare('DELETE FROM sync_patient_identity_links').run()
    expect(h.service.read(readRequest)).toEqual({ status: 'IDENTITY_NOT_READY' })
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'IDENTITY_NOT_READY' })
    expect(h.http).not.toHaveBeenCalled()
  })

  it('denies screeners, locked sessions, disabled users and forced password changes', async () => {
    const h = harness()
    h.setRole('TRAINED_SCREENER')
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'FORBIDDEN' })
    h.setRole('LOCAL_ADMIN')
    h.lock()
    expect(h.service.read(readRequest)).toEqual({ status: 'UNAUTHENTICATED' })
    h.unlock()
    h.connection.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(admin)
    expect(h.service.read(readRequest)).toEqual({ status: 'FORBIDDEN' })
    h.connection
      .prepare('UPDATE users SET is_active = 1, must_change_password = 1 WHERE id = ?')
      .run(admin)
    expect(h.service.read(readRequest)).toEqual({ status: 'FORBIDDEN' })
    expect(h.http).not.toHaveBeenCalled()
  })

  it.each(['lock', 'relogin', 'credential', 'identity'] as const)(
    'discards a response after an in-flight %s change',
    async (change) => {
      const h = harness()
      let resolve!: (result: HistoryFetchResult) => void
      h.http.mockImplementation(
        () =>
          new Promise((result) => {
            resolve = result
          })
      )
      const pending = h.service.refresh(refreshRequest)
      expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'BUSY' })
      if (change === 'lock') h.lock()
      if (change === 'relogin') {
        h.lock()
        h.unlock()
      }
      if (change === 'credential') h.configure(`chs_inst_v1_${'C'.repeat(43)}`)
      if (change === 'identity') h.connection.prepare('UPDATE patients SET row_version = 2').run()
      resolve({ status: 'RECEIVED', page: historyFixture() })
      expect((await pending).status).not.toBe('COMPLETE')
      expect(
        h.connection
          .prepare("SELECT COUNT(*) n FROM central_history_snapshots WHERE state = 'READY'")
          .get()
      ).toEqual({ n: 0 })
      expect(h.connection.prepare('SELECT COUNT(*) n FROM central_history_items').get()).toEqual({
        n: 0
      })
    }
  )

  it.each(['patient', 'profile', 'range', 'order', 'duplicate', 'cursor', 'timestamp'] as const)(
    'rejects mixed or malformed %s pages without replacing saved history',
    async (problem) => {
      const h = harness()
      await h.service.refresh(refreshRequest)
      const before = h.service.read(readRequest)
      const base = itemsPage(4)
      h.http.mockResolvedValueOnce({
        status: 'RECEIVED',
        page: { ...base, items: base.items.slice(0, 2), nextCursor: historyUuid(88) }
      })
      await h.service.refresh({ ...refreshRequest, restart: true })
      let next: HistoryPage = { ...base, items: base.items.slice(2), nextCursor: null }
      if (problem === 'patient') next = { ...next, personId: historyUuid(55) }
      if (problem === 'profile')
        next = { ...next, patient: { ...next.patient, displayName: 'Changed identity' } }
      if (problem === 'range') next = { ...next, fromDate: '2026-08-01' }
      if (problem === 'order') next = { ...next, items: [...next.items].reverse() }
      if (problem === 'duplicate') next = { ...next, items: base.items.slice(0, 2) }
      if (problem === 'cursor') next = { ...next, nextCursor: historyUuid(88) }
      if (problem === 'timestamp') next = { ...next, retrievedAt: '2026-09-17T12:01:00.000Z' }
      h.http.mockResolvedValueOnce({ status: 'RECEIVED', page: next })
      expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'INVALID_RESPONSE' })
      expect(h.service.read(readRequest)).toEqual(before)
    }
  )

  it('prevents disclosure and promotion if the local audit write fails', async () => {
    const h = harness()
    await h.service.refresh(refreshRequest)
    h.connection.exec(
      "CREATE TRIGGER fail_history_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
    )
    expect(h.service.read(readRequest)).toEqual({ status: 'UNAVAILABLE' })
    expect(await h.service.refresh(refreshRequest)).toEqual({ status: 'UNAVAILABLE' })
  })

  it('expires offline snapshots after 30 days and validates caller-supplied bounds', async () => {
    const h = harness()
    await h.service.refresh(refreshRequest)
    h.time('2026-10-18T12:00:00.000Z')
    expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    expect(await h.service.refresh({ ...refreshRequest, fromDate: '2024-01-01' })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(await h.service.refresh({ ...refreshRequest, personId: historyUuid(999) })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(h.service.read({ ...readRequest, requesterLocalActorId: admin })).toEqual({
      status: 'VALIDATION_FAILED'
    })
  })

  it('detects a replacement between local pages and supports a bounded type filter', async () => {
    const h = harness()
    h.http.mockResolvedValue({ status: 'RECEIVED', page: itemsPage(30) })
    await h.service.refresh(refreshRequest)
    const first = h.service.read(readRequest)
    if (first.status !== 'READY') throw new Error('Expected history')
    await h.service.refresh({ ...refreshRequest, restart: true })
    expect(h.service.read({ ...readRequest, offset: 25, snapshotId: first.snapshotId })).toEqual({
      status: 'CACHE_CHANGED'
    })
    expect(h.service.read({ ...readRequest, resourceType: 'REFERRAL' })).toMatchObject({
      status: 'READY',
      total: 0,
      page: { items: [] }
    })
  })
  it('rejects a traversal larger than 5000 records while preserving the previous complete snapshot', async () => {
    const h = harness()
    expect((await h.service.refresh(refreshRequest)).status).toBe('COMPLETE')
    const original = h.service.read(readRequest)
    const base = historyFixture()
    const item = base.items[0]!
    for (let page = 0; page <= 100; page++) {
      h.http.mockResolvedValueOnce({
        status: 'RECEIVED',
        page: {
          ...base,
          nextCursor: historyUuid(20000 + page),
          items: Array.from({ length: 50 }, (_, i) => ({
            ...item,
            resourceId: historyUuid(15000 - page * 50 - i)
          }))
        }
      })
      const result = await h.service.refresh({ ...refreshRequest, restart: page === 0 })
      expect(result.status).toBe(page === 100 ? 'LIMIT_REACHED' : 'IN_PROGRESS')
    }
    expect(h.service.read(readRequest)).toEqual(original)
    expect(
      h.connection
        .prepare("SELECT COUNT(*) n FROM central_history_snapshots WHERE state = 'DOWNLOADING'")
        .get()
    ).toEqual({ n: 0 })
  })

  it('rolls back promotion and new items if completion cannot be audited', async () => {
    const h = harness()
    expect((await h.service.refresh(refreshRequest)).status).toBe('COMPLETE')
    const original = h.service.read(readRequest)
    let resolve!: (result: HistoryFetchResult) => void
    h.http.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = h.service.refresh({ ...refreshRequest, restart: true })
    h.connection.exec(
      "CREATE TRIGGER fail_history_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
    )
    resolve({ status: 'RECEIVED', page: itemsPage(30) })
    expect(await pending).toEqual({ status: 'UNAVAILABLE' })
    h.connection.exec('DROP TRIGGER fail_history_audit')
    expect(h.service.read(readRequest)).toEqual(original)
    expect(h.connection.prepare('SELECT COUNT(*) n FROM central_history_items').get()).toEqual({
      n: historyFixture().items.length
    })
  })
  it('retains offline access after a legitimate new login updates the user authentication timestamps', async () => {
    const h = harness()
    expect((await h.service.refresh(refreshRequest)).status).toBe('COMPLETE')
    h.lock()
    h.unlock()
    h.connection
      .prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run('2026-09-17T12:01:00.000Z', '2026-09-17T12:01:00.000Z', admin)
    h.http.mockResolvedValue({ status: 'OFFLINE' })
    expect(h.service.read(readRequest)).toMatchObject({ status: 'READY', total: 5 })
  })
  it.each(['audit failure', 'lock'] as const)(
    'commits a server denial even after a concurrent %s',
    async (condition) => {
      const h = harness()
      expect((await h.service.refresh(refreshRequest)).status).toBe('COMPLETE')
      let resolve!: (result: HistoryFetchResult) => void
      h.http.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      const pending = h.service.refresh(refreshRequest)
      if (condition === 'lock') h.lock()
      else
        h.connection.exec(
          "CREATE TRIGGER fail_history_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
        )
      resolve({ status: 'ACCESS_DENIED' })
      expect(await pending).toEqual({ status: 'ACCESS_DENIED' })
      expect(
        h.connection.prepare('SELECT COUNT(*) n FROM central_history_snapshots').get()
      ).toEqual({ n: 0 })
      if (condition === 'lock') h.unlock()
      else h.connection.exec('DROP TRIGGER fail_history_audit')
      expect(h.service.read(readRequest)).toEqual({ status: 'NO_CACHE' })
    }
  )
})
