import { describe, expect, it } from 'vitest'

import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  appHealthSchema,
  appInfoSchema,
  createIpcFailure,
  createIpcSuccess,
  ipcChannels,
  ipcFailureResultSchema,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type AppHealth,
  type AppInfo
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
  database: 'not-configured',
  clinicalFeatures: 'not-implemented'
}

describe('shared IPC contracts', () => {
  it('defines exactly the approved app channel strings', () => {
    expect(ipcChannels).toEqual({
      app: {
        getInfo: 'health-screening:app:get-info',
        getHealth: 'health-screening:app:get-health'
      }
    })
    expect(new Set(Object.values(ipcChannels.app)).size).toBe(2)
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
})
