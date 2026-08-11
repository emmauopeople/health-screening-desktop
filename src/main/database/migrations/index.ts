import { databaseMigrations, targetSchemaVersion } from './migration-manifest'
import { runDatabaseMigrations } from './migration-runner'
import { validateSchemaVersion1 } from './schema-v1-contract'
import { validateSchemaVersion2 } from './schema-v2-contract'
import { validateSchemaVersion3 } from './schema-v3-contract'
import { validateSchemaVersion4 } from './schema-v4-contract'
import { validateSchemaVersion5 } from './schema-v5-contract'
import { validateSchemaVersion6 } from './schema-v6-contract'
import { validateSchemaVersion7 } from './schema-v7-contract'
import type { DatabaseMigrationContext, DatabaseMigrationRunner } from './migration-types'

const productionSchemaValidators = new Map([
  [1, validateSchemaVersion1],
  [2, validateSchemaVersion2],
  [3, validateSchemaVersion3],
  [4, validateSchemaVersion4],
  [5, validateSchemaVersion5],
  [6, validateSchemaVersion6],
  [7, validateSchemaVersion7]
])

export {
  MigrationCompatibilityError,
  MigrationExecutionError,
  MigrationManifestError,
  type DatabaseMigrationRunner,
  type DatabaseMigrationSummary
} from './migration-types'

export { targetSchemaVersion }
export {
  schemaVersion2NamedIndexes,
  schemaVersion2TableContracts,
  schemaVersion2TableNames,
  validateSchemaVersion2
} from './schema-v2-contract'
export {
  schemaVersion3NamedIndexes,
  schemaVersion3TableContracts,
  schemaVersion3TableNames,
  schemaVersion3TriggerNames,
  validateSchemaVersion3
} from './schema-v3-contract'
export {
  schemaVersion4NamedIndexes,
  schemaVersion4TableContracts,
  schemaVersion4TableNames,
  schemaVersion4TriggerNames,
  validateSchemaVersion4
} from './schema-v4-contract'
export {
  schemaVersion5NamedIndexes,
  schemaVersion5TableContracts,
  schemaVersion5TableNames,
  schemaVersion5TriggerNames,
  validateSchemaVersion5
} from './schema-v5-contract'
export {
  schemaVersion6NamedIndexes,
  schemaVersion6TableContracts,
  schemaVersion6TableNames,
  schemaVersion6TriggerNames,
  validateSchemaVersion6
} from './schema-v6-contract'
export {
  schemaVersion7NamedIndexes,
  schemaVersion7TableContracts,
  schemaVersion7TableNames,
  schemaVersion7TriggerNames,
  validateSchemaVersion7
} from './schema-v7-contract'

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
