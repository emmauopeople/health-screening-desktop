import { computeMigrationChecksum } from './migration-checksum'
import type { DatabaseMigration, ResolvedDatabaseMigration } from './migration-types'
import initialSchemaSql from './sql/0001-initial-schema.sql?raw'

export const targetSchemaVersion = 1

const initialSchemaMigration = Object.freeze({
  version: 1,
  name: 'initial-schema',
  sql: initialSchemaSql
} satisfies DatabaseMigration)

export const databaseMigrations = Object.freeze([initialSchemaMigration] as const)

export function resolveDatabaseMigrations(
  migrations: readonly DatabaseMigration[]
): readonly ResolvedDatabaseMigration[] {
  return migrations.map((migration) => ({
    ...migration,
    checksum: computeMigrationChecksum(migration.sql)
  }))
}
