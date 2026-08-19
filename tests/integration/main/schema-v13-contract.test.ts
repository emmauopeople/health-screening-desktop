import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { MigrationCompatibilityError } from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import {
  foodCatalogSeedRows,
  validateSchemaVersion13
} from '@main/database/migrations/schema-v13-contract'

const now = '2026-08-10T12:00:00.000Z'
const ids = Object.freeze({
  installation: 'a1000000-0000-4000-8000-000000000001',
  user: 'a1000000-0000-4000-8000-000000000002',
  location: 'a1000000-0000-4000-8000-000000000003',
  session: 'a1000000-0000-4000-8000-000000000004',
  patient: 'a1000000-0000-4000-8000-000000000005',
  encounter: 'a1000000-0000-4000-8000-000000000006',
  foodLog: 'a1000000-0000-4000-8000-000000000007',
  draft: 'a1000000-0000-4000-8000-000000000008',
  row: 'a1000000-0000-4000-8000-000000000009'
})

describe('schema version 13 Food draft foundation contract', () => {
  it('accepts fresh schema version 13 databases with exact catalog seed and clean integrity', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 13)

      expect(() => validateSchemaVersion13(connection, 'compatibility')).not.toThrow()
      expect(readCatalogSeed(connection)).toEqual(
        foodCatalogSeedRows.map(([code, displayName, normalizedSearchName, sortOrder]) => ({
          code,
          display_name: displayName,
          normalized_search_name: normalizedSearchName,
          is_active: 1,
          sort_order: sortOrder
        }))
      )
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('upgrades v12 databases and preserves existing food_logs rows unchanged', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      seedFoodLogGraph(connection)
      const before = readFoodLog(connection)

      migrateToVersion(connection, 13)

      expect(readFoodLog(connection)).toEqual(before)
      expect(() => validateSchemaVersion13(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it.each([
    [
      'missing Food foreign key',
      (sql: string) =>
        sql.replace(
          /,\r?\n[ ]{2}CONSTRAINT fk_food_draft_rows_catalog FOREIGN KEY \(catalog_code\)\r?\n[ ]{4}REFERENCES food_catalog_items \(code\) ON UPDATE RESTRICT ON DELETE RESTRICT/u,
          ''
        )
    ],
    [
      'missing Food draft created_by foreign key',
      (sql: string) => removeConstraint(sql, 'fk_food_drafts_created_by')
    ],
    [
      'missing Food draft updated_by foreign key',
      (sql: string) => removeConstraint(sql, 'fk_food_drafts_updated_by')
    ],
    [
      'missing Food row created_by foreign key',
      (sql: string) => removeConstraint(sql, 'fk_food_draft_rows_created_by')
    ],
    [
      'missing Food row updated_by foreign key',
      (sql: string) => removeConstraint(sql, 'fk_food_draft_rows_updated_by')
    ],
    [
      'altered foreign-key target or delete/update action',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'fk_food_drafts_created_by',
          'ON UPDATE RESTRICT ON DELETE RESTRICT',
          'ON UPDATE CASCADE ON DELETE RESTRICT'
        )
    ],
    [
      'extra Food foreign key',
      (sql: string) =>
        sql.replace(
          'CONSTRAINT ux_food_draft_rows_sequence UNIQUE (food_draft_id, sequence_number)',
          'CONSTRAINT fk_food_draft_rows_extra FOREIGN KEY (updated_by)\n    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,\n  CONSTRAINT ux_food_draft_rows_sequence UNIQUE (food_draft_id, sequence_number)'
        )
    ],
    [
      'missing unique encounter constraint',
      (sql: string) =>
        sql.replace('encounter_id TEXT NOT NULL UNIQUE', 'encounter_id TEXT NOT NULL')
    ],
    [
      'removed period-start calendar check',
      (sql: string) =>
        sql.replace(
          "AND period_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'",
          'AND 1 = 1'
        )
    ],
    [
      'removed period-end calendar check',
      (sql: string) =>
        sql.replace("AND period_end GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'", 'AND 1 = 1')
    ],
    [
      'altered period-start 30-day-month result',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_start_date',
          'WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30',
          'WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 31'
        )
    ],
    [
      'altered period-end 30-day-month result',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_end_date',
          'WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30',
          'WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 31'
        )
    ],
    [
      'altered 31-day-month list',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_start_date',
          'IN (1, 3, 5, 7, 8, 10, 12) THEN 31',
          'IN (1, 3, 5, 7, 10, 12) THEN 31'
        )
    ],
    [
      'altered 30-day-month list',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_end_date',
          'IN (4, 6, 9, 11) THEN 30',
          'IN (4, 6, 8, 9, 11) THEN 30'
        )
    ],
    [
      'altered leap-year February result',
      (sql: string) =>
        replaceWithinConstraint(sql, 'ck_food_drafts_period_start_date', ') THEN 29', ') THEN 28')
    ],
    [
      'altered non-leap February result',
      (sql: string) =>
        replaceWithinConstraint(sql, 'ck_food_drafts_period_end_date', 'ELSE 28', 'ELSE 29')
    ],
    [
      'altered leap-year modulo-400 condition',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_start_date',
          'CAST(substr(period_start, 1, 4) AS INTEGER) % 400 = 0',
          'CAST(substr(period_start, 1, 4) AS INTEGER) % 400 != 0'
        )
    ],
    [
      'altered leap-year modulo-4-or-100 condition',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'ck_food_drafts_period_end_date',
          'CAST(substr(period_end, 1, 4) AS INTEGER) % 100 != 0',
          'CAST(substr(period_end, 1, 4) AS INTEGER) % 100 = 0'
        )
    ],
    [
      'altered catalog timestamp constraint',
      (sql: string) =>
        sql.replace(
          'CONSTRAINT ck_food_catalog_items_updated_at CHECK (updated_at >= created_at)',
          'CONSTRAINT ck_food_catalog_items_updated_at CHECK (updated_at >= updated_at)'
        )
    ],
    [
      'altered draft timestamp constraint',
      (sql: string) =>
        sql.replace(
          'CONSTRAINT ck_food_drafts_updated_at CHECK (updated_at >= created_at)',
          'CONSTRAINT ck_food_drafts_updated_at CHECK (updated_at > created_at)'
        )
    ],
    [
      'altered row timestamp constraint',
      (sql: string) =>
        sql.replace(
          'CONSTRAINT ck_food_draft_rows_updated_at CHECK (updated_at >= created_at)',
          'CONSTRAINT ck_food_draft_rows_updated_at CHECK (updated_at > created_at)'
        )
    ],
    [
      'timestamp constraint moved out of its proper Food table',
      (sql: string) =>
        moveConstraint(sql, 'ck_food_catalog_items_updated_at', 'ck_food_drafts_period_dates')
    ],
    [
      'required Food row constraint moved out of food_draft_rows',
      (sql: string) =>
        moveConstraint(
          sql,
          'ck_food_draft_rows_updated_at',
          'ux_food_catalog_items_normalized_search_name'
        )
    ],
    [
      'required Food draft constraint moved out of food_drafts',
      (sql: string) =>
        moveConstraint(
          sql,
          'ck_food_drafts_updated_at',
          'ux_food_catalog_items_normalized_search_name'
        )
    ],
    ['altered response code', (sql: string) => sql.replace("'PREFER_NOT_TO_ANSWER'", "'REFUSED'")],
    [
      'extra response code',
      (sql: string) =>
        sql.replace("'PREFER_NOT_TO_ANSWER')", "'PREFER_NOT_TO_ANSWER', 'NO_FOOD_REPORTED')")
    ],
    [
      'altered frequency code',
      (sql: string) => sql.replace("'2_TO_3_DAYS'", "'TWO_TO_THREE_DAYS'")
    ],
    [
      'extra frequency code',
      (sql: string) =>
        sql
          .replace("'EVERY_DAY')", "'EVERY_DAY', 'UNKNOWN')")
          .replace("'EVERY_DAY')", "'EVERY_DAY')")
    ],
    [
      'removed duplicate-food protection',
      (sql: string) =>
        sql.replace(
          /,\r?\n[ ]{2}CONSTRAINT ux_food_draft_rows_normalized_name UNIQUE \(food_draft_id, food_name_normalized\)/u,
          ''
        )
    ],
    [
      'removed text constraint',
      (sql: string) => sql.replace("TRIM(food_name_snapshot) != ''", '1 = 1')
    ],
    [
      'altered catalog seed code',
      (sql: string) => sql.replace("'RICE', 'Rice'", "'WHITE_RICE', 'Rice'")
    ],
    [
      'missing index',
      (sql: string) =>
        sql.replace(
          /CREATE INDEX ix_food_drafts_patient\r?\n[ ]{2}ON food_drafts \(patient_id\);\r?\n/u,
          ''
        )
    ]
  ])('rejects %s', async (_caseName, transform) => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 12)
      const originalMigrationSql = databaseMigrations[12]!.sql
      const mutatedMigrationSql = transform(originalMigrationSql)
      expect(mutatedMigrationSql).not.toBe(originalMigrationSql)
      connection.exec(mutatedMigrationSql)

      expect(() => validateSchemaVersion13(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('rejects inherited v12 constraint regression', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 11)
      connection.exec(
        databaseMigrations[11]!.sql.replace("TRIM(description) != ''", "description != ''")
      )
      connection.exec(databaseMigrations[12]!.sql)

      expect(() => validateSchemaVersion13(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('enforces Food SQL constraints for response, frequency, duplicate names, text, and catalog', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 13)
      seedFoodDraftGraph(connection)

      expect(() =>
        insertDraftRow(connection, { id: ids.row, normalizedName: 'rice' })
      ).not.toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'a1000000-0000-4000-8000-000000000010',
          sequenceNumber: 2,
          normalizedName: 'rice'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'a1000000-0000-4000-8000-000000000011',
          sequenceNumber: 3,
          normalizedName: 'RICE'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'a1000000-0000-4000-8000-000000000012',
          sequenceNumber: 4,
          frequencyCode: 'WEEKLY'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'a1000000-0000-4000-8000-000000000013',
          sequenceNumber: 5,
          catalogCode: 'OTHER'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'a1000000-0000-4000-8000-000000000014',
          sequenceNumber: 6,
          foodName: ' ',
          normalizedName: 'blank'
        })
      ).toThrow()
      expect(() =>
        connection
          .prepare("UPDATE food_drafts SET food_response = 'NO_FOOD_REPORTED' WHERE id = ?")
          .run(ids.draft)
      ).toThrow()
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd047-schema-v13-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    connection.pragma('journal_mode = WAL')
    connection.pragma('synchronous = NORMAL')
    connection.pragma('busy_timeout = 5000')
    connection.pragma('trusted_schema = OFF')
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToVersion(connection: Database.Database, version: 11 | 12 | 13): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}

