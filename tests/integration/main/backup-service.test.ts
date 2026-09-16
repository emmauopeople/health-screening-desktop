import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductionFirstRunBootstrapService } from '@main/application'
import {
  createDatabaseRuntime,
  createLocalUserRepository,
  createProductionDatabaseMigrationRunner,
  getDatabasePath,
  type DatabaseRuntime
} from '@main/database'
import {
  LocalSessionLockedError,
  LocalSessionAuthorizationError,
  type LocalAuthenticationSessionService,
  type ActiveLocalSessionContext
} from '@main/application/authentication/session'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { createBackupService, type BackupService } from '@main/application/backups/backup-service'
import { decryptBackup, encryptBackup } from '@main/application/backups/backup-archive'
import { readBackupMetadata } from '@main/application/backups/backup-validation'
import type { BackupMetadata } from '@shared/ipc/backup-contracts'

const request = { password: 'a-long-backup-passphrase' }
const logger = { info: vi.fn(), error: vi.fn() }
const now = parseUtcTimestamp('2026-09-16T12:00:00.000Z')
let root: string
let userData: string
let work: string
let destination: string
let runtime: DatabaseRuntime
let service: BackupService
let actor: ActiveLocalSessionContext
const requireAnyRole = vi.fn()
const chooseDestination = vi.fn<() => Promise<string | null>>()
const chooseSource = vi.fn<() => Promise<string | null>>()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'chs-backup-'))
  userData = join(root, 'profile')
  work = join(userData, 'backup-work')
  destination = join(root, 'saved.chsbackup')
  runtime = createDatabaseRuntime({
    databasePath: getDatabasePath(userData),
    migrationRunner: createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger
    }),
    logger
  })
  runtime.initialize()
  const connection = runtime.getConnection()
  const initialized = await createProductionFirstRunBootstrapService({
    connection,
    logger
  }).initialize({
    deploymentName: 'Private deployment',
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
  const user = createLocalUserRepository(connection).getById(initialized.administrator.id)!
  actor = {
    user,
    authenticatedAt: now,
    lastActivityAt: now,
    idleExpiresAt: now,
    absoluteExpiresAt: now
  }
  requireAnyRole.mockReset().mockImplementation(() => actor)
  chooseDestination.mockReset().mockResolvedValue(destination)
  chooseSource.mockReset().mockResolvedValue(destination)
  service = createBackupService({
    connection,
    authenticationSessionService: {
      requireAnyRole
    } as unknown as LocalAuthenticationSessionService,
    userDataDirectory: userData,
    workDirectory: work,
    applicationVersion: '1.0.0',
    chooseDestination,
    chooseSource
  })
})
afterEach(() => {
  runtime.close()
  rmSync(root, { recursive: true, force: true })
})

async function createValidBackup(): Promise<BackupMetadata> {
  const result = await service.create(request)
  expect(result.status).toBe('SAVED')
  if (result.status !== 'SAVED') throw new Error('Backup failed')
  return result.metadata
}

