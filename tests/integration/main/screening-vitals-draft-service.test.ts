import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createCurrentScreeningSessionService,
  LocalSessionAuthorizationError,
  LocalSessionUnauthenticatedError,
  createInstallationLocationService,
  createScreeningVitalsDraftService,
  type ActiveLocalSessionContext,
  type CurrentScreeningSessionService,
  type LocalAuthenticationSessionService,
  type ScreeningVitalsDraftService
} from '@main/application'
import {
  RepositoryWriteError,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  createProtocolVersionRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  createScreeningVitalsDraftRepository,
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
const installationId = '93000000-0000-4000-8000-000000000001'
const adminId = '93000000-0000-4000-8000-000000000002'
const nurseId = '93000000-0000-4000-8000-000000000003'
const locationId = '93000000-0000-4000-8000-000000000004'
const protocolId = '00000000-0000-4000-8000-000000000007'
const patientId = '93000000-0000-4000-8000-000000000006'
const secondPatientId = '93000000-0000-4000-8000-000000000007'
const sessionId = '93000000-0000-4000-8000-000000000008'
const currentSessionId = '93000000-0000-4000-8000-000000000011'
const encounterId = '93000000-0000-4000-8000-000000000009'
const secondEncounterId = '93000000-0000-4000-8000-000000000010'
const later = '2026-08-06T13:00:00.000Z'
const newReadingAt = '2026-08-06T14:00:00.000Z'
const changedReadingAt = '2026-08-06T15:00:00.000Z'
const nextDeploymentDate = '2026-08-07T12:00:00.000Z'

describe('screening vitals draft service integration', () => {
  it('loads no draft for a current editable encounter without creating an empty record', async () => {
    await withVitalsService(({ connection, service, currentScreeningSessionSpies }) => {
      seedCoreGraph(connection)

      expect(service.getVitalsDraft({ encounterId: parseEntityId(encounterId) })).toEqual({
        status: 'LOADED',
        draft: null
      })
      expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
      expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      expect(currentScreeningSessionSpies?.findCurrentScreeningSession).not.toHaveBeenCalled()
      expect(currentScreeningSessionSpies?.ensureCurrentScreeningSession).not.toHaveBeenCalled()
    })
  })

  it('does not create a first draft for an earlier-session encounter', async () => {
    await withVitalsService(
      ({ connection, service, currentScreeningSessionSpies }) => {
        seedCoreGraph(connection)
        connection
          .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
          .run('2026-08-05', sessionId)

        const sessionsBefore = readSessionRows(connection)
        const encountersBefore = readEncounterRows(connection)

        expect(service.getVitalsDraft({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'LOADED',
          draft: null
        })

        expect(
          service.saveVitalsDraft(
            createVitalsRequest({
              readings: [
                {
                  id: null,
                  sequenceNumber: 1,
                  systolic: 120,
                  diastolic: 80,
                  pulse: 70,
                  measurementSite: 'RIGHT_ARM',
                  patientPosition: 'SITTING',
                  measurementTime: '10:12'
                }
              ]
            })
          )
        ).toEqual({ status: 'SESSION_NOT_CURRENT' })

        expect(
          currentScreeningSessionSpies?.findCurrentScreeningSessionInTransaction
        ).toHaveBeenCalledOnce()
        expect(currentScreeningSessionSpies?.findCurrentScreeningSession).not.toHaveBeenCalled()
        expect(currentScreeningSessionSpies?.ensureCurrentScreeningSession).not.toHaveBeenCalled()
        expect(readSessionRows(connection)).toEqual(sessionsBefore)
        expect(readEncounterRows(connection)).toEqual(encountersBefore)
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
        expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { timestamps: [nextDeploymentDate], currentSessionId }
    )
  })

  it('rejects a first draft when a pre-midnight session lookup becomes stale at transaction time', async () => {
    await withVitalsService(
      ({ connection, service, currentScreeningSessionService }) => {
        seedCoreGraph(connection)

        const sessionsBefore = readSessionRows(connection)
        const encountersBefore = readEncounterRows(connection)
        const auditBefore = readAuditRows(connection)
        const outboxBefore = readOutboxRows(connection)

        expect(currentScreeningSessionService.findCurrentScreeningSession()).toMatchObject({
          status: 'FOUND',
          session: { id: parseEntityId(sessionId) }
        })

        expect(
          service.saveVitalsDraft(
            createVitalsRequest({
              readings: [completeReading(1)]
            })
          )
        ).toEqual({ status: 'SESSION_NOT_CURRENT' })

        expect(readSessionRows(connection)).toEqual(sessionsBefore)
        expect(readEncounterRows(connection)).toEqual(encountersBefore)
        expect(readAuditRows(connection)).toEqual(auditBefore)
        expect(readOutboxRows(connection)).toEqual(outboxBefore)
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
        expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(0)
      },
      {
        timestamps: ['2026-08-06T23:59:59.000Z', '2026-08-07T00:00:01.000Z'],
        useRealCurrentSessionService: true
      }
    )
  })

  it('rejects an earlier first draft without a current session and leaves persistence unchanged', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)
        connection
          .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
          .run('2026-08-05', sessionId)

        const sessionsBefore = readSessionRows(connection)
        const encountersBefore = readEncounterRows(connection)
        const auditBefore = readAuditRows(connection)
        const outboxBefore = readOutboxRows(connection)

        expect(
          service.saveVitalsDraft(
            createVitalsRequest({
              readings: [completeReading(1)]
            })
          )
        ).toEqual({ status: 'SESSION_NOT_CURRENT' })

        expect(readSessionRows(connection)).toEqual(sessionsBefore)
        expect(readEncounterRows(connection)).toEqual(encountersBefore)
        expect(readAuditRows(connection)).toEqual(auditBefore)
        expect(readOutboxRows(connection)).toEqual(outboxBefore)
        expect(readTableCount(connection, 'screening_sessions')).toBe(1)
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
        expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(0)
      },
      {
        timestamps: [nextDeploymentDate],
        useRealCurrentSessionService: true
      }
    )
  })

  it('restores an editable earlier-session draft without changing historical attribution', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        const saved = service.saveVitalsDraft(
          createVitalsRequest({
            readings: [completeReading(1)],
            notes: 'Earlier-session draft'
          })
        )

        if (saved.status !== 'SAVED') {
          throw new Error('Expected the earlier-session draft to save.')
        }

        connection
          .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
          .run('2026-08-05', sessionId)

        const sessionsBeforeRecovery = readSessionRows(connection)
        const encountersBeforeRecovery = readEncounterRows(connection)
        const installationBeforeRecovery = readInstallationRows(connection)
        const configurationBeforeRecovery = readLocationConfigurationRows(connection)
        const recovered = service.getVitalsDraft({ encounterId: parseEntityId(encounterId) })

        expect(recovered).toMatchObject({
          status: 'LOADED',
          draft: {
            id: saved.draft.id,
            encounterId,
            rowVersion: saved.draft.rowVersion,
            notes: 'Earlier-session draft',
            readings: [
              expect.objectContaining({
                id: saved.draft.readings[0]!.id,
                sequenceNumber: 1
              })
            ]
          }
        })
        expect(readSessionRows(connection)).toEqual(sessionsBeforeRecovery)
        expect(readEncounterRows(connection)).toEqual(encountersBeforeRecovery)
        expect(readInstallationRows(connection)).toEqual(installationBeforeRecovery)
        expect(readLocationConfigurationRows(connection)).toEqual(configurationBeforeRecovery)
        expect(readTableCount(connection, 'screening_sessions')).toBe(1)
        expect(readTableCount(connection, 'screening_encounters')).toBe(1)
        expect(readDraftRows(connection)).toEqual([
          expect.objectContaining({
            encounter_id: encounterId
          })
        ])

        const continued = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: saved.draft.rowVersion,
            readings: [{ ...completeReading(1), id: saved.draft.readings[0]!.id }],
            notes: 'Continued after date rollover'
          })
        )
        expect(continued).toMatchObject({
          status: 'SAVED',
          draft: {
            id: saved.draft.id,
            rowVersion: 2,
            notes: 'Continued after date rollover'
          }
        })
        expect(readSessionRows(connection)).toEqual(sessionsBeforeRecovery)
        expect(readEncounterRows(connection)).toEqual(encountersBeforeRecovery)
      },
      {
        timestamps: [now, now, nextDeploymentDate],
        useRealCurrentSessionService: true
      }
    )
  })

  it('blocks non-editable encounter lifecycle states during draft recovery', async () => {
    for (const status of ['COMPLETED', 'AMENDED', 'VOID'] as const) {
      await withVitalsService(({ connection, service }) => {
        seedCoreGraph(connection)
        connection
          .prepare('UPDATE screening_encounters SET status = ? WHERE id = ?')
          .run(status, encounterId)

        expect(service.getVitalsDraft({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'ENCOUNTER_NOT_EDITABLE'
        })
      })
    }
  })

  it('saves incomplete local drafts transactionally with trusted actor, audit, and outbox', async () => {
    await withVitalsService(({ connection, service, authenticationSessionService }) => {
      seedCoreGraph(connection)

      const result = service.saveVitalsDraft(
        createVitalsRequest({
          readings: [
            {
              id: null,
              sequenceNumber: 1,
              systolic: 150,
              diastolic: null,
              pulse: null,
              measurementSite: null,
              patientPosition: null,
              measurementTime: null
            }
          ],
          notes: 'Incomplete local draft'
        })
      )

      expect(result).toMatchObject({
        status: 'SAVED',
        draft: {
          encounterId,
          status: 'DRAFT',
          rowVersion: 1,
          weightKg: null,
          waistCm: null,
          notes: 'Incomplete local draft',
          readings: [
            expect.objectContaining({
              sequenceNumber: 1,
              systolic: 150,
              diastolic: null,
              pulse: null
            })
          ]
        }
      })
      expect(authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
        'LOCAL_ADMIN',
        'NURSE',
        'TRAINED_SCREENER'
      ])
      expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(1)
      expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(1)
      expect(readDraftRows(connection)).toEqual([
        expect.objectContaining({
          encounter_id: encounterId,
          status: 'DRAFT',
          weight_kg: null,
          waist_cm: null,
          notes: 'Incomplete local draft',
          created_by: nurseId,
          updated_by: nurseId,
          row_version: 1
        })
      ])
      expect(readAuditRows(connection)).toEqual([
        expect.objectContaining({
          action: 'SCREENING_VITALS_DRAFT_SAVED',
          entity_type: 'SCREENING_ENCOUNTER',
          entity_id: encounterId,
          user_id: nurseId
        })
      ])
      expect(readOutboxRows(connection)).toEqual([
        expect.objectContaining({
          aggregate_type: 'SCREENING_ENCOUNTER',
          aggregate_id: encounterId,
          operation: 'SCREENING_VITALS_DRAFT_SAVED',
          payload_schema_version: 'screening-encounter.vitals-draft-saved.v1'
        })
      ])
      expect(JSON.stringify(readAuditRows(connection))).not.toContain('150')
      expect(JSON.stringify(readOutboxRows(connection))).not.toContain('Incomplete local draft')
    })
  })

  it('updates the same encounter draft, preserves reading creation times, and persists removals', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        const first = service.saveVitalsDraft(
          createVitalsRequest({
            readings: [completeReading(1), completeReading(2)],
            weightKg: 80.5,
            waistCm: 91,
            notes: 'Initial note'
          })
        )

        if (first.status !== 'SAVED') {
          throw new Error('Expected first save to succeed.')
        }

        const firstReadingId = first.draft.readings[0]!.id
        const secondReadingId = first.draft.readings[1]!.id
        const firstReadingCreatedAt = readReadingRows(connection).find(
          (reading) => reading.id === firstReadingId
        )?.created_at

        expect(
          service.saveVitalsDraft(
            createVitalsRequest({
              expectedVersion: first.draft.rowVersion,
              readings: [{ ...completeReading(1), id: null }]
            })
          )
        ).toEqual({ status: 'VALIDATION_FAILED' })

        const second = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: first.draft.rowVersion,
            readings: [{ ...completeReading(1), id: firstReadingId, systolic: 142 }],
            weightKg: null,
            waistCm: null,
            notes: null
          })
        )

        expect(second).toMatchObject({
          status: 'SAVED',
          draft: {
            id: first.draft.id,
            rowVersion: 2,
            weightKg: null,
            waistCm: null,
            notes: null,
            readings: [
              expect.objectContaining({
                id: firstReadingId,
                sequenceNumber: 1,
                systolic: 142
              })
            ]
          }
        })
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(1)
        expect(readReadingRows(connection)).toEqual([
          expect.objectContaining({
            id: firstReadingId,
            sequence_number: 1,
            systolic: 142,
            created_at: firstReadingCreatedAt,
            updated_at: later
          })
        ])
        expect(JSON.stringify(readReadingRows(connection))).not.toContain(secondReadingId)
        expect(readAuditRows(connection).map((row) => row.action)).toEqual([
          'SCREENING_VITALS_DRAFT_SAVED',
          'SCREENING_VITALS_DRAFT_SAVED'
        ])

        const identical = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: 2,
            readings: [{ ...completeReading(1), id: firstReadingId, systolic: 142 }],
            weightKg: null,
            waistCm: null,
            notes: null
          })
        )

        expect(identical).toMatchObject({
          status: 'SAVED',
          draft: {
            id: first.draft.id,
            rowVersion: 2
          }
        })
        expect(readAuditRows(connection).map((row) => row.action)).toEqual([
          'SCREENING_VITALS_DRAFT_SAVED',
          'SCREENING_VITALS_DRAFT_SAVED'
        ])
        expect(readOutboxRows(connection).map((row) => row.operation)).toEqual([
          'SCREENING_VITALS_DRAFT_SAVED',
          'SCREENING_VITALS_DRAFT_SAVED'
        ])
      },
      { timestamps: [now, now, later] }
    )
  })

  it('reorders stable readings, adds new timestamps, and removes later readings transactionally', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        const first = service.saveVitalsDraft(
          createVitalsRequest({ readings: [completeReading(1), completeReading(2)] })
        )

        if (first.status !== 'SAVED') {
          throw new Error('Expected the initial readings to save.')
        }

        const firstReading = first.draft.readings[0]!
        const secondReading = first.draft.readings[1]!
        const firstReadingCreatedAt = readReadingRows(connection).find(
          (reading) => reading.id === firstReading.id
        )?.created_at
        const secondReadingCreatedAt = readReadingRows(connection).find(
          (reading) => reading.id === secondReading.id
        )?.created_at
        const reordered = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: first.draft.rowVersion,
            readings: [
              { ...completeReading(2), id: secondReading.id, sequenceNumber: 1 },
              { ...completeReading(1), id: firstReading.id, sequenceNumber: 2 }
            ]
          })
        )

        if (reordered.status !== 'SAVED') {
          throw new Error('Expected the reordered readings to save.')
        }

        expect(reordered.draft.readings.map((reading) => reading.id)).toEqual([
          secondReading.id,
          firstReading.id
        ])
        expect(readReadingRows(connection)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: secondReading.id,
              created_at: secondReadingCreatedAt,
              updated_at: later
            }),
            expect.objectContaining({
              id: firstReading.id,
              created_at: firstReadingCreatedAt,
              updated_at: later
            })
          ])
        )

        const added = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: reordered.draft.rowVersion,
            readings: [
              { ...completeReading(2), id: secondReading.id, sequenceNumber: 1 },
              { ...completeReading(1), id: firstReading.id, sequenceNumber: 2 },
              completeReading(3)
            ]
          })
        )

        if (added.status !== 'SAVED') {
          throw new Error('Expected the new reading to save.')
        }

        const newReading = added.draft.readings[2]!
        const newReadingRow = readReadingRows(connection).find(
          (reading) => reading.id === newReading.id
        )
        expect(newReading.id).not.toBe(firstReading.id)
        expect(newReading.id).not.toBe(secondReading.id)
        expect(newReadingRow).toEqual(
          expect.objectContaining({ created_at: newReadingAt, updated_at: newReadingAt })
        )
        expect(readReadingRows(connection)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: secondReading.id,
              created_at: secondReadingCreatedAt,
              updated_at: later
            }),
            expect.objectContaining({
              id: firstReading.id,
              created_at: firstReadingCreatedAt,
              updated_at: later
            })
          ])
        )

        const removed = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: added.draft.rowVersion,
            readings: [
              { ...completeReading(2), id: secondReading.id, sequenceNumber: 1 },
              { ...completeReading(3), id: newReading.id, sequenceNumber: 2 }
            ]
          })
        )

        expect(removed).toMatchObject({
          status: 'SAVED',
          draft: {
            readings: [
              { id: secondReading.id, sequenceNumber: 1 },
              { id: newReading.id, sequenceNumber: 2 }
            ]
          }
        })
        expect(readReadingRows(connection)).toEqual([
          expect.objectContaining({
            id: secondReading.id,
            sequence_number: 1,
            created_at: secondReadingCreatedAt,
            updated_at: later
          }),
          expect.objectContaining({
            id: newReading.id,
            sequence_number: 2,
            created_at: newReadingAt,
            updated_at: nextDeploymentDate
          })
        ])
      },
      { timestamps: [now, later, newReadingAt, nextDeploymentDate] }
    )
  })

  it('preserves timestamps for unchanged readings and updates only changed readings', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        const first = service.saveVitalsDraft(
          createVitalsRequest({ readings: [completeReading(1), completeReading(2)] })
        )

        if (first.status !== 'SAVED') {
          throw new Error('Expected the initial readings to save.')
        }

        const firstReadingId = first.draft.readings[0]!.id
        const secondReadingId = first.draft.readings[1]!.id
        const initialRows = readReadingRows(connection)
        const initialFirst = initialRows.find((row) => row.id === firstReadingId)
        const initialSecond = initialRows.find((row) => row.id === secondReadingId)

        const notesOnly = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: first.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: firstReadingId },
              { ...completeReading(2), id: secondReadingId }
            ],
            notes: 'Notes only'
          })
        )
        expect(notesOnly.status).toBe('SAVED')
        expect(readReadingRows(connection)).toEqual(initialRows)

        if (notesOnly.status !== 'SAVED') {
          throw new Error('Expected the notes-only save to succeed.')
        }

        const weightOnly = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: notesOnly.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: firstReadingId },
              { ...completeReading(2), id: secondReadingId }
            ],
            notes: 'Notes only',
            weightKg: 81.25
          })
        )
        expect(weightOnly.status).toBe('SAVED')
        expect(readReadingRows(connection)).toEqual(initialRows)

        if (weightOnly.status !== 'SAVED') {
          throw new Error('Expected the weight-only save to succeed.')
        }

        const waistOnly = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: weightOnly.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: firstReadingId },
              { ...completeReading(2), id: secondReadingId }
            ],
            notes: 'Notes only',
            weightKg: 81.25,
            waistCm: 92.5
          })
        )
        expect(waistOnly.status).toBe('SAVED')
        expect(readReadingRows(connection)).toEqual(initialRows)

        if (waistOnly.status !== 'SAVED') {
          throw new Error('Expected the waist-only save to succeed.')
        }

        const changed = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: waistOnly.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: firstReadingId, systolic: 145 },
              { ...completeReading(2), id: secondReadingId }
            ],
            notes: 'Notes only',
            weightKg: 81.25,
            waistCm: 92.5
          })
        )
        expect(changed.status).toBe('SAVED')
        expect(readReadingRows(connection)).toEqual([
          expect.objectContaining({
            id: firstReadingId,
            created_at: initialFirst?.created_at,
            updated_at: changedReadingAt,
            systolic: 145
          }),
          initialSecond
        ])

        if (changed.status !== 'SAVED') {
          throw new Error('Expected the changed-reading save to succeed.')
        }

        const identical = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: changed.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: firstReadingId, systolic: 145 },
              { ...completeReading(2), id: secondReadingId }
            ],
            notes: 'Notes only',
            weightKg: 81.25,
            waistCm: 92.5
          })
        )
        expect(identical.status).toBe('SAVED')
        expect(readReadingRows(connection)).toEqual([
          expect.objectContaining({
            id: firstReadingId,
            created_at: initialFirst?.created_at,
            updated_at: changedReadingAt
          }),
          initialSecond
        ])
      },
      { timestamps: [now, later, newReadingAt, nextDeploymentDate, changedReadingAt] }
    )
  })

  it('requires one complete reading to complete Vitals but keeps optional fields optional', async () => {
    await withVitalsService(({ connection, service }) => {
      seedCoreGraph(connection)

      expect(
        service.completeVitalsStep(
          createVitalsRequest({
            readings: [
              {
                ...completeReading(1),
                pulse: null
              }
            ]
          })
        )
      ).toEqual({ status: 'VALIDATION_FAILED' })
      expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)

      const completed = service.completeVitalsStep(
        createVitalsRequest({
          readings: [completeReading(1)],
          weightKg: null,
          waistCm: null,
          notes: null
        })
      )

      expect(completed).toMatchObject({
        status: 'COMPLETED',
        draft: {
          status: 'VITALS_COMPLETE',
          weightKg: null,
          waistCm: null,
          notes: null
        }
      })
      expect(readDraftRows(connection)).toEqual([
        expect.objectContaining({
          encounter_id: encounterId,
          status: 'VITALS_COMPLETE',
          weight_kg: null,
          waist_cm: null,
          notes: null
        })
      ])
      expect(readAuditRows(connection).map((row) => row.action)).toEqual([
        'SCREENING_VITALS_STEP_COMPLETED'
      ])
      expect(readOutboxRows(connection).map((row) => row.operation)).toEqual([
        'SCREENING_VITALS_STEP_COMPLETED'
      ])
    })
  })

  it('rejects unauthorized, over-posted, stale, and cross-encounter requests without mutation', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        expect(service.getVitalsDraft({ encounterId: parseEntityId(encounterId) })).toEqual({
          status: 'FORBIDDEN'
        })
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
      },
      { sessionFailure: new LocalSessionAuthorizationError() }
    )

    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        expect(service.saveVitalsDraft(createVitalsRequest())).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
      },
      { sessionFailure: new LocalSessionUnauthenticatedError() }
    )

    await withVitalsService(({ connection, service }) => {
      seedCoreGraph(connection)

      expect(
        service.saveVitalsDraft({ ...createVitalsRequest(), actor: { id: adminId } } as never)
      ).toEqual({
        status: 'VALIDATION_FAILED'
      })
      expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)

      expect(
        service.saveVitalsDraft(
          createVitalsRequest({
            readings: [{ ...completeReading(1), createdAt: now }]
          } as never)
        )
      ).toEqual({ status: 'VALIDATION_FAILED' })

      const saved = service.saveVitalsDraft(createVitalsRequest({ readings: [completeReading(1)] }))

      if (saved.status !== 'SAVED') {
        throw new Error('Expected save to succeed.')
      }

      expect(
        service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: saved.draft.rowVersion,
            readings: [
              { ...completeReading(1), id: saved.draft.readings[0]!.id, sequenceNumber: 1 },
              { ...completeReading(2), id: saved.draft.readings[0]!.id, sequenceNumber: 2 }
            ]
          })
        )
      ).toEqual({ status: 'VALIDATION_FAILED' })

      expect(
        service.saveVitalsDraft(
          createVitalsRequest({
            readings: [{ ...completeReading(1), id: saved.draft.readings[0]!.id, systolic: 122 }]
          })
        )
      ).toEqual({
        status: 'VERSION_CONFLICT'
      })
      expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(1)

      insertPatient(connection, secondPatientId, 'PT-000002')
      insertEncounter(connection, secondEncounterId, secondPatientId)
      const second = service.saveVitalsDraft(
        createVitalsRequest({
          encounterId: parseEntityId(secondEncounterId),
          readings: [completeReading(1)]
        })
      )

      if (second.status !== 'SAVED') {
        throw new Error('Expected second save to succeed.')
      }

      expect(
        service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: saved.draft.rowVersion,
            readings: [{ ...completeReading(1), id: second.draft.readings[0]!.id }]
          })
        )
      ).toEqual({ status: 'VALIDATION_FAILED' })
    })
  })

  it('rolls back draft, audit, and outbox effects when a later mutation boundary fails', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        expect(
          service.saveVitalsDraft(createVitalsRequest({ readings: [completeReading(1)] }))
        ).toEqual({
          status: 'UNAVAILABLE'
        })
        expect(readTableCount(connection, 'screening_vitals_drafts')).toBe(0)
        expect(readTableCount(connection, 'screening_vitals_draft_readings')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { failOutboxInsert: true }
    )
  })

  it('rolls back parent and reading reconciliation when the outbox write fails', async () => {
    await withVitalsService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        const first = service.saveVitalsDraft(
          createVitalsRequest({ readings: [completeReading(1), completeReading(2)] })
        )

        if (first.status !== 'SAVED') {
          throw new Error('Expected the first draft save to succeed.')
        }

        const draftBeforeFailure = readDraftRows(connection)
        const readingsBeforeFailure = readReadingRows(connection)
        const failed = service.saveVitalsDraft(
          createVitalsRequest({
            expectedVersion: first.draft.rowVersion,
            readings: [{ ...completeReading(1), id: first.draft.readings[0]!.id, systolic: 155 }]
          })
        )

        expect(failed).toEqual({ status: 'UNAVAILABLE' })
        expect(readDraftRows(connection)).toEqual(draftBeforeFailure)
        expect(readReadingRows(connection)).toEqual(readingsBeforeFailure)
        expect(readAuditRows(connection)).toHaveLength(1)
        expect(readOutboxRows(connection)).toHaveLength(1)
      },
      {
        failOutboxOnInsertNumber: 2,
        timestamps: [now, later]
      }
    )
  })
})