function removeConstraint(sql: string, constraintName: string): string {
  return replaceRequiredRegex(
    sql,
    new RegExp(
      `,\\r?\\n[ ]{2}CONSTRAINT ${constraintName}\\b[\\s\\S]*?(?=,\\r?\\n[ ]{2}CONSTRAINT|\\r?\\n\\) STRICT;)`,
      'u'
    ),
    ''
  )
}

function replaceWithinConstraint(
  sql: string,
  constraintName: string,
  search: string,
  replacement: string
): string {
  return replaceRequiredRegex(
    sql,
    new RegExp(
      `CONSTRAINT ${constraintName}\\b[\\s\\S]*?(?=,\\r?\\n[ ]{2}CONSTRAINT|\\r?\\n\\) STRICT;)`,
      'u'
    ),
    (constraint) => replaceRequired(constraint, search, replacement)
  )
}

function moveConstraint(sql: string, constraintName: string, targetConstraintName: string): string {
  const constraint = extractConstraint(sql, constraintName)
  const withoutConstraint = removeConstraint(sql, constraintName)
  return replaceRequired(
    withoutConstraint,
    `  CONSTRAINT ${targetConstraintName}`,
    `  ${constraint},\n  CONSTRAINT ${targetConstraintName}`
  )
}

function extractConstraint(sql: string, constraintName: string): string {
  const match = new RegExp(
    `,\\r?\\n[ ]{2}(CONSTRAINT ${constraintName}\\b[\\s\\S]*?)(?=,\\r?\\n[ ]{2}CONSTRAINT|\\r?\\n\\) STRICT;)`,
    'u'
  ).exec(sql)
  if (match?.[1] === undefined) throw new Error(`Expected ${constraintName} to exist`)
  return match[1]
}

