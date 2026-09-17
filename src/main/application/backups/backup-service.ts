import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import {
  assertLocalRestoreAllowed,
  assertSnapshotRestoreAllowed,
  RestoreRejected
} from './restore-safety'
import { stageRestore, cancelStagedRestore } from './pending-restore'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  type LocalAuthenticationSessionService
} from '@main/application/authentication/session'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocalUserRepository,
  parseAuditActionCode,
  parseAuditEntityType
} from '@main/database'
import { createSystemUtcClock } from '@main/foundation/utc-clock'
import { createSystemEntityIdGenerator } from '@main/foundation/entity-id'
import {
  backupRequestSchema,
  restoreCommitRequestSchema,
  restoreTokenRequestSchema,
  type RestoreCommitRequest,
  type RestoreTokenRequest,
  type BackupActionData,
  type BackupMetadata,
  type BackupRequest
} from '@shared/ipc/backup-contracts'
import {
  hashDatabase,
  decryptBackup,
  encryptBackup,
  InvalidBackupError,
  UnsupportedBackupError
} from './backup-archive'
import { readBackupMetadata, verifyBackupMetadata } from './backup-validation'

export interface BackupService {
  create(request: BackupRequest): Promise<BackupActionData>
  inspect(request: BackupRequest): Promise<BackupActionData>
  prepareRestore(request: BackupRequest): Promise<BackupActionData>
  restore(request: RestoreCommitRequest): Promise<BackupActionData>
  discardRestore(request: RestoreTokenRequest): Promise<BackupActionData>
}
export interface BackupServiceOptions {
  connection: Database.Database
  authenticationSessionService: LocalAuthenticationSessionService
  userDataDirectory: string
  workDirectory: string
  applicationVersion: string
  chooseDestination(): Promise<string | null>
  chooseSource(): Promise<string | null>
  requestRestart?(): void
}
class Rejected extends Error {
  constructor(readonly status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE') {
    super(status)
  }
}
export function createBackupService(options: BackupServiceOptions): BackupService {
  const { connection, authenticationSessionService: auth } = options
  const users = createLocalUserRepository(connection)
  const installations = createInstallationRepository(connection)
  const audit = createAuditEventRepository(connection)
  const transactions = createDatabaseTransactionExecutor({
    connection,
    clock: createSystemUtcClock(),
    idGenerator: createSystemEntityIdGenerator()
  })
  let busy = false
  let restarting = false
  let preview:
    | {
        token: string
        workspace: string
        metadata: BackupMetadata
        userId: string
        authenticatedAt: string
        expiresAt: number
      }
    | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  const discard = (): void => {
    if (expiry) clearTimeout(expiry)
    expiry = undefined
    if (preview) rmSync(preview.workspace, { recursive: true, force: true })
    preview = undefined
  }
  const authorize = (): ReturnType<LocalAuthenticationSessionService['requireAnyRole']> => {
    const session = auth.requireAnyRole(['LOCAL_ADMIN'])
    const user = users.getById(session.user.id)
    if (!user?.isActive || user.role !== 'LOCAL_ADMIN' || user.mustChangePassword)
      throw new Rejected('FORBIDDEN')
    return session
  }
  async function run(
    kind: 'create' | 'inspect' | 'prepareRestore' | 'restore' | 'discardRestore',
    request: BackupRequest | RestoreCommitRequest | RestoreTokenRequest
  ): Promise<BackupActionData> {
    let workspace: string | undefined
    let destination: string | undefined
    let ownsDestination = false
    let ownsOperation = false
    try {
      const actor = authorize()
      const reauthorize = (): void => {
        const current = authorize()
        if (current.user.id !== actor.user.id || current.authenticatedAt !== actor.authenticatedAt)
          throw new Rejected('AUTHENTICATION_REQUIRED')
      }
      const parsed = (
        kind === 'restore'
          ? restoreCommitRequestSchema
          : kind === 'discardRestore'
            ? restoreTokenRequestSchema
            : backupRequestSchema
      ).safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      if (busy || restarting) return { status: 'BUSY' }
      busy = true
      ownsOperation = true
      if (kind === 'restore' || kind === 'discardRestore') {
        if (
          !('token' in parsed.data) ||
          !preview ||
          preview.token !== parsed.data.token ||
          preview.userId !== actor.user.id ||
          preview.authenticatedAt !== actor.authenticatedAt ||
          preview.expiresAt <= Date.now()
        ) {
          discard()
          return { status: 'RESTORE_EXPIRED' }
        }
        if (kind === 'discardRestore') {
          discard()
          return { status: 'CANCELLED' }
        }
        const candidate = preview
        if (expiry) clearTimeout(expiry)
        expiry = undefined
        if (!options.requestRestart) throw new Rejected('UNAVAILABLE')
        const snapshot = join(candidate.workspace, 'snapshot.sqlite3')
        verifyBackupMetadata(snapshot, candidate.metadata)
        assertLocalRestoreAllowed(connection, candidate.metadata.installationId)
        assertSnapshotRestoreAllowed(snapshot, candidate.metadata.installationId)
        // The restored audit records the requesting administrator even if the account
        // was created after the snapshot; system actor avoids a fabricated foreign key.
        const restored = new Database(snapshot)
        try {
          restored.pragma('trusted_schema = OFF')
          restored
            .prepare(
              'INSERT INTO audit_log (id, installation_id, user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)'
            )
            .run(
              randomUUID(),
              candidate.metadata.installationId,
              'BACKUP_RESTORED',
              'INSTALLATION',
              candidate.metadata.installationId,
              new Date().toISOString(),
              JSON.stringify({
                requested_by_user_id: actor.user.id,
                backup_created_at: candidate.metadata.createdAt
              })
            )
          restored.pragma('wal_checkpoint(TRUNCATE)')
        } finally {
          restored.close()
        }
        const sha256 = await hashDatabase(snapshot)
        reauthorize()
        assertLocalRestoreAllowed(connection, candidate.metadata.installationId)
        stageRestore(options.userDataDirectory, snapshot, candidate.metadata, sha256)
        try {
          transactions.run((context) => {
            reauthorize()
            audit.insert(context.connection, {
              id: context.newEntityId(),
              installationId: installations.get()!.id,
              userId: actor.user.id,
              action: parseAuditActionCode('BACKUP_RESTORE_REQUESTED'),
              entityType: parseAuditEntityType('INSTALLATION'),
              entityId: installations.get()!.id,
              occurredAt: context.nowUtc(),
              metadata: { backup_created_at: candidate.metadata.createdAt }
            })
          })
          discard()
          options.requestRestart()
        } catch (error) {
          cancelStagedRestore(options.userDataDirectory)
          throw error
        }
        restarting = true
        return { status: 'RESTARTING' }
      }
      discard()
      if (!('password' in parsed.data)) return { status: 'VALIDATION_FAILED' }
      const selected = await (kind === 'create'
        ? options.chooseDestination()
        : options.chooseSource())
      reauthorize()
      if (selected === null) return { status: 'CANCELLED' }
      await mkdir(options.workDirectory, { recursive: true, mode: 0o700 })
      workspace = await mkdtemp(join(options.workDirectory, 'operation-'))
      const snapshotPath = join(workspace, 'snapshot.sqlite3')
      let metadata: BackupMetadata
      if (kind === 'create') {
        destination = selected.toLowerCase().endsWith('.chsbackup')
          ? selected
          : `${selected}.chsbackup`
        const parent = await realpath(dirname(destination))
        const managed = relative(await realpath(options.userDataDirectory), parent)
        if (
          managed === '' ||
          (managed !== '..' && !managed.startsWith(`..${sep}`) && !isAbsolute(managed))
        )
          throw new Rejected('UNAVAILABLE')
        reauthorize()
        const placeholder = await open(snapshotPath, 'wx', 0o600)
        await placeholder.close()
        await connection.backup(snapshotPath)
        reauthorize()
        metadata = readBackupMetadata(
          snapshotPath,
          new Date().toISOString(),
          options.applicationVersion
        )
        const archivePath = join(workspace, 'encrypted.chsbackup')
        await encryptBackup(snapshotPath, archivePath, parsed.data.password, metadata)
        reauthorize()
        // Exclusive creation never overwrites an older backup or another file.
        const output = await open(destination, 'wx', 0o600)
        ownsDestination = true
        try {
          for await (const chunk of createReadStream(archivePath)) await output.writeFile(chunk)
          await output.sync()
        } finally {
          await output.close()
        }
        reauthorize()
        transactions.run((context) => {
          reauthorize()
          const deployment = installations.get()
          if (!deployment || deployment.id !== metadata.installationId)
            throw new Rejected('UNAVAILABLE')
          audit.insert(context.connection, {
            id: context.newEntityId(),
            installationId: deployment.id,
            userId: actor.user.id,
            action: parseAuditActionCode('BACKUP_CREATED'),
            entityType: parseAuditEntityType('INSTALLATION'),
            entityId: deployment.id,
            occurredAt: context.nowUtc(),
            metadata: {
              format_version: metadata.formatVersion,
              schema_version: metadata.schemaVersion
            }
          })
        })
        ownsDestination = false
        return { status: 'SAVED', metadata }
      }
      try {
        metadata = await decryptBackup(
          selected,
          join(workspace, 'payload'),
          snapshotPath,
          parsed.data.password
        )
        verifyBackupMetadata(snapshotPath, metadata)
      } catch (error) {
        if (error instanceof UnsupportedBackupError) throw error
        throw new InvalidBackupError()
      }
      reauthorize()
      if (kind === 'prepareRestore') {
        assertLocalRestoreAllowed(connection, metadata.installationId)
        assertSnapshotRestoreAllowed(snapshotPath, metadata.installationId)
        const token = randomUUID()
        preview = {
          token,
          workspace,
          metadata,
          userId: actor.user.id,
          authenticatedAt: actor.authenticatedAt,
          expiresAt: Date.now() + 10 * 60_000
        }
        workspace = undefined
        expiry = setTimeout(() => {
          try {
            discard()
          } catch {
            /* Startup also cleans abandoned scratch. */
          }
        }, 10 * 60_000)
        expiry.unref()
        return { status: 'RESTORE_READY', token, metadata }
      }
      return { status: 'VERIFIED', metadata }
    } catch (error) {
      if (kind === 'restore') {
        try {
          discard()
        } catch {
          /* Startup cleans scratch. */
        }
      }
      if (error instanceof RestoreRejected) return { status: error.status }
      if (error instanceof Rejected) return { status: error.status }
      if (
        error instanceof LocalSessionUnauthenticatedError ||
        error instanceof LocalSessionLockedError ||
        error instanceof LocalSessionPasswordChangeRequiredError
      )
        return { status: 'AUTHENTICATION_REQUIRED' }
      if (error instanceof LocalSessionAuthorizationError) return { status: 'FORBIDDEN' }
      if (error instanceof UnsupportedBackupError) return { status: 'UNSUPPORTED_BACKUP' }
      if (error instanceof InvalidBackupError) return { status: 'INVALID_BACKUP' }
      if (kind === 'create' && isFileExistsError(error)) return { status: 'DESTINATION_EXISTS' }
      return { status: 'UNAVAILABLE' }
    } finally {
      try {
        if (ownsDestination && destination) await rm(destination, { force: true })
      } finally {
        try {
          if (workspace) await rm(workspace, { recursive: true, force: true })
        } finally {
          if (ownsOperation) busy = false
        }
      }
    }
  }
  return Object.freeze({
    create: (request: BackupRequest) => run('create', request),
    inspect: (request: BackupRequest) => run('inspect', request),
    prepareRestore: (request: BackupRequest) => run('prepareRestore', request),
    restore: (request: RestoreCommitRequest) => run('restore', request),
    discardRestore: (request: RestoreTokenRequest) => run('discardRestore', request)
  })
}
function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
