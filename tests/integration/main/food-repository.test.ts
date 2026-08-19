import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createFoodRepository,
  createProductionDatabaseMigrationRunner,
  RepositoryValidationError,
  type DatabaseTransactionExecutor,
  type FoodDraftRecord,
  type FoodDraftRowInput,
  type FoodRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import type { FoodDate } from '@main/database'

const ids = Object.freeze({
  installation: 'b1000000-0000-4000-8000-000000000001',
  user: 'b1000000-0000-4000-8000-000000000002',
  location: 'b1000000-0000-4000-8000-000000000003',
  patient: 'b1000000-0000-4000-8000-000000000004',
  otherPatient: 'b1000000-0000-4000-8000-000000000005',
  session: 'b1000000-0000-4000-8000-000000000006',
  encounter: 'b1000000-0000-4000-8000-000000000007',
  otherEncounter: 'b1000000-0000-4000-8000-000000000008',
  draft: 'b1000000-0000-4000-8000-000000000009',
  otherDraft: 'b1000000-0000-4000-8000-000000000010',
  row1: 'b1000000-0000-4000-8000-000000000011',
  row2: 'b1000000-0000-4000-8000-000000000012',
  row3: 'b1000000-0000-4000-8000-000000000013'
})

const firstTime = '2026-08-10T12:00:00.000Z' as UtcTimestamp
const secondTime = '2026-08-10T13:00:00.000Z' as UtcTimestamp
const thirdTime = '2026-08-10T14:00:00.000Z' as UtcTimestamp
const periodStart = '2026-08-04' as FoodDate
const periodEnd = '2026-08-10' as FoodDate

