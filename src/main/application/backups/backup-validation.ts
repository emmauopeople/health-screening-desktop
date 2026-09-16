import Database from 'better-sqlite3'
import { backupMetadataSchema, type BackupMetadata } from '@shared/ipc/backup-contracts'
import {
  databaseMigrations,
  resolveDatabaseMigrations,
  targetSchemaVersion
} from '@main/database/migrations/migration-manifest'
import { validateSchemaVersion24 } from '@main/database/migrations/schema-v24-contract'
import { InvalidBackupError, UnsupportedBackupError } from './backup-archive'

export function readBackupMetadata(
  databasePath: string,
  createdAt: string,
  applicationVersion: string
): BackupMetadata {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('trusted_schema = OFF')
    database.pragma('query_only = ON')
    const version = database.pragma('user_version', { simple: true })
    if (version !== targetSchemaVersion) throw new UnsupportedBackupError()
    const foreignKeyViolation = database.prepare('PRAGMA foreign_key_check').get()
    if (
      database.pragma('integrity_check', { simple: true }) !== 'ok' ||
      foreignKeyViolation !== undefined
    )
      throw new InvalidBackupError()
    validateSchemaVersion24(database, 'compatibility')
    const history = database
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version LIMIT ?')
      .all(databaseMigrations.length + 1)
    const expected = resolveDatabaseMigrations(databaseMigrations).map(
      ({ version, name, checksum }) => ({ version, name, checksum })
    )
    if (JSON.stringify(history) !== JSON.stringify(expected)) throw new InvalidBackupError()
    const installation = database
      .prepare('SELECT id, deployment_name, timezone FROM installation')
      .all() as { id: string; deployment_name: string; timezone: string }[]
    if (installation.length !== 1) throw new InvalidBackupError()
    const row = installation[0]!
    const count = (table: 'patients' | 'screening_encounters' | 'referrals' | 'users'): number =>
      (database.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total
    return backupMetadataSchema.parse({
      formatVersion: 1,
      createdAt,
      applicationVersion,
      schemaVersion: version,
      installationId: row.id,
      deploymentName: row.deployment_name,
      timeZone: row.timezone,
      counts: {
        patients: count('patients'),
        encounters: count('screening_encounters'),
        referrals: count('referrals'),
        users: count('users')
      },
      credentialScope: 'ORIGINAL_OS_PROFILE'
    })
  } finally {
    database.close()
  }
}
export function verifyBackupMetadata(databasePath: string, metadata: BackupMetadata): void {
  const actual = readBackupMetadata(databasePath, metadata.createdAt, metadata.applicationVersion)
  if (JSON.stringify(actual) !== JSON.stringify(metadata)) throw new InvalidBackupError()
}