function replaceRequired(sql: string, search: string, replacement: string): string {
  if (!sql.includes(search)) throw new Error(`Expected SQL to contain ${search}`)
  const next = sql.replace(search, replacement)
  if (next === sql) throw new Error(`Expected SQL replacement for ${search}`)
  return next
}

function replaceRequiredRegex(
  sql: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string)
): string {
  const next = sql.replace(pattern, replacement as string)
  if (next === sql) throw new Error(`Expected SQL replacement for ${pattern.source}`)
  return next
}

function readCatalogSeed(connection: Database.Database): readonly Record<string, unknown>[] {
  return connection
    .prepare(
      'SELECT code, display_name, normalized_search_name, is_active, sort_order FROM food_catalog_items ORDER BY sort_order, code'
    )
    .all() as readonly Record<string, unknown>[]
}

function seedFoodLogGraph(connection: Database.Database): void {
  seedCoreGraph(connection, ids.encounter, 'COMPLETED')
  connection
    .prepare(
      'INSERT INTO food_logs (id, encounter_id, food_code, food_name, food_name_normalized, frequency_code, notes, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.foodLog,
      ids.encounter,
      'RICE',
      'Rice',
      'rice',
      'EVERY_DAY',
      'Existing note',
      'PATIENT_REPORTED',
      ids.user,
      now
    )
}

