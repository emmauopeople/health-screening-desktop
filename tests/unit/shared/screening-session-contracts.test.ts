import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  ipcChannels,
  screeningSessionCloseRequestSchema,
  screeningSessionCloseResultSchema,
  screeningSessionCreateRequestSchema,
  screeningSessionCreateResultSchema,
  screeningSessionGetByIdRequestSchema,
  screeningSessionGetByIdResultSchema,
  screeningSessionGetWorkspaceContextRequestSchema,
  screeningSessionGetWorkspaceContextResultSchema,
  screeningSessionListRequestSchema,
  screeningSessionListResultSchema,
  screeningSessionReopenRequestSchema,
  screeningSessionReopenResultSchema
} from '@shared/ipc'

const sessionId = '11111111-1111-4111-8111-111111111111'
const locationId = '22222222-2222-4222-8222-222222222222'
const protocolVersionId = '33333333-3333-4333-8333-333333333333'
const timestamp = '2026-07-29T12:34:56.789Z'
const note = 'Private setup note for synthetic testing.'
const reason = 'Reopened after synthetic staff review.'

const openSession = {
  id: sessionId,
  locationId,
  protocolVersionId,
  sessionDate: '2026-07-29',
  status: 'OPEN',
  notes: note,
  openedAt: timestamp,
  closedAt: null,
  createdAt: timestamp,
  rowVersion: 1
} as const

const closedSession = {
  ...openSession,
  status: 'CLOSED',
  closedAt: '2026-07-29T13:34:56.789Z',
  rowVersion: 2
} as const

