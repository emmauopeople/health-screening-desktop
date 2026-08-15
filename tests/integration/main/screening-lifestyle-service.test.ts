import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createInstallationLocationService,
  createScreeningLifestyleService,
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  type CurrentScreeningSessionService,
  type LocalAuthenticationSessionService,
  type ScreeningLifestyleService
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLifestyleRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  parseLocationName,
  parseScreeningSessionDate,
  parseUserDisplayName,
  parseUsername,
  type LocalUserRecord,
  type LocalUserRole,
  type ScreeningEncounterOutboxRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-06T12:00:00.000Z'
const later = '2026-08-06T13:00:00.000Z'
const installationId = '95000000-0000-4000-8000-000000000001'
const adminId = '95000000-0000-4000-8000-000000000002'
const nurseId = '95000000-0000-4000-8000-000000000003'
const locationId = '95000000-0000-4000-8000-000000000004'
const patientId = '95000000-0000-4000-8000-000000000005'
const sessionId = '95000000-0000-4000-8000-000000000006'
const encounterId = '95000000-0000-4000-8000-000000000007'

describe('screening Lifestyle application service integration', () => {
  it('requires an active approved screening session and strict requests', async () => {
    await withLifestyleService(({ service, ensureCurrentSessionCalls }) => {
      expect(
        service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })
      ).toMatchObject({
        status: 'LOADED',
        workspace: { encounterId, draft: null }
      })

      expect(
        service.getLifestyleWorkspace({
          encounterId: parseEntityId(encounterId),
          extra: true
        } as never)
      ).toEqual({ status: 'VALIDATION_FAILED' })
      expect(ensureCurrentSessionCalls.count).toBe(0)
    })
  })

  it.each(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)(
    'allows the approved %s screening role',
    async (role) => {
      await withLifestyleService(
        ({ service }) => {
          expect(
            service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })
          ).toEqual(expect.objectContaining({ status: 'LOADED' }))
        },
        { sessionRole: role }
      )
    }
  )

  it('maps locked and forbidden sessions to controlled outcomes', async () => {
    await withLifestyleService(
      ({ service }) => {
        expect(service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
      },
      { authenticationFailure: new LocalSessionLockedError() }
    )

    await withLifestyleService(
      ({ service }) => {
        expect(service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'FORBIDDEN'
        })
      },
      { sessionRole: 'LOCAL_ADMIN', authenticationFailure: new LocalSessionAuthorizationError() }
    )
  })

  it.each(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)(
    'accepts approved role %s',
    async (role) => {
      await withLifestyleService(
        ({ service }) => {
          expect(
            service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })
          ).toEqual(expect.objectContaining({ status: 'LOADED' }))
        },
        { sessionRole: role }
      )
    }
  )

  it('maps password-change-required sessions and unsafe request shapes', async () => {
    await withLifestyleService(
      ({ service }) => {
        expect(service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
      },
      { authenticationFailure: new LocalSessionPasswordChangeRequiredError() }
    )
    await withLifestyleService(({ service }) => {
      const inherited = Object.create({ extra: true }) as Record<string, unknown>
      inherited.encounterId = parseEntityId(encounterId)
      expect(service.getLifestyleWorkspace(inherited as never)).toEqual({
        status: 'VALIDATION_FAILED'
      })
      const accessor = {} as Record<string, unknown>
      Object.defineProperty(accessor, 'encounterId', {
        enumerable: true,
        get: () => parseEntityId(encounterId)
      })
      expect(service.getLifestyleWorkspace(accessor as never)).toEqual({
        status: 'VALIDATION_FAILED'
      })
      expect(
        service.saveLifestyleDraft({
          ...createDraftRequest(),
          actorId: parseEntityId(adminId)
        } as never)
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it('creates a first draft only for the current session and fixes the seven-day period', async () => {
    await withLifestyleService(({ connection, service }) => {
      const result = service.saveLifestyleDraft(createDraftRequest())

      expect(result.status).toBe('SAVED')
      if (result.status !== 'SAVED') return
      expect(result.workspace.draft).toMatchObject({
        encounterId,
        status: 'IN_PROGRESS',
        periodStart: '2026-07-31',
        periodEnd: '2026-08-06'
      })
      expect(result.workspace.draft?.id).not.toBeNull()
      expect(result.workspace.draft?.alcohol).toBeNull()
      expect(result.workspace.draft?.tobacco).toBeNull()
      expect(result.workspace.draft?.physicalActivity).toBeNull()
      expect(result.workspace.draft?.work).toBeNull()
      expect(readCount(connection, 'lifestyle_drafts')).toBe(1)
      expect(result.workspace.draft).not.toHaveProperty('patientId')
      expect(result.workspace.draft).not.toHaveProperty('installationId')
      expect(result.workspace.draft).not.toHaveProperty('screeningSessionId')
      expect(result.workspace.draft).not.toHaveProperty('locationId')
      expect(result.workspace.draft).not.toHaveProperty('createdBy')
    })
  })

  it.each([
    ['month boundary', '2026-03-01', '2026-02-23'],
    ['year boundary', '2026-01-01', '2025-12-26'],
    ['leap year', '2028-03-01', '2028-02-24'],
    ['non-leap century', '2100-03-01', '2100-02-23'],
    ['leap century', '2000-03-01', '2000-02-24']
  ])(
    'calculates the fixed inclusive seven-day period across the %s',
    async (_, sessionDate, periodStart) => {
      await withLifestyleService(({ connection, service }) => {
        connection
          .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
          .run(sessionDate, sessionId)
        const result = service.saveLifestyleDraft(createDraftRequest())
        expect(result).toMatchObject({
          status: 'SAVED',
          workspace: { draft: { periodStart, periodEnd: sessionDate } }
        })
      })
    }
  )

  it('does not persist a rejected first draft or baseline', async () => {
    await withLifestyleService(({ connection, service }) => {
      const result = service.saveLifestyleDraft(
        createDraftRequest({
          alcohol: {
            id: null,
            weeklyResponse: 'YES',
            drinkingDays: 0,
            totalStandardizedDrinks: null,
            largestOneDayAmount: null,
            daysAtLargestAmount: null,
            commonBeverageTypes: [],
            otherBeverageDescription: null
          }
        })
      )
      expect(result).toEqual({ status: 'VALIDATION_FAILED' })
      expect(readCount(connection, 'lifestyle_drafts')).toBe(0)
      expect(readCount(connection, 'lifestyle_alcohol_weekly_records')).toBe(0)
    })

    await withLifestyleService(
      ({ connection, service }) => {
        const result = service.saveAlcoholBaseline(alcoholBaselineRequest())
        expect(result).toEqual({ status: 'SESSION_NOT_CURRENT' })
        expect(readCount(connection, 'lifestyle_alcohol_baseline_versions')).toBe(0)
        expect(readCount(connection, 'lifestyle_drafts')).toBe(0)
      },
      { currentSessionStatus: 'SESSION_NOT_FOUND' }
    )
  })

  it('rolls back baseline and draft writes when the event boundary fails', async () => {
    await withLifestyleService(
      ({ connection, service }) => {
        expect(service.saveAlcoholBaseline(alcoholBaselineRequest())).toEqual({
          status: 'UNAVAILABLE'
        })
        expect(
          service.saveTobaccoBaseline({ ...tobaccoBaselineRequest(), expectedDraftVersion: null })
        ).toEqual({
          status: 'UNAVAILABLE'
        })
        expect(
          service.saveWorkBaseline({ ...workBaselineRequest(), expectedDraftVersion: null })
        ).toEqual({
          status: 'UNAVAILABLE'
        })
        expect(readCount(connection, 'lifestyle_alcohol_baseline_versions')).toBe(0)
        expect(readCount(connection, 'lifestyle_tobacco_baseline_versions')).toBe(0)
        expect(readCount(connection, 'lifestyle_work_baseline_versions')).toBe(0)
        expect(readCount(connection, 'lifestyle_drafts')).toBe(0)
        expect(readCount(connection, 'audit_log')).toBe(0)
        expect(readCount(connection, 'sync_outbox')).toBe(0)
      },
      { failOutbox: true }
    )
  })

  it('loads an existing draft after date rollover without requiring a current-session lookup', async () => {
    await withLifestyleService(({ connection, service, currentSessionCalls }) => {
      const saved = service.saveLifestyleDraft(createDraftRequest())
      if (saved.status !== 'SAVED') throw new Error('Expected draft save')
      const firstLookupCount = currentSessionCalls.count

      connection
        .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
        .run('2026-08-05', sessionId)
      const loaded = service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })

      expect(loaded).toMatchObject({
        status: 'LOADED',
        workspace: {
          draft: {
            id: saved.workspace.draft?.id,
            periodStart: '2026-07-31',
            periodEnd: '2026-08-06'
          }
        }
      })
      expect(currentSessionCalls.count).toBe(firstLookupCount)
    })
  })

  it('creates immutable baseline versions and retains exact draft references', async () => {
    await withLifestyleService(({ service, connection }) => {
      const alcohol = service.saveAlcoholBaseline(alcoholBaselineRequest())
      expect(alcohol.status).toBe('SAVED')
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null) return

      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      expect(tobacco.status).toBe('SAVED')
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null) return

      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      expect(work.status).toBe('SAVED')
      if (work.status !== 'SAVED' || work.workspace.draft === null) return

      expect(work.workspace.draft.alcoholBaselineVersionId).toBe(
        alcohol.workspace.draft.alcoholBaselineVersionId
      )
      expect(work.workspace.draft.tobaccoBaselineVersionId).toBe(
        tobacco.workspace.draft.tobaccoBaselineVersionId
      )
      expect(work.workspace.draft.workBaselineVersionId).not.toBeNull()
      expect(readCount(connection, 'lifestyle_alcohol_baseline_versions')).toBe(1)
      expect(readCount(connection, 'lifestyle_tobacco_baseline_versions')).toBe(1)
      expect(readCount(connection, 'lifestyle_work_baseline_versions')).toBe(1)

      const secondAlcohol = service.saveAlcoholBaseline({
        ...alcoholBaselineRequest(),
        expectedBaselineVersion: 1,
        expectedDraftVersion: work.workspace.draft.rowVersion
      })
      expect(secondAlcohol.status).toBe('SAVED')
      if (secondAlcohol.status !== 'SAVED' || secondAlcohol.workspace.draft === null) return

      const stale = service.saveAlcoholBaseline({
        ...alcoholBaselineRequest(),
        expectedBaselineVersion: 1,
        expectedDraftVersion: secondAlcohol.workspace.draft.rowVersion
      })
      expect(stale).toEqual({ status: 'VERSION_CONFLICT' })
    })
  })

  it('persists incomplete branches, rejects contradictory branches, and completes only after strict validation', async () => {
    await withLifestyleService(({ service }) => {
      const saved = service.saveLifestyleDraft(
        createDraftRequest({
          alcohol: {
            id: null,
            weeklyResponse: 'YES',
            drinkingDays: null,
            totalStandardizedDrinks: null,
            largestOneDayAmount: null,
            daysAtLargestAmount: null,
            commonBeverageTypes: [],
            otherBeverageDescription: null
          },
          tobacco: { id: null, weeklyResponse: 'YES', products: [] },
          physicalActivity: {
            id: null,
            weeklyResponse: 'YES',
            sedentaryTimeResponse: null,
            sedentaryMinutesPerDay: null,
            activities: []
          }
        })
      )
      expect(saved.status).toBe('SAVED')
      if (saved.status !== 'SAVED' || saved.workspace.draft === null) return

      const contradictory = service.saveLifestyleDraft(
        createDraftRequest({
          expectedVersion: saved.workspace.draft.rowVersion,
          tobacco: {
            id: null,
            weeklyResponse: 'NO',
            products: [product(null)]
          },
          physicalActivity: {
            id: null,
            weeklyResponse: 'NO',
            sedentaryTimeResponse: 'RECORDED',
            sedentaryMinutesPerDay: 60,
            activities: [activity(null)]
          }
        })
      )
      expect(contradictory).toEqual({ status: 'VALIDATION_FAILED' })

      expect(
        service.completeLifestyle({
          ...createCompleteRequest(),
          expectedVersion: saved.workspace.draft.rowVersion
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it('rejects an inconsistent Alcohol weekly total before the application transaction writes', async () => {
    await withLifestyleService(({ connection, service }) => {
      const result = service.saveLifestyleDraft(
        createDraftRequest({
          alcohol: {
            id: null,
            weeklyResponse: 'YES',
            drinkingDays: 4,
            totalStandardizedDrinks: 3,
            largestOneDayAmount: 3,
            daysAtLargestAmount: 2,
            commonBeverageTypes: ['BEER'],
            otherBeverageDescription: null
          }
        })
      )
      expect(result).toEqual({ status: 'VALIDATION_FAILED' })
      expect(readCount(connection, 'lifestyle_drafts')).toBe(0)
      expect(readCount(connection, 'lifestyle_alcohol_weekly_records')).toBe(0)
    })
  })

  it('accepts valid decimal Alcohol quantities and rejects invalid decimal consistency without persistence', async () => {
    await withLifestyleService(({ service }) => {
      const valid = service.saveLifestyleDraft(
        createDraftRequest({
          alcohol: {
            id: null,
            weeklyResponse: 'YES',
            drinkingDays: 3,
            totalStandardizedDrinks: 0.3,
            largestOneDayAmount: 0.1,
            daysAtLargestAmount: 3,
            commonBeverageTypes: ['BEER'],
            otherBeverageDescription: null
          }
        })
      )
      expect(valid.status).toBe('SAVED')
    })

    await withLifestyleService(({ connection, service }) => {
      const invalid = service.saveLifestyleDraft(
        createDraftRequest({
          alcohol: {
            id: null,
            weeklyResponse: 'YES',
            drinkingDays: 3,
            totalStandardizedDrinks: 0.29,
            largestOneDayAmount: 0.1,
            daysAtLargestAmount: 3,
            commonBeverageTypes: ['BEER'],
            otherBeverageDescription: null
          }
        })
      )
      expect(invalid).toEqual({ status: 'VALIDATION_FAILED' })
      expect(readCount(connection, 'lifestyle_drafts')).toBe(0)
    })
  })

  it('requires baseline review confirmation and records only approved completion metadata', async () => {
    await withLifestyleService(({ service, connection }) => {
      const alcohol = service.saveAlcoholBaseline({ ...alcoholBaselineRequest(), status: 'FORMER' })
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
        throw new Error('Expected alcohol baseline')
      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        status: 'FORMER',
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
        throw new Error('Expected tobacco baseline')
      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      if (work.status !== 'SAVED' || work.workspace.draft === null)
        throw new Error('Expected work baseline')
      const draft = service.saveLifestyleDraft(
        completeWeeklyRequest({ expectedVersion: work.workspace.draft.rowVersion })
      )
      if (draft.status !== 'SAVED' || draft.workspace.draft === null)
        throw new Error('Expected Lifestyle draft')

      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: draft.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: null,
          tobaccoBaselineReviewConfirmedVersionId: null
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })

      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: draft.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: parseEntityId(adminId),
          tobaccoBaselineReviewConfirmedVersionId: draft.workspace.draft.tobaccoBaselineVersionId
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })

      const newerAlcohol = service.saveAlcoholBaseline({
        ...alcoholBaselineRequest(),
        status: 'FORMER',
        expectedBaselineVersion: 1,
        expectedDraftVersion: draft.workspace.draft.rowVersion
      })
      if (newerAlcohol.status !== 'SAVED' || newerAlcohol.workspace.draft === null)
        throw new Error('Expected newer alcohol baseline')
      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: newerAlcohol.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: draft.workspace.draft.alcoholBaselineVersionId,
          tobaccoBaselineReviewConfirmedVersionId:
            newerAlcohol.workspace.draft.tobaccoBaselineVersionId
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })

      const completionRequest = {
        ...completeWeeklyRequest({ expectedVersion: newerAlcohol.workspace.draft.rowVersion }),
        alcoholBaselineReviewConfirmedVersionId:
          newerAlcohol.workspace.draft.alcoholBaselineVersionId,
        tobaccoBaselineReviewConfirmedVersionId:
          newerAlcohol.workspace.draft.tobaccoBaselineVersionId
      }
      const completed = service.completeLifestyle(completionRequest)
      expect(completed).toMatchObject({
        status: 'COMPLETED',
        workspace: { draft: { status: 'COMPLETE' } }
      })
      if (completed.status === 'COMPLETED') {
        expect(Object.isFrozen(completed.workspace)).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft)).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft?.alcohol)).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft?.tobacco)).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft?.tobacco?.products[0])).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft?.physicalActivity)).toBe(true)
        expect(Object.isFrozen(completed.workspace.draft?.physicalActivity?.activities[0])).toBe(
          true
        )
        expect(Object.isFrozen(completed.workspace.draft?.work)).toBe(true)
        expect(Object.isFrozen(completed.workspace.activeAlcoholBaseline)).toBe(true)
        expect(Object.isFrozen(completed.workspace.activeTobaccoBaseline)).toBe(true)
        expect(Object.isFrozen(completed.workspace.activeWorkBaseline)).toBe(true)
        expect(completed.workspace.activeAlcoholBaseline).not.toHaveProperty('patientId')
        expect(completed.workspace.activeTobaccoBaseline).not.toHaveProperty('installationId')
        expect(completed.workspace.activeWorkBaseline).not.toHaveProperty('createdBy')
        expect(completed.workspace.draft?.tobacco?.products[0]).not.toHaveProperty(
          'tobaccoWeeklyRecordId'
        )
      }

      const auditRows = connection
        .prepare(
          "SELECT metadata_json FROM audit_log WHERE action = 'SCREENING_LIFESTYLE_STEP_COMPLETED'"
        )
        .all() as { metadata_json: string }[]
      const completionMetadata = JSON.parse(auditRows[0]!.metadata_json) as Record<string, unknown>
      expect(Object.keys(completionMetadata).sort()).toEqual(
        [
          'activity_row_count',
          'alcohol_baseline_reference_id',
          'alcohol_baseline_review_confirmed_version_id',
          'alcohol_record_count',
          'draft_id',
          'draft_status',
          'encounter_id',
          'other_activity_row_count',
          'row_version',
          'tobacco_baseline_reference_id',
          'tobacco_baseline_review_confirmed_version_id',
          'tobacco_product_count',
          'work_baseline_reference_id'
        ].sort()
      )
      expect(completionMetadata).toMatchObject({
        alcohol_baseline_review_confirmed_version_id:
          newerAlcohol.workspace.draft.alcoholBaselineVersionId,
        tobacco_baseline_review_confirmed_version_id:
          newerAlcohol.workspace.draft.tobaccoBaselineVersionId
      })
      expect(completionMetadata).not.toHaveProperty('weeklyResponse')
      expect(completionMetadata).not.toHaveProperty('description')
      const outboxRow = connection
        .prepare(
          "SELECT payload_json FROM sync_outbox WHERE operation = 'SCREENING_LIFESTYLE_STEP_COMPLETED'"
        )
        .get() as { payload_json: string }
      expect(JSON.parse(outboxRow.payload_json)).toEqual(completionMetadata)
      const counts = [readCount(connection, 'audit_log'), readCount(connection, 'sync_outbox')]
      const retry = service.completeLifestyle(completionRequest)
      expect(retry).toMatchObject({
        status: 'COMPLETED',
        workspace: { draft: { status: 'COMPLETE' } }
      })
      expect([readCount(connection, 'audit_log'), readCount(connection, 'sync_outbox')]).toEqual(
        counts
      )
    })
  })

  it('requires confirmation for NEVER Alcohol and Tobacco baselines', async () => {
    await withLifestyleService(({ service }) => {
      const alcohol = service.saveAlcoholBaseline({ ...alcoholBaselineRequest(), status: 'NEVER' })
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
        throw new Error('Expected alcohol baseline')
      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        status: 'NEVER',
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
        throw new Error('Expected tobacco baseline')
      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      if (work.status !== 'SAVED' || work.workspace.draft === null)
        throw new Error('Expected work baseline')
      const draft = service.saveLifestyleDraft(
        completeWeeklyRequest({ expectedVersion: work.workspace.draft.rowVersion })
      )
      if (draft.status !== 'SAVED' || draft.workspace.draft === null)
        throw new Error('Expected Lifestyle draft')
      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: draft.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: null,
          tobaccoBaselineReviewConfirmedVersionId: null
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it.each(['NO', 'UNKNOWN', 'DECLINED'] as const)(
    'completes the explicit %s weekly branches',
    async (response) => {
      await withLifestyleService(({ service }) => {
        const alcohol = service.saveAlcoholBaseline(alcoholBaselineRequest())
        if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
          throw new Error('Expected alcohol baseline')
        const tobacco = service.saveTobaccoBaseline({
          ...tobaccoBaselineRequest(),
          expectedDraftVersion: alcohol.workspace.draft.rowVersion
        })
        if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
          throw new Error('Expected tobacco baseline')
        const work = service.saveWorkBaseline({
          ...workBaselineRequest(),
          expectedDraftVersion: tobacco.workspace.draft.rowVersion
        })
        if (work.status !== 'SAVED' || work.workspace.draft === null)
          throw new Error('Expected work baseline')
        const weekly = completeWeeklyRequest({
          alcohol: {
            id: null,
            weeklyResponse: response,
            drinkingDays: null,
            totalStandardizedDrinks: null,
            largestOneDayAmount: null,
            daysAtLargestAmount: null,
            commonBeverageTypes: [],
            otherBeverageDescription: null
          },
          tobacco: { id: null, weeklyResponse: response, products: [] },
          physicalActivity: {
            id: null,
            weeklyResponse: response,
            sedentaryTimeResponse: 'UNKNOWN',
            sedentaryMinutesPerDay: null,
            activities: []
          },
          work: { id: null, weeklyResponse: 'NO_WORK' },
          expectedVersion: work.workspace.draft.rowVersion
        })
        const draft = service.saveLifestyleDraft(weekly)
        if (draft.status !== 'SAVED' || draft.workspace.draft === null)
          throw new Error('Expected Lifestyle draft')
        expect(
          service.completeLifestyle({
            ...weekly,
            expectedVersion: draft.workspace.draft.rowVersion,
            alcoholBaselineReviewConfirmedVersionId: null,
            tobaccoBaselineReviewConfirmedVersionId: null
          })
        ).toMatchObject({ status: 'COMPLETED' })
      })
    }
  )

  it('reopens a completed draft when a baseline reference changes', async () => {
    await withLifestyleService(({ service }) => {
      const alcohol = service.saveAlcoholBaseline(alcoholBaselineRequest())
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
        throw new Error('Expected alcohol baseline')
      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
        throw new Error('Expected tobacco baseline')
      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      if (work.status !== 'SAVED' || work.workspace.draft === null)
        throw new Error('Expected work baseline')
      const draft = service.saveLifestyleDraft(
        completeWeeklyRequest({ expectedVersion: work.workspace.draft.rowVersion })
      )
      if (draft.status !== 'SAVED' || draft.workspace.draft === null)
        throw new Error('Expected Lifestyle draft')
      const completed = service.completeLifestyle({
        ...completeWeeklyRequest({ expectedVersion: draft.workspace.draft.rowVersion }),
        alcoholBaselineReviewConfirmedVersionId: null,
        tobaccoBaselineReviewConfirmedVersionId: null
      })
      if (completed.status !== 'COMPLETED' || completed.workspace.draft === null)
        throw new Error('Expected completed Lifestyle draft')

      const reopened = service.saveAlcoholBaseline({
        ...alcoholBaselineRequest(),
        status: 'FORMER',
        expectedBaselineVersion: 1,
        expectedDraftVersion: completed.workspace.draft.rowVersion
      })
      expect(reopened).toMatchObject({
        status: 'SAVED',
        workspace: { draft: { status: 'IN_PROGRESS' } }
      })
      if (reopened.status !== 'SAVED' || reopened.workspace.draft === null) return
      expect(reopened.workspace.draft.alcoholBaselineVersionId).not.toBe(
        completed.workspace.draft.alcoholBaselineVersionId
      )
      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: reopened.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: null,
          tobaccoBaselineReviewConfirmedVersionId: reopened.workspace.draft.tobaccoBaselineVersionId
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it('rolls back completion changes across every Lifestyle table after an outbox failure', async () => {
    await withLifestyleService(({ connection, service, outboxFailure }) => {
      const alcohol = service.saveAlcoholBaseline(alcoholBaselineRequest())
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
        throw new Error('Expected alcohol baseline')
      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
        throw new Error('Expected tobacco baseline')
      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      if (work.status !== 'SAVED' || work.workspace.draft === null)
        throw new Error('Expected work baseline')
      const draft = service.saveLifestyleDraft(
        completeWeeklyRequest({
          expectedVersion: work.workspace.draft.rowVersion,
          otherActivityResponse: 'YES',
          otherActivities: [otherActivity(null)]
        })
      )
      if (draft.status !== 'SAVED' || draft.workspace.draft === null)
        throw new Error('Expected Lifestyle draft')

      const tables = [
        'lifestyle_alcohol_baseline_versions',
        'lifestyle_tobacco_baseline_versions',
        'lifestyle_work_baseline_versions',
        'lifestyle_drafts',
        'lifestyle_alcohol_weekly_records',
        'lifestyle_tobacco_weekly_records',
        'lifestyle_tobacco_product_rows',
        'lifestyle_physical_activity_weekly_records',
        'lifestyle_activity_rows',
        'lifestyle_work_weekly_records',
        'lifestyle_other_activity_rows',
        'audit_log',
        'sync_outbox'
      ] as const
      const before = new Map(tables.map((table) => [table, snapshotTable(connection, table)]))
      const originalVersion = draft.workspace.draft.rowVersion
      outboxFailure.enabled = true

      const failed = service.completeLifestyle({
        ...completeWeeklyRequest({
          expectedVersion: originalVersion,
          alcohol: {
            ...completeWeeklyRequest().alcohol!,
            totalStandardizedDrinks: 4
          },
          tobacco: {
            ...completeWeeklyRequest().tobacco!,
            products: [{ ...product(null), averageQuantityPerUseDay: 2 }]
          },
          physicalActivity: {
            ...completeWeeklyRequest().physicalActivity!,
            activities: [{ ...activity(null), averageMinutesPerActiveDay: 31 }]
          },
          work: { id: null, weeklyResponse: 'LESS_THAN_USUAL' },
          otherActivityResponse: 'YES',
          otherActivities: [otherActivity(null)]
        }),
        alcoholBaselineReviewConfirmedVersionId: null,
        tobaccoBaselineReviewConfirmedVersionId: null
      })
      expect(failed).toEqual({ status: 'UNAVAILABLE' })

      for (const table of tables)
        expect(snapshotTable(connection, table)).toEqual(before.get(table))
      expect(
        service.getLifestyleWorkspace({ encounterId: parseEntityId(encounterId) })
      ).toMatchObject({ workspace: { draft: { rowVersion: originalVersion } } })
    })
  })

  it('retries the original null-ID draft request without creating duplicate rows', async () => {
    await withLifestyleService(({ service, connection }) => {
      const request = completeWeeklyRequest()
      const first = service.saveLifestyleDraft(request)
      if (first.status !== 'SAVED' || first.workspace.draft === null)
        throw new Error('Expected first save')
      const counts = [
        readCount(connection, 'lifestyle_drafts'),
        readCount(connection, 'lifestyle_tobacco_weekly_records'),
        readCount(connection, 'lifestyle_tobacco_product_rows'),
        readCount(connection, 'lifestyle_activity_rows'),
        readCount(connection, 'audit_log'),
        readCount(connection, 'sync_outbox')
      ]
      const retry = service.saveLifestyleDraft(request)
      expect(retry).toMatchObject({
        status: 'SAVED',
        workspace: {
          draft: { id: first.workspace.draft.id, rowVersion: first.workspace.draft.rowVersion }
        }
      })
      expect([
        readCount(connection, 'lifestyle_drafts'),
        readCount(connection, 'lifestyle_tobacco_weekly_records'),
        readCount(connection, 'lifestyle_tobacco_product_rows'),
        readCount(connection, 'lifestyle_activity_rows'),
        readCount(connection, 'audit_log'),
        readCount(connection, 'sync_outbox')
      ]).toEqual(counts)
    })
  })

  it('rejects unnecessary baseline confirmation on a non-conflicting branch', async () => {
    await withLifestyleService(({ service }) => {
      const alcohol = service.saveAlcoholBaseline(alcoholBaselineRequest())
      if (alcohol.status !== 'SAVED' || alcohol.workspace.draft === null)
        throw new Error('Expected alcohol baseline')
      const tobacco = service.saveTobaccoBaseline({
        ...tobaccoBaselineRequest(),
        expectedDraftVersion: alcohol.workspace.draft.rowVersion
      })
      if (tobacco.status !== 'SAVED' || tobacco.workspace.draft === null)
        throw new Error('Expected tobacco baseline')
      const work = service.saveWorkBaseline({
        ...workBaselineRequest(),
        expectedDraftVersion: tobacco.workspace.draft.rowVersion
      })
      if (work.status !== 'SAVED' || work.workspace.draft === null)
        throw new Error('Expected work baseline')
      const draft = service.saveLifestyleDraft(
        completeWeeklyRequest({ expectedVersion: work.workspace.draft.rowVersion })
      )
      if (draft.status !== 'SAVED' || draft.workspace.draft === null)
        throw new Error('Expected Lifestyle draft')
      expect(
        service.completeLifestyle({
          ...completeWeeklyRequest({ expectedVersion: draft.workspace.draft.rowVersion }),
          alcoholBaselineReviewConfirmedVersionId: draft.workspace.draft.alcoholBaselineVersionId,
          tobaccoBaselineReviewConfirmedVersionId: null
        })
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it('treats an identical draft retry as a no-op', async () => {
    await withLifestyleService(({ service, connection }) => {
      const request = createDraftRequest({
        alcohol: {
          id: null,
          weeklyResponse: 'NO',
          drinkingDays: null,
          totalStandardizedDrinks: null,
          largestOneDayAmount: null,
          daysAtLargestAmount: null,
          commonBeverageTypes: [],
          otherBeverageDescription: null
        }
      })
      const first = service.saveLifestyleDraft(request)
      if (first.status !== 'SAVED' || first.workspace.draft === null)
        throw new Error('Expected first save')
      const auditCount = readCount(connection, 'audit_log')
      const outboxCount = readCount(connection, 'sync_outbox')
      const retry = service.saveLifestyleDraft({
        ...request,
        expectedVersion: first.workspace.draft.rowVersion,
        alcohol: {
          ...request.alcohol!,
          id: first.workspace.draft.alcohol?.id ?? null
        }
      })
      expect(retry).toMatchObject({
        status: 'SAVED',
        workspace: { draft: { rowVersion: first.workspace.draft.rowVersion } }
      })
      expect(readCount(connection, 'audit_log')).toBe(auditCount)
      expect(readCount(connection, 'sync_outbox')).toBe(outboxCount)
    })
  })

  it('writes audit and outbox metadata without clinical answers', async () => {
    await withLifestyleService(({ service, connection }) => {
      const result = service.saveLifestyleDraft(createDraftRequest())
      expect(result.status).toBe('SAVED')
      const audit = connection.prepare('SELECT metadata_json FROM audit_log').get() as {
        metadata_json: string
      }
      const outbox = connection.prepare('SELECT payload_json FROM sync_outbox').get() as {
        payload_json: string
      }
      expect(audit.metadata_json).not.toContain('drinking_days')
      expect(audit.metadata_json).not.toContain('products')
      expect(outbox.payload_json).not.toContain('minutes')
    })
  })
})

interface Harness {
  readonly connection: Database.Database
  readonly service: ScreeningLifestyleService
  readonly currentSessionCalls: { count: number }
  readonly ensureCurrentSessionCalls: { count: number }
  readonly outboxFailure: { enabled: boolean }
}

async function withLifestyleService(
  test: (harness: Harness) => void,
  options: {
    readonly sessionRole?: LocalUserRole
    readonly authenticationFailure?: unknown
    readonly failOutbox?: boolean
    readonly currentSessionStatus?: 'FOUND' | 'SESSION_NOT_FOUND' | 'SESSION_CLOSED'
  } = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd041a-lifestyle-service-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => now)
    })(connection)
    seedCoreGraph(connection)
    const authenticationSessionService = createAuthenticationSessionService(
      options.sessionRole ?? 'NURSE',
      options.authenticationFailure
    )
    const currentSessionCalls = { count: 0 }
    const ensureCurrentSessionCalls = { count: 0 }
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(createQueuedIdGenerator()),
      clock: createUtcClock(() => later),
      logger: { error: vi.fn() }
    })
    const installationRepository = createInstallationRepository(connection)
    const locationRepository = createLocationRepository(connection)
    const sessionRepository = createScreeningSessionRepository(connection)
    const encounterRepository = createScreeningEncounterRepository(connection)
    const auditRepository = createAuditEventRepository(connection)
    const outboxFailure = { enabled: options.failOutbox === true }
    const outbox = createOutboxRepository(connection, outboxFailure)
    const installationLocationService = createInstallationLocationService({
      authenticationSessionService,
      installationRepository,
      installationLocationConfigurationRepository:
        createInstallationLocationConfigurationRepository(connection),
      locationRepository,
      screeningSessionRepository: sessionRepository,
      screeningEncounterRepository: encounterRepository,
      auditEventRepository: auditRepository,
      transactionExecutor: executor
    })
    const currentScreeningSessionService = createMockCurrentScreeningSessionService(
      currentSessionCalls,
      ensureCurrentSessionCalls,
      options.currentSessionStatus
    )
    const service = createScreeningLifestyleService({
      authenticationSessionService,
      currentScreeningSessionService,
      installationLocationService,
      installationRepository,
      locationRepository,
      screeningSessionRepository: sessionRepository,
      screeningEncounterRepository: encounterRepository,
      lifestyleRepository: createLifestyleRepository(connection),
      screeningEncounterOutboxRepository: outbox,
      auditEventRepository: auditRepository,
      transactionExecutor: executor
    })
    test({ connection, service, currentSessionCalls, ensureCurrentSessionCalls, outboxFailure })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function createMockCurrentScreeningSessionService(
  calls: { count: number },
  ensureCalls: { count: number },
  status: 'FOUND' | 'SESSION_NOT_FOUND' | 'SESSION_CLOSED' = 'FOUND'
): CurrentScreeningSessionService {
  const session = {
    id: parseEntityId(sessionId),
    locationId: parseEntityId(locationId),
    protocolVersionId: parseEntityId('00000000-0000-4000-8000-000000000007'),
    sessionDate: parseScreeningSessionDate('2026-08-06'),
    status: 'OPEN' as const,
    notes: null,
    openedAt: now as UtcTimestamp,
    closedAt: null,
    createdAt: now as UtcTimestamp,
    rowVersion: 1
  }
  return {
    ensureCurrentScreeningSession: vi.fn(() => {
      ensureCalls.count += 1
      return {
        status: 'RESOLVED',
        session,
        location: { id: parseEntityId(locationId), displayName: parseLocationName('Test Site') }
      }
    }),
    findCurrentScreeningSession: vi.fn(() => ({
      status: 'FOUND',
      session,
      location: { id: parseEntityId(locationId), displayName: parseLocationName('Test Site') }
    })),
    findCurrentScreeningSessionInTransaction: vi.fn(() => {
      calls.count += 1
      if (status !== 'FOUND') return { status }
      return {
        status: 'FOUND',
        session,
        location: { id: parseEntityId(locationId), displayName: parseLocationName('Test Site') }
      }
    })
  } as unknown as CurrentScreeningSessionService
}

function createAuthenticationSessionService(
  role: LocalUserRole,
  failure?: unknown
): LocalAuthenticationSessionService {
  const user: LocalUserRecord = {
    id: parseEntityId(nurseId),
    username: parseUsername('screening-user'),
    displayName: parseUserDisplayName('Screening User'),
    role,
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now as UtcTimestamp,
    createdAt: now as UtcTimestamp,
    updatedAt: now as UtcTimestamp
  }
  return {
    requireAnyRole: vi.fn(() => {
      if (failure !== undefined) throw failure
      if (!['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'].includes(role))
        throw new LocalSessionAuthorizationError()
      return {
        user,
        authenticatedAt: now,
        lastActivityAt: now,
        idleExpiresAt: later,
        absoluteExpiresAt: later
      } as never
    }),
    requireActiveSession: vi.fn(),
    getSnapshot: vi.fn(),
    recordActivity: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    login: vi.fn(),
    unlock: vi.fn(),
    changeRequiredPassword: vi.fn()
  } as unknown as LocalAuthenticationSessionService
}

function createDraftRequest(
  overrides: Partial<Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]> = {}
): Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0] {
  return {
    encounterId: parseEntityId(encounterId),
    expectedVersion: null,
    alcohol: null,
    tobacco: null,
    physicalActivity: null,
    work: null,
    otherActivityResponse: null,
    otherActivities: [],
    ...overrides
  }
}

function createCompleteRequest(
  overrides: Partial<Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]> = {}
): Parameters<ScreeningLifestyleService['completeLifestyle']>[0] {
  return {
    ...createDraftRequest(overrides),
    alcoholBaselineReviewConfirmedVersionId: null,
    tobaccoBaselineReviewConfirmedVersionId: null
  }
}

function completeWeeklyRequest(
  overrides: Partial<Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]> = {}
): Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0] {
  return createDraftRequest({
    alcohol: {
      id: null,
      weeklyResponse: 'YES',
      drinkingDays: 2,
      totalStandardizedDrinks: 3,
      largestOneDayAmount: 2,
      daysAtLargestAmount: 1,
      commonBeverageTypes: ['BEER'],
      otherBeverageDescription: null
    },
    tobacco: { id: null, weeklyResponse: 'YES', products: [product(null)] },
    physicalActivity: {
      id: null,
      weeklyResponse: 'YES',
      sedentaryTimeResponse: 'RECORDED',
      sedentaryMinutesPerDay: 60,
      activities: [activity(null)]
    },
    work: { id: null, weeklyResponse: 'USUAL' },
    otherActivityResponse: 'NO',
    ...overrides
  })
}

function alcoholBaselineRequest(): Parameters<ScreeningLifestyleService['saveAlcoholBaseline']>[0] {
  return {
    encounterId: parseEntityId(encounterId),
    expectedBaselineVersion: null,
    expectedDraftVersion: null,
    status: 'CURRENT' as const,
    everConsumed: 'YES' as const,
    consumedPast12Months: 'YES' as const,
    commonBeverageTypes: ['BEER'] as const,
    otherBeverageDescription: null
  }
}

function tobaccoBaselineRequest(): Parameters<ScreeningLifestyleService['saveTobaccoBaseline']>[0] {
  return {
    encounterId: parseEntityId(encounterId),
    expectedBaselineVersion: null,
    expectedDraftVersion: 0,
    status: 'CURRENT_DAILY' as const,
    everRegularlyUsed: 'YES' as const,
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'EVERY_DAY' as const,
    productTypes: ['CIGARETTE'] as const,
    otherProductDescription: null
  }
}

function workBaselineRequest(): Parameters<ScreeningLifestyleService['saveWorkBaseline']>[0] {
  return {
    encounterId: parseEntityId(encounterId),
    expectedBaselineVersion: null,
    expectedDraftVersion: 0,
    status: 'EMPLOYED' as const,
    occupationJobTitle: 'Worker',
    usualPhysicalDemand: 'WALKING' as const,
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY' as const,
    description: null
  }
}

function product(
  id: string | null
): NonNullable<
  Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]['tobacco']
>['products'][number] {
  return {
    id: id === null ? null : parseEntityId(id),
    sequenceNumber: 1,
    productType: 'CIGARETTE' as const,
    daysUsed: 1,
    averageQuantityPerUseDay: 1,
    unit: 'STICKS_CIGARETTES' as const,
    secondhandSmokeExposure: null,
    otherProductDescription: null,
    otherUnitDescription: null
  }
}

function activity(
  id: string | null
): NonNullable<
  Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]['physicalActivity']
