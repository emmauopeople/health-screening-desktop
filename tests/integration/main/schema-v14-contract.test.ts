import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { MigrationCompatibilityError } from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion14 } from '@main/database/migrations/schema-v14-contract'

const now = '2026-08-10T12:00:00.000Z'
const ids = Object.freeze({
  installation: 'f1000000-0000-4000-8000-000000000001',
  user: 'f1000000-0000-4000-8000-000000000002',
  location: 'f1000000-0000-4000-8000-000000000003',
  session: 'f1000000-0000-4000-8000-000000000004',
  patient: 'f1000000-0000-4000-8000-000000000005',
  encounter: 'f1000000-0000-4000-8000-000000000006',
  otcLog: 'f1000000-0000-4000-8000-000000000007',
  draft: 'f1000000-0000-4000-8000-000000000008',
  row: 'f1000000-0000-4000-8000-000000000009'
})

describe('schema version 14 OTC draft foundation contract', () => {
  it('accepts fresh schema version 14 databases with clean integrity', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 14)

      expect(() => validateSchemaVersion14(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('upgrades v13 databases and preserves existing otc_medication_logs rows unchanged', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 13)
      seedOtcLogGraph(connection)
      const before = readOtcLog(connection)

      migrateToVersion(connection, 14)

      expect(readOtcLog(connection)).toEqual(before)
      expect(() => validateSchemaVersion14(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it.each([
    [
      'missing OTC draft created_by foreign key',
      (sql: string) => removeConstraint(sql, 'fk_otc_drafts_created_by')
    ],
    [
      'altered OTC row parent foreign key action',
      (sql: string) =>
        replaceWithinConstraint(
          sql,
          'fk_otc_draft_rows_parent',
          'ON UPDATE RESTRICT ON DELETE RESTRICT',
          'ON UPDATE CASCADE ON DELETE RESTRICT'
        )
    ],
    [
      'extra OTC row foreign key',
      (sql: string) =>
        sql.replace(
          'CONSTRAINT ux_otc_draft_rows_sequence UNIQUE (otc_draft_id, sequence_number)',
          'CONSTRAINT fk_otc_draft_rows_extra FOREIGN KEY (updated_by)\n    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,\n  CONSTRAINT ux_otc_draft_rows_sequence UNIQUE (otc_draft_id, sequence_number)'
        )
    ],
    [
      'missing OTC draft index',
      (sql: string) =>
        replaceRequiredRegex(
          sql,
          /CREATE INDEX ix_otc_drafts_patient\r?\n[ ]{2}ON otc_drafts \(patient_id\);\r?\n/u,
          ''
        )
    ],
    [
      'extra OTC index',
      (sql: string) => `${sql}\nCREATE INDEX ix_otc_drafts_extra ON otc_drafts (updated_at);\n`
    ],
    [
      'altered OTC response code',
      (sql: string) => replaceRequired(sql, "'NONE_REPORTED'", "'NO_OTC_REPORTED'")
    ],
    [
      'extra OTC response code',
      (sql: string) =>
        replaceRequired(sql, "'PREFER_NOT_TO_ANSWER')", "'PREFER_NOT_TO_ANSWER', 'REFUSED')")
    ],
    [
      'altered currently-taking code',
      (sql: string) => replaceRequired(sql, "'YES', 'NO', 'UNKNOWN'", "'YES', 'NO', 'UNSURE'")
    ],
    [
      'removed period-start calendar check',
      (sql: string) =>
        replaceRequired(
          sql,
          "AND period_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'",
          'AND 1 = 1'
        )
    ],
    [
      'altered period-end leap-year calculation',
      (sql: string) =>
        replaceWithinConstraint(sql, 'ck_otc_drafts_period_end_date', ') THEN 29', ') THEN 28')
    ],
    [
      'altered draft timestamp constraint',
      (sql: string) =>
        replaceRequired(
          sql,
          'CONSTRAINT ck_otc_drafts_updated_at CHECK (updated_at >= created_at)',
          'CONSTRAINT ck_otc_drafts_updated_at CHECK (updated_at > created_at)'
        )
    ],
    [
      'altered row timestamp constraint',
      (sql: string) =>
        replaceRequired(
          sql,
          'CONSTRAINT ck_otc_draft_rows_updated_at CHECK (updated_at >= created_at)',
          'CONSTRAINT ck_otc_draft_rows_updated_at CHECK (updated_at > created_at)'
        )
    ],
    [
      'moved draft constraint out of otc_drafts',
      (sql: string) =>
        moveConstraint(sql, 'ck_otc_drafts_updated_at', 'ck_otc_draft_rows_updated_at')
    ],
    [
      'moved row constraint out of otc_draft_rows',
      (sql: string) =>
        moveConstraint(sql, 'ck_otc_draft_rows_updated_at', 'ck_otc_drafts_updated_at')
    ],
    [
      'removed product text constraint',
      (sql: string) => replaceRequired(sql, "TRIM(product_name_snapshot) != ''", '1 = 1')
    ],
    [
      'additional narrowing OTC parent response check',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_drafts',
          "CONSTRAINT ck_otc_drafts_response_narrow CHECK (otc_response <> 'UNKNOWN')"
        )
    ],
    [
      'additional narrowing currently-taking response check',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_draft_rows',
          "CONSTRAINT ck_otc_draft_rows_currently_taking_narrow CHECK (currently_taking_response <> 'UNKNOWN')"
        )
    ],
    [
      'extra OTC row unique constraint',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_draft_rows',
          'CONSTRAINT ux_otc_draft_rows_product_name UNIQUE (otc_draft_id, product_name_normalized)'
        )
    ],
    [
      'additional product-name restriction',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_draft_rows',
          'CONSTRAINT ck_otc_draft_rows_product_name_narrow CHECK (product_name_snapshot IS NULL OR length(product_name_snapshot) >= 2)'
        )
    ],
    [
      'additional reason-for-use restriction',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_draft_rows',
          'CONSTRAINT ck_otc_draft_rows_reason_narrow CHECK (reason_for_use IS NULL OR length(reason_for_use) >= 2)'
        )
    ],
    [
      'changed OTC response default',
      (sql: string) =>
        replaceRequired(
          sql,
          'otc_response TEXT NULL CHECK',
          "otc_response TEXT NULL DEFAULT 'UNKNOWN' CHECK"
        )
    ],
    [
      'altered OTC normalized-name collation',
      (sql: string) => replaceRequired(sql, 'COLLATE NOCASE', 'COLLATE RTRIM')
    ],
    [
      'copied constraint into the wrong OTC table',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_drafts',
          'CONSTRAINT ck_otc_draft_rows_updated_at_copy CHECK (updated_at >= created_at)'
        )
    ],
    [
      'narrowed nullable partial-row contract',
      (sql: string) =>
        addTableConstraint(
          sql,
          'otc_draft_rows',
          'CONSTRAINT ck_otc_draft_rows_partial_narrow CHECK (product_name_snapshot IS NULL OR length(product_name_snapshot) >= 2)'
        )
    ],
    [
      'removed inherited Food duplicate protection',
      () =>
        databaseMigrations[12]!.sql.replace(
          /,\r?\n[ ]{2}CONSTRAINT ux_food_draft_rows_normalized_name UNIQUE \(food_draft_id, food_name_normalized\)/u,
          ''
        )
    ]
  ])('rejects %s', async (_caseName, transform) => {
    await withDatabase((connection) => {
      if (_caseName === 'removed inherited Food duplicate protection') {
        migrateToVersion(connection, 12)
        const mutatedV13Sql = transform(databaseMigrations[12]!.sql)
        expect(mutatedV13Sql).not.toBe(databaseMigrations[12]!.sql)
        connection.exec(mutatedV13Sql)
        connection.exec(databaseMigrations[13]!.sql)
      } else {
        migrateToVersion(connection, 13)
        const originalMigrationSql = databaseMigrations[13]!.sql
        const mutatedMigrationSql = transform(originalMigrationSql)
        expect(mutatedMigrationSql).not.toBe(originalMigrationSql)
        connection.exec(mutatedMigrationSql)
      }

      expect(() => validateSchemaVersion14(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('enforces OTC SQL constraints for response, dates, nullable partial rows, text, and row ownership', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 14)
      seedOtcDraftGraph(connection)

      expect(() => insertDraftRow(connection, { reasonForUse: 'headache' })).not.toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'f1000000-0000-4000-8000-000000000010',
          sequenceNumber: 2,
          productName: null,
          normalizedName: 'pain reliever'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'f1000000-0000-4000-8000-000000000011',
          sequenceNumber: 3,
          productName: ' ',
          normalizedName: 'blank'
        })
      ).toThrow()
      expect(() =>
        insertDraftRow(connection, {
          id: 'f1000000-0000-4000-8000-000000000012',
          sequenceNumber: 4,
          currentlyTakingResponse: 'MAYBE'
        })
      ).toThrow()
      expect(() =>
        connection.prepare("UPDATE otc_drafts SET otc_response = 'YES' WHERE id = ?").run(ids.draft)
      ).toThrow()
      expect(() =>
        connection
          .prepare("UPDATE otc_drafts SET period_end = '2026-02-29' WHERE id = ?")
          .run(ids.draft)
      ).toThrow()
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd048-schema-v14-'))
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

function migrateToVersion(connection: Database.Database, version: 12 | 13 | 14): void {
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

function addTableConstraint(sql: string, tableName: string, constraint: string): string {
  return replaceRequiredRegex(
    sql,
    new RegExp(`(CREATE TABLE ${tableName} \\([\\s\\S]*?)(\\r?\\n\\) STRICT;)`, 'u'),
    (_match, body: string, end: string) => `${body},\n  ${constraint}${end}`
  )
}

function seedOtcLogGraph(connection: Database.Database): void {
  seedCoreGraph(connection, ids.encounter, 'COMPLETED')
  connection
    .prepare(
      'INSERT INTO otc_medication_logs (id, encounter_id, product_name, product_name_normalized, reason_for_use, dose_text, frequency_text, duration_text, source_of_medication, currently_taking, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.otcLog,
      ids.encounter,
      'Pain reliever',
      'pain reliever',
      'Headache',
      '1 tablet',
      'daily',
      '2 days',
      'Pharmacy',
      1,
      'PATIENT_REPORTED',
      ids.user,
      now
    )
}

function seedOtcDraftGraph(connection: Database.Database): void {
  seedCoreGraph(connection, ids.encounter, 'DRAFT')
  connection
    .prepare(
      'INSERT INTO otc_drafts (id, encounter_id, patient_id, screening_session_id, location_id, installation_id, period_start, period_end, otc_response, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
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
      null,
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
    productName?: string | null
    normalizedName?: string | null
    reasonForUse?: string | null
    currentlyTakingResponse?: string | null
  } = {}
): void {
  connection
    .prepare(
      'INSERT INTO otc_draft_rows (id, otc_draft_id, sequence_number, product_name_snapshot, product_name_normalized, reason_for_use, dose_text, frequency_text, duration_text, source_of_medication, currently_taking_response, source_type, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      overrides.id ?? ids.row,
      ids.draft,
      overrides.sequenceNumber ?? 1,
      overrides.productName ?? null,
      overrides.normalizedName ?? null,
      overrides.reasonForUse ?? null,
      overrides.currentlyTakingResponse ?? null,
      'PATIENT_REPORTED',
      ids.user,
      now,
      ids.user,
      now
    )
}

function readOtcLog(connection: Database.Database): Record<string, unknown> {
  return connection
    .prepare('SELECT * FROM otc_medication_logs WHERE id = ?')
    .get(ids.otcLog) as Record<string, unknown>
}
