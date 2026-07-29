import { databaseMigrations, targetSchemaVersion } from './migration-manifest'
import { runDatabaseMigrations } from './migration-runner'
import { validateSchemaVersion1 } from './schema-v1-contract'
import type { DatabaseMigrationContext, DatabaseMigrationRunner } from './migration-types'

const productionSchemaValidators = new Map([[targetSchemaVersion, validateSchemaVersion1]])

export {
  MigrationCompatibilityError,
  MigrationExecutionError,
  MigrationManifestError,
  type DatabaseMigrationRunner,
  type DatabaseMigrationSummary
} from './migration-types'

export { targetSchemaVersion }

export function createProductionDatabaseMigrationRunner({
  applicationVersion,
  logger,
  clock
}: Omit<DatabaseMigrationContext, 'connection'>): DatabaseMigrationRunner {
  return (connection) =>
    runDatabaseMigrations({
      connection,
      migrations: databaseMigrations,
      applicationVersion,
      logger,
      clock,
      expectedHighestVersion: targetSchemaVersion,
      schemaValidators: productionSchemaValidators
    })
}