describe('Food repository foundation', () => {
  it('creates an empty draft and lists active catalog items in deterministic order', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)

      expect(draft).toMatchObject({
        encounterId: ids.encounter,
        foodResponse: null,
        rowVersion: 1,
        rows: []
      })
      expect(
        repository
          .listActiveCatalogItems()
          .map((item) => item.code)
          .slice(0, 4)
      ).toEqual(['RICE', 'BEANS', 'CORN_FUFU', 'WATER_FUFU'])
      expect(repository.listActiveCatalogItems()).toHaveLength(26)
    })
  })

  it('saves partial reported rows, normalizes text, and preserves unchanged child timestamps', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const saved = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: draft.id,
          expectedRowVersion: draft.rowVersion,
          foodResponse: 'REPORTED',
          rows: [
            rowInput({
              id: ids.row1,
              sequenceNumber: 1,
              catalogCode: 'RICE',
              foodNameSnapshot: '  Rice  ',
              frequencyCode: null,
              preparationNote: '  with stew  '
            })
          ],
          actorId: parseEntityId(ids.user),
          occurredAt: secondTime
        })
      )

      expect(saved.status).toBe('UPDATED')
      if (saved.status !== 'UPDATED') return
      expect(saved.draft.rowVersion).toBe(2)
      expect(saved.draft.rows[0]).toMatchObject({
        catalogCode: 'RICE',
        foodNameSnapshot: 'Rice',
        foodNameNormalized: 'rice',
        frequencyCode: null,
        preparationNote: 'with stew',
        sourceType: 'PATIENT_REPORTED'
      })
      const createdAt = saved.draft.rows[0]?.createdAt
      const updatedAt = saved.draft.rows[0]?.updatedAt

      const equivalent = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.draft.id,
          expectedRowVersion: saved.draft.rowVersion,
          foodResponse: 'REPORTED',
          rows: [
            rowInput({
              id: ids.row1,
              sequenceNumber: 1,
              catalogCode: 'RICE',
              preparationNote: 'with stew'
            })
          ],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )

      expect(equivalent.status).toBe('UNCHANGED')
      if (equivalent.status === 'UNCHANGED') {
        expect(equivalent.draft.rowVersion).toBe(2)
        expect(equivalent.draft.rows[0]?.createdAt).toBe(createdAt)
        expect(equivalent.draft.rows[0]?.updatedAt).toBe(updatedAt)
      }
    })
  })

  it('adds, updates, removes, and reorders rows without unconditional child reinserts', async () => {
    await withFoodDatabase(({ connection, executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const first = saveRows(executor, repository, draft, [
        rowInput({ id: ids.row1, sequenceNumber: 1, foodNameSnapshot: 'Rice' }),
        rowInput({
          id: ids.row2,
          sequenceNumber: 2,
          catalogCode: 'BEANS',
          foodNameSnapshot: 'Beans'
        })
      ])
      const row1CreatedAt = first.rows[0]?.createdAt

      const second = saveRows(executor, repository, first, [
        rowInput({
          id: ids.row2,
          sequenceNumber: 1,
          catalogCode: 'BEANS',
          foodNameSnapshot: 'Beans',
          frequencyCode: '2_TO_3_DAYS'
        }),
        rowInput({
          id: ids.row1,
          sequenceNumber: 2,
          foodNameSnapshot: 'Rice',
          frequencyCode: 'EVERY_DAY'
        }),
        rowInput({ id: ids.row3, sequenceNumber: 3, foodNameSnapshot: 'Yam' })
      ])

      expect(second.rows.map((row) => row.id)).toEqual([ids.row2, ids.row1, ids.row3])
      expect(second.rows.find((row) => row.id === ids.row1)?.createdAt).toBe(row1CreatedAt)
      expect(readFoodRows(connection)).toHaveLength(3)

      const third = saveRows(executor, repository, second, [
        rowInput({ id: ids.row1, sequenceNumber: 1, foodNameSnapshot: 'Rice' })
      ])
      expect(third.rows.map((row) => row.id)).toEqual([ids.row1])
      expect(readFoodRows(connection)).toHaveLength(1)
    })
  })

  it('clears rows when switching away from REPORTED and rejects rows for non-reported responses', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const reported = saveRows(executor, repository, draft, [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])

      const unknown = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: reported.id,
          expectedRowVersion: reported.rowVersion,
          foodResponse: 'UNKNOWN',
          rows: [],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(unknown).toMatchObject({
        status: 'UPDATED',
        draft: { foodResponse: 'UNKNOWN', rows: [] }
      })
      if (unknown.status !== 'UPDATED') return

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: unknown.draft.id,
            expectedRowVersion: unknown.draft.rowVersion,
            foodResponse: 'DECLINED',
            rows: [rowInput({ id: ids.row1, sequenceNumber: 1 })],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)
    })
  })

  it('uses authoritative catalog snapshots and rejects conflicting or inactive new catalog selections', async () => {
    await withFoodDatabase(({ connection, executor, repository }) => {
      const draft = insertDraft(executor, repository)

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            foodResponse: 'REPORTED',
            rows: [
              rowInput({
                id: ids.row1,
                sequenceNumber: 1,
                catalogCode: 'RICE',
                foodNameSnapshot: 'Beans'
              })
            ],
            actorId: parseEntityId(ids.user),
            occurredAt: secondTime
          })
        )
      ).toThrow(RepositoryValidationError)

      connection.prepare("UPDATE food_catalog_items SET is_active = 0 WHERE code = 'RICE'").run()
      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            foodResponse: 'REPORTED',
            rows: [
              rowInput({
                id: ids.row1,
                sequenceNumber: 1,
                catalogCode: 'RICE',
                foodNameSnapshot: 'Rice'
              })
            ],
            actorId: parseEntityId(ids.user),
            occurredAt: secondTime
          })
        )
      ).toThrow(RepositoryValidationError)
      connection.prepare("UPDATE food_catalog_items SET is_active = 1 WHERE code = 'RICE'").run()

      const saved = saveRows(executor, repository, draft, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          catalogCode: 'RICE',
          foodNameSnapshot: 'Rice'
        })
      ])

      expect(saved.rows[0]).toMatchObject({
        catalogCode: 'RICE',
        foodNameSnapshot: 'Rice',
        foodNameNormalized: 'rice'
      })
    })
  })

  it('handles catalog changes without rewriting existing snapshots or permitting inactive new selections', async () => {
    await withFoodDatabase(({ connection, executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const saved = saveRows(executor, repository, draft, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          catalogCode: 'RICE',
          foodNameSnapshot: 'Rice'
        })
      ])

      const changedCatalog = saveRows(executor, repository, saved, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          catalogCode: 'BEANS',
          foodNameSnapshot: 'Beans'
        })
      ])
      expect(changedCatalog.rows[0]).toMatchObject({
        catalogCode: 'BEANS',
        foodNameSnapshot: 'Beans',
        foodNameNormalized: 'beans'
      })

      connection
        .prepare(
          "UPDATE food_catalog_items SET display_name = 'Beans renamed', normalized_search_name = 'beans renamed', updated_at = ? WHERE code = 'BEANS'"
        )
        .run(thirdTime)
      const preserved = saveRows(executor, repository, changedCatalog, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          catalogCode: 'BEANS',
          foodNameSnapshot: 'Beans renamed',
          frequencyCode: 'EVERY_DAY'
        })
      ])
      expect(preserved.rows[0]).toMatchObject({
        catalogCode: 'BEANS',
        foodNameSnapshot: 'Beans',
        foodNameNormalized: 'beans',
        frequencyCode: 'EVERY_DAY'
      })

      connection.prepare("UPDATE food_catalog_items SET is_active = 0 WHERE code = 'BEANS'").run()
      const retainedInactive = saveRows(executor, repository, preserved, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          catalogCode: 'BEANS',
          foodNameSnapshot: 'Beans renamed',
          frequencyCode: '2_TO_3_DAYS'
        })
      ])
      expect(retainedInactive.rows[0]).toMatchObject({
        catalogCode: 'BEANS',
        foodNameSnapshot: 'Beans',
        frequencyCode: '2_TO_3_DAYS'
      })

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: retainedInactive.id,
            expectedRowVersion: retainedInactive.rowVersion,
            foodResponse: 'REPORTED',
            rows: [
              rowInput({
                id: ids.row2,
                sequenceNumber: 1,
                catalogCode: 'BEANS',
                foodNameSnapshot: 'Beans renamed'
              })
            ],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)
    })
  })

  it('rejects duplicate normalized foods, whitespace names, oversize notes, and invalid catalog codes', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const base = {
        id: draft.id,
        expectedRowVersion: draft.rowVersion,
        foodResponse: 'REPORTED' as const,
        actorId: parseEntityId(ids.user),
        occurredAt: secondTime
      }

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            ...base,
            rows: [
              rowInput({ id: ids.row1, sequenceNumber: 1, foodNameSnapshot: 'Rice' }),
              rowInput({ id: ids.row2, sequenceNumber: 2, foodNameSnapshot: '  RICE  ' })
            ]
          })
        )
      ).toThrow(RepositoryValidationError)
      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            ...base,
            rows: [rowInput({ id: ids.row1, sequenceNumber: 1, foodNameSnapshot: '   ' })]
          })
        )
      ).toThrow(RepositoryValidationError)
      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            ...base,
            rows: [
              rowInput({
                id: ids.row1,
                sequenceNumber: 1,
                preparationNote: 'a'.repeat(201)
              })
            ]
          })
        )
      ).toThrow(RepositoryValidationError)
      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            ...base,
            rows: [rowInput({ id: ids.row1, sequenceNumber: 1, catalogCode: 'OTHER' })]
          })
        )
      ).toThrow(RepositoryValidationError)
    })
  })

  it('returns idempotent equivalent retry and rejects stale non-equivalent saves', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const saved = saveRows(executor, repository, draft, [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])

      const equivalent = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: 1,
          foodResponse: 'REPORTED',
          rows: [rowInput({ id: ids.row1, sequenceNumber: 1 })],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(equivalent.status).toBe('UNCHANGED')
      if (equivalent.status === 'UNCHANGED')
        expect(equivalent.draft.rowVersion).toBe(saved.rowVersion)

      const currentVersionEquivalent = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: saved.rowVersion,
          foodResponse: 'REPORTED',
          rows: [rowInput({ id: ids.row1, sequenceNumber: 1 })],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(currentVersionEquivalent.status).toBe('UNCHANGED')
      if (currentVersionEquivalent.status === 'UNCHANGED')
        expect(currentVersionEquivalent.draft.rowVersion).toBe(saved.rowVersion)

      const conflict = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: 1,
          foodResponse: 'REPORTED',
          rows: [rowInput({ id: ids.row1, sequenceNumber: 1, frequencyCode: 'EVERY_DAY' })],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(conflict).toMatchObject({ status: 'VERSION_CONFLICT' })
    })
  })

  it('rejects wrong-draft and cross-encounter child-row ownership violations', async () => {
    await withFoodDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const otherDraft = insertDraft(executor, repository, {
        id: ids.otherDraft,
        encounterId: ids.otherEncounter,
        patientId: ids.otherPatient
      })
      const savedOther = saveRows(executor, repository, otherDraft, [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            foodResponse: 'REPORTED',
            rows: [rowInput({ id: savedOther.rows[0]!.id, sequenceNumber: 1 })],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)
    })
  })

  it('loads up to eight distinct recent patient foods from completed prior encounters only', async () => {
    await withFoodDatabase(({ connection, repository }) => {
      seedRecentFoodLogs(connection)

      const recent = repository.listRecentPatientFoods(
        parseEntityId(ids.patient),
        parseEntityId(ids.encounter)
      )

      expect(recent).toHaveLength(8)
      expect(recent[0]).toMatchObject({
        foodNameSnapshot: 'Rice latest',
        foodNameNormalized: 'rice'
      })
      expect(recent.map((food) => food.foodNameNormalized)).not.toContain('current')
      expect(recent.map((food) => food.foodNameNormalized)).not.toContain('draft only')
      expect(recent.map((food) => food.foodNameNormalized)).not.toContain('other patient')
    })
  })

  it('returns inactive historical catalog foods as custom recent suggestions', async () => {
    await withFoodDatabase(({ connection, repository }) => {
      seedSingleRecentFoodLog(connection, {
        foodCode: 'RICE',
        name: 'Rice',
        normalizedName: 'rice'
      })
      connection.prepare("UPDATE food_catalog_items SET is_active = 0 WHERE code = 'RICE'").run()

      const recent = repository.listRecentPatientFoods(
        parseEntityId(ids.patient),
        parseEntityId(ids.encounter)
      )

      expect(recent).toEqual([
        expect.objectContaining({
          catalogCode: null,
          foodNameSnapshot: 'Rice',
          foodNameNormalized: 'rice'
        })
      ])
    })
  })
})

