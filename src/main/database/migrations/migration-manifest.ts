import { computeMigrationChecksum } from './migration-checksum'
import type { DatabaseMigration, ResolvedDatabaseMigration } from './migration-types'
import initialSchemaSql from './sql/0001-initial-schema.sql?raw'
import patientRegistryManagementSql from './sql/0002-patient-registry-management.sql?raw'
import patientDemographicAmendmentHistorySql from './sql/0003-patient-demographic-amendment-history.sql?raw'

export const targetSchemaVersion = 3

const initialSchemaMigration = Object.freeze({
  version: 1,
  name: 'initial-schema',
  sql: initialSchemaSql
} satisfies DatabaseMigration)

const patientRegistryManagementMigration = Object.freeze({
  version: 2,
  name: 'patient-registry-management',
  sql: patientRegistryManagementSql
} satisfies DatabaseMigration)

const patientDemographicAmendmentHistoryMigration = Object.freeze({
  version: 3,
  name: 'patient-demographic-amendment-history',
  sql: patientDemographicAmendmentHistorySql
} satisfies DatabaseMigration)

export const databaseMigrations = Object.freeze([
  initialSchemaMigration,
  patientRegistryManagementMigration,
  patientDemographicAmendmentHistoryMigration
] as const)

export function resolveDatabaseMigrations(
  migrations: readonly DatabaseMigration[]
): readonly ResolvedDatabaseMigration[] {
  return migrations.map((migration) => ({
    ...migration,
    checksum: computeMigrationChecksum(migration.sql)
  }))
}
