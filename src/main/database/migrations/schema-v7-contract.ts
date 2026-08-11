import type { DatabaseSchemaValidationMode, MigrationConnection } from './migration-types'
import {
  schemaVersion6NamedIndexes,
  schemaVersion6TableContracts,
  schemaVersion6TableNames,
  schemaVersion6TriggerNames,
  validateSchemaVersion6
} from './schema-v6-contract'

export const schemaVersion7TableContracts = schemaVersion6TableContracts
export const schemaVersion7TableNames = schemaVersion6TableNames
export const schemaVersion7TriggerNames = schemaVersion6TriggerNames
export const schemaVersion7NamedIndexes = schemaVersion6NamedIndexes

export function validateSchemaVersion7(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion6(connection, mode)
}
