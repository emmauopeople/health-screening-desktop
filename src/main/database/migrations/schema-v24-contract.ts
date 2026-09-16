import { validateSchemaVersion23 } from './schema-v23-contract'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
export function validateSchemaVersion24(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion23(connection, mode)
  const row = connection
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='sync_transport_resource_mappings'"
    )
    .get() as { sql?: string } | undefined
  if (
    !['REFERRAL', 'REFERRAL_STATUS', 'REFERRAL_FOLLOWUP'].every((type) =>
      row?.sql?.includes(`'${type}'`)
    )
  ) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}
