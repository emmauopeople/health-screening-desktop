import { validateSchemaVersion25 } from './schema-v25-contract'
import cacheSql from './sql/0026-central-patient-history.sql?raw'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'

export function validateSchemaVersion26(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion25(connection, mode, {
    tables: ['central_history_snapshots', 'central_history_items'],
    indexes: ['ix_central_history_expiry']
  })
  const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').replace(/;$/, '').trim()
  const definitions = [
    ...cacheSql.matchAll(/CREATE TABLE (\w+)[\s\S]*?\) STRICT;|CREATE INDEX (\w+)[\s\S]*?;/g)
  ]
  const valid =
    definitions.length === 3 &&
    definitions.every(([sql, table, index]) => {
      const stored = connection
        .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
        .get(table ? 'table' : 'index', table ?? index) as { sql?: string } | undefined
      return typeof stored?.sql === 'string' && normalize(stored.sql) === normalize(sql)
    })
  if (!valid) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}
