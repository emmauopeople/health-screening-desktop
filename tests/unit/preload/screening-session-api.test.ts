import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createIpcSuccess,
  createScreeningSessionFailure,
  ipcChannels,
  type HealthScreeningApi,
  type PublicScreeningSession,
  type PublicScreeningSessionWorkspaceLocation,
  type ScreeningSessionCloseRequest,
  type ScreeningSessionCreateRequest,
  type ScreeningSessionGetByIdRequest,
  type ScreeningSessionListRequest,
  type ScreeningSessionReopenRequest
} from '@shared/ipc'

const sessionId = '11111111-1111-4111-8111-111111111111'
const locationId = '22222222-2222-4222-8222-222222222222'
const secondLocationId = '22222222-2222-4222-8222-222222222223'
const protocolVersionId = '33333333-3333-4333-8333-333333333333'
const timestamp = '2026-07-29T12:34:56.789Z'
const closedTimestamp = '2026-07-29T13:34:56.789Z'
const sensitiveNote = 'Synthetic private setup note.'
const sensitiveReason = 'Synthetic private closure reason.'

const openSession: PublicScreeningSession = {
  id: sessionId,
  locationId,
  protocolVersionId,
  sessionDate: '2026-07-29',
  status: 'OPEN',
  notes: sensitiveNote,
  openedAt: timestamp,
  closedAt: null,
  createdAt: timestamp,
  rowVersion: 1
}

const closedSession: PublicScreeningSession = {
  ...openSession,
  status: 'CLOSED',
  closedAt: closedTimestamp,
  rowVersion: 2
}

const activeLocation: PublicScreeningSessionWorkspaceLocation = {
  id: locationId,
  name: 'Central Church'
}

const createRequest: ScreeningSessionCreateRequest = {
  locationId,
  sessionDate: '2026-07-29',
  notes: sensitiveNote
}

const closeRequest: ScreeningSessionCloseRequest = {
  id: sessionId,
  expectedRowVersion: 1,
  reason: sensitiveReason
}

const reopenRequest: ScreeningSessionReopenRequest = {
  id: sessionId,
  expectedRowVersion: 2,
  reason: sensitiveReason
}

const getByIdRequest: ScreeningSessionGetByIdRequest = {
  id: sessionId
}

const listRequest: ScreeningSessionListRequest = {
  locationId: null,
  status: null,
  dateFrom: null,
  dateTo: null,
  page: 1,
  pageSize: 25
}

