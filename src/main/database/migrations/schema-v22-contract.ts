import { validateSchemaVersion21 } from './schema-v21-contract'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'

export function validateSchemaVersion22(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  // The table/index/trigger catalog is unchanged; v22 expands the mapping enum.
  validateSchemaVersion21(connection, mode)
  const row = connection
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_transport_resource_mappings'"
    )
    .get() as { sql?: unknown } | undefined
  if (typeof row?.sql !== 'string' || !row.sql.includes("'FOOD'") || !row.sql.includes("'OTC'")) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}