async function withFoodDatabase(
  test: (context: {
    readonly connection: Database.Database
    readonly executor: DatabaseTransactionExecutor
    readonly repository: FoodRepository
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd047-food-repository-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => firstTime)
    })(connection)
    seedCoreGraph(connection)
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => ids.row3),
      clock: createUtcClock(() => firstTime)
    })
    test({ connection, executor, repository: createFoodRepository(connection) })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function insertDraft(
  executor: DatabaseTransactionExecutor,
  repository: FoodRepository,
  overrides: {
    readonly id?: string
    readonly encounterId?: string
    readonly patientId?: string
  } = {}
): FoodDraftRecord {
  return executor.run((context) =>
    repository.insertDraft(context.connection, {
      id: parseEntityId(overrides.id ?? ids.draft),
      encounterId: parseEntityId(overrides.encounterId ?? ids.encounter),
      patientId: parseEntityId(overrides.patientId ?? ids.patient),
      screeningSessionId: parseEntityId(ids.session),
      locationId: parseEntityId(ids.location),
      installationId: parseEntityId(ids.installation),
      periodStart,
      periodEnd,
      actorId: parseEntityId(ids.user),
      occurredAt: firstTime
    })
  )
}

function saveRows(
  executor: DatabaseTransactionExecutor,
  repository: FoodRepository,
  draft: FoodDraftRecord,
  rows: readonly FoodDraftRowInput[]
): FoodDraftRecord {
  const result = executor.run((context) =>
    repository.updateDraft(context.connection, {
      id: draft.id,
      expectedRowVersion: draft.rowVersion,
      foodResponse: 'REPORTED',
      rows,
      actorId: parseEntityId(ids.user),
      occurredAt: secondTime
    })
  )
  if (result.status !== 'UPDATED') throw new Error(`Unexpected ${result.status}`)
  return result.draft
}

