import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type {
  ActiveLocalSessionContext,
  LocalAuthenticationSessionService,
  PatientAcknowledgmentService,
  PatientDemographicAmendmentService,
  PatientRegistryService
} from '@main/application'
import {
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '@main/application'
import type {
  PatientAcknowledgmentRecord,
  PatientDemographicAmendmentRecord,
  PatientDetailRecord,
  LocalUserRole
} from '@main/database'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import {
  createPatientIpcHandlers,
  type PatientIpcHandlers,
  type PatientIpcOperationalLogger
} from '@main/ipc/handlers/patient-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createPatientFailure,
  type PatientAmendDemographicsRequest,
  type PatientListAcknowledgmentHistoryRequest,
  type PatientListDemographicAmendmentHistoryRequest,
  type PatientRecordAcknowledgmentRequest
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111' as EntityId
const userId = '22222222-2222-4222-8222-222222222222' as EntityId
const amendmentId = '33333333-3333-4333-8333-333333333333' as EntityId
const acknowledgmentId = '44444444-4444-4444-8444-444444444444' as EntityId
const timestamp = '2026-07-29T12:34:56.789Z' as UtcTimestamp
const sensitivePatientValue = '11111111-1111-4111-8111-111111111111'
const sensitiveReasonNote = 'corrected synthetic reason note'
const sensitiveAcknowledgmentNote = 'synthetic acknowledgment note'

const amendRequest: PatientAmendDemographicsRequest = {
  patientId,
  expectedRowVersion: 1,
  reasonCode: 'DATA_ENTRY_CORRECTION',
  reasonNote: sensitiveReasonNote,
  patch: {
    givenName: 'Test'
  }
}

const demographicHistoryRequest: PatientListDemographicAmendmentHistoryRequest = {
  patientId,
  page: 1,
  pageSize: 25
}

const recordAcknowledgmentRequest: PatientRecordAcknowledgmentRequest = {
  patientId,
  expectedRowVersion: 1,
  status: 'DECLINED',
  note: sensitiveAcknowledgmentNote
}

const acknowledgmentHistoryRequest: PatientListAcknowledgmentHistoryRequest = {
  patientId,
  page: 1,
  pageSize: 25
}

describe('patient amendment and acknowledgment IPC handlers', () => {
  it('authorizes all local roles and passes only trusted session actor data', async () => {
    for (const role of ['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const) {
      const harness = createHarness({ role })

      await expect(
        harness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
      ).resolves.toMatchObject({ ok: true, data: { status: 'AMENDED' } })
      await expect(
        harness.handlers.listDemographicAmendmentHistory(
          createAllowedEvent(),
          demographicHistoryRequest
        )
      ).resolves.toMatchObject({ ok: true, data: { items: [], page: 1, pageSize: 25, total: 0 } })
      await expect(
        harness.handlers.recordAcknowledgment(createAllowedEvent(), recordAcknowledgmentRequest)
      ).resolves.toMatchObject({ ok: true, data: { status: 'RECORDED' } })
      await expect(
        harness.handlers.listAcknowledgmentHistory(
          createAllowedEvent(),
          acknowledgmentHistoryRequest
        )
      ).resolves.toMatchObject({ ok: true, data: { items: [], page: 1, pageSize: 25, total: 0 } })

      expect(harness.demographicService.amend).toHaveBeenCalledWith(amendRequest, {
        userId,
        role
      })
      expect(harness.demographicService.listHistory).toHaveBeenCalledWith(
        demographicHistoryRequest,
        { userId, role }
      )
      expect(harness.acknowledgmentService.record).toHaveBeenCalledWith(
        recordAcknowledgmentRequest,
        { userId, role }
      )
      expect(harness.acknowledgmentService.listHistory).toHaveBeenCalledWith(
        acknowledgmentHistoryRequest,
        { userId, role }
      )
      expect(harness.authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
        'LOCAL_ADMIN',
        'NURSE',
        'TRAINED_SCREENER'
      ])
    }
  })

  it('rejects request-supplied actor-like fields before service invocation', async () => {
    for (const testCase of newHandlerCases) {
      const harness = createHarness()

      await expect(
        testCase.call(harness.handlers, createAllowedEvent(), {
          ...testCase.request,
          userId: '99999999-9999-4999-8999-999999999999',
          role: 'LOCAL_ADMIN'
        })
      ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
      expect(harness.demographicService.amend).not.toHaveBeenCalled()
      expect(harness.demographicService.listHistory).not.toHaveBeenCalled()
      expect(harness.acknowledgmentService.record).not.toHaveBeenCalled()
      expect(harness.acknowledgmentService.listHistory).not.toHaveBeenCalled()
    }
  })

  it('maps session and sender authorization failures for every new channel', async () => {
    const failureCases = [
      {
        error: new LocalSessionUnauthenticatedError(),
        event: createAllowedEvent(),
        code: 'AUTH_UNAUTHENTICATED'
      },
      { error: new LocalSessionLockedError(), event: createAllowedEvent(), code: 'AUTH_LOCKED' },
      {
        error: new LocalSessionPasswordChangeRequiredError(),
        event: createAllowedEvent(),
        code: 'AUTH_PASSWORD_CHANGE_REQUIRED'
      },
      { error: null, event: createForbiddenEvent(), code: 'IPC_FORBIDDEN' }
    ] as const

    for (const failureCase of failureCases) {
      for (const testCase of newHandlerCases) {
        const harness = createHarness({ authError: failureCase.error })

        await expect(
          testCase.call(harness.handlers, failureCase.event, testCase.request)
        ).resolves.toEqual(createPatientFailure(failureCase.code))
        expect(harness.demographicService.amend).not.toHaveBeenCalled()
        expect(harness.demographicService.listHistory).not.toHaveBeenCalled()
        expect(harness.acknowledgmentService.record).not.toHaveBeenCalled()
        expect(harness.acknowledgmentService.listHistory).not.toHaveBeenCalled()
      }
    }
  })

  it('maps demographic amendment service results and safe failures', async () => {
    const patient = createPatientDetailRecord()
    const conflictHarness = createHarness({
      demographicAmend: () => ({ status: 'PATIENT_VERSION_CONFLICT', patient })
    })
    const notFoundHarness = createHarness({
      demographicAmend: () => ({ status: 'NOT_FOUND' })
    })
    const forbiddenHarness = createHarness({
      demographicAmend: () => ({ status: 'FORBIDDEN' })
    })
    const malformedHarness = createHarness({
      demographicAmend: () => ({ status: 'AMENDED', amendmentId: 'not-a-uuid', patient })
    })
    const thrownHarness = createHarness({
      demographicAmend: () => {
        throw createSensitiveError()
      }
    })

    await expect(
      createHarness().handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'AMENDED',
        amendmentId,
        patient: { id: patientId, clinicalStatus: 'NOT_AVAILABLE' }
      }
    })
    await expect(
      conflictHarness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toMatchObject({
      ok: true,
      data: { status: 'PATIENT_VERSION_CONFLICT', patient: { id: patientId } }
    })
    await expect(
      notFoundHarness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
    await expect(
      forbiddenHarness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toEqual(createPatientFailure('AUTHORIZATION_FAILED'))
    await expect(
      malformedHarness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    await expect(
      thrownHarness.handlers.amendDemographics(createAllowedEvent(), amendRequest)
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('maps demographic history records to public fields and validates output', async () => {
    const record = createDemographicRecord()
    const malformedHarness = createHarness({
      demographicHistory: () => ({
        items: [{ ...record, changes: [{ ...record.changes[0], fieldName: 'given_name_bad' }] }],
        page: 1,
        pageSize: 25,
        total: 1
      })
    })
    const thrownHarness = createHarness({
      demographicHistory: () => {
        throw createSensitiveError()
      }
    })

    await expect(
      createHarness({
        demographicHistory: () => ({ items: [record], page: 2, pageSize: 25, total: 30 })
      }).handlers.listDemographicAmendmentHistory(createAllowedEvent(), {
        ...demographicHistoryRequest,
        page: 2
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        items: [
          {
            amendmentId,
            patientId,
            priorRowVersion: 1,
            resultingRowVersion: 2,
            reasonCode: 'DATA_ENTRY_CORRECTION',
            reasonNote: sensitiveReasonNote,
            amendedByUserId: userId,
            amendedByDisplayName: 'Admin User',
            amendedAt: timestamp,
            changes: [
              { fieldName: 'givenName', previousValue: 'Tset', newValue: 'Test' },
              { fieldName: 'status', previousValue: 'ACTIVE', newValue: 'INACTIVE' }
            ]
          }
        ],
        page: 2,
        pageSize: 25,
        total: 30
      }
    })
    await expect(
      malformedHarness.handlers.listDemographicAmendmentHistory(
        createAllowedEvent(),
        demographicHistoryRequest
      )
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    await expect(
      thrownHarness.handlers.listDemographicAmendmentHistory(
        createAllowedEvent(),
        demographicHistoryRequest
      )
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('maps acknowledgment command service results and validates output', async () => {
    const patient = createPatientDetailRecord()
    const acknowledgment = createAcknowledgmentRecord()
    const conflictHarness = createHarness({
      acknowledgmentRecord: () => ({ status: 'PATIENT_VERSION_CONFLICT', patient })
    })
    const duplicateHarness = createHarness({
      acknowledgmentRecord: () => ({ status: 'DUPLICATE_DECISION', patient, acknowledgment })
    })
    const notFoundHarness = createHarness({
      acknowledgmentRecord: () => ({ status: 'NOT_FOUND' })
    })
    const malformedHarness = createHarness({
      acknowledgmentRecord: () => ({ status: 'RECORDED', acknowledgmentId: 'not-a-uuid', patient })
    })
    const thrownHarness = createHarness({
      acknowledgmentRecord: () => {
        throw createSensitiveError()
      }
    })

    await expect(
      createHarness().handlers.recordAcknowledgment(
        createAllowedEvent(),
        recordAcknowledgmentRequest
      )
    ).resolves.toMatchObject({
      ok: true,
      data: { status: 'RECORDED', acknowledgmentId, patient: { id: patientId } }
    })
    await expect(
      conflictHarness.handlers.recordAcknowledgment(
        createAllowedEvent(),
        recordAcknowledgmentRequest
      )
    ).resolves.toMatchObject({
      ok: true,
      data: { status: 'PATIENT_VERSION_CONFLICT', patient: { id: patientId } }
    })
    await expect(
      duplicateHarness.handlers.recordAcknowledgment(
        createAllowedEvent(),
        recordAcknowledgmentRequest
      )
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'DUPLICATE_DECISION',
        patient: { id: patientId },
        acknowledgment: {
          acknowledgmentId,
          patientId,
          status: 'ACKNOWLEDGED',
          priorRowVersion: 1,
          resultingRowVersion: 2
        }
      }
    })
    await expect(
      notFoundHarness.handlers.recordAcknowledgment(
        createAllowedEvent(),
        recordAcknowledgmentRequest
      )
    ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
    await expect(
      malformedHarness.handlers.recordAcknowledgment(
        createAllowedEvent(),
        recordAcknowledgmentRequest
      )
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    await expect(
      thrownHarness.handlers.recordAcknowledgment(createAllowedEvent(), recordAcknowledgmentRequest)
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('maps acknowledgment history, including legacy null versions, and validates output', async () => {
    const legacyRecord = createAcknowledgmentRecord({
      status: 'NOT_REQUESTED',
      note: null,
      priorRowVersion: null,
      resultingRowVersion: null
    })
    const explicitRecord = createAcknowledgmentRecord()
    const malformedHarness = createHarness({
      acknowledgmentHistory: () => ({
        items: [{ ...explicitRecord, sourceType: 'REMOTE' }],
        page: 1,
        pageSize: 25,
        total: 1
      })
    })
    const thrownHarness = createHarness({
      acknowledgmentHistory: () => {
        throw createSensitiveError()
      }
    })

    await expect(
      createHarness({
        acknowledgmentHistory: () => ({
          items: [legacyRecord, explicitRecord],
          page: 1,
          pageSize: 50,
          total: 2
        })
      }).handlers.listAcknowledgmentHistory(createAllowedEvent(), {
        ...acknowledgmentHistoryRequest,
        pageSize: 50
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        items: [
          {
            acknowledgmentId,
            patientId,
            status: 'NOT_REQUESTED',
            sourceType: 'LOCAL',
            note: null,
            recordedByUserId: userId,
            recordedByDisplayName: 'Admin User',
            recordedAt: timestamp,
            priorRowVersion: null,
            resultingRowVersion: null
          },
          {
            acknowledgmentId,
            patientId,
            status: 'ACKNOWLEDGED',
            sourceType: 'LOCAL',
            note: sensitiveAcknowledgmentNote,
            recordedByUserId: userId,
            recordedByDisplayName: 'Admin User',
            recordedAt: timestamp,
            priorRowVersion: 1,
            resultingRowVersion: 2
          }
        ],
        page: 1,
        pageSize: 50,
        total: 2
      }
    })
    await expect(
      malformedHarness.handlers.listAcknowledgmentHistory(
        createAllowedEvent(),
        acknowledgmentHistoryRequest
      )
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    await expect(
      thrownHarness.handlers.listAcknowledgmentHistory(
        createAllowedEvent(),
        acknowledgmentHistoryRequest
      )
    ).resolves.toEqual(createPatientFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(thrownHarness.logger)
  })
})

interface HandlerCase {
  readonly request:
    | PatientAmendDemographicsRequest
    | PatientListDemographicAmendmentHistoryRequest
    | PatientRecordAcknowledgmentRequest
    | PatientListAcknowledgmentHistoryRequest
  call(
    handlers: PatientIpcHandlers,
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<unknown>
}

const newHandlerCases: readonly HandlerCase[] = Object.freeze([
  {
    request: amendRequest,
    call: (handlers, event, request) => handlers.amendDemographics(event, request)
  },
  {
    request: demographicHistoryRequest,
    call: (handlers, event, request) => handlers.listDemographicAmendmentHistory(event, request)
  },
  {
    request: recordAcknowledgmentRequest,
    call: (handlers, event, request) => handlers.recordAcknowledgment(event, request)
  },
  {
    request: acknowledgmentHistoryRequest,
    call: (handlers, event, request) => handlers.listAcknowledgmentHistory(event, request)
  }
])

interface HarnessOptions {
  readonly role?: LocalUserRole
  readonly authError?: Error | null
  readonly demographicAmend?: () => unknown
  readonly demographicHistory?: () => unknown
  readonly acknowledgmentRecord?: () => unknown
  readonly acknowledgmentHistory?: () => unknown
}

interface TestHarness {
  readonly handlers: PatientIpcHandlers
  readonly authenticationSessionService: LocalAuthenticationSessionService & {
    readonly requireAnyRole: ReturnType<typeof vi.fn>
  }
  readonly demographicService: PatientDemographicAmendmentService & {
    readonly amend: ReturnType<typeof vi.fn>
    readonly listHistory: ReturnType<typeof vi.fn>
  }
  readonly acknowledgmentService: PatientAcknowledgmentService & {
    readonly record: ReturnType<typeof vi.fn>
    readonly listHistory: ReturnType<typeof vi.fn>
  }
  readonly logger: TestLogger
}

interface TestLogger extends PatientIpcOperationalLogger {
  readonly warn: PatientIpcOperationalLogger['warn'] & {
    readonly mock: { readonly calls: unknown[][] }
  }
  readonly error: PatientIpcOperationalLogger['error'] & {
    readonly mock: { readonly calls: unknown[][] }
  }
}

function createHarness(options: HarnessOptions = {}): TestHarness {
  const logger = createLogger()
  const authenticationSessionService = createAuthenticationSessionService(
    options.role ?? 'LOCAL_ADMIN',
    options.authError
  )
  const demographicService = {
    amend: vi.fn(
      options.demographicAmend ??
        (() => ({ status: 'AMENDED', patient: createPatientDetailRecord(), amendmentId }))
    ),
    listHistory: vi.fn(
      options.demographicHistory ?? (() => ({ items: [], page: 1, pageSize: 25, total: 0 }))
    )
  } as unknown as TestHarness['demographicService']
  const acknowledgmentService = {
    record: vi.fn(
      options.acknowledgmentRecord ??
        (() => ({ status: 'RECORDED', patient: createPatientDetailRecord(), acknowledgmentId }))
    ),
    listHistory: vi.fn(
      options.acknowledgmentHistory ?? (() => ({ items: [], page: 1, pageSize: 25, total: 0 }))
    )
  } as unknown as TestHarness['acknowledgmentService']

  return {
    handlers: createPatientIpcHandlers({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService,
      patientRegistryService: createPatientRegistryService(),
      patientDemographicAmendmentService: demographicService,
      patientAcknowledgmentService: acknowledgmentService,
      logger
    }),
    authenticationSessionService,
    demographicService,
    acknowledgmentService,
    logger
  }
}

function createAuthenticationSessionService(
  role: LocalUserRole,
  authError: Error | null | undefined
): TestHarness['authenticationSessionService'] {
  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn(() => {
      if (authError !== undefined && authError !== null) {
        throw authError
      }

      return createActiveContext(role)
    })
  } as unknown as TestHarness['authenticationSessionService']
}

function createPatientRegistryService(): PatientRegistryService {
  return {
    search: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listRecent: vi.fn(),
    findDuplicates: vi.fn(),
    markNotDuplicate: vi.fn()
  } as unknown as PatientRegistryService
}

function createActiveContext(role: LocalUserRole): ActiveLocalSessionContext {
  return {
    user: {
      id: userId,
      username: 'Admin.User' as never,
      displayName: 'Admin User' as never,
      role,
      isActive: true,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    authenticatedAt: timestamp,
    lastActivityAt: timestamp,
    idleExpiresAt: timestamp,
    absoluteExpiresAt: timestamp
  }
}

function createPatientDetailRecord(): PatientDetailRecord {
  return Object.freeze({
    id: patientId,
    patientCode: 'PT-000001' as never,
    displayName: 'Test Patient' as never,
    givenName: 'Test',
    familyName: 'Patient',
    otherNames: null,
    dateOfBirth: '1990-01-01',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Test Buea',
    quarter: 'Test Quarter',
    phone: '650 555 0100',
    status: 'ACTIVE',
    rowVersion: 2,
    updatedAt: timestamp,
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    acknowledgmentStatus: 'ACKNOWLEDGED',
    acknowledgmentRecordedAt: timestamp,
    acknowledgmentRecordedByDisplayName: 'Admin User',
    createdAt: timestamp,
    createdByDisplayName: 'Admin User',
    updatedByDisplayName: 'Admin User'
  })
}

function createDemographicRecord(): PatientDemographicAmendmentRecord {
  return Object.freeze({
    id: amendmentId,
    patientId,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: sensitiveReasonNote,
    amendedBy: userId,
    amendedByDisplayName: 'Admin User',
    amendedAt: timestamp,
    changes: Object.freeze([
      Object.freeze({ fieldName: 'given_name', previousValue: 'Tset', newValue: 'Test' }),
      Object.freeze({ fieldName: 'status', previousValue: 'ACTIVE', newValue: 'INACTIVE' })
    ])
  })
}

function createAcknowledgmentRecord(
  overrides: Partial<PatientAcknowledgmentRecord> = {}
): PatientAcknowledgmentRecord {
  return Object.freeze({
    id: acknowledgmentId,
    patientId,
    status: 'ACKNOWLEDGED',
    sourceType: 'LOCAL',
    note: sensitiveAcknowledgmentNote,
    recordedBy: userId,
    recordedByDisplayName: 'Admin User',
    recordedAt: timestamp,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    ...overrides
  })
}

function createAllowedEvent(): IpcSenderValidationEvent {
  return createEvent('http://localhost:5173/')
}

function createForbiddenEvent(): IpcSenderValidationEvent {
  return createEvent('https://example.invalid/')
}

function createEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}

function createLogger(): TestLogger {
  return {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function createSensitiveError(): Error {
  const error = new Error(
    `SELECT * FROM patients WHERE id = ${sensitivePatientValue}; ${sensitiveReasonNote}; ${sensitiveAcknowledgmentNote}; C:\\secret\\patient.sqlite3`
  )
  error.name = 'C:\\secret\\SqlitePatientError'

  return error
}

function expectLogsAreSafe(logger: TestLogger): void {
  const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

  expect(logs).not.toContain(sensitivePatientValue)
  expect(logs).not.toContain(sensitiveReasonNote)
  expect(logs).not.toContain(sensitiveAcknowledgmentNote)
  expect(logs).not.toContain('SELECT')
  expect(logs).not.toContain('patients')
  expect(logs).not.toContain('C:\\secret')
  expect(logs).not.toContain('SqlitePatientError')
  expect(logs).toContain('errorType=UnknownError')
}