interface CurrentScreeningSessionSpies {
  readonly ensureCurrentScreeningSession: ReturnType<typeof vi.fn>
  readonly findCurrentScreeningSession: ReturnType<typeof vi.fn>
  readonly findCurrentScreeningSessionInTransaction: ReturnType<typeof vi.fn>
}

interface Harness {
  readonly connection: Database.Database
  readonly service: ScreeningVitalsDraftService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly currentScreeningSessionSpies: CurrentScreeningSessionSpies | null
  readonly authenticationSessionService: LocalAuthenticationSessionService & {
    readonly requireAnyRole: ReturnType<typeof vi.fn>
  }
}

async function withVitalsService(
  test: (harness: Harness) => void,
  options: {
    readonly sessionRole?: LocalUserRole
    readonly sessionFailure?: unknown
    readonly failOutboxInsert?: boolean
    readonly failOutboxOnInsertNumber?: number
    readonly timestamps?: readonly string[]
    readonly currentSessionId?: string
    readonly useRealCurrentSessionService?: boolean
  } = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd030a-vitals-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    const timestamps = [...(options.timestamps ?? [])]

    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: createLogger(),
      clock: createUtcClock(() => now)
    })(connection)

    const authenticationSessionService = createAuthenticationSessionService({
      userId: nurseId,
      role: options.sessionRole ?? 'NURSE',
      failure: options.sessionFailure
    })
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(createQueuedIdGenerator()),
      clock: createUtcClock(() => (timestamps.shift() ?? now) as UtcTimestamp),
      logger: createLogger()
    })
    const installationRepository = createInstallationRepository(connection)
    const locationRepository = createLocationRepository(connection)
    const screeningSessionRepository = createScreeningSessionRepository(connection)
    const screeningEncounterRepository = createScreeningEncounterRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const outboxRepository = createOutboxRepository(
      connection,
      options.failOutboxInsert === true,
      options.failOutboxOnInsertNumber
    )
    const installationLocationService = createInstallationLocationService({
      authenticationSessionService,
      installationRepository,
      installationLocationConfigurationRepository:
        createInstallationLocationConfigurationRepository(connection),
      locationRepository,
      screeningSessionRepository,
      screeningEncounterRepository,
      auditEventRepository,
      transactionExecutor
    })
    const mockCurrentScreeningSessionService = createMockCurrentScreeningSessionService(
      options.currentSessionId ?? sessionId
    )
    const currentScreeningSessionSpies = options.useRealCurrentSessionService
      ? null
      : mockCurrentScreeningSessionService
    const currentScreeningSessionService: CurrentScreeningSessionService =
      options.useRealCurrentSessionService
        ? createCurrentScreeningSessionService({
            authenticationSessionService,
            installationLocationService,
            installationRepository,
            locationRepository,
            protocolVersionRepository: createProtocolVersionRepository(connection),
            screeningSessionRepository,
            screeningSessionOutboxRepository: createScreeningSessionOutboxRepository(connection),
            auditEventRepository,
            transactionExecutor
          })
        : mockCurrentScreeningSessionService
    const service = createScreeningVitalsDraftService({
      authenticationSessionService,
      currentScreeningSessionService,
      installationLocationService,
      installationRepository,
      locationRepository,
      screeningSessionRepository,
      screeningEncounterRepository,
      screeningVitalsDraftRepository: createScreeningVitalsDraftRepository(connection),
      screeningEncounterOutboxRepository: outboxRepository,
      auditEventRepository,
      transactionExecutor
    })

    test({
      connection,
      service,
      currentScreeningSessionService,
      currentScreeningSessionSpies,
      authenticationSessionService
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createMockCurrentScreeningSessionService(
  currentSessionIdValue: string
): CurrentScreeningSessionService & CurrentScreeningSessionSpies {
  return {
    ensureCurrentScreeningSession: vi.fn(() => {
      throw new Error('Vitals service must not create a current session.')
    }),
    findCurrentScreeningSession: vi.fn(() => ({
      status: 'FOUND' as const,
      session: {
        id: parseEntityId(currentSessionIdValue),
        locationId: parseEntityId(locationId),
        protocolVersionId: parseEntityId(protocolId),
        sessionDate: parseScreeningSessionDate('2026-08-06'),
        status: 'OPEN' as const,
        notes: null,
        openedAt: now as UtcTimestamp,
        closedAt: null,
        createdAt: now as UtcTimestamp,
        rowVersion: 1
      },
      location: {
        id: parseEntityId(locationId),
        displayName: parseLocationName('Test Site')
      }
    })),
    findCurrentScreeningSessionInTransaction: vi.fn(() => ({
      status: 'FOUND' as const,
      session: {
        id: parseEntityId(currentSessionIdValue),
        locationId: parseEntityId(locationId),
        protocolVersionId: parseEntityId(protocolId),
        sessionDate: parseScreeningSessionDate('2026-08-06'),
        status: 'OPEN' as const,
        notes: null,
        openedAt: now as UtcTimestamp,
        closedAt: null,
        createdAt: now as UtcTimestamp,
        rowVersion: 1
      },
      location: {
        id: parseEntityId(locationId),
        displayName: parseLocationName('Test Site')
      }
    }))
  }
}

function createOutboxRepository(
  connection: Database.Database,
  failInsert: boolean,
  failOnInsertNumber?: number
): ScreeningEncounterOutboxRepository {
  const repository = createScreeningEncounterOutboxRepository(connection)

  if (!failInsert && failOnInsertNumber === undefined) {
    return repository
  }

  let insertCount = 0

  return {
    ...repository,
    insert: vi.fn((...args: Parameters<ScreeningEncounterOutboxRepository['insert']>) => {
      insertCount += 1

      if (failInsert || insertCount === failOnInsertNumber) {
        throw new RepositoryWriteError()
      }

      return repository.insert(...args)
    })
  } as unknown as ScreeningEncounterOutboxRepository
}

function createAuthenticationSessionService({
  userId,
  role,
  failure
}: {
  readonly userId: string
  readonly role: LocalUserRole
  readonly failure?: unknown
}): LocalAuthenticationSessionService & { readonly requireAnyRole: ReturnType<typeof vi.fn> } {
  const context = createActiveContext(userId, role)

  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn((roles: readonly LocalUserRole[]) => {
      if (failure !== undefined) {
        throw failure
      }

      if (!roles.includes(role)) {
        throw new LocalSessionAuthorizationError()
      }

      return context
    })
  } as unknown as LocalAuthenticationSessionService & {
    readonly requireAnyRole: ReturnType<typeof vi.fn>
  }
}

function createActiveContext(userId: string, role: LocalUserRole): ActiveLocalSessionContext {
  const user: LocalUserRecord = Object.freeze({
    id: parseEntityId(userId),
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
  })

  return Object.freeze({
    user,
    authenticatedAt: now as UtcTimestamp,
    lastActivityAt: now as UtcTimestamp,
    idleExpiresAt: '2026-08-06T12:15:00.000Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-08-07T00:00:00.000Z' as UtcTimestamp
  })
}

function createVitalsRequest(
  overrides: Partial<Parameters<ScreeningVitalsDraftService['saveVitalsDraft']>[0]> = {}
): Parameters<ScreeningVitalsDraftService['saveVitalsDraft']>[0] {
  return {
    encounterId: parseEntityId(encounterId),
    expectedVersion: null,
    readings: [completeReading(1)],
    weightKg: null,
    waistCm: null,
    notes: null,
    ...overrides
  }
}

function completeReading(
  sequenceNumber: number
): Parameters<ScreeningVitalsDraftService['saveVitalsDraft']>[0]['readings'][number] {
  return {
    id: null,
    sequenceNumber,
    systolic: 120 + sequenceNumber,
    diastolic: 80 + sequenceNumber,
    pulse: 70 + sequenceNumber,
    measurementSite: sequenceNumber === 1 ? 'RIGHT_ARM' : 'LEFT_ARM',
    patientPosition: sequenceNumber === 1 ? 'SITTING' : 'STANDING',
    measurementTime: sequenceNumber === 1 ? '10:12' : '10:18'
  }
}

function seedCoreGraph(connection: Database.Database): void {
  insertInstallation(connection)
  insertUser(connection, adminId, 'admin', 'LOCAL_ADMIN')
  insertUser(connection, nurseId, 'nurse', 'NURSE')
  insertLocation(connection, locationId)
  insertPatient(connection, patientId, 'PT-000001')
  insertSession(connection)
  insertConfiguration(connection)
  insertEncounter(connection, encounterId, patientId)
}

function insertInstallation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Local Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
}

