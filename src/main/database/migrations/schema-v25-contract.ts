import { validateSchemaVersion21 } from './schema-v21-contract'
import historySql from './sql/0025-encounter-history-sync.sql?raw'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'

export function validateSchemaVersion25(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  const required = [
    'screening_encounter_review_status_history',
    'tr_screening_encounter_addenda_sync',
    'tr_screening_encounter_review_flags_sync',
    'tr_screening_encounter_review_status_history_sync',
    'tr_review_flag_open_history',
    'tr_review_flag_close_history',
    'tr_review_flag_origin_immutable',
    'tr_review_flag_no_delete',
    'tr_screening_encounter_addenda_no_update',
    'tr_screening_encounter_addenda_no_delete',
    'tr_screening_encounter_review_status_history_no_update',
    'tr_screening_encounter_review_status_history_no_delete'
  ]
  validateSchemaVersion21(connection, mode, { tables: [required[0]!], triggers: required.slice(1) })
  const names = new Set(
    (
      connection
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')")
        .all() as { name: string }[]
    ).map((row) => row.name)
  )
  const mapping = connection
    .prepare("SELECT sql FROM sqlite_master WHERE name='sync_transport_resource_mappings'")
    .get() as { sql?: string } | undefined
  const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').replace(/;$/, '').trim()
  const definitions = [...historySql.matchAll(/CREATE TRIGGER (\w+)[\s\S]*? END;/g)]
  const exactTriggers = definitions.every(([sql, name]) => {
    const stored = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(name) as { sql?: string } | undefined
    return typeof stored?.sql === 'string' && normalize(stored.sql) === normalize(sql)
  })
  const table = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(required[0]) as { sql?: string } | undefined
  const expectedTable = historySql.match(
    /CREATE TABLE screening_encounter_review_status_history[\s\S]*?\) STRICT;/
  )?.[0]
  const clinicalColumns = [
    ['screening_encounters', 'clinical_time'],
    ['screening_vitals_draft_readings', 'measurement_date']
  ].every(([name, column]) =>
    (
      connection.prepare(`PRAGMA table_info(${name})`).all() as { name: string; type: string }[]
    ).some((c) => c.name === column && c.type === 'TEXT')
  )
  if (
    !required.every((name) => names.has(name)) ||
    !exactTriggers ||
    definitions.length !== required.length - 1 ||
    !expectedTable ||
    !table?.sql ||
    normalize(table.sql) !== normalize(expectedTable) ||
    !clinicalColumns ||
    ![
      'PATIENT',
      'SCREENING_SESSION',
      'SCREENING_ENCOUNTER',
      'VITALS',
      'LIFESTYLE',
      'FOOD',
      'OTC',
      'REFERRAL',
      'REFERRAL_STATUS',
      'REFERRAL_FOLLOWUP',
      'ENCOUNTER_ADDENDUM',
      'ENCOUNTER_REVIEW_FLAG',
      'ENCOUNTER_REVIEW_STATUS'
    ].every((type) => mapping?.sql?.includes(`'${type}'`))
  ) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}
