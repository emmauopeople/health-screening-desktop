import { validateSchemaVersion22 } from './schema-v22-contract'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
export function validateSchemaVersion23(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion22(connection, mode)
  for (const [table, column] of [
    ['screening_encounters', 'clinical_time'],
    ['screening_vitals_draft_readings', 'measurement_date']
  ]) {
    const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string
      type: string
    }[]
    if (!columns.some((c) => c.name === column && c.type === 'TEXT')) {
      if (mode === 'execution') throw new MigrationExecutionError()
      throw new MigrationCompatibilityError()
    }
  }
}