function seedFoodDraftGraph(connection: Database.Database): void {
  seedCoreGraph(connection, ids.encounter, 'DRAFT')
  connection
    .prepare(
      'INSERT INTO food_drafts (id, encounter_id, patient_id, screening_session_id, location_id, installation_id, period_start, period_end, food_response, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      ids.draft,
      ids.encounter,
      ids.patient,
      ids.session,
      ids.location,
      ids.installation,
      '2026-08-04',
      '2026-08-10',
      'REPORTED',
      ids.user,
      now,
      ids.user,
      now
    )
}

function seedCoreGraph(
  connection: Database.Database,
  encounterId: string,
  encounterStatus: 'DRAFT' | 'COMPLETED'
): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.user, 'tester', 'tester', 'Test User', 'hash', 'salt', 'TRAINED_SCREENER', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.location,
      'Test Location',
      'test location',
      'COMMUNITY_SITE',
      ids.user,
      now,
      ids.user,
      now
    )
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as { id: string }
  ).id
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.patient,
      'TEST-1',
      'Test Patient',
      'test patient',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      ids.session,
      ids.location,
      protocolId,
      '2026-08-10',
      'OPEN',
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounterId,
      ids.patient,
      ids.session,
      ids.location,
      protocolId,
      encounterStatus,
      now,
      encounterStatus === 'COMPLETED' ? now : null,
      'LOCAL',
      ids.user,
      now,
      now
    )
}

function insertDraftRow(
  connection: Database.Database,
  overrides: {
    id?: string
    sequenceNumber?: number
    catalogCode?: string | null
    foodName?: string
    normalizedName?: string
    frequencyCode?: string | null
  } = {}
): void {
  connection
    .prepare(
      'INSERT INTO food_draft_rows (id, food_draft_id, sequence_number, catalog_code, food_name_snapshot, food_name_normalized, frequency_code, preparation_note, source_type, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)'
    )
    .run(
      overrides.id ?? ids.row,
      ids.draft,
      overrides.sequenceNumber ?? 1,
      overrides.catalogCode ?? 'RICE',
      overrides.foodName ?? 'Rice',
      overrides.normalizedName ?? 'rice',
      overrides.frequencyCode ?? 'EVERY_DAY',
      'PATIENT_REPORTED',
      ids.user,
      now,
      ids.user,
      now
    )
}

function readFoodLog(connection: Database.Database): Record<string, unknown> {
  return connection.prepare('SELECT * FROM food_logs WHERE id = ?').get(ids.foodLog) as Record<
    string,
    unknown
  >
}
