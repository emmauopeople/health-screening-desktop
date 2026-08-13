import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createLifestyleRepository,
  createProductionDatabaseMigrationRunner,
  RepositoryValidationError,
  RepositoryWriteError,
  type DatabaseTransactionExecutor,
  type LifestyleActivityInput,
  type LifestyleAlcoholBaselineInput,
  type LifestyleDraftOwnershipInput,
  type LifestyleDraftUpdateInput,
  type LifestyleOtherActivityInput,
  type LifestyleTobaccoBaselineInput,
  type LifestyleTobaccoProductInput,
  type LifestyleWorkBaselineInput
} from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import type { LifestyleDate } from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'

const ids = {
  installation: '11111111-1111-4111-8111-111111111111',
  otherInstallation: '11111111-1111-4111-8111-111111111112',
  user: '22222222-2222-4222-8222-222222222222',
  location: '33333333-3333-4333-8333-333333333333',
  protocol: '44444444-4444-4444-8444-444444444444',
  patient: '55555555-5555-4555-8555-555555555555',
  otherPatient: '55555555-5555-4555-8555-555555555556',
  session: '66666666-6666-4666-8666-666666666666',
  encounter: '77777777-7777-4777-8777-777777777777',
  otherEncounter: '77777777-7777-4777-8777-777777777778',
  alcoholBaseline1: '88888888-8888-4888-8888-888888888888',
  alcoholBaseline2: '99999999-9999-4999-8999-999999999999',
  alcoholBaseline3: '99999999-9999-4999-8999-999999999998',
  otherAlcoholBaseline: '88888888-8888-4888-8888-888888888887',
  crossInstallationAlcoholBaseline: '88888888-8888-4888-8888-888888888882',
  tobaccoBaseline: '88888888-8888-4888-8888-888888888886',
  otherTobaccoBaseline: '88888888-8888-4888-8888-888888888885',
  crossInstallationTobaccoBaseline: '88888888-8888-4888-8888-888888888881',
  workBaseline: '88888888-8888-4888-8888-888888888884',
  otherWorkBaseline: '88888888-8888-4888-8888-888888888883',
  crossInstallationWorkBaseline: '88888888-8888-4888-8888-888888888880',
  draft: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherDraft: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  alcohol: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tobacco: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  product: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  product2: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
  activity: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  activity2: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed',
  physical: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  work: '11111111-2222-4222-8222-111111111111',
  otherActivity1: '12345678-1234-4234-8234-1234567890ab',
  otherActivity2: '12345678-1234-4234-8234-1234567890ac',
  otherActivity3: '12345678-1234-4234-8234-1234567890ad',
  otherActivity4: '12345678-1234-4234-8234-1234567890ae',
  otherActivityForeign: '12345678-1234-4234-8234-1234567890af'
} as const

const firstTime = '2026-07-29T12:00:00.000Z' as UtcTimestamp
const secondTime = '2026-07-29T13:00:00.000Z' as UtcTimestamp
const thirdTime = '2026-07-29T14:00:00.000Z' as UtcTimestamp
const fourthTime = '2026-07-29T15:00:00.000Z' as UtcTimestamp
const periodStart = '2026-07-23' as LifestyleDate
const periodEnd = '2026-07-29' as LifestyleDate

