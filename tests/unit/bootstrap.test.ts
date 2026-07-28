import { describe, expect, it } from 'vitest'

import { applicationStatus, getApplicationStatus } from '@shared/contracts/bootstrap'

describe('bootstrap status contract', () => {
  it('exposes the approved engineering foundation status through the shared alias', () => {
    expect(applicationStatus).toEqual({
      applicationName: 'Health Screening Offline Desktop',
      status: 'Engineering foundation',
      clinicalFeaturesImplemented: false,
      databaseConfigured: false,
      businessIpcImplemented: false
    })
  })

  it('returns a copy so callers cannot mutate the shared source object', () => {
    const returnedStatus = getApplicationStatus()
    const mutableStatus = returnedStatus as {
      applicationName: string
      clinicalFeaturesImplemented: boolean
    }

    mutableStatus.applicationName = 'Mutated application name'
    mutableStatus.clinicalFeaturesImplemented = true

    expect(returnedStatus).not.toBe(applicationStatus)
    expect(applicationStatus.applicationName).toBe('Health Screening Offline Desktop')
    expect(applicationStatus.clinicalFeaturesImplemented).toBe(false)
    expect(getApplicationStatus()).toEqual(applicationStatus)
  })
})
