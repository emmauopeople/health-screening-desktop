import { describe, expect, it, vi } from 'vitest'

import {
  createAuditReportService,
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  type LocalAuthenticationSessionService
} from '@main/application'
import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseIanaTimeZone,
  type AuditReportRepository
} from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

const id = (suffix: string): string => `77000000-0000-4000-8000-0000000000${suffix}`
const request = {
  query: '',
  occurredFromInclusive: null,
  occurredToExclusive: null,
  actor: { kind: 'ALL' as const },
  action: null,
  entityType: null,
  entityId: null,
  page: 1,
  pageSize: 25 as const
}

describe('audit report service', () => {
  it('requires the local administrator role before returning report data', () => {
    const authenticationSessionService = createAuthenticationSessionService()
    const repository = createRepository()
    const service = createAuditReportService({
      authenticationSessionService,
      auditReportRepository: repository
    })

    expect(service.getContext()).toMatchObject({
      status: 'LOADED',
      deployment: { name: 'Cameroon Pilot' }
    })
    expect(service.search(request)).toMatchObject({
      status: 'LOADED',
      total: 1,
      items: [{ action: 'PATIENT_CREATED' }]
    })
    expect(authenticationSessionService.requireAnyRole).toHaveBeenCalledWith(['LOCAL_ADMIN'])
    expect(repository.search).toHaveBeenCalledOnce()
  })

  it('contains locked and unauthorized sessions without reading the repository', () => {
    const repository = createRepository()
    const locked = createAuthenticationSessionService(new LocalSessionLockedError())
    const forbidden = createAuthenticationSessionService(new LocalSessionAuthorizationError())

    expect(
      createAuditReportService({
        authenticationSessionService: locked,
        auditReportRepository: repository
      }).search(request)
    ).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
    expect(
      createAuditReportService({
        authenticationSessionService: forbidden,
        auditReportRepository: repository
      }).getContext()
    ).toEqual({ status: 'FORBIDDEN' })
    expect(repository.getContext).not.toHaveBeenCalled()
    expect(repository.search).not.toHaveBeenCalled()
  })

  it('rejects malformed requests and contains repository failures', () => {
    const repository = createRepository()
    const service = createAuditReportService({
      authenticationSessionService: createAuthenticationSessionService(),
      auditReportRepository: repository
    })

    expect(service.search({ ...request, entityId: id('20') })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(repository.search).not.toHaveBeenCalled()

    vi.mocked(repository.search).mockImplementation(() => {
      throw new Error('database path and secret row')
    })
    expect(service.search(request)).toEqual({ status: 'UNAVAILABLE' })
  })
})

function createAuthenticationSessionService(failure?: Error): LocalAuthenticationSessionService {
  return {
    requireAnyRole: vi.fn(() => {
      if (failure !== undefined) throw failure
      return {} as never
    })
  } as unknown as LocalAuthenticationSessionService
}

function createRepository(): AuditReportRepository {
  const deployment = Object.freeze({
    id: parseEntityId(id('01')),
    name: 'Cameroon Pilot',
    timeZone: parseIanaTimeZone('Africa/Douala')
  })
  const actor = Object.freeze({
    id: parseEntityId(id('02')),
    username: 'admin',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN' as const
  })
  const event = Object.freeze({
    id: parseEntityId(id('10')),
    action: parseAuditActionCode('PATIENT_CREATED'),
    entityType: parseAuditEntityType('PATIENT'),
    entityId: parseEntityId(id('20')),
    occurredAt: parseUtcTimestamp('2026-09-08T12:00:00.000Z'),
    actor,
    deployment,
    metadata: Object.freeze({ source: 'LOCAL' })
  })

  return {
    getContext: vi.fn(() => ({
      deployment,
      actors: Object.freeze([actor]),
      actions: Object.freeze([event.action]),
      entityTypes: Object.freeze([event.entityType]),
      hasSystemEvents: false
    })),
    search: vi.fn(() => ({
      items: Object.freeze([event]),
      page: 1,
      pageSize: 25 as const,
      total: 1
    }))
  }
}