function insertUser(
  connection: Database.Database,
  id: string,
  username: string,
  role: string
): void {
  connection
    .prepare(
      `INSERT INTO users (
        id,
        username,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        role,
        is_active,
        must_change_password,
        failed_login_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, ?, ?)`
    )
    .run(id, username, username, `${username} User`, role, now, now)
}

function insertLocation(connection: Database.Database, id: string): void {
  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, 'COMMUNITY_SITE', 1, ?, ?, ?, ?)`
    )
    .run(id, `Site ${id}`, `site ${id}`, adminId, now, adminId, now)
}

function insertPatient(connection: Database.Database, id: string, patientCode: string): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        name_normalized,
        sex,
        date_of_birth,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, 'Test Patient', 'Test', 'Patient', 'test patient', 'UNKNOWN', '1990-01-01', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(id, patientCode, adminId, now, adminId, now)
}

function insertSession(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        notes,
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, '2026-08-06', 'OPEN', NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, 1)`
    )
    .run(sessionId, locationId, protocolId, adminId, now, adminId, now, adminId, now)
}

function insertConfiguration(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
        singleton_id,
        installation_id,
        location_id,
        configured_at,
        configured_by,
        updated_at,
        updated_by,
        row_version
      ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, locationId, now, adminId, now, adminId)
}