describe('screening-session IPC contracts', () => {
  it('defines the exact screening-session channel strings', () => {
    expect(ipcChannels.screeningSessions.getWorkspaceContext).toBe(
      'health-screening:screening-sessions:get-workspace-context'
    )
    expect(ipcChannels.screeningSessions.create).toBe('health-screening:screening-sessions:create')
    expect(ipcChannels.screeningSessions.close).toBe('health-screening:screening-sessions:close')
    expect(ipcChannels.screeningSessions.reopen).toBe('health-screening:screening-sessions:reopen')
    expect(ipcChannels.screeningSessions.getById).toBe(
      'health-screening:screening-sessions:get-by-id'
    )
    expect(ipcChannels.screeningSessions.list).toBe('health-screening:screening-sessions:list')
  })

  it('accepts every valid exact request shape', () => {
    expect(screeningSessionGetWorkspaceContextRequestSchema.parse({})).toEqual({})
    expect(
      screeningSessionCreateRequestSchema.parse({
        locationId,
        sessionDate: '2026-07-29',
        notes: note
      })
    ).toEqual({ locationId, sessionDate: '2026-07-29', notes: note })
    expect(
      screeningSessionCreateRequestSchema.parse({
        locationId,
        sessionDate: '2026-07-29'
      })
    ).toEqual({ locationId, sessionDate: '2026-07-29' })
    expect(
      screeningSessionCloseRequestSchema.parse({
        id: sessionId,
        expectedRowVersion: 1
      })
    ).toEqual({ id: sessionId, expectedRowVersion: 1 })
    expect(
      screeningSessionCloseRequestSchema.parse({
        id: sessionId,
        expectedRowVersion: 1,
        reason: null
      })
    ).toEqual({ id: sessionId, expectedRowVersion: 1, reason: null })
    expect(
      screeningSessionReopenRequestSchema.parse({
        id: sessionId,
        expectedRowVersion: 2,
        reason
      })
    ).toEqual({ id: sessionId, expectedRowVersion: 2, reason })
    expect(screeningSessionGetByIdRequestSchema.parse({ id: sessionId })).toEqual({
      id: sessionId
    })
    expect(
      screeningSessionListRequestSchema.parse({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: 1,
        pageSize: 25
      })
    ).toEqual({
      locationId: null,
      status: null,
      dateFrom: null,
      dateTo: null,
      page: 1,
      pageSize: 25
    })
  })

  it('rejects missing fields, extra fields, renderer authority, and generated create fields', () => {
    const forbiddenCreateFields = [
      { userId: sessionId },
      { role: 'LOCAL_ADMIN' },
      { actor: { userId: sessionId, role: 'LOCAL_ADMIN' } },
      { protocolVersionId },
      { id: sessionId },
      { lifecycleHistoryId: sessionId },
      { auditEventId: sessionId },
      { outboxId: sessionId },
      { status: 'OPEN' },
      { rowVersion: 1 },
      { createdAt: timestamp }
    ] as const

    for (const extra of forbiddenCreateFields) {
      expect(
        screeningSessionCreateRequestSchema.safeParse({
          locationId,
          sessionDate: '2026-07-29',
          ...extra
        }).success
      ).toBe(false)
    }

    expect(screeningSessionCreateRequestSchema.safeParse({ locationId }).success).toBe(false)
    expect(screeningSessionCloseRequestSchema.safeParse({ id: sessionId }).success).toBe(false)
    expect(
      screeningSessionReopenRequestSchema.safeParse({
        id: sessionId,
        expectedRowVersion: 1
      }).success
    ).toBe(false)
    expect(
      screeningSessionGetWorkspaceContextRequestSchema.safeParse({ extra: true }).success
    ).toBe(false)
  })

  it('rejects malformed identifiers, dates, versions, filters, pagination, and text', () => {
    expect(
      screeningSessionCreateRequestSchema.safeParse({
        locationId: 'not-a-uuid',
        sessionDate: '2026-07-29'
      }).success
    ).toBe(false)
    expect(
      screeningSessionCreateRequestSchema.safeParse({
        locationId,
        sessionDate: '2026-02-30'
      }).success
    ).toBe(false)
    expect(
      screeningSessionCloseRequestSchema.safeParse({
        id: sessionId,
        expectedRowVersion: 0
      }).success
    ).toBe(false)
    expect(
      screeningSessionListRequestSchema.safeParse({
        locationId,
        status: 'OPEN',
        dateFrom: '2026-07-30',
        dateTo: '2026-07-29',
        page: 1,
        pageSize: 25
      }).success
    ).toBe(false)
    expect(
      screeningSessionListRequestSchema.safeParse({
        locationId: null,
        status: null,
        dateFrom: null,
        dateTo: null,
        page: 1,
        pageSize: 10
      }).success
    ).toBe(false)

    for (const unsafeText of ['', '   ', 'line\nbreak', '\u007f', '\u2028', '\ud800']) {
      expect(
        screeningSessionCreateRequestSchema.safeParse({
          locationId,
          sessionDate: '2026-07-29',
          notes: unsafeText
        }).success
      ).toBe(false)
      expect(
        screeningSessionReopenRequestSchema.safeParse({
          id: sessionId,
          expectedRowVersion: 1,
          reason: unsafeText
        }).success
      ).toBe(false)
    }

    expect(
      screeningSessionCloseRequestSchema.safeParse({
        id: sessionId,
        expectedRowVersion: 1,
        reason: '\u{1f600}'.repeat(500)
      }).success
    ).toBe(true)
    expect(
      screeningSessionCloseRequestSchema.safeParse({
        id: sessionId,
        expectedRowVersion: 1,
        reason: '\u{1f600}'.repeat(501)
      }).success
    ).toBe(false)
  })

  it('rejects unsafe transport objects without invoking accessors or leaking proxy failures', () => {
    let getterInvoked = false
    const getterRequest = { locationId, sessionDate: '2026-07-29' }

    Object.defineProperty(getterRequest, 'notes', {
      enumerable: true,
      get() {
        getterInvoked = true
        return note
      }
    })

    const cyclicRequest: Record<string, unknown> = { locationId, sessionDate: '2026-07-29' }
    cyclicRequest['self'] = cyclicRequest
    const symbolRequest = Object.defineProperty(
      { locationId, sessionDate: '2026-07-29' },
      Symbol('role'),
      {
        enumerable: true,
        value: 'LOCAL_ADMIN'
      }
    )
    const proxyRequest = new Proxy(
      { locationId, sessionDate: '2026-07-29' },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\screening.sqlite3')
        }
      }
    )

    for (const value of [
      Object.assign(Object.create({ role: 'LOCAL_ADMIN' }), {
        locationId,
        sessionDate: '2026-07-29'
      }),
      getterRequest,
      symbolRequest,
      cyclicRequest,
      proxyRequest
    ]) {
      expect(() => screeningSessionCreateRequestSchema.safeParse(value)).not.toThrow()
      expect(screeningSessionCreateRequestSchema.safeParse(value).success).toBe(false)
    }

    expect(getterInvoked).toBe(false)
  })

  it('accepts public success results for lifecycle outcomes', () => {
    for (const status of [
      'ALREADY_EXISTS',
      'SESSION_DATE_NOT_CURRENT',
      'LOCATION_NOT_FOUND',
      'LOCATION_INACTIVE',
      'NO_ACTIVE_PROTOCOL'
    ] as const) {
      expect(
        screeningSessionCreateResultSchema.safeParse(createIpcSuccess({ status })).success
      ).toBe(true)
    }

    expect(
      screeningSessionCreateResultSchema.parse(
        createIpcSuccess({ status: 'CREATED', session: openSession })
      )
    ).toEqual(createIpcSuccess({ status: 'CREATED', session: openSession }))
    expect(
      screeningSessionCloseResultSchema.safeParse(
        createIpcSuccess({ status: 'CLOSED', session: closedSession })
      ).success
    ).toBe(true)
    expect(
      screeningSessionReopenResultSchema.safeParse(
        createIpcSuccess({ status: 'REOPENED', session: openSession })
      ).success
    ).toBe(true)
    expect(
      screeningSessionReopenResultSchema.safeParse(createIpcSuccess({ status: 'FORBIDDEN' }))
        .success
    ).toBe(true)
    expect(
      screeningSessionGetByIdResultSchema.safeParse(
        createIpcSuccess({ status: 'FOUND', session: openSession })
      ).success
    ).toBe(true)
    expect(
      screeningSessionListResultSchema.safeParse(
        createIpcSuccess({
          status: 'LISTED',
          items: [openSession],
          page: 1,
          pageSize: 25,
          total: 1
        })
      ).success
    ).toBe(true)
  })

  it('accepts safe workspace context results and rejects internal output fields', () => {
    expect(
      screeningSessionGetWorkspaceContextResultSchema.safeParse(
        createIpcSuccess({
          deploymentLocalDate: '2026-07-29',
          activeLocations: [{ id: locationId, name: 'Central Church' }]
        })
      ).success
    ).toBe(true)
    expect(
      screeningSessionGetWorkspaceContextResultSchema.safeParse(
        createIpcSuccess({
          deploymentLocalDate: '2026-07-29',
          activeLocations: [
            {
              id: locationId,
              name: 'Central Church',
              nameNormalized: 'central church'
            }
          ]
        })
      ).success
    ).toBe(false)
  })

  it('rejects internal or unexpected public session output fields', () => {
    for (const extra of [
      { openedBy: sessionId },
      { createdBy: sessionId },
      { updatedAt: timestamp },
      { lifecycleHistoryId: sessionId },
      { auditMetadata: { session_id: sessionId } },
      { outboxPayload: { screening_session_id: sessionId } },
      { locationDisplayName: 'Central Church' }
    ]) {
      expect(
        screeningSessionGetByIdResultSchema.safeParse(
          createIpcSuccess({ status: 'FOUND', session: { ...openSession, ...extra } })
        ).success
      ).toBe(false)
    }

    expect(
      screeningSessionGetByIdResultSchema.safeParse(
        createIpcSuccess({ status: 'FOUND', session: { ...openSession, closedAt: timestamp } })
      ).success
    ).toBe(false)
    expect(
      screeningSessionGetByIdResultSchema.safeParse(
        createIpcSuccess({ status: 'FOUND', session: { ...closedSession, closedAt: null } })
      ).success
    ).toBe(false)
  })
})
