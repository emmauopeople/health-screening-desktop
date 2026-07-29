import { describe, expect, it } from 'vitest'

import {
  getClinicalFeatureText,
  getDatabaseText,
  getIpcText,
  type AppLoadState
} from '../../src/renderer/src/app/status-mapping'

const loadingState: AppLoadState = { status: 'loading' }
const unavailableState: AppLoadState = {
  status: 'error',
  message: 'The desktop service is unavailable.'
}
const readyState: AppLoadState = {
  status: 'ready',
  info: {
    applicationName: 'Health Screening Offline Desktop',
    applicationVersion: '1.0.0',
    platform: 'win32',
    architecture: 'x64',
    packaged: false
  },
  health: {
    status: 'ready',
    ipc: 'available',
    database: 'ready',
    clinicalFeatures: 'not-implemented'
  }
}

describe('renderer foundation status mapping', () => {
  it('shows Loading only while requests are pending', () => {
    expect(getClinicalFeatureText(loadingState)).toBe('Loading')
    expect(getDatabaseText(loadingState)).toBe('Loading')
    expect(getIpcText(loadingState)).toBe('Loading')
  })

  it('shows ready foundation values after a successful health response', () => {
    expect(getClinicalFeatureText(readyState)).toBe('Not implemented')
    expect(getDatabaseText(readyState)).toBe('Ready')
    expect(getIpcText(readyState)).toBe('Available')
  })

  it('shows Unavailable for every foundation status after IPC failure', () => {
    expect(getClinicalFeatureText(unavailableState)).toBe('Unavailable')
    expect(getDatabaseText(unavailableState)).toBe('Unavailable')
    expect(getIpcText(unavailableState)).toBe('Unavailable')
  })

  it('shows an unavailable database from a valid health response', () => {
    expect(
      getDatabaseText({ ...readyState, health: { ...readyState.health, database: 'unavailable' } })
    ).toBe('Unavailable')
  })
})