describe('preload screening-session API', () => {
  it('exposes exactly the frozen screeningSessions methods without transport internals', () => {
    const api = createHealthScreeningApi(vi.fn())

    expect(Object.keys(api.screeningSessions)).toEqual([
      'getWorkspaceContext',
      'create',
      'close',
      'reopen',
      'getById',
      'list'
    ])
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.screeningSessions)).toBe(true)

    for (const transportName of [
      'invoke',
      'send',
      'sendSync',
      'on',
      'once',
      'removeListener',
      'subscribe',
      'ipcRenderer',
      'channel'
    ]) {
      expect(transportName in api.screeningSessions).toBe(false)
    }
  })

  it('keeps the HealthScreeningApi type and composed API surface in sync', () => {
    const api: HealthScreeningApi = createHealthScreeningApi(vi.fn())

    expect(typeof api.screeningSessions.getWorkspaceContext).toBe('function')
    expect(typeof api.screeningSessions.create).toBe('function')
    expect(typeof api.screeningSessions.close).toBe('function')
    expect(typeof api.screeningSessions.reopen).toBe('function')
    expect(typeof api.screeningSessions.getById).toBe('function')
    expect(typeof api.screeningSessions.list).toBe('function')
  })

  it('invokes only the exact fixed screening-session channels with parsed requests', async () => {
    const responses = [
      createIpcSuccess({
        deploymentLocalDate: '2026-07-29',
        activeLocations: [activeLocation]
      }),
      createIpcSuccess({ status: 'CREATED' as const, session: openSession }),
      createIpcSuccess({ status: 'CLOSED' as const, session: closedSession }),
      createIpcSuccess({ status: 'REOPENED' as const, session: openSession }),
      createIpcSuccess({ status: 'FOUND' as const, session: openSession }),
      createIpcSuccess({
        status: 'LISTED' as const,
        items: [openSession],
        page: 1,
        pageSize: 25,
        total: 1
      })
    ]
    const invoke = vi.fn()

    for (const response of responses) {
      invoke.mockResolvedValueOnce(response)
    }

    const api = createHealthScreeningApi(invoke)
    const rendererCreateRequest = { ...createRequest }

    const getWorkspaceContextWithIgnoredArgument = api.screeningSessions
      .getWorkspaceContext as unknown as (request: unknown) => Promise<unknown>

    await expect(
      getWorkspaceContextWithIgnoredArgument({ channel: 'attacker:channel' })
    ).resolves.toEqual(responses[0])
    await expect(api.screeningSessions.create(rendererCreateRequest)).resolves.toEqual(responses[1])
    await expect(api.screeningSessions.close(closeRequest)).resolves.toEqual(responses[2])
    await expect(api.screeningSessions.reopen(reopenRequest)).resolves.toEqual(responses[3])
    await expect(api.screeningSessions.getById(getByIdRequest)).resolves.toEqual(responses[4])
    await expect(api.screeningSessions.list(listRequest)).resolves.toEqual(responses[5])

    expect(invoke).toHaveBeenNthCalledWith(1, ipcChannels.screeningSessions.getWorkspaceContext, {})
    expect(invoke).toHaveBeenNthCalledWith(2, ipcChannels.screeningSessions.create, createRequest)
    expect(invoke.mock.calls[1]?.[1]).not.toBe(rendererCreateRequest)
    expect(invoke).toHaveBeenNthCalledWith(3, ipcChannels.screeningSessions.close, closeRequest)
    expect(invoke).toHaveBeenNthCalledWith(4, ipcChannels.screeningSessions.reopen, reopenRequest)
    expect(invoke).toHaveBeenNthCalledWith(5, ipcChannels.screeningSessions.getById, getByIdRequest)
    expect(invoke).toHaveBeenNthCalledWith(6, ipcChannels.screeningSessions.list, listRequest)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', expect.anything())
    expect(rendererCreateRequest).toEqual(createRequest)
    expect(Object.isFrozen(rendererCreateRequest)).toBe(false)
  })

  it('preserves every valid service business outcome after response validation', async () => {
    const cases = [
      [
        'create',
        createRequest,
        createIpcSuccess({ status: 'CREATED' as const, session: openSession })
      ],
      ['create', createRequest, createIpcSuccess({ status: 'ALREADY_EXISTS' as const })],
      ['create', createRequest, createIpcSuccess({ status: 'SESSION_DATE_NOT_CURRENT' as const })],
      ['create', createRequest, createIpcSuccess({ status: 'LOCATION_NOT_FOUND' as const })],
      ['create', createRequest, createIpcSuccess({ status: 'LOCATION_INACTIVE' as const })],
      ['create', createRequest, createIpcSuccess({ status: 'NO_ACTIVE_PROTOCOL' as const })],
      [
        'close',
        closeRequest,
        createIpcSuccess({ status: 'CLOSED' as const, session: closedSession })
      ],
      ['close', closeRequest, createIpcSuccess({ status: 'NOT_FOUND' as const })],
      [
        'close',
        closeRequest,
        createIpcSuccess({ status: 'SESSION_VERSION_CONFLICT' as const, session: openSession })
      ],
      [
        'close',
        closeRequest,
        createIpcSuccess({ status: 'ALREADY_CLOSED' as const, session: closedSession })
      ],
      [
        'reopen',
        reopenRequest,
        createIpcSuccess({ status: 'REOPENED' as const, session: openSession })
      ],
      ['reopen', reopenRequest, createIpcSuccess({ status: 'NOT_FOUND' as const })],
      [
        'reopen',
        reopenRequest,
        createIpcSuccess({ status: 'SESSION_VERSION_CONFLICT' as const, session: closedSession })
      ],
      [
        'reopen',
        reopenRequest,
        createIpcSuccess({ status: 'ALREADY_OPEN' as const, session: openSession })
      ],
      ['reopen', reopenRequest, createIpcSuccess({ status: 'FORBIDDEN' as const })],
      [
        'getById',
        getByIdRequest,
        createIpcSuccess({ status: 'FOUND' as const, session: openSession })
      ],
      ['getById', getByIdRequest, createIpcSuccess({ status: 'NOT_FOUND' as const })],
      [
        'list',
        listRequest,
        createIpcSuccess({
          status: 'LISTED' as const,
          items: [openSession],
          page: 1,
          pageSize: 25,
          total: 1
        })
      ]
    ] as const

    for (const [method, request, response] of cases) {
      const invoke = vi.fn().mockResolvedValue(response)
      const api = createHealthScreeningApi(invoke)

      await expect(api.screeningSessions[method](request as never)).resolves.toEqual(response)
    }
  })

  it('rejects invalid create requests locally without invoking IPC', async () => {
    const invalidRequests = [
      { ...createRequest, actor: { userId: sessionId, role: 'LOCAL_ADMIN' } },
      { ...createRequest, userId: sessionId },
      { ...createRequest, role: 'LOCAL_ADMIN' },
      { ...createRequest, protocolVersionId },
      { ...createRequest, id: sessionId },
      { ...createRequest, createdAt: timestamp },
      { ...createRequest, locationId: 'not-a-uuid' },
      { ...createRequest, sessionDate: '2026-02-30' },
      { ...createRequest, notes: 'Unsafe\nnote' },
      { ...createRequest, notes: '\ud800' }
    ]

    for (const request of invalidRequests) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningSessions.create(
        request as unknown as ScreeningSessionCreateRequest
      )

      expect(result).toEqual(createScreeningSessionFailure('VALIDATION_FAILED'))
      expect(Object.isFrozen(result)).toBe(true)
      if (result.ok) {
        throw new Error('Expected validation failure result.')
      }
      expect(Object.isFrozen(result.error)).toBe(true)
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('rejects invalid lifecycle, lookup, and list requests locally without invoking IPC', async () => {
    const invalidCalls: ReadonlyArray<{
      readonly method: 'close' | 'reopen' | 'getById' | 'list'
      readonly request:
        | ScreeningSessionCloseRequest
        | ScreeningSessionReopenRequest
        | ScreeningSessionGetByIdRequest
        | ScreeningSessionListRequest
    }> = [
      { method: 'close', request: { ...closeRequest, expectedRowVersion: 0 } },
      { method: 'close', request: { ...closeRequest, reason: '' } },
      { method: 'reopen', request: { ...reopenRequest, reason: '  ' } },
      { method: 'reopen', request: { ...reopenRequest, reason: '\u0085' } },
      { method: 'getById', request: { id: 'not-a-uuid' } },
      { method: 'list', request: { ...listRequest, page: 0 } },
      { method: 'list', request: { ...listRequest, pageSize: 10 as never } },
      { method: 'list', request: { ...listRequest, status: 'DRAFT' as never } },
      { method: 'list', request: { ...listRequest, dateFrom: '2026-07-30', dateTo: '2026-07-29' } }
    ]

    for (const { method, request } of invalidCalls) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningSessions[method](
        request as never
      )

      expect(result).toEqual(createScreeningSessionFailure('VALIDATION_FAILED'))
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('contains hostile renderer request objects without invoking IPC or accessors', async () => {
    let getterInvoked = false
    const accessorRequest = { ...createRequest }

    Object.defineProperty(accessorRequest, 'notes', {
      enumerable: true,
      get() {
        getterInvoked = true
        return sensitiveNote
      }
    })

    const symbolRequest = Object.defineProperty({ ...createRequest }, Symbol('role'), {
      enumerable: true,
      value: 'LOCAL_ADMIN'
    })
    const cyclicRequest: Record<string, unknown> = { ...createRequest }
    cyclicRequest['self'] = cyclicRequest
    const customPrototypeRequest = Object.assign(Object.create({ trusted: true }), createRequest)
    const proxyTrapRequest = new Proxy(
      { ...createRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error(`C:\\secret\\${sensitiveNote}`)
        }
      }
    )

    for (const request of [
      accessorRequest,
      symbolRequest,
      cyclicRequest,
      customPrototypeRequest,
      proxyTrapRequest
    ]) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningSessions.create(
        request as unknown as ScreeningSessionCreateRequest
      )

      expect(result).toEqual(createScreeningSessionFailure('VALIDATION_FAILED'))
      expect(invoke).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('C:\\')
      expect(JSON.stringify(result)).not.toContain(sensitiveNote)
    }

    expect(getterInvoked).toBe(false)
  })

  it('maps invoke failures and malformed responses to frozen IPC_UNAVAILABLE failures', async () => {
    const malformedResponses = [
      createIpcSuccess({
        status: 'CREATED',
        session: { ...openSession, createdBy: sessionId }
      }),
      createIpcSuccess({
        status: 'UNKNOWN',
        session: openSession
      }),
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: `SELECT * FROM screening_sessions; ${sensitiveNote}; C:\\secret\\db.sqlite`
        }
      },
      createIpcSuccess({
        deploymentLocalDate: '2026-07-29',
        activeLocations: [
          {
            ...activeLocation,
            createdAt: timestamp
          }
        ]
      }),
      new Proxy(createIpcSuccess({ status: 'CREATED', session: openSession }), {
        ownKeys() {
          throw new Error(`proxy trap ${sensitiveReason}`)
        }
      })
    ]

    for (const response of malformedResponses) {
      const result = await createHealthScreeningApi(
        vi.fn().mockResolvedValue(response)
      ).screeningSessions.create(createRequest)

      expect(result).toEqual(createScreeningSessionFailure('IPC_UNAVAILABLE'))
      expect(Object.isFrozen(result)).toBe(true)
      expectScreeningFailureIsSafe(result)
    }

    for (const invoke of [
      vi.fn().mockRejectedValue(createSensitiveError()),
      vi.fn(() => {
        throw `primitive ${sensitiveReason}`
      })
    ]) {
      const result = await createHealthScreeningApi(invoke).screeningSessions.create(createRequest)

      expect(result).toEqual(createScreeningSessionFailure('IPC_UNAVAILABLE'))
      expect(Object.isFrozen(result)).toBe(true)
      expectScreeningFailureIsSafe(result)
    }
  })

  it('deeply freezes workspace, list, session, and failure results returned through preload', async () => {
    const workspaceResult = await createHealthScreeningApi(
      vi.fn().mockResolvedValue(
        createIpcSuccess({
          deploymentLocalDate: '2026-07-29',
          activeLocations: [activeLocation]
        })
      )
    ).screeningSessions.getWorkspaceContext()
    const listResult = await createHealthScreeningApi(
      vi.fn().mockResolvedValue(
        createIpcSuccess({
          status: 'LISTED',
          items: [openSession],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    ).screeningSessions.list(listRequest)
    const failureResult = await createHealthScreeningApi(vi.fn()).screeningSessions.create({
      ...createRequest,
      locationId: 'not-a-uuid'
    } as ScreeningSessionCreateRequest)

    expect(Object.isFrozen(workspaceResult)).toBe(true)
    expect(Object.isFrozen(workspaceResult.ok && workspaceResult.data)).toBe(true)
    expect(Object.isFrozen(workspaceResult.ok && workspaceResult.data.activeLocations)).toBe(true)
    expect(Object.isFrozen(workspaceResult.ok && workspaceResult.data.activeLocations[0])).toBe(
      true
    )
    expect(Object.isFrozen(listResult)).toBe(true)
    expect(Object.isFrozen(listResult.ok && listResult.data)).toBe(true)
    expect(Object.isFrozen(listResult.ok && listResult.data.items)).toBe(true)
    expect(Object.isFrozen(listResult.ok && listResult.data.items[0])).toBe(true)
    expect(Object.isFrozen(failureResult)).toBe(true)
    if (failureResult.ok) {
      throw new Error('Expected validation failure result.')
    }
    expect(Object.isFrozen(failureResult.error)).toBe(true)
  })

  it('passes valid page sizes and fixed safe failures through response validation', async () => {
    for (const pageSize of [25, 50, 100] as const) {
      const response = createIpcSuccess({
        status: 'LISTED' as const,
        items: [],
        page: 1,
        pageSize,
        total: 0
      })
      const invoke = vi.fn().mockResolvedValue(response)

      await expect(
        createHealthScreeningApi(invoke).screeningSessions.list({ ...listRequest, pageSize })
      ).resolves.toEqual(response)
      expect(invoke).toHaveBeenCalledWith(ipcChannels.screeningSessions.list, {
        ...listRequest,
        pageSize
      })
    }

    const authorizationFailure = createScreeningSessionFailure('AUTHORIZATION_FAILED')

    await expect(
      createHealthScreeningApi(
        vi.fn().mockResolvedValue(authorizationFailure)
      ).screeningSessions.reopen(reopenRequest)
    ).resolves.toEqual(authorizationFailure)
  })

  it('does not register screening-session subscriptions or affect existing method groups', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess({ status: 'NOT_FOUND' as const }))
    const subscribe = vi.fn()
    const api = createHealthScreeningApi(invoke, subscribe)

    await api.screeningSessions.getById(getByIdRequest)

    expect(subscribe).not.toHaveBeenCalled()
    expect(Object.keys(api.app)).toEqual(['getInfo', 'getHealth'])
    expect(Object.keys(api.firstRun)).toEqual(['getState', 'initialize'])
    expect(Object.keys(api.auth)).toEqual([
      'getSession',
      'login',
      'changeRequiredPassword',
      'unlock',
      'lock',
      'logout',
      'recordActivity',
      'onSessionChanged'
    ])
    expect(Object.keys(api.patient)).toEqual([
      'search',
      'get',
      'create',
      'amendDemographics',
      'listDemographicAmendmentHistory',
      'recordAcknowledgment',
      'listAcknowledgmentHistory',
      'listRecent',
      'findDuplicates',
      'markNotDuplicate'
    ])
  })

  it('fails closed for malformed workspace and list nested arrays', async () => {
    let accessorInvoked = false
    const unsafeLocations = [activeLocation]
    Object.defineProperty(unsafeLocations, '0', {
      enumerable: true,
      get() {
        accessorInvoked = true
        return activeLocation
      }
    })
    const oversizedSessions = Array.from({ length: 251 }, (_, index) => ({
      ...openSession,
      id: `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`,
      locationId: index % 2 === 0 ? locationId : secondLocationId
    }))

    await expect(
      createHealthScreeningApi(
        vi.fn().mockResolvedValue(
          createIpcSuccess({
            deploymentLocalDate: '2026-07-29',
            activeLocations: unsafeLocations
          })
        )
      ).screeningSessions.getWorkspaceContext()
    ).resolves.toEqual(createScreeningSessionFailure('IPC_UNAVAILABLE'))
    await expect(
      createHealthScreeningApi(
        vi.fn().mockResolvedValue(
          createIpcSuccess({
            status: 'LISTED',
            items: oversizedSessions,
            page: 1,
            pageSize: 100,
            total: 251
          })
        )
      ).screeningSessions.list(listRequest)
    ).resolves.toEqual(createScreeningSessionFailure('IPC_UNAVAILABLE'))

    expect(accessorInvoked).toBe(false)
  })
})

function createSensitiveError(): Error {
  const error = new Error(
    `SELECT * FROM screening_sessions WHERE id = ${sessionId}; ${sensitiveNote}; ${sensitiveReason}; C:\\secret\\screening.sqlite3`
  )
  error.name = 'SensitiveScreeningSessionError'

  return error
}

function expectScreeningFailureIsSafe(result: unknown): void {
  const serialized = JSON.stringify(result)

  expect(serialized).not.toContain(sessionId)
  expect(serialized).not.toContain(sensitiveNote)
  expect(serialized).not.toContain(sensitiveReason)
  expect(serialized).not.toContain('SELECT')
  expect(serialized).not.toContain('screening_sessions')
  expect(serialized).not.toContain('C:\\')
  expect(serialized).not.toContain('SensitiveScreeningSessionError')
  expect(serialized).not.toContain('stack')
  expect(serialized).not.toContain('proxy trap')
}