type FoodDraftRowInputOverrides = Omit<Partial<FoodDraftRowInput>, 'id'> & {
  readonly id?: string | FoodDraftRowInput['id']
}

function rowInput(overrides: FoodDraftRowInputOverrides = {}): FoodDraftRowInput {
  return {
    id: parseEntityId(overrides.id ?? ids.row1),
    sequenceNumber: overrides.sequenceNumber ?? 1,
    catalogCode: overrides.catalogCode ?? null,
    foodNameSnapshot: overrides.foodNameSnapshot ?? 'Rice',
    frequencyCode: overrides.frequencyCode ?? null,
    preparationNote: overrides.preparationNote ?? null,
    sourceType: overrides.sourceType ?? 'PATIENT_REPORTED'
  }
}

function readFoodRows(connection: Database.Database): readonly Record<string, unknown>[] {
  return connection
    .prepare('SELECT * FROM food_draft_rows ORDER BY sequence_number')
    .all() as readonly Record<string, unknown>[]
}

function seedCoreGraph(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', firstTime, firstTime)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(
      ids.user,
      'tester',
      'tester',
      'Test User',
      'hash',
      'salt',
      'TRAINED_SCREENER',
      firstTime,
      firstTime
    )
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
      firstTime,
      ids.user,
      firstTime
    )
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as {
      id: string
    }
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
      firstTime,
      ids.user,
      firstTime
    )
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.otherPatient,
      'TEST-2',
      'Other Patient',
      'other patient',
      'ACTIVE',
      ids.user,
      firstTime,
      ids.user,
      firstTime
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
      firstTime,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  insertEncounter(connection, ids.encounter, ids.patient, 'DRAFT', protocolId)
  insertEncounter(connection, ids.otherEncounter, ids.otherPatient, 'DRAFT', protocolId)
}

