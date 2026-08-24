import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  schemaVersion15NamedIndexes,
  schemaVersion15TableContracts,
  schemaVersion15TableNames,
  schemaVersion15TriggerNames,
  validateSchemaVersion15
} from './schema-v15-contract'

const rootEncounterIdentityIndexName = 'ux_screening_encounters_root_session_patient'

export const schemaVersion16TableContracts = schemaVersion15TableContracts
export const schemaVersion16TableNames = schemaVersion15TableNames
export const schemaVersion16NamedIndexes = schemaVersion15NamedIndexes
export const schemaVersion16TriggerNames = schemaVersion15TriggerNames

export function validateSchemaVersion16(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  try {
    validateSchemaVersion15(connection, mode)
    if (!hasRepeatScreeningEncounterIdentityIndex(connection)) throw new Error()
  } catch {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function hasRepeatScreeningEncounterIdentityIndex(connection: MigrationConnection): boolean {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(rootEncounterIdentityIndexName) as { sql?: unknown } | undefined

  return (
    normalizeSchemaSql(typeof row?.sql === 'string' ? row.sql : '') ===
    normalizeSchemaSql(`
      CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
        ON screening_encounters (screening_session_id, patient_id)
        WHERE amendment_of_encounter_id IS NULL AND status = 'DRAFT'
    `)
  )
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}
