import { computeMigrationChecksum } from './migration-checksum'
import type { DatabaseMigration, ResolvedDatabaseMigration } from './migration-types'
import initialSchemaSql from './sql/0001-initial-schema.sql?raw'
import patientRegistryManagementSql from './sql/0002-patient-registry-management.sql?raw'
import patientDemographicAmendmentHistorySql from './sql/0003-patient-demographic-amendment-history.sql?raw'
import screeningSessionLifecycleFoundationSql from './sql/0004-screening-session-lifecycle-foundation.sql?raw'
import screeningEncounterIdentitySql from './sql/0005-screening-encounter-identity.sql?raw'
import installationLocationConfigurationSql from './sql/0006-installation-location-configuration.sql?raw'
import baselineActiveProtocolSql from './sql/0007-baseline-active-protocol.sql?raw'
import screeningVitalsDraftsSql from './sql/0008-screening-vitals-drafts.sql?raw'
import lifestyleFoundationSql from './sql/0009-lifestyle-foundation.sql?raw'
import lifestyleActivityResponseSemanticsSql from './sql/0010-lifestyle-activity-response-semantics.sql?raw'

export const targetSchemaVersion = 10

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

const installationLocationConfigurationMigration = Object.freeze({
  version: 6,
  name: 'installation-location-configuration',
  sql: installationLocationConfigurationSql
} satisfies DatabaseMigration)

const baselineActiveProtocolMigration = Object.freeze({
  version: 7,
  name: 'baseline-active-protocol',
  sql: baselineActiveProtocolSql
} satisfies DatabaseMigration)

const screeningVitalsDraftsMigration = Object.freeze({
  version: 8,
  name: 'screening-vitals-drafts',
  sql: screeningVitalsDraftsSql
} satisfies DatabaseMigration)

const lifestyleFoundationMigration = Object.freeze({
  version: 9,
  name: 'lifestyle-foundation',
  sql: lifestyleFoundationSql
} satisfies DatabaseMigration)

const lifestyleActivityResponseSemanticsMigration = Object.freeze({
  version: 10,
  name: 'lifestyle-activity-response-semantics',
  sql: lifestyleActivityResponseSemanticsSql
} satisfies DatabaseMigration)

export const databaseMigrations = Object.freeze([
  initialSchemaMigration,
  patientRegistryManagementMigration,
  patientDemographicAmendmentHistoryMigration,
  screeningSessionLifecycleFoundationMigration,
  screeningEncounterIdentityMigration,
  installationLocationConfigurationMigration,
  baselineActiveProtocolMigration,
  screeningVitalsDraftsMigration,
  lifestyleFoundationMigration,
  lifestyleActivityResponseSemanticsMigration
] as const)

export function resolveDatabaseMigrations(
  migrations: readonly DatabaseMigration[]
): readonly ResolvedDatabaseMigration[] {
  return migrations.map((migration) => ({
    ...migration,
    checksum: computeMigrationChecksum(migration.sql)
  }))
}
