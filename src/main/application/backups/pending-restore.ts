import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { databaseFileName, getDatabaseDirectory } from '@main/database/database-path'
import { backupMetadataSchema, type BackupMetadata } from '@shared/ipc/backup-contracts'
import { hashDatabase } from './backup-archive'
import { verifyBackupMetadata } from './backup-validation'
import { assertSnapshotRestoreAllowed } from './restore-safety'

const manifestSchema = z
  .object({
    id: z.uuid(),
    metadata: backupMetadataSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
const pendingPath = (profile: string): string => join(profile, 'restore-pending')
function flushFile(path: string): void {
  const descriptor = openSync(path, 'r+')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Publish a complete replacement and its manifest atomically on the same volume. */
export function stageRestore(
  profile: string,
  snapshot: string,
  metadata: BackupMetadata,
  sha256: string
): void {
  if (existsSync(pendingPath(profile))) throw new Error('A restore is already pending')
  const id = randomUUID()
  const stage = join(profile, 'backup-work', `restore-${id}`)
  mkdirSync(join(stage, 'data'), { recursive: true, mode: 0o700 })
  try {
    const target = join(stage, 'data', databaseFileName)
    copyFileSync(snapshot, target)
    flushFile(target)
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ id, metadata, sha256 }), {
      flag: 'wx',
      mode: 0o600
    })
    flushFile(join(stage, 'manifest.json'))
    renameSync(stage, pendingPath(profile))
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

export function cancelStagedRestore(profile: string): void {
  rmSync(pendingPath(profile), { recursive: true, force: true })
}

export interface AppliedRestore {
  recoveryPath: string
  complete(): void
  rollback(): void
}

/** Called under the single-instance lock before SQLite, installer setup, or workers open.
 * Directory existence forms a recoverable journal across either rename boundary.
 * A malformed/ambiguous journal stops startup rather than initializing an empty database.
 */
export async function applyPendingRestore(profile: string): Promise<AppliedRestore | undefined> {
  const pending = pendingPath(profile)
  if (!existsSync(pending)) return undefined
  const manifestPath = join(pending, 'manifest.json')
  if (statSync(manifestPath).size > 16_384) throw new Error('Invalid restore manifest')
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
  const live = getDatabaseDirectory(profile)
  const staged = join(pending, 'data')
  const recovery = join(profile, 'recovery', `before-restore-${manifest.id}`)
  if (existsSync(join(pending, 'rollback'))) {
    finishRollback(profile, pending, live, recovery, manifest.id)
    return undefined
  }
  const hasStage = existsSync(staged)
  const hasLive = existsSync(live)
  const hasRecovery = existsSync(recovery)
  if ((!hasStage && (!hasLive || !hasRecovery)) || (hasStage && hasLive && hasRecovery))
    throw new Error('Ambiguous restore journal')
  const candidate = join(hasStage ? staged : live, databaseFileName)
  if ((await hashDatabase(candidate)) !== manifest.sha256)
    throw new Error('Restore snapshot changed')
  verifyBackupMetadata(candidate, manifest.metadata)
  assertSnapshotRestoreAllowed(candidate, manifest.metadata.installationId)
  // Validate the original file family, including its committed WAL, before moving it.
  assertSnapshotRestoreAllowed(
    join(hasRecovery ? recovery : live, databaseFileName),
    manifest.metadata.installationId
  )
  mkdirSync(join(profile, 'recovery'), { recursive: true, mode: 0o700 })
  if (!hasRecovery) renameSync(live, recovery)
  try {
    if (hasStage) renameSync(staged, live)
  } catch (error) {
    if (!existsSync(live)) renameSync(recovery, live)
    throw error
  }
  // Finalize the journal before opening the database; the verified replacement and
  // original directory are both durable. Runtime failures use the explicit rollback.
  const receipt = join(profile, 'recovery', `restore-receipt-${manifest.id}`)
  renameSync(pending, receipt)
  let completed = false
  return {
    recoveryPath: recovery,
    complete() {
      completed = true
    },
    rollback() {
      if (completed) return
      writeFileSync(join(receipt, 'rollback'), 'ROLLBACK', { flag: 'wx', mode: 0o600 })
      flushFile(join(receipt, 'rollback'))
      renameSync(receipt, pending)
      finishRollback(profile, pending, live, recovery, manifest.id)
      completed = true
    }
  }
}

/** Rollback has its own durable marker so an interrupted rollback cannot look like a fresh installation. */
function finishRollback(
  profile: string,
  pending: string,
  live: string,
  recovery: string,
  id: string
): void {
  const failed = join(pending, 'failed-data')
  if (!existsSync(failed)) {
    if (!existsSync(live) || !existsSync(recovery)) throw new Error('Incomplete rollback journal')
    renameSync(live, failed)
  }
  if (!existsSync(live)) {
    if (!existsSync(recovery)) throw new Error('Missing rollback recovery data')
    renameSync(recovery, live)
  } else if (existsSync(recovery)) throw new Error('Ambiguous rollback journal')
  renameSync(pending, join(profile, 'recovery', `failed-restore-${id}`))
}