describe('Lifestyle persistence foundation', () => {
  it('versions baselines and reconciles weekly records without changing unchanged timestamps', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const patientId = parseEntityId(ids.patient)
      const installationId = parseEntityId(ids.installation)
      const userId = parseEntityId(ids.user)
      const first = executor.run((context) =>
        repository.insertAlcoholBaseline(context.connection, {
          id: parseEntityId(ids.alcoholBaseline1),
          patientId,
          installationId,
          expectedCurrentVersion: null,
          status: 'CURRENT',
          everConsumed: 'YES',
          consumedPast12Months: 'YES',
          commonBeverageTypes: ['BEER'],
          otherBeverageDescription: null,
          actorId: userId,
          occurredAt: firstTime
        })
      )
      expect(first.status).toBe('INSERTED')
      const second = executor.run((context) =>
        repository.insertAlcoholBaseline(context.connection, {
          id: parseEntityId(ids.alcoholBaseline2),
          patientId,
          installationId,
          expectedCurrentVersion: 1,
          status: 'FORMER',
          everConsumed: 'YES',
          consumedPast12Months: 'NO',
          commonBeverageTypes: [],
          otherBeverageDescription: null,
          actorId: userId,
          occurredAt: secondTime
        })
      )
      expect(second.status).toBe('INSERTED')
      expect(
        repository.listAlcoholBaselineHistory(patientId, installationId).map((item) => item.version)
      ).toEqual([1, 2])
      expect(repository.findActiveAlcoholBaseline(patientId, installationId)?.id).toBe(
        ids.alcoholBaseline2
      )

      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, {
          id: parseEntityId(ids.draft),
          encounterId: parseEntityId(ids.encounter),
          patientId,
          screeningSessionId: parseEntityId(ids.session),
          locationId: parseEntityId(ids.location),
          installationId,
          periodStart,
          periodEnd,
          actorId: userId,
          occurredAt: firstTime
        })
      )
      expect(draft.periodStart).toBe('2026-07-23')
      expect(draft.periodEnd).toBe('2026-07-29')

      const firstUpdate = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: draft.id,
          expectedRowVersion: draft.rowVersion,
          status: 'IN_PROGRESS',
          alcoholBaselineVersionId: parseEntityId(ids.alcoholBaseline2),
          tobaccoBaselineVersionId: null,
          workBaselineVersionId: null,
          actorId: userId,
          occurredAt: secondTime,
          alcohol: {
            id: parseEntityId(ids.alcohol),
            weeklyResponse: 'YES',
            drinkingDays: 2,
            totalStandardizedDrinks: 3,
            largestOneDayAmount: 2,
            daysAtLargestAmount: 1,
            commonBeverageTypes: ['BEER'],
            otherBeverageDescription: null
          },
          tobacco: {
            id: parseEntityId(ids.tobacco),
            weeklyResponse: 'NO',
            products: [
              {
                id: parseEntityId(ids.product),
                sequenceNumber: 1,
                productType: 'VAPE',
                daysUsed: 1,
                averageQuantityPerUseDay: 1,
                unit: 'SESSIONS',
                secondhandSmokeExposure: null,
                otherProductDescription: null,
                otherUnitDescription: null
              }
            ]
          },
          physicalActivity: {
            id: parseEntityId(ids.physical),
            weeklyResponse: 'YES',
            sedentaryMinutesPerDay: 60,
            activities: [
              {
                id: parseEntityId(ids.activity),
                sequenceNumber: 1,
                activityDomain: 'EXERCISE',
                description: null,
                intensity: 'MODERATE',
                daysInPastSevenDays: 3,
                averageMinutesPerActiveDay: 20
              }
            ]
          },
          work: { id: parseEntityId(ids.work), weeklyResponse: 'USUAL' },
          otherActivities: []
        })
      )
      expect(firstUpdate.status).toBe('UPDATED')
      if (firstUpdate.status !== 'UPDATED') return
      const productCreatedAt = firstUpdate.draft.tobacco?.products[0]?.createdAt
      const productUpdatedAt = firstUpdate.draft.tobacco?.products[0]?.updatedAt
      const activityMinutes = firstUpdate.draft.physicalActivity?.activities[0]?.weeklyMinutes
      expect(activityMinutes).toBe(60)

      const unchanged = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: firstUpdate.draft.id,
          expectedRowVersion: firstUpdate.draft.rowVersion,
          status: 'IN_PROGRESS',
          alcoholBaselineVersionId: parseEntityId(ids.alcoholBaseline2),
          tobaccoBaselineVersionId: null,
          workBaselineVersionId: null,
          actorId: userId,
          occurredAt: thirdTime,
          alcohol: null,
          tobacco: {
            id: parseEntityId(ids.tobacco),
            weeklyResponse: 'NO',
            products: [
              {
                id: parseEntityId(ids.product),
                sequenceNumber: 1,
                productType: 'VAPE',
                daysUsed: 1,
                averageQuantityPerUseDay: 1,
                unit: 'SESSIONS',
                secondhandSmokeExposure: null,
                otherProductDescription: null,
                otherUnitDescription: null
              }
            ]
          },
          physicalActivity: null,
          work: null,
          otherActivities: []
        })
      )
      expect(unchanged.status).toBe('UPDATED')
      if (unchanged.status === 'UPDATED') {
        expect(unchanged.draft.tobacco?.products[0]?.createdAt).toBe(productCreatedAt)
        expect(unchanged.draft.tobacco?.products[0]?.updatedAt).toBe(productUpdatedAt)
      }

      const changed = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: firstUpdate.draft.id,
          expectedRowVersion: unchanged.status === 'UPDATED' ? unchanged.draft.rowVersion : 2,
          status: 'IN_PROGRESS',
          alcoholBaselineVersionId: parseEntityId(ids.alcoholBaseline2),
          tobaccoBaselineVersionId: null,
          workBaselineVersionId: null,
          actorId: userId,
          occurredAt: fourthTime,
          alcohol: null,
          tobacco: {
            id: parseEntityId(ids.tobacco),
            weeklyResponse: 'NO',
            products: [
              {
                id: parseEntityId(ids.product),
                sequenceNumber: 1,
                productType: 'VAPE',
                daysUsed: 2,
                averageQuantityPerUseDay: 1,
                unit: 'SESSIONS',
                secondhandSmokeExposure: null,
                otherProductDescription: null,
                otherUnitDescription: null
              }
            ]
          },
          physicalActivity: null,
          work: null,
          otherActivities: []
        })
      )
      expect(changed.status).toBe('UPDATED')
      if (changed.status === 'UPDATED') {
        expect(changed.draft.tobacco?.products[0]?.createdAt).toBe(productCreatedAt)
        expect(changed.draft.tobacco?.products[0]?.updatedAt).toBe('2026-07-29T15:00:00.000Z')
      }
    })
  })

  it('rejects duplicate child IDs and rolls back a failed update', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, {
          id: parseEntityId(ids.draft),
          encounterId: parseEntityId(ids.encounter),
          patientId: parseEntityId(ids.patient),
          screeningSessionId: parseEntityId(ids.session),
          locationId: parseEntityId(ids.location),
          installationId: parseEntityId(ids.installation),
          periodStart,
          periodEnd,
          actorId: parseEntityId(ids.user),
          occurredAt: firstTime
        })
      )
      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            status: 'DRAFT',
            alcoholBaselineVersionId: null,
            tobaccoBaselineVersionId: null,
            workBaselineVersionId: null,
            actorId: parseEntityId(ids.user),
            occurredAt: secondTime,
            alcohol: null,
            tobacco: {
              id: parseEntityId(ids.tobacco),
              weeklyResponse: 'YES',
              products: [
                {
                  id: parseEntityId(ids.product),
                  sequenceNumber: 1,
                  productType: 'VAPE',
                  daysUsed: 1,
                  averageQuantityPerUseDay: 1,
                  unit: 'SESSIONS',
                  secondhandSmokeExposure: null,
                  otherProductDescription: null,
                  otherUnitDescription: null
                },
                {
                  id: parseEntityId(ids.product),
                  sequenceNumber: 2,
                  productType: 'VAPE',
                  daysUsed: 1,
                  averageQuantityPerUseDay: 1,
                  unit: 'SESSIONS',
                  secondhandSmokeExposure: null,
                  otherProductDescription: null,
                  otherUnitDescription: null
                }
              ]
            },
            physicalActivity: null,
            work: null,
            otherActivities: []
          })
        )
      ).toThrow(RepositoryValidationError)
      expect(repository.findDraftByEncounter(parseEntityId(ids.encounter))?.rowVersion).toBe(1)
    })
  })

  it('rejects draft ownership mismatches against the persisted encounter', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const valid = createDraftInput()
      for (const input of [
        { ...valid, patientId: parseEntityId(ids.otherPatient) },
        { ...valid, screeningSessionId: parseEntityId(ids.otherEncounter) },
        { ...valid, locationId: parseEntityId(ids.otherEncounter) },
        { ...valid, installationId: parseEntityId(ids.otherEncounter) }
      ])
        expect(() =>
          executor.run((context) => repository.insertDraft(context.connection, input))
        ).toThrow(RepositoryValidationError)
      expect(repository.findDraftByEncounter(parseEntityId(ids.encounter))).toBeNull()
    })
  })

  it('rejects cross-patient baselines and stale baseline writes', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const userId = parseEntityId(ids.user)
      const patientId = parseEntityId(ids.patient)
      const otherPatientId = parseEntityId(ids.otherPatient)
      const installationId = parseEntityId(ids.installation)

      const first = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.alcoholBaseline1, patientId, null, firstTime)
        )
      )
      expect(first.status).toBe('INSERTED')
      const callerA = repository.findActiveAlcoholBaseline(patientId, installationId)
      const callerB = repository.findActiveAlcoholBaseline(patientId, installationId)
      const second = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(
            ids.alcoholBaseline2,
            patientId,
            callerA?.version ?? null,
            secondTime
          )
        )
      )
      expect(second.status).toBe('INSERTED')
      const stale = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.alcoholBaseline3, patientId, callerB?.version ?? null, thirdTime)
        )
      )
      expect(stale).toEqual({ status: 'VERSION_CONFLICT', currentVersion: 2 })
      expect(
        repository.listAlcoholBaselineHistory(patientId, installationId).map((item) => item.version)
      ).toEqual([1, 2])
      expect(repository.findActiveAlcoholBaseline(patientId, installationId)?.id).toBe(
        ids.alcoholBaseline2
      )

      const otherAlcohol = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.otherAlcoholBaseline, otherPatientId, null, firstTime)
        )
      )
      expect(otherAlcohol.status).toBe('INSERTED')
      const otherTobacco = executor.run((context) =>
        repository.insertTobaccoBaseline(context.connection, {
          id: parseEntityId(ids.otherTobaccoBaseline),
          patientId: otherPatientId,
          installationId,
          expectedCurrentVersion: null,
          status: 'NEVER',
          everRegularlyUsed: 'NO',
          formerUseApproximateStopDate: null,
          currentUseFrequency: 'NOT_AT_ALL',
          productTypes: [],
          otherProductDescription: null,
          actorId: userId,
          occurredAt: firstTime
        })
      )
      expect(otherTobacco.status).toBe('INSERTED')
      const otherWork = executor.run((context) =>
        repository.insertWorkBaseline(context.connection, {
          id: parseEntityId(ids.otherWorkBaseline),
          patientId: otherPatientId,
          installationId,
          expectedCurrentVersion: null,
          status: 'RETIRED',
          occupationJobTitle: null,
          usualPhysicalDemand: null,
          typicalWorkdaysPerWeek: null,
          typicalHoursPerWorkday: null,
          shiftPattern: null,
          description: null,
          actorId: userId,
          occurredAt: firstTime
        })
      )
      expect(otherWork.status).toBe('INSERTED')

      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      for (const references of [
        {
          alcoholBaselineVersionId: parseEntityId(ids.otherAlcoholBaseline),
          tobaccoBaselineVersionId: null,
          workBaselineVersionId: null
        },
        {
          alcoholBaselineVersionId: null,
          tobaccoBaselineVersionId: parseEntityId(ids.otherTobaccoBaseline),
          workBaselineVersionId: null
        },
        {
          alcoholBaselineVersionId: null,
          tobaccoBaselineVersionId: null,
          workBaselineVersionId: parseEntityId(ids.otherWorkBaseline)
        }
      ])
        expect(() =>
          executor.run((context) =>
            repository.updateDraft(context.connection, {
              ...emptyDraftUpdate(draft.id, draft.rowVersion, secondTime),
              ...references
            })
          )
        ).toThrow(RepositoryValidationError)

      expect(() =>
        executor.run((context) =>
          repository.insertAlcoholBaseline(context.connection, {
            ...alcoholBaselineInput(ids.alcoholBaseline3, patientId, null, thirdTime),
            installationId: parseEntityId(ids.otherEncounter)
          })
        )
      ).toThrow(RepositoryWriteError)
    })
  })

  it('reconciles other activity order without touching unchanged rows', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      const firstUpdate = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(draft.id, draft.rowVersion, secondTime),
          otherActivities: [
            otherActivity(ids.otherActivity1, 1, 'HOUSEHOLD', 'A'),
            otherActivity(ids.otherActivity2, 2, 'COMMUNITY', 'B')
          ]
        })
      )
      expect(firstUpdate.status).toBe('UPDATED')
      if (firstUpdate.status !== 'UPDATED') return
      const originalA = firstUpdate.draft.otherActivities[0]
      const originalB = firstUpdate.draft.otherActivities[1]

      const swapped = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(firstUpdate.draft.id, firstUpdate.draft.rowVersion, thirdTime),
          otherActivities: [
            otherActivity(ids.otherActivity2, 1, 'COMMUNITY', 'B'),
            otherActivity(ids.otherActivity1, 2, 'HOUSEHOLD', 'A')
          ]
        })
      )
      expect(swapped.status).toBe('UPDATED')
      if (swapped.status !== 'UPDATED') return
      expect(swapped.draft.otherActivities.map((item) => item.id)).toEqual([
        ids.otherActivity2,
        ids.otherActivity1
      ])
      expect(swapped.draft.otherActivities[0]?.createdAt).toBe(originalB?.createdAt)
      expect(swapped.draft.otherActivities[1]?.createdAt).toBe(originalA?.createdAt)
      expect(swapped.draft.otherActivities[0]?.updatedAt).toBe(thirdTime)
      expect(swapped.draft.otherActivities[1]?.updatedAt).toBe(thirdTime)

      const mixed = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(swapped.draft.id, swapped.draft.rowVersion, fourthTime),
          otherActivities: [
            otherActivity(ids.otherActivity2, 1, 'COMMUNITY', 'B'),
            otherActivity(ids.otherActivity3, 2, 'SPORT', 'C'),
            otherActivity(ids.otherActivity1, 3, 'HOUSEHOLD', 'A2')
          ]
        })
      )
      expect(mixed.status).toBe('UPDATED')
      if (mixed.status !== 'UPDATED') return
      const preserved = mixed.draft.otherActivities.find((item) => item.id === ids.otherActivity2)
      const changed = mixed.draft.otherActivities.find((item) => item.id === ids.otherActivity1)
      const added = mixed.draft.otherActivities.find((item) => item.id === ids.otherActivity3)
      expect(preserved?.createdAt).toBe(originalB?.createdAt)
      expect(preserved?.updatedAt).toBe(thirdTime)
      expect(changed?.createdAt).toBe(originalA?.createdAt)
      expect(changed?.updatedAt).toBe(fourthTime)
      expect(added?.createdAt).toBe(fourthTime)
      expect(added?.updatedAt).toBe(fourthTime)
    })
  })

  it('allocates ordered child temporary sequences above persisted and submitted values', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      const firstUpdate = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(draft.id, draft.rowVersion, firstTime),
          otherActivities: [
            otherActivity(ids.otherActivity1, 1, 'HOUSEHOLD', 'A'),
            otherActivity(ids.otherActivity2, 1000001, 'COMMUNITY', 'B')
          ]
        })
      )
      expect(firstUpdate.status).toBe('UPDATED')
      if (firstUpdate.status !== 'UPDATED') return
      const unchangedHighSequence = firstUpdate.draft.otherActivities.find(
        (item) => item.id === ids.otherActivity2
      )

      const insertedAboveSubmitted = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(firstUpdate.draft.id, firstUpdate.draft.rowVersion, secondTime),
          otherActivities: [
            otherActivity(ids.otherActivity1, 2, 'HOUSEHOLD', 'A'),
            otherActivity(ids.otherActivity2, 1000001, 'COMMUNITY', 'B'),
            otherActivity(ids.otherActivity3, 2000000, 'SPORT', 'C')
          ]
        })
      )
      expect(insertedAboveSubmitted.status).toBe('UPDATED')
      if (insertedAboveSubmitted.status !== 'UPDATED') return
      const preservedHighSequence = insertedAboveSubmitted.draft.otherActivities.find(
        (item) => item.id === ids.otherActivity2
      )
      const movedLowSequence = insertedAboveSubmitted.draft.otherActivities.find(
        (item) => item.id === ids.otherActivity1
      )
      const insertedHighSequence = insertedAboveSubmitted.draft.otherActivities.find(
        (item) => item.id === ids.otherActivity3
      )
      expect(preservedHighSequence?.sequenceNumber).toBe(1000001)
      expect(preservedHighSequence?.createdAt).toBe(unchangedHighSequence?.createdAt)
      expect(preservedHighSequence?.updatedAt).toBe(unchangedHighSequence?.updatedAt)
      expect(movedLowSequence?.sequenceNumber).toBe(2)
      expect(movedLowSequence?.updatedAt).toBe(secondTime)
      expect(insertedHighSequence?.sequenceNumber).toBe(2000000)
      expect(insertedHighSequence?.createdAt).toBe(secondTime)

      const multipleMoved = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(
            insertedAboveSubmitted.draft.id,
            insertedAboveSubmitted.draft.rowVersion,
            thirdTime
          ),
          otherActivities: [
            otherActivity(ids.otherActivity3, 2, 'SPORT', 'C'),
            otherActivity(ids.otherActivity1, 3, 'HOUSEHOLD', 'A'),
            otherActivity(ids.otherActivity2, 1000001, 'COMMUNITY', 'B')
          ]
        })
      )
      expect(multipleMoved.status).toBe('UPDATED')
      if (multipleMoved.status !== 'UPDATED') return
      expect(
        multipleMoved.draft.otherActivities.map((item) => [item.id, item.sequenceNumber])
      ).toEqual([
        [ids.otherActivity3, 2],
        [ids.otherActivity1, 3],
        [ids.otherActivity2, 1000001]
      ])
      expect(
        multipleMoved.draft.otherActivities.find((item) => item.id === ids.otherActivity2)
          ?.updatedAt
      ).toBe(unchangedHighSequence?.updatedAt)
      expect(
        multipleMoved.draft.otherActivities.find((item) => item.id === ids.otherActivity1)
          ?.updatedAt
      ).toBe(thirdTime)
      expect(
        multipleMoved.draft.otherActivities.find((item) => item.id === ids.otherActivity3)
          ?.updatedAt
      ).toBe(thirdTime)
    })
  })

  it('rejects ordered reconciliation when no safe temporary sequence range exists', async () => {
    await withLifestyleDatabase(({ executor, repository }) => {
      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      const firstUpdate = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(draft.id, draft.rowVersion, firstTime),
          otherActivities: [
            otherActivity(ids.otherActivity1, 1, 'HOUSEHOLD', 'A'),
            otherActivity(ids.otherActivity2, Number.MAX_SAFE_INTEGER, 'COMMUNITY', 'B')
          ]
        })
      )
      expect(firstUpdate.status).toBe('UPDATED')
      if (firstUpdate.status !== 'UPDATED') return
      const unchangedMaxSequence = firstUpdate.draft.otherActivities.find(
        (item) => item.id === ids.otherActivity2
      )

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            ...emptyDraftUpdate(firstUpdate.draft.id, firstUpdate.draft.rowVersion, secondTime),
            otherActivities: [
              otherActivity(ids.otherActivity1, 2, 'HOUSEHOLD', 'A'),
              otherActivity(ids.otherActivity2, Number.MAX_SAFE_INTEGER, 'COMMUNITY', 'B')
            ]
          })
        )
      ).toThrow(RepositoryValidationError)

      const recovered = repository.findDraftByEncounter(parseEntityId(ids.encounter))
      const maxSequenceRow = recovered?.otherActivities.find(
        (item) => item.id === ids.otherActivity2
      )
      expect(recovered?.otherActivities.map((item) => [item.id, item.sequenceNumber])).toEqual([
        [ids.otherActivity1, 1],
        [ids.otherActivity2, Number.MAX_SAFE_INTEGER]
      ])
      expect(maxSequenceRow?.createdAt).toBe(unchangedMaxSequence?.createdAt)
      expect(maxSequenceRow?.updatedAt).toBe(unchangedMaxSequence?.updatedAt)
    })
  })

  it('enforces critical database constraints through direct SQL', async () => {
    await withLifestyleDatabase(({ connection, executor, repository }) => {
      const patientId = parseEntityId(ids.patient)
      const installationId = parseEntityId(ids.installation)
      const otherPatientId = parseEntityId(ids.otherPatient)
      const validAlcohol = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.alcoholBaseline1, patientId, null, firstTime)
        )
      )
      const otherAlcohol = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.otherAlcoholBaseline, otherPatientId, null, firstTime)
        )
      )
      const validTobacco = executor.run((context) =>
        repository.insertTobaccoBaseline(
          context.connection,
          tobaccoBaselineInput(ids.tobaccoBaseline, patientId, null, firstTime)
        )
      )
      const otherTobacco = executor.run((context) =>
        repository.insertTobaccoBaseline(
          context.connection,
          tobaccoBaselineInput(ids.otherTobaccoBaseline, otherPatientId, null, firstTime)
        )
      )
      const validWork = executor.run((context) =>
        repository.insertWorkBaseline(
          context.connection,
          workBaselineInput(ids.workBaseline, patientId, null, firstTime)
        )
      )
      const otherWork = executor.run((context) =>
        repository.insertWorkBaseline(
          context.connection,
          workBaselineInput(ids.otherWorkBaseline, otherPatientId, null, firstTime)
        )
      )
      expect(validAlcohol.status).toBe('INSERTED')
      expect(otherAlcohol.status).toBe('INSERTED')
      expect(validTobacco.status).toBe('INSERTED')
      expect(otherTobacco.status).toBe('INSERTED')
      expect(validWork.status).toBe('INSERTED')
      expect(otherWork.status).toBe('INSERTED')

      expect(() =>
        insertDraftDirect(connection, {
          id: ids.draft,
          patientId: ids.patient,
          periodStart: '2026-02-30',
          periodEnd: '2026-03-01',
          alcoholBaselineVersionId: null
        })
      ).toThrow()
      expect(() =>
        insertDraftDirect(connection, {
          id: ids.draft,
          patientId: ids.patient,
          periodStart: '2026-07-30',
          periodEnd: '2026-07-29',
          alcoholBaselineVersionId: null
        })
      ).toThrow()
      expect(() =>
        insertDraftDirect(connection, {
          id: ids.draft,
          patientId: ids.otherPatient,
          periodStart,
          periodEnd,
          alcoholBaselineVersionId: null
        })
      ).toThrow()
      expect(() =>
        insertDraftDirect(connection, {
          id: ids.draft,
          patientId: ids.patient,
          periodStart,
          periodEnd,
          alcoholBaselineVersionId: ids.otherAlcoholBaseline
        })
      ).toThrow()

      const draft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      expect(() =>
        insertDraftDirect(connection, {
          id: ids.otherDraft,
          patientId: ids.patient,
          periodStart,
          periodEnd,
          alcoholBaselineVersionId: null
        })
      ).toThrow()

      expect(() =>
        updateBaselineReferencesDirect(connection, draft.id, {
          alcohol: ids.alcoholBaseline1,
          tobacco: ids.tobaccoBaseline,
          work: ids.workBaseline
        })
      ).not.toThrow()
      expect(readDraftBaselineReferences(connection, draft.id)).toEqual({
        alcohol: ids.alcoholBaseline1,
        tobacco: ids.tobaccoBaseline,
        work: ids.workBaseline
      })
      expect(() =>
        updateBaselineReferencesDirect(connection, draft.id, {
          alcohol: null,
          tobacco: null,
          work: null
        })
      ).not.toThrow()
      expect(readDraftBaselineReferences(connection, draft.id)).toEqual({
        alcohol: null,
        tobacco: null,
        work: null
      })
      updateBaselineReferencesDirect(connection, draft.id, {
        alcohol: ids.alcoholBaseline1,
        tobacco: ids.tobaccoBaseline,
        work: ids.workBaseline
      })
      insertCrossInstallationBaselineFixtures(connection)
      for (const mismatch of [
        { alcohol: ids.otherAlcoholBaseline },
        { alcohol: ids.crossInstallationAlcoholBaseline },
        { tobacco: ids.otherTobaccoBaseline },
        { tobacco: ids.crossInstallationTobaccoBaseline },
        { work: ids.otherWorkBaseline },
        { work: ids.crossInstallationWorkBaseline }
      ] as const) {
        const before = readDraftBaselineReferences(connection, draft.id)
        expect(() => updateBaselineReferencesDirect(connection, draft.id, mismatch)).toThrow()
        expect(readDraftBaselineReferences(connection, draft.id)).toEqual(before)
      }
      deleteCrossInstallationBaselineFixtures(connection)

      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'NO', 1, NULL, NULL, NULL, '[]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', NULL, NULL, NULL, NULL, '[\"OTHER\"]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).not.toThrow()
      expect(
        connection
          .prepare(
            'SELECT drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount FROM lifestyle_alcohol_weekly_records WHERE id = ?'
          )
          .get(ids.alcohol)
      ).toEqual({
        drinking_days: null,
        total_standardized_drinks: null,
        largest_one_day_amount: null,
        days_at_largest_amount: null
      })
      connection
        .prepare('DELETE FROM lifestyle_alcohol_weekly_records WHERE id = ?')
        .run(ids.alcohol)
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', 0, NULL, NULL, NULL, '[]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', NULL, 0, NULL, NULL, '[]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', NULL, 1, 2, NULL, '[]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', 1, NULL, NULL, 2, '[]', NULL, ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_weekly_records (id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks, largest_one_day_amount, days_at_largest_amount, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, 'YES', NULL, NULL, NULL, NULL, '[]', 'hidden', ?, ?, ?, ?)"
          )
          .run(ids.alcohol, draft.id, ids.user, firstTime, ids.user, firstTime)
      ).toThrow()
      expect(() =>
        connection
          .prepare(
            "INSERT INTO lifestyle_alcohol_baseline_versions (id, patient_id, installation_id, version, status, ever_consumed, consumed_past_12_months, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 'CURRENT', 'YES', 'YES', '[]', NULL, ?, ?, ?, ?)"
          )
          .run(
            ids.alcoholBaseline2,
            patientId,
            installationId,
            ids.user,
            firstTime,
            ids.user,
            firstTime
          )
      ).toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })

  it('passes SQLite foreign key and integrity checks after fresh and upgraded migrations', async () => {
    await withTemporaryConnection((connection) => {
      connection.pragma('foreign_keys = ON')
      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: createUtcClock(() => firstTime)
      })(connection)
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(countRows(connection, 'lifestyle_drafts')).toBe(0)
      expect(countRows(connection, 'lifestyle_alcohol_baseline_versions')).toBe(0)
    })

    await withTemporaryConnection((connection) => {
      connection.pragma('foreign_keys = ON')
      runDatabaseMigrations({
        connection,
        migrations: databaseMigrations.slice(0, 8),
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: createUtcClock(() => firstTime),
        expectedHighestVersion: 8
      })
      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() },
        clock: createUtcClock(() => secondTime)
      })(connection)
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(countRows(connection, 'lifestyle_drafts')).toBe(0)
      expect(countRows(connection, 'lifestyle_alcohol_baseline_versions')).toBe(0)
    })
  })

  it('rolls back a failed weekly aggregate transaction across child tables', async () => {
    await withLifestyleDatabase(({ connection, executor, repository }) => {
      const baseline = executor.run((context) =>
        repository.insertAlcoholBaseline(
          context.connection,
          alcoholBaselineInput(ids.alcoholBaseline1, parseEntityId(ids.patient), null, firstTime)
        )
      )
      expect(baseline.status).toBe('INSERTED')
      const firstDraft = executor.run((context) =>
        repository.insertDraft(context.connection, createDraftInput())
      )
      const referencedDraft = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(firstDraft.id, firstDraft.rowVersion, secondTime),
          alcoholBaselineVersionId: parseEntityId(ids.alcoholBaseline1)
        })
      )
      expect(referencedDraft.status).toBe('UPDATED')
      if (referencedDraft.status !== 'UPDATED') return
      const secondDraft = executor.run((context) =>
        repository.insertDraft(context.connection, {
          ...createDraftInput(),
          id: parseEntityId(ids.otherDraft),
          encounterId: parseEntityId(ids.otherEncounter),
          patientId: parseEntityId(ids.otherPatient)
        })
      )
      const secondUpdated = executor.run((context) =>
        repository.updateDraft(context.connection, {
          ...emptyDraftUpdate(secondDraft.id, secondDraft.rowVersion, secondTime),
          otherActivities: [otherActivity(ids.otherActivityForeign, 1, 'SPORT', 'Foreign')]
        })
      )
      expect(secondUpdated.status).toBe('UPDATED')
      const before = readWeeklyAggregateTableState(connection, firstDraft.id)

      expect(() =>
        executor.run((context) => {
          const nextBaseline = repository.insertAlcoholBaseline(
            context.connection,
            alcoholBaselineInput(ids.alcoholBaseline2, parseEntityId(ids.patient), 1, thirdTime)
          )
          expect(nextBaseline.status).toBe('INSERTED')
          repository.updateDraft(context.connection, {
            ...emptyDraftUpdate(
              referencedDraft.draft.id,
              referencedDraft.draft.rowVersion,
              thirdTime
            ),
            alcoholBaselineVersionId: parseEntityId(ids.alcoholBaseline2),
            alcohol: {
              id: parseEntityId(ids.alcohol),
              weeklyResponse: 'YES',
              drinkingDays: 2,
              totalStandardizedDrinks: 3,
              largestOneDayAmount: 2,
              daysAtLargestAmount: 1,
              commonBeverageTypes: ['BEER'],
              otherBeverageDescription: null
            },
            tobacco: {
              id: parseEntityId(ids.tobacco),
              weeklyResponse: 'YES',
              products: [tobaccoProduct(ids.product, 1, 2)]
            },
            physicalActivity: {
              id: parseEntityId(ids.physical),
              weeklyResponse: 'YES',
              sedentaryMinutesPerDay: 60,
              activities: [activity(ids.activity, 1, 3)]
            },
            work: { id: parseEntityId(ids.work), weeklyResponse: 'USUAL' },
            otherActivities: [otherActivity(ids.otherActivityForeign, 1, 'SPORT', 'Cross draft')]
          })
        })
      ).toThrow(RepositoryValidationError)

      const after = readWeeklyAggregateTableState(connection, firstDraft.id)
      expect(after).toEqual(before)
      expect(
        repository.findActiveAlcoholBaseline(
          parseEntityId(ids.patient),
          parseEntityId(ids.installation)
        )?.id
      ).toBe(ids.alcoholBaseline1)
      expect(
        connection
          .prepare('SELECT COUNT(*) AS count FROM lifestyle_alcohol_baseline_versions WHERE id = ?')
          .get(ids.alcoholBaseline2)
      ).toEqual({ count: 0 })
    })
  })
})