describe('encrypted desktop backup foundation', () => {
  it('captures WAL data, preserves identity/accounts, verifies and audits without exposing secrets', async () => {
    const connection = runtime.getConnection()
    connection.pragma('wal_autocheckpoint = 0')
    connection
      .prepare(
        'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        '11111111-1111-4111-8111-111111111111',
        'P001',
        'Private patient',
        'private patient',
        'ACTIVE',
        actor.user.id,
        now,
        actor.user.id,
        now
      )
    connection
      .prepare('INSERT INTO app_settings VALUES (?, ?, ?, ?)')
      .run('backup-test', '"uncheckpointed-private-value"', now, 'PRIVATE')
    expect(existsSync(`${getDatabasePath(userData)}-wal`)).toBe(true)
    const originalUsers = connection.prepare('SELECT * FROM users').all()
    const metadata = await createValidBackup()
    expect(metadata).toMatchObject({
      deploymentName: 'Private deployment',
      schemaVersion: 24,
      counts: { patients: 1, users: 1 },
      credentialScope: 'ORIGINAL_OS_PROFILE'
    })
    const bytes = readFileSync(destination)
    for (const secret of [
      'SQLite format',
      'Private patient',
      'Private deployment',
      request.password,
      'uncheckpointed-private-value'
    ])
      expect(bytes.includes(Buffer.from(secret))).toBe(false)
    expect(await service.inspect(request)).toEqual({ status: 'VERIFIED', metadata })
    const inspect = join(root, 'reopened')
    mkdirSync(inspect)
    const dbPath = join(inspect, 'database.sqlite3')
    await decryptBackup(destination, join(inspect, 'payload'), dbPath, request.password)
    const restored = new Database(dbPath, { readonly: true })
    try {
      expect(restored.prepare('SELECT * FROM users').all()).toEqual(originalUsers)
      expect(
        restored.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('backup-test')
      ).toEqual({ value_json: '"uncheckpointed-private-value"' })
      expect(restored.prepare('SELECT id FROM installation').get()).toEqual({
        id: metadata.installationId
      })
    } finally {
      restored.close()
    }
    const audits = connection
      .prepare("SELECT metadata_json FROM audit_log WHERE action = 'BACKUP_CREATED'")
      .all()
    expect(audits).toEqual([{ metadata_json: '{"format_version":1,"schema_version":24}' }])
    expect(readdirSync(work)).toEqual([])
    expect(connection.prepare('SELECT * FROM users').all()).toEqual(originalUsers)
  })

  it.each(['create', 'inspect'] as const)(
    'blocks unauthenticated %s before opening a file dialog',
    async (method) => {
      requireAnyRole.mockImplementation(() => {
        throw new LocalSessionLockedError()
      })
      expect(await service[method](request)).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
      expect(chooseDestination).not.toHaveBeenCalled()
      expect(chooseSource).not.toHaveBeenCalled()
    }
  )
  it('rejects non-admin and deactivated administrators', async () => {
    requireAnyRole.mockImplementationOnce(() => {
      throw new LocalSessionAuthorizationError()
    })
    expect(await service.create(request)).toEqual({ status: 'FORBIDDEN' })
    runtime.getConnection().prepare('UPDATE users SET is_active = 0').run()
    expect(await service.create(request)).toEqual({ status: 'FORBIDDEN' })
    expect(chooseDestination).not.toHaveBeenCalled()
  })
  it('rejects invalid passwords and over-posted destination paths', async () => {
    expect(await service.create({ password: 'short' })).toEqual({ status: 'VALIDATION_FAILED' })
    expect(await service.create({ ...request, path: destination } as typeof request)).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(chooseDestination).not.toHaveBeenCalled()
  })
  it('cancels without creating files or audit events', async () => {
    chooseDestination.mockResolvedValue(null)
    expect(await service.create(request)).toEqual({ status: 'CANCELLED' })
    expect(existsSync(destination)).toBe(false)
    expect(
      runtime
        .getConnection()
        .prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'BACKUP_CREATED'")
        .get()
    ).toEqual({ n: 0 })
  })
  it('rechecks session authority after the native dialog', async () => {
    chooseDestination.mockImplementation(async () => {
      requireAnyRole.mockImplementation(() => {
        throw new LocalSessionLockedError()
      })
      return destination
    })
    expect(await service.create(request)).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
    expect(existsSync(destination)).toBe(false)
  })
  it('rejects a different administrator taking over an in-flight request', async () => {
    chooseDestination.mockImplementation(async () => {
      actor = { ...actor, authenticatedAt: parseUtcTimestamp('2026-09-16T12:01:00.000Z') }
      return destination
    })
    expect(await service.create(request)).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
    expect(existsSync(destination)).toBe(false)
  })
  it('serializes backup and inspection operations while a dialog is open', async () => {
    let finish: (value: string | null) => void = () => {
      throw new Error('not initialized')
    }
    chooseDestination.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = service.create(request)
    expect(await service.inspect(request)).toEqual({ status: 'BUSY' })
    finish(null)
    expect(await first).toEqual({ status: 'CANCELLED' })
    chooseDestination.mockResolvedValue(null)
    expect(await service.create(request)).toEqual({ status: 'CANCELLED' })
  })
  it('never overwrites an existing destination and cleans all private temporary files', async () => {
    writeFileSync(destination, 'previous backup')
    expect(await service.create(request)).toEqual({ status: 'DESTINATION_EXISTS' })
    expect(readFileSync(destination, 'utf8')).toBe('previous backup')
    expect(readdirSync(work)).toEqual([])
  })
  it('rejects destinations inside managed application data', async () => {
    chooseDestination.mockResolvedValue(join(userData, 'data', 'unsafe.chsbackup'))
    expect(await service.create(request)).toEqual({ status: 'UNAVAILABLE' })
    expect(existsSync(join(userData, 'data', 'unsafe.chsbackup'))).toBe(false)
    expect(readdirSync(work)).toEqual([])
  })
  it('removes a newly created file if recording the success audit fails', async () => {
    const connection = runtime.getConnection()
    const original = connection.prepare.bind(connection)
    const prepare = vi.spyOn(connection, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO audit_log')) throw new Error('simulated audit failure')
      return original(sql)
    })
    try {
      expect(await service.create(request)).toEqual({ status: 'UNAVAILABLE' })
      expect(existsSync(destination)).toBe(false)
      expect(readdirSync(work)).toEqual([])
    } finally {
      prepare.mockRestore()
    }
    expect(
      connection
        .prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'BACKUP_CREATED'")
        .get()
    ).toEqual({ n: 0 })
  })

  it('reauthorizes after snapshot creation and removes temporary plaintext when the session locks', async () => {
    const connection = runtime.getConnection()
    const backup = connection.backup.bind(connection)
    const intercepted = vi.spyOn(connection, 'backup').mockImplementation(async (path, options) => {
      const result = await backup(path, options)
      requireAnyRole.mockImplementation(() => {
        throw new LocalSessionLockedError()
      })
      return result
    })
    try {
      expect(await service.create(request)).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
      expect(existsSync(destination)).toBe(false)
      expect(readdirSync(work)).toEqual([])
    } finally {
      intercepted.mockRestore()
    }
  })

  it('rejects wrong passwords and clears unauthenticated temporary plaintext', async () => {
    await createValidBackup()
    expect(await service.inspect({ password: 'incorrect-password' })).toEqual({
      status: 'INVALID_BACKUP'
    })
    expect(readdirSync(work)).toEqual([])
  })
  it.each(['header', 'ciphertext', 'tag', 'truncated'] as const)(
    'rejects a modified %s',
    async (part) => {
      await createValidBackup()
      const bytes = readFileSync(destination)
      if (part === 'truncated') writeFileSync(destination, bytes.subarray(0, 42))
      else {
        const offset = part === 'header' ? 10 : part === 'tag' ? bytes.length - 1 : 50
        bytes[offset] = bytes[offset]! ^ 1
        writeFileSync(destination, bytes)
      }
      expect(await service.inspect(request)).toEqual({ status: 'INVALID_BACKUP' })
      expect(readdirSync(work)).toEqual([])
    }
  )
  it('rejects an authenticated archive whose metadata disagrees with the database', async () => {
    const source = join(root, 'snapshot.sqlite3')
    await runtime.getConnection().backup(source)
    const metadata = readBackupMetadata(source, new Date().toISOString(), '1.0.0')
    await encryptBackup(source, destination, request.password, {
      ...metadata,
      installationId: '22222222-2222-4222-8222-222222222222'
    })
    expect(await service.inspect(request)).toEqual({ status: 'INVALID_BACKUP' })
  })
  it('rejects unsupported schema versions without migrating the backup or live database', async () => {
    const source = join(root, 'snapshot.sqlite3')
    await runtime.getConnection().backup(source)
    const metadata = readBackupMetadata(source, new Date().toISOString(), '1.0.0')
    const changed = new Database(source)
    changed.pragma('user_version = 999')
    changed.close()
    await encryptBackup(source, destination, request.password, { ...metadata, schemaVersion: 999 })
    expect(await service.inspect(request)).toEqual({ status: 'UNSUPPORTED_BACKUP' })
    expect(runtime.getConnection().pragma('user_version', { simple: true })).toBe(24)
  })
  it('rejects a database with an incompatible migration history', async () => {
    const source = join(root, 'snapshot.sqlite3')
    await runtime.getConnection().backup(source)
    const metadata = readBackupMetadata(source, new Date().toISOString(), '1.0.0')
    const changed = new Database(source)
    changed
      .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
      .run('0'.repeat(64))
    changed.close()
    await encryptBackup(source, destination, request.password, metadata)
    expect(await service.inspect(request)).toEqual({ status: 'INVALID_BACKUP' })
  })
})