>['activities'][number] {
  return {
    id: id === null ? null : parseEntityId(id),
    sequenceNumber: 1,
    activityDomain: 'EXERCISE' as const,
    description: null,
    intensity: 'MODERATE' as const,
    daysInPastSevenDays: 1,
    averageMinutesPerActiveDay: 30
  }
}

function otherActivity(
  id: string | null
): Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]['otherActivities'][number] {
  return {
    id: id === null ? null : parseEntityId(id),
    sequenceNumber: 1,
    category: 'OTHER' as const,
    description: 'Community activity',
    daysInPastSevenDays: 1,
    averageMinutesPerDay: 20,
    intensity: 'LIGHT' as const
  }
}

function seedCoreGraph(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, 'Local Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
  connection
    .prepare(
      `INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, ?, ?)`
    )
    .run(adminId, 'admin', 'admin', 'Admin User', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      `INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, ?, ?)`
    )
    .run(nurseId, 'screening-user', 'screening-user', 'Screening User', 'NURSE', now, now)
  connection
    .prepare(
      `INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, 'Test Site', 'test site', 'COMMUNITY_SITE', 1, ?, ?, ?, ?)`
    )
    .run(locationId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO patients (id, patient_code, display_name, given_name, family_name, name_normalized, sex, date_of_birth, status, created_by, created_at, updated_by, updated_at) VALUES (?, 'PT-000001', 'Test Patient', 'Test', 'Patient', 'test patient', 'UNKNOWN', '1990-01-01', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(patientId, adminId, now, adminId, now)
  connection
    .prepare(
      `INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, notes, opened_by, opened_at, closed_by, closed_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, '2026-08-06', 'OPEN', NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, 1)`
    )
    .run(
      sessionId,
      locationId,
      '00000000-0000-4000-8000-000000000007',
      adminId,
      now,
      adminId,
      now,
      adminId,
      now
    )
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (singleton_id, installation_id, location_id, configured_at, configured_by, updated_at, updated_by, row_version) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, locationId, now, adminId, now, adminId)
  connection
    .prepare(
      `INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, amendment_of_encounter_id, amendment_reason, void_reason, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, 1, ?, ?)`
    )
    .run(
      encounterId,
      patientId,
      sessionId,
      locationId,
      '00000000-0000-4000-8000-000000000007',
      now,
      nurseId,
      now,
      now
    )
}

function createOutboxRepository(
  connection: Database.Database,
  failure: { enabled: boolean }
): ScreeningEncounterOutboxRepository {
  const repository = createScreeningEncounterOutboxRepository(connection)
  return {
    ...repository,
    insert: vi.fn((...args: Parameters<ScreeningEncounterOutboxRepository['insert']>) => {
      if (failure.enabled) throw new Error('controlled outbox failure')
      return repository.insert(...args)
    })
  } as unknown as ScreeningEncounterOutboxRepository
}

function snapshotTable(connection: Database.Database, table: string): readonly unknown[] {
  return connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as readonly unknown[]
}

function createQueuedIdGenerator(): () => string {
  let next = 1
  return () => `96000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
}

function readCount(connection: Database.Database, table: string): number {
  return Number(
    (connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  )
}