function createDraftInput(): LifestyleDraftOwnershipInput {
  return {
    id: parseEntityId(ids.draft),
    encounterId: parseEntityId(ids.encounter),
    patientId: parseEntityId(ids.patient),
    screeningSessionId: parseEntityId(ids.session),
    locationId: parseEntityId(ids.location),
    installationId: parseEntityId(ids.installation),
    periodStart,
    periodEnd,
    actorId: parseEntityId(ids.user),
    occurredAt: firstTime
  }
}

function emptyDraftUpdate(
  id: ReturnType<typeof parseEntityId>,
  expectedRowVersion: number,
  occurredAt: UtcTimestamp
): LifestyleDraftUpdateInput {
  return {
    id,
    expectedRowVersion,
    status: 'IN_PROGRESS',
    alcoholBaselineVersionId: null,
    tobaccoBaselineVersionId: null,
    workBaselineVersionId: null,
    actorId: parseEntityId(ids.user),
    occurredAt,
    alcohol: null,
    tobacco: null,
    physicalActivity: null,
    work: null,
    otherActivities: []
  }
}

function alcoholBaselineInput(
  id: string,
  patientId: ReturnType<typeof parseEntityId>,
  expectedCurrentVersion: number | null,
  occurredAt: UtcTimestamp
): LifestyleAlcoholBaselineInput {
  return {
    id: parseEntityId(id),
    patientId,
    installationId: parseEntityId(ids.installation),
    expectedCurrentVersion,
    status: 'CURRENT',
    everConsumed: 'YES',
    consumedPast12Months: 'YES',
    commonBeverageTypes: ['BEER'],
    otherBeverageDescription: null,
    actorId: parseEntityId(ids.user),
    occurredAt
  }
}

