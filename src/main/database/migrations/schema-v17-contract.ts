import type { DatabaseSchemaValidationMode, MigrationConnection } from './migration-types'
import {
  schemaVersion16NamedIndexes,
  schemaVersion16TableContracts,
  schemaVersion16TableNames,
  schemaVersion16TriggerNames,
  validateSchemaVersion16
} from './schema-v16-contract'

export const schemaVersion17TableContracts = schemaVersion16TableContracts
export const schemaVersion17TableNames = schemaVersion16TableNames
export const schemaVersion17NamedIndexes = schemaVersion16NamedIndexes
export const schemaVersion17TriggerNames = schemaVersion16TriggerNames

export function validateSchemaVersion17(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion16(connection, mode)
}
