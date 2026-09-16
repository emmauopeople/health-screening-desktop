import type Database from 'better-sqlite3'
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
  type BackupActionData,
  type BackupMetadata,
  type BackupRequest
} from '@shared/ipc/backup-contracts'
import {
  decryptBackup,
  encryptBackup,
  InvalidBackupError,
  UnsupportedBackupError
} from './backup-archive'
import { readBackupMetadata, verifyBackupMetadata } from './backup-validation'

export interface BackupService {
  create(request: BackupRequest): Promise<BackupActionData>
  inspect(request: BackupRequest): Promise<BackupActionData>
}
export interface BackupServiceOptions {
  connection: Database.Database
  authenticationSessionService: LocalAuthenticationSessionService
  userDataDirectory: string
  workDirectory: string
  applicationVersion: string
  chooseDestination(): Promise<string | null>
  chooseSource(): Promise<string | null>
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
  const authorize = (): ReturnType<LocalAuthenticationSessionService['requireAnyRole']> => {
    const session = auth.requireAnyRole(['LOCAL_ADMIN'])
    const user = users.getById(session.user.id)
    if (!user?.isActive || user.role !== 'LOCAL_ADMIN' || user.mustChangePassword)
      throw new Rejected('FORBIDDEN')
    return session
  }
  async function run(
    kind: 'create' | 'inspect',
    request: BackupRequest
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
      const parsed = backupRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      if (busy) return { status: 'BUSY' }
      busy = true
      ownsOperation = true
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
      return { status: 'VERIFIED', metadata }
    } catch (error) {
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
    inspect: (request: BackupRequest) => run('inspect', request)
  })
}
function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