function tobaccoBaselineInput(
  id: string,
  patientId: ReturnType<typeof parseEntityId>,
  expectedCurrentVersion: number | null,
  occurredAt: UtcTimestamp
): LifestyleTobaccoBaselineInput {
  return {
    id: parseEntityId(id),
    patientId,
    installationId: parseEntityId(ids.installation),
    expectedCurrentVersion,
    status: 'CURRENT_DAILY',
    everRegularlyUsed: 'YES',
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'EVERY_DAY',
    productTypes: ['VAPE'],
    otherProductDescription: null,
    actorId: parseEntityId(ids.user),
    occurredAt
  }
}

function workBaselineInput(
  id: string,
  patientId: ReturnType<typeof parseEntityId>,
  expectedCurrentVersion: number | null,
  occurredAt: UtcTimestamp
): LifestyleWorkBaselineInput {
  return {
    id: parseEntityId(id),
    patientId,
    installationId: parseEntityId(ids.installation),
    expectedCurrentVersion,
    status: 'EMPLOYED',
    occupationJobTitle: 'Role',
    usualPhysicalDemand: 'STANDING',
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY',
    description: null,
    actorId: parseEntityId(ids.user),
    occurredAt
  }
}

function tobaccoProduct(
  id: string,
  sequenceNumber: number,
  daysUsed: number
): LifestyleTobaccoProductInput {
  return {
    id: parseEntityId(id),
    sequenceNumber,
    productType: 'VAPE',
    daysUsed,
    averageQuantityPerUseDay: 1,
    unit: 'SESSIONS',
    secondhandSmokeExposure: null,
    otherProductDescription: null,
    otherUnitDescription: null
  }
}

