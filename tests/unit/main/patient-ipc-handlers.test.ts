import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { PatientRegistryService } from '@main/application'
import { PatientRegistryCreationError } from '@main/application'
import type { ActiveLocalSessionContext } from '@main/application'
import type { AuthenticatedHandlerAuthorization } from '@main/ipc/authentication'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createAuthenticationFailure,
  createIpcSuccess,
  type PatientCreateRequest,
  type PublicPatientSummary,
  type UtcTimestamp
} from '@shared/ipc'

const activeContext = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin',
    displayName: 'Administrator',
    role: 'LOCAL_ADMIN',
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: '2026-08-03T12:00:00.000Z',
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z'
  },
  authenticatedAt: '2026-08-03T12:00:00.000Z',
  lastActivityAt: '2026-08-03T12:00:00.000Z',
  idleExpiresAt: '2026-08-03T12:15:00.000Z',
  absoluteExpiresAt: '2026-08-04T00:00:00.000Z'
} as ActiveLocalSessionContext

const patient: PublicPatientSummary = {
  patientId: '00000000-0000-4000-8000-000000000101',
  patientCode: 'PT-000001',
  displayName: 'Alice Tangwa',
  status: 'ACTIVE',
  sex: 'FEMALE',
  dateOfBirth: '1990-05-12',
  approximateAgeYears: null,
  approximateAgeAsOfDate: null,
  ageDobDisplay: 'DOB 1990-05-12',
  village: 'Nkwen',
  quarter: 'Upper',
  phoneAvailable: true,
  lastScreening: null,
  referralFollowUp: null,
  revision: '2026-08-03T12:00:00.000Z' as UtcTimestamp
}

const createRequest: PatientCreateRequest = {
  givenName: 'Alice',
  middleName: null,
  familyName: 'Tangwa',
  sex: 'FEMALE',
  dateOfBirth: '1990-05-12',
  approximateAgeYears: null,
  approximateAgeAsOfDate: null,
  village: 'Nkwen',
  quarter: 'Upper',
  phone: '+1 312 555 0101',
  acknowledgmentStatus: 'ACKNOWLEDGED',
  acknowledgmentReference: null,
  reviewedDuplicateToken: null
}

describe('patient IPC handlers', () => {
  it('authorizes patient search roles and returns only validated response envelopes', async () => {
    const service = createService({
      search: vi.fn(() => ({
        rows: [patient],
        total: 1,
        page: 1,
        pageSize: 25 as const
      }))
    })
    const authorization = createAuthorization()
    const handlers = createHandlers(service, authorization)

    await expect(
      handlers.search(createAllowedEvent(), { query: 'alice', page: 1, pageSize: 25 })
    ).resolves.toEqual(
      createIpcSuccess({
        rows: [patient],
        total: 1,
        page: 1,
        pageSize: 25
      })
    )
    expect(authorization.requireAnyRole).toHaveBeenCalledWith(createAllowedEvent(), [
      'LOCAL_ADMIN',
      'NURSE',
      'TRAINED_SCREENER'
    ])
    expect(service.search).toHaveBeenCalledWith(
      { user: activeContext.user },
      { query: 'alice', page: 1, pageSize: 25 }
    )
  })

  it('fails closed before service execution for denied senders or malformed requests', async () => {
    const service = createService()
    const deniedAuthorization = createAuthorization({
      requireAnyRole: vi.fn(() => ({
        ok: false as const,
        failure: createAuthenticationFailure('IPC_FORBIDDEN')
      }))
    })

    await expect(
      createHandlers(service, deniedAuthorization).create(createAllowedEvent(), createRequest)
    ).resolves.toEqual(createAuthenticationFailure('IPC_FORBIDDEN'))

    const allowedAuthorization = createAuthorization()

    await expect(
      createHandlers(service, allowedAuthorization).create(createAllowedEvent(), {
        ...createRequest,
        dateOfBirth: null,
        approximateAgeYears: null
      })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    expect(service.create).not.toHaveBeenCalled()
  })

  it('maps service failures to fixed internal errors without leaking details', async () => {
    const service = createService({
      create: vi.fn(() => {
        throw new PatientRegistryCreationError('C:\\secret\\registry.sqlite3')
      })
    })

    const result = await createHandlers(service).create(createAllowedEvent(), createRequest)

    expect(result).toEqual(createAuthenticationFailure('INTERNAL_ERROR'))
    expect(JSON.stringify(result)).not.toContain('C:\\secret')
  })
})

function createHandlers(
  service: PatientRegistryService = createService(),
  authorization: AuthenticatedHandlerAuthorization = createAuthorization()
): ReturnType<typeof createPatientIpcHandlers> {
  return createPatientIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authorization,
    patientRegistryService: service,
    logger: {
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>()
    }
  })
}

function createAuthorization(
  overrides: Partial<AuthenticatedHandlerAuthorization> = {}
): AuthenticatedHandlerAuthorization {
  return {
    requireActiveSession: vi.fn(() => ({
      ok: true as const,
      context: activeContext
    })),
    requireAnyRole: vi.fn(() => ({
      ok: true as const,
      context: activeContext
    })),
    ...overrides
  }
}

function createService(overrides: Partial<PatientRegistryService> = {}): PatientRegistryService {
  return {
    search: vi.fn(() => ({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25 as const
    })),
    getSummary: vi.fn(() => patient),
    findDuplicates: vi.fn(() => ({
      candidates: [],
      reviewToken: '0'.repeat(64)
    })),
    create: vi.fn(() => ({
      status: 'CREATED' as const,
      patient
    })),
    ...overrides
  }
}

function createAllowedEvent(): IpcSenderValidationEvent {
  const mainFrame = { url: 'http://localhost:5173/' }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}
