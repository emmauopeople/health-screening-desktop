import { computeMigrationChecksum } from './migration-checksum'
import type { DatabaseMigration, ResolvedDatabaseMigration } from './migration-types'
import initialSchemaSql from './sql/0001-initial-schema.sql?raw'
import patientRegistrySql from './sql/0002-patient-registry.sql?raw'

export const targetSchemaVersion = 2

const initialSchemaMigration = Object.freeze({
  version: 1,
  name: 'initial-schema',
  sql: initialSchemaSql
} satisfies DatabaseMigration)

const patientRegistryMigration = Object.freeze({
  version: 2,
  name: 'patient-registry',
  sql: patientRegistrySql
} satisfies DatabaseMigration)

export const databaseMigrations = Object.freeze([
  initialSchemaMigration,
  patientRegistryMigration
] as const)

export function resolveDatabaseMigrations(
  migrations: readonly DatabaseMigration[]
): readonly ResolvedDatabaseMigration[] {
  return migrations.map((migration) => ({
    ...migration,
    checksum: computeMigrationChecksum(migration.sql)
  }))
}