function activity(id: string, sequenceNumber: number, days: number): LifestyleActivityInput {
  return {
    id: parseEntityId(id),
    sequenceNumber,
    activityDomain: 'EXERCISE',
    description: null,
    intensity: 'MODERATE',
    daysInPastSevenDays: days,
    averageMinutesPerActiveDay: 20
  }
}

function otherActivity(
  id: string,
  sequenceNumber: number,
  category: 'HOUSEHOLD' | 'COMMUNITY' | 'SPORT',
  description: string
): LifestyleOtherActivityInput {
  return {
    id: parseEntityId(id),
    sequenceNumber,
    category,
    description,
    daysInPastSevenDays: 2,
    averageMinutesPerDay: 30,
    intensity: 'MODERATE'
  }
}

function insertDraftDirect(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly patientId: string
    readonly periodStart: string
    readonly periodEnd: string
    readonly alcoholBaselineVersionId: string | null
  }
): void {
  connection
    .prepare(
      "INSERT INTO lifestyle_drafts (id, encounter_id, status, patient_id, screening_session_id, location_id, installation_id, period_start, period_end, alcohol_baseline_version_id, tobacco_baseline_version_id, work_baseline_version_id, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1)"
    )
    .run(
      input.id,
      ids.encounter,
      input.patientId,
      ids.session,
      ids.location,
      ids.installation,
      input.periodStart,
      input.periodEnd,
      input.alcoholBaselineVersionId,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
}

function updateBaselineReferencesDirect(
  connection: Database.Database,
  draftId: string,
  references: {
    readonly alcohol?: string | null
    readonly tobacco?: string | null
    readonly work?: string | null
  }
): void {
  const current = readDraftBaselineReferences(connection, draftId)
  connection
    .prepare(
      'UPDATE lifestyle_drafts SET alcohol_baseline_version_id = ?, tobacco_baseline_version_id = ?, work_baseline_version_id = ? WHERE id = ?'
    )
    .run(
      references.alcohol === undefined ? current.alcohol : references.alcohol,
      references.tobacco === undefined ? current.tobacco : references.tobacco,
      references.work === undefined ? current.work : references.work,
      draftId
    )
}

function readDraftBaselineReferences(
  connection: Database.Database,
  draftId: string
): {
  readonly alcohol: string | null
  readonly tobacco: string | null
  readonly work: string | null
} {
  const row = connection
    .prepare(
      'SELECT alcohol_baseline_version_id, tobacco_baseline_version_id, work_baseline_version_id FROM lifestyle_drafts WHERE id = ?'
    )
    .get(draftId) as {
    readonly alcohol_baseline_version_id: string | null
    readonly tobacco_baseline_version_id: string | null
    readonly work_baseline_version_id: string | null
  }
  return {
    alcohol: row.alcohol_baseline_version_id,
    tobacco: row.tobacco_baseline_version_id,
    work: row.work_baseline_version_id
  }
}

function insertCrossInstallationBaselineFixtures(connection: Database.Database): void {
  connection.pragma('foreign_keys = OFF')
  connection
    .prepare(
      "INSERT INTO lifestyle_alcohol_baseline_versions (id, patient_id, installation_id, version, status, ever_consumed, consumed_past_12_months, common_beverage_types_json, other_beverage_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 'CURRENT', 'YES', 'YES', '[]', NULL, ?, ?, ?, ?)"
    )
    .run(
      ids.crossInstallationAlcoholBaseline,
      ids.patient,
      ids.otherInstallation,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  connection
    .prepare(
      "INSERT INTO lifestyle_tobacco_baseline_versions (id, patient_id, installation_id, version, status, ever_regularly_used, former_use_approximate_stop_date, current_use_frequency, product_types_json, other_product_description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 'CURRENT_DAILY', 'YES', NULL, 'EVERY_DAY', '[\"VAPE\"]', NULL, ?, ?, ?, ?)"
    )
    .run(
      ids.crossInstallationTobaccoBaseline,
      ids.patient,
      ids.otherInstallation,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  connection
    .prepare(
      "INSERT INTO lifestyle_work_baseline_versions (id, patient_id, installation_id, version, status, occupation_job_title, usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday, shift_pattern, description, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, 1, 'EMPLOYED', 'Role', 'STANDING', 5, 8, 'DAY', NULL, ?, ?, ?, ?)"
    )
    .run(
      ids.crossInstallationWorkBaseline,
      ids.patient,
      ids.otherInstallation,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  connection.pragma('foreign_keys = ON')
}

function deleteCrossInstallationBaselineFixtures(connection: Database.Database): void {
  connection
    .prepare('DELETE FROM lifestyle_work_baseline_versions WHERE id = ?')
    .run(ids.crossInstallationWorkBaseline)
  connection
    .prepare('DELETE FROM lifestyle_tobacco_baseline_versions WHERE id = ?')
    .run(ids.crossInstallationTobaccoBaseline)
  connection
    .prepare('DELETE FROM lifestyle_alcohol_baseline_versions WHERE id = ?')
    .run(ids.crossInstallationAlcoholBaseline)
}

function readWeeklyAggregateTableState(
  connection: Database.Database,
  draftId: ReturnType<typeof parseEntityId>
): Record<string, readonly Record<string, unknown>[]> {
  return {
    alcoholBaselines: queryRows(
      connection,
      'SELECT * FROM lifestyle_alcohol_baseline_versions WHERE patient_id = ? AND installation_id = ? ORDER BY version, id',
      ids.patient,
      ids.installation
    ),
    draft: queryRows(connection, 'SELECT * FROM lifestyle_drafts WHERE id = ?', draftId),
    alcoholWeekly: queryRows(
      connection,
      'SELECT * FROM lifestyle_alcohol_weekly_records WHERE lifestyle_draft_id = ? ORDER BY id',
      draftId
    ),
    tobaccoWeekly: queryRows(
      connection,
      'SELECT * FROM lifestyle_tobacco_weekly_records WHERE lifestyle_draft_id = ? ORDER BY id',
      draftId
    ),
    tobaccoProducts: queryRows(
      connection,
      'SELECT * FROM lifestyle_tobacco_product_rows WHERE tobacco_weekly_record_id IN (SELECT id FROM lifestyle_tobacco_weekly_records WHERE lifestyle_draft_id = ?) ORDER BY tobacco_weekly_record_id, sequence_number, id',
      draftId
    ),
    physicalWeekly: queryRows(
      connection,
      'SELECT * FROM lifestyle_physical_activity_weekly_records WHERE lifestyle_draft_id = ? ORDER BY id',
      draftId
    ),
    physicalActivities: queryRows(
      connection,
      'SELECT * FROM lifestyle_activity_rows WHERE physical_activity_weekly_record_id IN (SELECT id FROM lifestyle_physical_activity_weekly_records WHERE lifestyle_draft_id = ?) ORDER BY physical_activity_weekly_record_id, sequence_number, id',
      draftId
    ),
    workWeekly: queryRows(
      connection,
      'SELECT * FROM lifestyle_work_weekly_records WHERE lifestyle_draft_id = ? ORDER BY id',
      draftId
    ),
    otherActivities: queryRows(
      connection,
      'SELECT * FROM lifestyle_other_activity_rows WHERE lifestyle_draft_id = ? ORDER BY sequence_number, id',
      draftId
    )
  }
}

function queryRows(
  connection: Database.Database,
  sql: string,
  ...parameters: readonly unknown[]
): readonly Record<string, unknown>[] {
  return connection.prepare(sql).all(...parameters) as Record<string, unknown>[]
}

async function withLifestyleDatabase(
  test: (context: {
    connection: Database.Database
    repository: ReturnType<typeof createLifestyleRepository>
    executor: DatabaseTransactionExecutor
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd040-lifestyle-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => firstTime)
    })(connection)
    seedDatabase(connection)
    test({
      connection,
      repository: createLifestyleRepository(connection),
      executor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: { generate: () => parseEntityId(ids.draft) },
        clock: createUtcClock(() => firstTime),
        logger: { error: vi.fn() }
      })
    })
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function withTemporaryConnection(
  test: (connection: Database.Database) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd040-lifestyle-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function countRows(connection: Database.Database, table: string): number {
  return Number(
    (connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  )
}

function seedDatabase(connection: Database.Database): void {
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
      'CLINIC',
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  const protocolId = String(
    (
      connection
        .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
        .get() as { id: string }
    ).id
  )
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
      '2026-07-29',
      'OPEN',
      ids.user,
      firstTime,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      ids.encounter,
      ids.patient,
      ids.session,
      ids.location,
      protocolId,
      'DRAFT',
      firstTime,
      'LOCAL',
      ids.user,
      firstTime,
      firstTime
    )
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      ids.otherEncounter,
      ids.otherPatient,
      ids.session,
      ids.location,
      protocolId,
      'DRAFT',
      firstTime,
      'LOCAL',
      ids.user,
      firstTime,
      firstTime
    )
}
