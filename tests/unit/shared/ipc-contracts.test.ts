import { describe, expect, it } from 'vitest'

import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  appHealthSchema,
  appInfoSchema,
  createFirstRunFailure,
  createIpcFailure,
  createIpcSuccess,
  firstRunGetStateRequestSchema,
  firstRunGetStateResultSchema,
  firstRunInitializeRequestSchema,
  firstRunInitializeResultSchema,
  firstRunPublicStateSchema,
  firstRunSafeErrorMessages,
  ipcChannels,
  ipcFailureResultSchema,
  patientCreateRequestSchema,
  patientSearchRequestSchema,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type AppHealth,
  type AppInfo,
  type FirstRunInitializeRequest
} from '@shared/ipc'

const validAppInfo: AppInfo = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  platform: 'win32',
  architecture: 'x64',
  packaged: false
}

const validAppHealth: AppHealth = {
  status: 'ready',
  ipc: 'available',
  database: 'ready',
  clinicalFeatures: 'not-implemented'
}

const validFirstRunInitializeRequest: FirstRunInitializeRequest = {
  deploymentName: '  Cameroon   Pilot  ',
  timeZone: 'Africa/Douala',
  administrator: {
    username: ' Admin.User ',
    displayName: ' Admin   User ',
    temporaryPassword: 'ValidPassw0rd!'
  },
  initialLocation: {
    name: ' Central   Church ',
    locationType: 'CHURCH',
    village: ' Messa ',
    subdivision: ' Yaounde  I ',
    region: ' Centre ',
    directions: ' Opposite   market gate. '
  }
}

