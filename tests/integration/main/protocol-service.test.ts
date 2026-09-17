import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductionFirstRunBootstrapService } from '@main/application'
import {
  createDatabaseRuntime,
  createLocalUserRepository,
  createProductionDatabaseMigrationRunner,
  type DatabaseRuntime
} from '@main/database'
import {
  LocalSessionLockedError,
  LocalSessionAuthorizationError,
  type LocalAuthenticationSessionService,
  type ActiveLocalSessionContext
} from '@main/application/authentication/session'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import {
  createProtocolService,
  type ProtocolService
} from '@main/application/protocols/protocol-service'
import { SCREENING_BP_PROTOCOL_V1 } from '@shared/screening-bp-protocol'

let directory: string
let runtime: DatabaseRuntime
let service: ProtocolService
let actor: ActiveLocalSessionContext
const requireAnyRole = vi.fn()
const logger = { info: vi.fn(), error: vi.fn() }
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'chs-protocols-'))
  runtime = createDatabaseRuntime({
    databasePath: join(directory, 'test.sqlite3'),
    migrationRunner: createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger
    }),
    logger
  })
  runtime.initialize()
  const connection = runtime.getConnection()
  const result = await createProductionFirstRunBootstrapService({ connection, logger }).initialize({
    deploymentName: 'Test clinic',
    timeZone: 'Africa/Douala',
    administrator: { username: 'admin', displayName: 'Admin', temporaryPassword: 'ValidPassw0rd!' },
    initialLocation: {
      name: 'Clinic',
      locationType: 'CHURCH',
      village: null,
      subdivision: null,
      region: null,
      directions: null
    }
  })
  connection.prepare('UPDATE users SET must_change_password = 0').run()
  const user = createLocalUserRepository(connection).getById(result.administrator.id)!
  const now = parseUtcTimestamp('2026-09-17T10:00:00.000Z')
  actor = {
    user,
    authenticatedAt: now,
    lastActivityAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now
  }
  requireAnyRole.mockReset().mockReturnValue(actor)
  service = createProtocolService({
    connection,
    authenticationSessionService: { requireAnyRole } as unknown as LocalAuthenticationSessionService
  })
})
afterEach(() => {
  runtime.close()
  rmSync(directory, { recursive: true, force: true })
})
function changeConfiguration(configuration: unknown): void {
  const json = JSON.stringify(configuration)
  runtime
    .getConnection()
    .prepare(
      "UPDATE protocol_versions SET configuration_json = ?, checksum = ? WHERE status = 'ACTIVE'"
    )
    .run(json, createHash('sha256').update(json).digest('hex'))
}
const expected = {
  rulesetKey: SCREENING_BP_PROTOCOL_V1.key,
  rulesetVersion: SCREENING_BP_PROTOCOL_V1.version,
  ...SCREENING_BP_PROTOCOL_V1.configuration
}

describe('read-only protocol administration', () => {
  it('reads the real migrated baseline and confirms it matches runtime rules without writes', () => {
    const database = runtime.getConnection()
    const before = database.prepare('SELECT total_changes() AS changes').get()
    database.pragma('query_only = ON')
    expect(service.get()).toEqual({
      status: 'LOADED',
      active: {
        key: 'health-screening-baseline',
        version: '1',
        effectiveAt: '1970-01-01T00:00:00.000Z',
        rulesMatch: true
      }
    })
    expect(database.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
    expect(requireAnyRole).toHaveBeenCalledWith(['LOCAL_ADMIN'])
  })
  it('matches configuration regardless of JSON property order', () => {
    changeConfiguration({ bpScreening: Object.fromEntries(Object.entries(expected).reverse()) })
    expect(service.get()).toMatchObject({ status: 'LOADED', active: { rulesMatch: true } })
  })
  it.each([
    { ...expected, repeatIntervalMinutes: 10 },
    { ...expected, urgentDiastolicThreshold: 110 },
    { ...expected, rulesetVersion: '2' },
    { ...expected, extraRule: true },
    {}
  ])('reports mismatched saved rules without changing screening behavior', (bpScreening) => {
    changeConfiguration({ bpScreening })
    expect(service.get()).toMatchObject({ status: 'LOADED', active: { rulesMatch: false } })
    expect(SCREENING_BP_PROTOCOL_V1.configuration.repeatIntervalMinutes).toBe(1)
  })
  it('reports a missing active protocol without substituting a default', () => {
    runtime.getConnection().prepare("UPDATE protocol_versions SET status = 'INACTIVE'").run()
    expect(service.get()).toEqual({ status: 'NO_ACTIVE_PROTOCOL' })
  })
  it('rejects inconsistent persisted checksums without leaking stored configuration', () => {
    runtime.getConnection().prepare('UPDATE protocol_versions SET checksum = ?').run('0'.repeat(64))
    expect(service.get()).toEqual({ status: 'UNAVAILABLE' })
  })
  it.each([
    'LOCKED',
    'NURSE',
    'INACTIVE',
    'PASSWORD_CHANGE',
    'PERSISTED_ROLE',
    'PERSISTED_LOCK'
  ] as const)('blocks %s access', (state) => {
    const database = runtime.getConnection()
    if (state === 'LOCKED')
      requireAnyRole.mockImplementation(() => {
        throw new LocalSessionLockedError()
      })
    if (state === 'NURSE')
      requireAnyRole.mockImplementation(() => {
        throw new LocalSessionAuthorizationError()
      })
    if (state === 'INACTIVE') database.prepare('UPDATE users SET is_active = 0').run()
    if (state === 'PASSWORD_CHANGE')
      database.prepare('UPDATE users SET must_change_password = 1').run()
    if (state === 'PERSISTED_ROLE') database.prepare("UPDATE users SET role = 'NURSE'").run()
    if (state === 'PERSISTED_LOCK')
      database.prepare('UPDATE users SET locked_until = ?').run('2099-01-01T00:00:00.000Z')
    expect(service.get()).toEqual({
      status: state === 'LOCKED' ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN'
    })
  })
})
