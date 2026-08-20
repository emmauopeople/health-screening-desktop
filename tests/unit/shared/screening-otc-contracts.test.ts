import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  createScreeningOtcIpcFailure,
  ipcChannels,
  screeningOtcCurrentlyTakingResponseSchema,
  screeningOtcGetWorkspaceRequestSchema,
  screeningOtcGetWorkspaceResultSchema,
  screeningOtcResponseSchema,
  screeningOtcSaveDraftRequestSchema,
  screeningOtcSaveDraftResultSchema
} from '@shared/ipc'

import {
  otcEncounterId,
  validOtcGetWorkspaceRequest,
  validOtcSaveDraftRequest,
  validOtcWorkspace
} from './screening-otc-test-fixtures'

describe('shared OTC IPC contracts', () => {
  it('defines exactly the approved OTC channels and vocabularies', () => {
    expect(ipcChannels.screeningEncounters.otc).toEqual({
      getWorkspace: 'health-screening:screening-encounters:otc:get-workspace',
      saveDraft: 'health-screening:screening-encounters:otc:save-draft'
    })
    expect(screeningOtcResponseSchema.options).toEqual([
      'REPORTED',
      'NONE_REPORTED',
      'UNKNOWN',
      'DECLINED',
      'PREFER_NOT_TO_ANSWER'
    ])
    expect(screeningOtcCurrentlyTakingResponseSchema.options).toEqual(['YES', 'NO', 'UNKNOWN'])
  })

  it('accepts valid workspace, blank draft, and meaningful partial-row requests', () => {
    expect(screeningOtcGetWorkspaceRequestSchema.parse(validOtcGetWorkspaceRequest)).toEqual(
      validOtcGetWorkspaceRequest
    )
    expect(screeningOtcSaveDraftRequestSchema.parse(validOtcSaveDraftRequest)).toEqual(
      validOtcSaveDraftRequest
    )
    expect(
      screeningOtcSaveDraftRequestSchema.safeParse({
        encounterId: otcEncounterId,
        expectedVersion: null,
        otcResponse: null,
        rows: [
          {
            id: null,
            sequenceNumber: 1,
            productName: null,
            reasonForUse: 'reason before name',
            doseText: null,
            frequencyText: null,
            durationText: null,
            sourceOfMedication: null,
            currentlyTakingResponse: null
          }
        ]
      }).success
    ).toBe(true)
    expect(
      screeningOtcSaveDraftRequestSchema.safeParse({
        ...validOtcSaveDraftRequest,
        otcResponse: null,
        rows: []
      }).success
    ).toBe(true)
  })

  it('rejects unknown authority fields and invalid values', () => {
    const invalidValues: unknown[] = [
      { ...validOtcGetWorkspaceRequest, patientId: otcEncounterId },
      { ...validOtcSaveDraftRequest, actorId: otcEncounterId },
      { ...validOtcSaveDraftRequest, expectedVersion: 0 },
      { ...validOtcSaveDraftRequest, expectedVersion: 1.5 },
      { ...validOtcSaveDraftRequest, otcResponse: 'NO' },
      {
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], extra: true }]
      },
      {
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], id: 'not-an-id' }]
      },
      {
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], sequenceNumber: 0 }]
      },
      {
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], currentlyTakingResponse: 'MAYBE' }]
      }
    ]
    for (const value of invalidValues)
      expect(screeningOtcSaveDraftRequestSchema.safeParse(value).success).toBe(false)
  })

  it('rejects blank, oversized, unsafe, and unpaired-surrogate text', () => {
    for (const field of [
      'productName',
      'reasonForUse',
      'doseText',
      'frequencyText',
      'durationText',
      'sourceOfMedication'
    ] as const) {
      expect(
        screeningOtcSaveDraftRequestSchema.safeParse({
          ...validOtcSaveDraftRequest,
          rows: [{ ...validOtcSaveDraftRequest.rows[0], [field]: '' }]
        }).success
      ).toBe(false)
      expect(
        screeningOtcSaveDraftRequestSchema.safeParse({
          ...validOtcSaveDraftRequest,
          rows: [{ ...validOtcSaveDraftRequest.rows[0], [field]: '\u0001' }]
        }).success
      ).toBe(false)
      expect(
        screeningOtcSaveDraftRequestSchema.safeParse({
          ...validOtcSaveDraftRequest,
          rows: [{ ...validOtcSaveDraftRequest.rows[0], [field]: '\ud800' }]
        }).success
      ).toBe(false)
    }
    expect(
      screeningOtcSaveDraftRequestSchema.safeParse({
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], productName: 'x'.repeat(161) }]
      }).success
    ).toBe(false)
    expect(
      screeningOtcSaveDraftRequestSchema.safeParse({
        ...validOtcSaveDraftRequest,
        rows: [{ ...validOtcSaveDraftRequest.rows[0], reasonForUse: 'x'.repeat(501) }]
      }).success
    ).toBe(false)
  })

  it('rejects unsafe transport structures before schema evaluation', () => {
    const accessor = { ...validOtcSaveDraftRequest }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get: () => otcEncounterId
    })
    const symbolBearing = Object.defineProperty({ ...validOtcSaveDraftRequest }, Symbol('secret'), {
      enumerable: true,
      value: 'clinical'
    })
    const cyclic: Record<string, unknown> = { ...validOtcSaveDraftRequest }
    cyclic.cycle = cyclic
    const classInstance = Object.assign(new (class {})(), validOtcSaveDraftRequest)

    for (const value of [accessor, symbolBearing, cyclic, classInstance])
      expect(screeningOtcSaveDraftRequestSchema.safeParse(value).success).toBe(false)
  })

  it('rejects noncanonical arrays and unsupported primitive transport values', () => {
    const sparse = new Array(1)
    const hole = [validOtcSaveDraftRequest.rows[0]]
    delete hole[0]
    const named = [validOtcSaveDraftRequest.rows[0]]
    Object.defineProperty(named, 'extra', { enumerable: true, value: true })
    const nonCanonical = [validOtcSaveDraftRequest.rows[0]]
    Object.defineProperty(nonCanonical, '01', {
      enumerable: true,
      value: validOtcSaveDraftRequest.rows[0]
    })
    const accessor = [] as typeof validOtcSaveDraftRequest.rows
    Object.defineProperty(accessor, '0', {
      configurable: true,
      enumerable: true,
      get: () => validOtcSaveDraftRequest.rows[0]
    })

    for (const rows of [sparse, hole, named, nonCanonical, accessor])
      expect(
        screeningOtcSaveDraftRequestSchema.safeParse({
          ...validOtcSaveDraftRequest,
          rows
        }).success
      ).toBe(false)

    for (const child of [(() => 'invalid') as never, Symbol('invalid') as never, 1n as never])
      expect(
        screeningOtcSaveDraftRequestSchema.safeParse({
          ...validOtcSaveDraftRequest,
          rows: [{ ...validOtcSaveDraftRequest.rows[0], reasonForUse: child }]
        }).success
      ).toBe(false)
  })

  it('rejects malformed nested arrays in public workspace results', () => {
    const sparseRows = new Array(1)
    const namedRecent = [...validOtcWorkspace.recentMedications]
    Object.defineProperty(namedRecent, 'extra', { enumerable: true, value: true })

    expect(
      screeningOtcGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({
          status: 'LOADED',
          workspace: {
            ...validOtcWorkspace,
            draft: { ...validOtcWorkspace.draft!, rows: sparseRows }
          }
        })
      ).success
    ).toBe(false)
    expect(
      screeningOtcGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({
          status: 'LOADED',
          workspace: { ...validOtcWorkspace, recentMedications: namedRecent }
        })
      ).success
    ).toBe(false)
  })

  it('rejects prototype-pollution-shaped request and result objects', () => {
    expect(
      screeningOtcGetWorkspaceRequestSchema.safeParse(withOwnProto({ encounterId: otcEncounterId }))
        .success
    ).toBe(false)

    expect(
      screeningOtcSaveDraftRequestSchema.safeParse(
        withOwnProto({
          encounterId: otcEncounterId,
          expectedVersion: null,
          otcResponse: null,
          rows: []
        })
      ).success
    ).toBe(false)

    const validWithPrototypeProperty = { ...validOtcSaveDraftRequest }
    defineOwnProto(validWithPrototypeProperty, { extra: true })
    expect(screeningOtcSaveDraftRequestSchema.safeParse(validWithPrototypeProperty).success).toBe(
      false
    )

    const rowWithPrototypeProperty = { ...validOtcSaveDraftRequest.rows[0] }
    defineOwnProto(rowWithPrototypeProperty, { extra: true })
    expect(
      screeningOtcSaveDraftRequestSchema.safeParse({
        ...validOtcSaveDraftRequest,
        rows: [rowWithPrototypeProperty]
      }).success
    ).toBe(false)

    const resultObjects = [
      withOwnProto({ ok: true, data: { status: 'LOADED', workspace: validOtcWorkspace } }),
      createIpcSuccess(withOwnProto({ status: 'LOADED', workspace: validOtcWorkspace }) as never),
      createIpcSuccess({
        status: 'LOADED',
        workspace: withOwnProto(validOtcWorkspace) as never
      }),
      createIpcSuccess({
        status: 'LOADED',
        workspace: {
          ...validOtcWorkspace,
          draft: withOwnProto(validOtcWorkspace.draft!) as never
        }
      })
    ]
    for (const result of resultObjects)
      expect(screeningOtcGetWorkspaceResultSchema.safeParse(result).success).toBe(false)
  })

  it('validates public results and exposes only safe standardized failures', () => {
    expect(
      screeningOtcGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({ status: 'LOADED', workspace: validOtcWorkspace })
      ).success
    ).toBe(true)
    expect(
      screeningOtcSaveDraftResultSchema.safeParse(
        createIpcSuccess({ status: 'SAVED', workspace: validOtcWorkspace })
      ).success
    ).toBe(true)
    expect(
      screeningOtcGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({
          status: 'LOADED',
          workspace: { ...validOtcWorkspace, patientId: otcEncounterId }
        })
      ).success
    ).toBe(false)
    for (const code of ['IPC_FORBIDDEN', 'IPC_UNAVAILABLE', 'INTERNAL_ERROR'] as const) {
      const failure = createScreeningOtcIpcFailure(code)
      expect(Object.isFrozen(failure)).toBe(false)
      expect(failure.error.message).not.toMatch(/clinical|database|secret|payload/iu)
    }
  })
})

function defineOwnProto(target: object, value: unknown): void {
  Object.defineProperty(target, '__proto__', {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

function withOwnProto<T extends object>(value: unknown): T {
  const target: Record<string, unknown> = {}
  defineOwnProto(target, value)
  return target as T
}
