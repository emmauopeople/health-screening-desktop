import { computeMigrationChecksum } from './migration-checksum'
import type { DatabaseMigration, ResolvedDatabaseMigration } from './migration-types'
import initialSchemaSql from './sql/0001-initial-schema.sql?raw'
import patientRegistryManagementSql from './sql/0002-patient-registry-management.sql?raw'
import patientDemographicAmendmentHistorySql from './sql/0003-patient-demographic-amendment-history.sql?raw'
import screeningSessionLifecycleFoundationSql from './sql/0004-screening-session-lifecycle-foundation.sql?raw'
import screeningEncounterIdentitySql from './sql/0005-screening-encounter-identity.sql?raw'

export const targetSchemaVersion = 5

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

const screeningSessionLifecycleFoundationMigration = Object.freeze({
  version: 4,
  name: 'screening-session-lifecycle-foundation',
  sql: screeningSessionLifecycleFoundationSql,
  foreignKeyMode: 'disabled-during-transaction'
} satisfies DatabaseMigration)

const screeningEncounterIdentityMigration = Object.freeze({
  version: 5,
  name: 'screening-encounter-identity',
  sql: screeningEncounterIdentitySql
} satisfies DatabaseMigration)

export const databaseMigrations = Object.freeze([
  initialSchemaMigration,
  patientRegistryManagementMigration,
  patientDemographicAmendmentHistoryMigration,
  screeningSessionLifecycleFoundationMigration,
  screeningEncounterIdentityMigration
] as const)

export function resolveDatabaseMigrations(
  migrations: readonly DatabaseMigration[]
): readonly ResolvedDatabaseMigration[] {
  return migrations.map((migration) => ({
    ...migration,
    checksum: computeMigrationChecksum(migration.sql)
  }))
}
