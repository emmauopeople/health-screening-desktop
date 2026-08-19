import { databaseMigrations, targetSchemaVersion } from './migration-manifest'
import { runDatabaseMigrations } from './migration-runner'
import { validateSchemaVersion1 } from './schema-v1-contract'
import { validateSchemaVersion2 } from './schema-v2-contract'
import { validateSchemaVersion3 } from './schema-v3-contract'
import { validateSchemaVersion4 } from './schema-v4-contract'
import { validateSchemaVersion5 } from './schema-v5-contract'
import { validateSchemaVersion6 } from './schema-v6-contract'
import { validateSchemaVersion7 } from './schema-v7-contract'
import { validateSchemaVersion8 } from './schema-v8-contract'
import { validateSchemaVersion9 } from './schema-v9-contract'
import { validateSchemaVersion10 } from './schema-v10-contract'
import { validateSchemaVersion11 } from './schema-v11-contract'
import { validateSchemaVersion12 } from './schema-v12-contract'
import { validateSchemaVersion13 } from './schema-v13-contract'
import type { DatabaseMigrationContext, DatabaseMigrationRunner } from './migration-types'

const productionSchemaValidators = new Map([
  [1, validateSchemaVersion1],
  [2, validateSchemaVersion2],
  [3, validateSchemaVersion3],
  [4, validateSchemaVersion4],
  [5, validateSchemaVersion5],
  [6, validateSchemaVersion6],
  [7, validateSchemaVersion7],
  [8, validateSchemaVersion8],
  [9, validateSchemaVersion9],
  [10, validateSchemaVersion10],
  [11, validateSchemaVersion11],
  [12, validateSchemaVersion12],
  [13, validateSchemaVersion13]
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
export {
  schemaVersion8NamedIndexes,
  schemaVersion8TableContracts,
  schemaVersion8TableNames,
  schemaVersion8TriggerNames,
  validateSchemaVersion8
} from './schema-v8-contract'
export {
  schemaVersion9NamedIndexes,
  schemaVersion9TableContracts,
  schemaVersion9TableNames,
  schemaVersion9TriggerNames,
  validateSchemaVersion9
} from './schema-v9-contract'
export {
  schemaVersion10NamedIndexes,
  schemaVersion10TableContracts,
  schemaVersion10TableNames,
  schemaVersion10TriggerNames,
  hasSchemaVersion10RequiredResponseChecks,
  validateSchemaVersion10
} from './schema-v10-contract'
export {
  schemaVersion11NamedIndexes,
  schemaVersion11TableContracts,
  schemaVersion11TableNames,
  schemaVersion11TriggerNames,
  validateSchemaVersion11
} from './schema-v11-contract'
export {
  schemaVersion12NamedIndexes,
  schemaVersion12TableContracts,
  schemaVersion12TableNames,
  schemaVersion12TriggerNames,
  validateSchemaVersion12
} from './schema-v12-contract'
export {
  foodCatalogSeedRows,
  schemaVersion13NamedIndexes,
  schemaVersion13TableContracts,
  schemaVersion13TableNames,
  schemaVersion13TriggerNames,
  validateSchemaVersion13
} from './schema-v13-contract'

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