function insertEncounter(
  connection: Database.Database,
  encounterId: string,
  patientId: string,
  status: 'DRAFT' | 'COMPLETED',
  protocolId: string,
  sessionId: string = ids.session
): void {
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounterId,
      patientId,
      sessionId,
      ids.location,
      protocolId,
      status,
      firstTime,
      status === 'COMPLETED' ? firstTime : null,
      'LOCAL',
      ids.user,
      firstTime,
      firstTime
    )
}

function seedRecentFoodLogs(connection: Database.Database): void {
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as {
      id: string
    }
  ).id
  const priorEncounterPrefix = 'c1000000-0000-4000-8000-'
  for (let index = 1; index <= 10; index += 1) {
    const encounterId = `${priorEncounterPrefix}${String(index).padStart(12, '0')}`
    const sessionId = `c2000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const sessionDate = `2026-07-${String(index).padStart(2, '0')}`
    insertScreeningSession(connection, sessionId, protocolId, sessionDate, 'CLOSED')
    insertEncounter(connection, encounterId, ids.patient, 'COMPLETED', protocolId, sessionId)
    insertFoodLog(connection, {
      id: `d1000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      encounterId,
      name: index === 10 ? 'Rice latest' : `Food ${index}`,
      normalizedName: index === 10 ? 'rice' : `food ${index}`,
      recordedAt: `2026-08-${String(index).padStart(2, '0')}T12:00:00.000Z`
    })
  }
  insertFoodLog(connection, {
    id: 'd1000000-0000-4000-8000-000000000099',
    encounterId: ids.encounter,
    name: 'Current',
    normalizedName: 'current',
    recordedAt: '2026-08-11T12:00:00.000Z'
  })
  const draftEncounter = 'c1000000-0000-4000-8000-000000000099'
  const draftSession = 'c2000000-0000-4000-8000-000000000099'
  insertScreeningSession(connection, draftSession, protocolId, '2026-07-20', 'OPEN')
  insertEncounter(connection, draftEncounter, ids.patient, 'DRAFT', protocolId, draftSession)
  insertFoodLog(connection, {
    id: 'd1000000-0000-4000-8000-000000000098',
    encounterId: draftEncounter,
    name: 'Draft only',
    normalizedName: 'draft only',
    recordedAt: '2026-08-12T12:00:00.000Z'
  })
  const otherEncounter = 'c1000000-0000-4000-8000-000000000098'
  const otherSession = 'c2000000-0000-4000-8000-000000000098'
  insertScreeningSession(connection, otherSession, protocolId, '2026-07-21', 'CLOSED')
  insertEncounter(
    connection,
    otherEncounter,
    ids.otherPatient,
    'COMPLETED',
    protocolId,
    otherSession
  )
  insertFoodLog(connection, {
    id: 'd1000000-0000-4000-8000-000000000097',
    encounterId: otherEncounter,
    name: 'Other patient',
    normalizedName: 'other patient',
    recordedAt: '2026-08-13T12:00:00.000Z'
  })
}

