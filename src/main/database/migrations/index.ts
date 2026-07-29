import { databaseMigrations, targetSchemaVersion } from './migration-manifest'
import { runDatabaseMigrations } from './migration-runner'
import type { DatabaseMigrationContext, DatabaseMigrationRunner } from './migration-types'

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
      expectedHighestVersion: targetSchemaVersion
    })
}