describe('shared IPC contracts', () => {
  it('defines exactly the approved app and first-run channel strings', () => {
    expect(ipcChannels).toEqual({
      app: {
        getInfo: 'health-screening:app:get-info',
        getHealth: 'health-screening:app:get-health'
      },
      firstRun: {
        getState: 'health-screening:first-run:get-state',
        initialize: 'health-screening:first-run:initialize'
      },
      auth: {
        getSession: 'health-screening:auth:get-session',
        login: 'health-screening:auth:login',
        changeRequiredPassword: 'health-screening:auth:change-required-password',
        unlock: 'health-screening:auth:unlock',
        lock: 'health-screening:auth:lock',
        logout: 'health-screening:auth:logout',
        recordActivity: 'health-screening:auth:record-activity',
        sessionChanged: 'health-screening:auth:session-changed'
      },
      patient: {
        search: 'health-screening:patient:search',
        get: 'health-screening:patient:get',
        create: 'health-screening:patient:create',
        amendDemographics: 'health-screening:patient:amend-demographics',
        listDemographicAmendmentHistory:
          'health-screening:patient:list-demographic-amendment-history',
        recordAcknowledgment: 'health-screening:patient:record-acknowledgment',
        listAcknowledgmentHistory: 'health-screening:patient:list-acknowledgment-history',
        listRecent: 'health-screening:patient:list-recent',
        findDuplicates: 'health-screening:patient:find-duplicates',
        markNotDuplicate: 'health-screening:patient:mark-not-duplicate'
      },
      screeningSessions: {
        getWorkspaceContext: 'health-screening:screening-sessions:get-workspace-context',
        create: 'health-screening:screening-sessions:create',
        close: 'health-screening:screening-sessions:close',
        reopen: 'health-screening:screening-sessions:reopen',
        getById: 'health-screening:screening-sessions:get-by-id',
        list: 'health-screening:screening-sessions:list'
      }
    })
    expect(
      new Set([
        ...Object.values(ipcChannels.app),
        ...Object.values(ipcChannels.firstRun),
        ...Object.values(ipcChannels.auth),
        ...Object.values(ipcChannels.patient),
        ...Object.values(ipcChannels.screeningSessions)
      ]).size
    ).toBe(28)
  })

  it('keeps patient requests strict and main-process-authored', () => {
    expect(
      patientSearchRequestSchema.parse({
        query: 'Ada',
        page: 1,
        pageSize: 25
      })
    ).toEqual({
      query: 'Ada',
      page: 1,
      pageSize: 25
    })
    expect(
      patientCreateRequestSchema.safeParse({
        givenName: 'Ada',
        familyName: 'M.',
        otherNames: null,
        dateOfBirth: '1980-01-01',
        approximateAgeYears: null,
        ageAsOfDate: null,
        sex: 'FEMALE',
        village: 'Messa',
        quarter: null,
        phone: null,
        alternateContactName: null,
        alternateContactPhone: null,
        residenceNotes: null,
        status: 'ACTIVE',
        duplicateReviewToken: null,
        patientCode: 'PT-000001',
        updatedBy: '11111111-1111-4111-8111-111111111111'
      }).success
    ).toBe(false)
  })

  it('uses strict empty request objects for app operations', () => {
    expect(appGetInfoRequestSchema.parse({})).toEqual({})
    expect(appGetHealthRequestSchema.parse({})).toEqual({})
    expect(appGetInfoRequestSchema.safeParse({ extra: true }).success).toBe(false)
    expect(appGetHealthRequestSchema.safeParse({ extra: true }).success).toBe(false)
  })

  it('parses only approved safe app info and health responses', () => {
    expect(appInfoSchema.parse(validAppInfo)).toEqual(validAppInfo)
    expect(appHealthSchema.parse(validAppHealth)).toEqual(validAppHealth)
    expect(appInfoSchema.safeParse({ ...validAppInfo, userDataPath: 'C:\\secret' }).success).toBe(
      false
    )
    expect(appHealthSchema.safeParse({ ...validAppHealth, checkedAt: 'now' }).success).toBe(false)
    expect(appHealthSchema.parse({ ...validAppHealth, database: 'unavailable' }).database).toBe(
      'unavailable'
    )
    expect(
      appHealthSchema.safeParse({ ...validAppHealth, database: 'not-configured' }).success
    ).toBe(false)
    expect(appHealthSchema.safeParse({ ...validAppHealth, database: 'connected' }).success).toBe(
      false
    )
    expect(
      appHealthSchema.safeParse({ ...validAppHealth, database: { status: 'ready' } }).success
    ).toBe(false)
    expect(
      appHealthSchema.safeParse({ ...validAppHealth, databasePath: 'C:\\secret\\db.sqlite3' })
        .success
    ).toBe(false)
    expect(appInfoSchema.safeParse({ ...validAppInfo, applicationVersion: '' }).success).toBe(false)
  })

  it('validates strict discriminated success and failure envelopes', () => {
    expect(appGetInfoResultSchema.parse(createIpcSuccess(validAppInfo))).toEqual(
      createIpcSuccess(validAppInfo)
    )
    expect(appGetHealthResultSchema.parse(createIpcSuccess(validAppHealth))).toEqual(
      createIpcSuccess(validAppHealth)
    )
    expect(ipcFailureResultSchema.parse(createIpcFailure('IPC_FORBIDDEN'))).toEqual({
      ok: false,
      error: {
        code: 'IPC_FORBIDDEN',
        message: 'This operation is unavailable from the current window.'
      }
    })
    expect(
      appGetInfoResultSchema.safeParse({
        ok: true,
        data: validAppInfo,
        extra: 'not allowed'
      }).success
    ).toBe(false)
    expect(
      appGetInfoResultSchema.safeParse({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The application could not complete the request.',
          stack: 'hidden'
        }
      }).success
    ).toBe(false)
    expect(
      ipcFailureResultSchema.safeParse({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'arbitrary renderer-visible message'
        }
      }).success
    ).toBe(false)
    expect(
      ipcFailureResultSchema.safeParse({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'This operation is unavailable from the current window.'
        }
      }).success
    ).toBe(false)
    expect(
      ipcFailureResultSchema.safeParse({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The application could not complete the request. C:\\secret\\app'
        }
      }).success
    ).toBe(false)
  })

  it('keeps operation result types inferred from their schemas', () => {
    const infoResult: AppGetInfoResult = appGetInfoResultSchema.parse(
      createIpcSuccess(validAppInfo)
    )
    const healthResult: AppGetHealthResult = appGetHealthResultSchema.parse(
      createIpcSuccess(validAppHealth)
    )

    expect(infoResult).toEqual(createIpcSuccess(validAppInfo))
    expect(healthResult).toEqual(createIpcSuccess(validAppHealth))
  })

  it('keeps approved response data structured-clone safe', () => {
    expect(structuredClone(validAppInfo)).toEqual(validAppInfo)
    expect(structuredClone(validAppHealth)).toEqual(validAppHealth)
  })

  it('uses strict first-run get-state requests', () => {
    expect(firstRunGetStateRequestSchema.parse({})).toEqual({})
    expect(firstRunGetStateRequestSchema.safeParse({ extra: true }).success).toBe(false)
    expect(firstRunGetStateRequestSchema.safeParse([]).success).toBe(false)
    expect(firstRunGetStateRequestSchema.safeParse(null).success).toBe(false)

    const symbolRequest = Object.defineProperty({}, Symbol('secret'), {
      value: true,
      enumerable: true
    })

    expect(firstRunGetStateRequestSchema.safeParse(symbolRequest).success).toBe(false)
  })

  it('accepts one exact first-run initialization request without normalization', () => {
    const parsed = firstRunInitializeRequestSchema.parse(validFirstRunInitializeRequest)

    expect(parsed).toEqual(validFirstRunInitializeRequest)
    expect(parsed.deploymentName).toBe('  Cameroon   Pilot  ')
    expect(parsed.administrator.username).toBe(' Admin.User ')
    expect(parsed.initialLocation.name).toBe(' Central   Church ')
  })

  it('rejects malformed first-run initialization requests at transport boundaries', () => {
    const symbolRequest = Object.defineProperty(
      { ...validFirstRunInitializeRequest },
      Symbol('secret'),
      { value: true, enumerable: true }
    )
    const nestedSymbolRequest = {
      ...validFirstRunInitializeRequest,
      administrator: Object.defineProperty(
        { ...validFirstRunInitializeRequest.administrator },
        Symbol('secret'),
        { value: true, enumerable: true }
      )
    }

    for (const value of [
      null,
      [],
      'request',
      { ...validFirstRunInitializeRequest, id: '11111111-1111-4111-8111-111111111111' },
      Object.fromEntries(
        Object.entries(validFirstRunInitializeRequest).filter(([key]) => key !== 'timeZone')
      ),
      {
        ...validFirstRunInitializeRequest,
        administrator: {
          ...validFirstRunInitializeRequest.administrator,
          role: 'LOCAL_ADMIN'
        }
      },
      {
        ...validFirstRunInitializeRequest,
        initialLocation: {
          ...validFirstRunInitializeRequest.initialLocation,
          village: undefined
        }
      },
      {
        ...validFirstRunInitializeRequest,
        initialLocation: {
          ...validFirstRunInitializeRequest.initialLocation,
          locationType: 'HOSPITAL'
        }
      },
      { ...validFirstRunInitializeRequest, deploymentName: 'A'.repeat(241) },
      {
        ...validFirstRunInitializeRequest,
        administrator: {
          ...validFirstRunInitializeRequest.administrator,
          temporaryPassword: 'A'.repeat(257)
        }
      },
      {
        ...validFirstRunInitializeRequest,
        initialLocation: {
          ...validFirstRunInitializeRequest.initialLocation,
          directions: 'A'.repeat(1001)
        }
      },
      {
        ...validFirstRunInitializeRequest,
        administrator: {
          ...validFirstRunInitializeRequest.administrator,
          temporaryPassword: 12
        }
      },
      {
        ...validFirstRunInitializeRequest,
        administrator: {
          ...validFirstRunInitializeRequest.administrator,
          temporaryPassword: () => undefined
        }
      },
      {
        ...validFirstRunInitializeRequest,
        administrator: {
          ...validFirstRunInitializeRequest.administrator,
          temporaryPassword: 1n
        }
      },
      symbolRequest,
      nestedSymbolRequest
    ]) {
      expect(firstRunInitializeRequestSchema.safeParse(value).success).toBe(false)
    }
  })

  it('rejects prototype-sensitive first-run request values without invoking accessors', () => {
    let topLevelGetterInvoked = false
    const accessorRequest = { ...validFirstRunInitializeRequest }
    Object.defineProperty(accessorRequest, 'deploymentName', {
      enumerable: true,
      get() {
        topLevelGetterInvoked = true
        return 'Cameroon Pilot'
      }
    })

    let nestedGetterInvoked = false
    const nestedAccessorRequest = {
      ...validFirstRunInitializeRequest,
      administrator: { ...validFirstRunInitializeRequest.administrator }
    }
    Object.defineProperty(nestedAccessorRequest.administrator, 'temporaryPassword', {
      enumerable: true,
      get() {
        nestedGetterInvoked = true
        return 'ValidPassw0rd!'
      }
    })

    const nullPrototypeRequest = Object.assign(Object.create(null), validFirstRunInitializeRequest)
    const customPrototypeRequest = Object.setPrototypeOf(
      { ...validFirstRunInitializeRequest },
      { trusted: false }
    )
    const descriptorTrapRequest = new Proxy(
      { ...validFirstRunInitializeRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    for (const value of [
      accessorRequest,
      nestedAccessorRequest,
      nullPrototypeRequest,
      customPrototypeRequest,
      descriptorTrapRequest
    ]) {
      expect(firstRunInitializeRequestSchema.safeParse(value).success).toBe(false)
    }
    expect(topLevelGetterInvoked).toBe(false)
    expect(nestedGetterInvoked).toBe(false)
  })

  it('validates minimized public first-run state and success responses', () => {
    const initializedState = {
      status: 'INITIALIZED',
      deploymentName: 'Cameroon Pilot',
      timeZone: 'Africa/Douala'
    } as const

    expect(firstRunPublicStateSchema.parse({ status: 'REQUIRED' })).toEqual({
      status: 'REQUIRED'
    })
    expect(firstRunPublicStateSchema.parse(initializedState)).toEqual(initializedState)
    expect(
      firstRunPublicStateSchema.parse({
        status: 'INCONSISTENT',
        code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      })
    ).toEqual({
      status: 'INCONSISTENT',
      code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
    })
    expect(firstRunGetStateResultSchema.parse(createIpcSuccess(initializedState))).toEqual(
      createIpcSuccess(initializedState)
    )
    expect(firstRunInitializeResultSchema.parse(createIpcSuccess(initializedState))).toEqual(
      createIpcSuccess(initializedState)
    )

    for (const value of [
      { ...initializedState, id: '11111111-1111-4111-8111-111111111111' },
      { ...initializedState, createdAt: '2026-07-29T12:34:56.789Z' },
      { ...initializedState, installation: { id: 'secret' } },
      { ...initializedState, administrator: { username: 'Admin.User' } },
      { ...initializedState, initialLocation: { name: 'Central Church' } },
      { ...initializedState, auditEvents: [] },
      { ...initializedState, metadata: { bootstrap: true } },
      { ...initializedState, passwordHash: 'hash' },
      { ...initializedState, usernameNormalized: 'admin.user' }
    ]) {
      expect(firstRunPublicStateSchema.safeParse(value).success).toBe(false)
    }
  })

  it('uses exact operation-specific first-run failure envelopes', () => {
    expect(firstRunGetStateResultSchema.parse(createFirstRunFailure('IPC_FORBIDDEN'))).toEqual({
      ok: false,
      error: {
        code: 'IPC_FORBIDDEN',
        message: 'This operation is unavailable from the current window.'
      }
    })

    for (const [code, message] of Object.entries(firstRunSafeErrorMessages)) {
      expect(
        firstRunInitializeResultSchema.parse({
          ok: false,
          error: { code, message }
        })
      ).toEqual({
        ok: false,
        error: { code, message }
      })
    }

    expect(
      firstRunGetStateResultSchema.safeParse(createFirstRunFailure('FIRST_RUN_ALREADY_INITIALIZED'))
        .success
    ).toBe(false)
    expect(
      firstRunInitializeResultSchema.safeParse({
        ok: false,
        error: {
          code: 'FIRST_RUN_ALREADY_INITIALIZED',
          message: 'arbitrary message'
        }
      }).success
    ).toBe(false)
    expect(
      firstRunInitializeResultSchema.safeParse({
        ok: false,
        error: {
          code: 'FIRST_RUN_INITIALIZATION_FAILED',
          message: 'Application setup could not be completed.',
          errorType: 'PasswordHashingError'
        }
      }).success
    ).toBe(false)
  })

  it('keeps first-run request and response data structured-clone safe', () => {
    const initializedState = {
      status: 'INITIALIZED',
      deploymentName: 'Cameroon Pilot',
      timeZone: 'Africa/Douala'
    } as const

    expect(structuredClone(validFirstRunInitializeRequest)).toEqual(validFirstRunInitializeRequest)
    expect(structuredClone(createIpcSuccess(initializedState))).toEqual(
      createIpcSuccess(initializedState)
    )
    expect(structuredClone(createFirstRunFailure('FIRST_RUN_INITIALIZATION_FAILED'))).toEqual(
      createFirstRunFailure('FIRST_RUN_INITIALIZATION_FAILED')
    )
  })
})