function seedSingleRecentFoodLog(
  connection: Database.Database,
  input: {
    readonly foodCode: string | null
    readonly name: string
    readonly normalizedName: string
  }
): void {
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as {
      id: string
    }
  ).id
  const encounterId = 'c1000000-0000-4000-8000-000000000096'
  const sessionId = 'c2000000-0000-4000-8000-000000000096'
  insertScreeningSession(connection, sessionId, protocolId, '2026-07-22', 'CLOSED')
  insertEncounter(connection, encounterId, ids.patient, 'COMPLETED', protocolId, sessionId)
  insertFoodLog(connection, {
    id: 'd1000000-0000-4000-8000-000000000096',
    encounterId,
    foodCode: input.foodCode,
    name: input.name,
    normalizedName: input.normalizedName,
    recordedAt: '2026-08-14T12:00:00.000Z'
  })
}

function insertScreeningSession(
  connection: Database.Database,
  sessionId: string,
  protocolId: string,
  sessionDate: string,
  status: 'OPEN' | 'CLOSED'
): void {
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, closed_by, closed_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      sessionId,
      ids.location,
      protocolId,
      sessionDate,
      status,
      ids.user,
      firstTime,
      status === 'CLOSED' ? ids.user : null,
      status === 'CLOSED' ? firstTime : null,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
}

function insertFoodLog(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly encounterId: string
    readonly foodCode?: string | null
    readonly name: string
    readonly normalizedName: string
    readonly recordedAt: string
  }
): void {
  connection
    .prepare(
      'INSERT INTO food_logs (id, encounter_id, food_code, food_name, food_name_normalized, frequency_code, notes, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)'
    )
    .run(
      input.id,
      input.encounterId,
      input.foodCode ?? null,
      input.name,
      input.normalizedName,
      'PATIENT_REPORTED',
      ids.user,
      input.recordedAt
    )
}