function insertEncounter(
  connection: Database.Database,
  id: string,
  encounterPatientId: string
): void {
  connection
    .prepare(
      `INSERT INTO screening_encounters (
        id,
        patient_id,
        screening_session_id,
        location_id,
        protocol_version_id,
        status,
        started_at,
        completed_at,
        source_type,
        recorded_by,
        amendment_of_encounter_id,
        amendment_reason,
        void_reason,
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, 1, ?, ?)`
    )
    .run(id, encounterPatientId, sessionId, locationId, protocolId, now, nurseId, now, now)
}

function createQueuedIdGenerator(): () => string {
  const ids = Array.from(
    { length: 80 },
    (_, index) => `94000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  )

  return () => {
    const next = ids.shift()

    if (next === undefined) {
      throw new Error('No HSD-030A test ID remains.')
    }

    return next
  }
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM "${tableName}"`).get() as {
    total: number
  }

  return row.total
}

function readSessionRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT id, location_id, session_date, status, row_version, closed_at
       FROM screening_sessions
       ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>
}

function readInstallationRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare('SELECT singleton_id, id, timezone FROM installation ORDER BY singleton_id')
    .all() as Array<Record<string, unknown>>
}

function readLocationConfigurationRows(
  connection: Database.Database
): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT singleton_id, installation_id, location_id, row_version
       FROM installation_location_configuration
       ORDER BY singleton_id`
    )
    .all() as Array<Record<string, unknown>>
}

function readEncounterRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT id, patient_id, screening_session_id, location_id, status, record_version
       FROM screening_encounters
       ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>
}

function readDraftRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare('SELECT * FROM screening_vitals_drafts ORDER BY encounter_id')
    .all() as Array<Record<string, unknown>>
}

function readReadingRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare('SELECT * FROM screening_vitals_draft_readings ORDER BY sequence_number')
    .all() as Array<Record<string, unknown>>
}

function readAuditRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      'SELECT action, entity_type, entity_id, user_id, metadata_json FROM audit_log ORDER BY rowid'
    )
    .all() as Array<Record<string, unknown>>
}

function readOutboxRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT aggregate_type, aggregate_id, operation, payload_json, payload_schema_version
       FROM sync_outbox
       ORDER BY rowid`
    )
    .all() as Array<Record<string, unknown>>
}

function createLogger(): {
  info(message: string): void
  error(message: string): void
} {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
}
