import { describe, expect, it } from 'vitest'

import { parseSyncBatchResponse } from '@main/application/sync-transport'

const batchId = '10000000-0000-4000-8000-000000000001'
const recordId = '20000000-0000-4000-8000-000000000001'
const localResourceId = '30000000-0000-4000-8000-000000000001'

interface TestOutcome {
  recordId: string
  resourceType: string
  localResourceId: string
  sourceRevision: number
  status: string
  canonicalResourceId: string | null
  centralPersonId: string | null
  chsMedicalId: string | null
  medicalIdStatus: string | null
  errors: { code: string; path: string; retryable: boolean }[]
}

interface TestResponse {
  contractVersion: string
  batchId: string
  batchStatus: string
  receivedAt: string
  completedAt: string
  outcomes: TestOutcome[]
}

const requestJson = JSON.stringify({
  contractVersion: '1.0',
  batchId,
  records: [
    {
      recordId,
      resourceType: 'PATIENT',
      localResourceId,
      sourceRevision: 2
    }
  ]
})

describe('synchronization response contract', () => {
  it('accepts an exact outcome and centrally generated UUIDv7 identifiers', () => {
    const response = validResponse()

    expect(parseSyncBatchResponse(JSON.stringify(response), requestJson)).toMatchObject({
      batchId,
      outcomes: [
        {
          recordId,
          canonicalResourceId: '40000000-0000-7000-8000-000000000001'
        }
      ]
    })
  })

  it('rejects unknown fields and missing, duplicate, or mismatched outcomes', () => {
    expect(() =>
      parseSyncBatchResponse(JSON.stringify({ ...validResponse(), unexpected: true }), requestJson)
    ).toThrow()
    expect(() =>
      parseSyncBatchResponse(JSON.stringify({ ...validResponse(), outcomes: [] }), requestJson)
    ).toThrow()
    expect(() => {
      const response = validResponse()
      return parseSyncBatchResponse(
        JSON.stringify({ ...response, outcomes: [response.outcomes[0], response.outcomes[0]] }),
        requestJson
      )
    }).toThrow()
    expect(() => {
      const response = validResponse()
      return parseSyncBatchResponse(
        JSON.stringify({
          ...response,
          outcomes: [{ ...response.outcomes[0], sourceRevision: 3 }]
        }),
        requestJson
      )
    }).toThrow()
  })

  it('rejects inconsistent patient identity outcome fields', () => {
    const response = validResponse()
    expect(() =>
      parseSyncBatchResponse(
        JSON.stringify({
          ...response,
          outcomes: [
            {
              ...response.outcomes[0],
              status: 'REVIEW_REQUIRED',
              centralPersonId: '50000000-0000-7000-8000-000000000001',
              medicalIdStatus: 'PENDING_REVIEW'
            }
          ]
        }),
        requestJson
      )
    ).toThrow()
  })
})

function validResponse(): TestResponse {
  return {
    contractVersion: '1.0',
    batchId,
    batchStatus: 'ACCEPTED',
    receivedAt: '2026-09-03T12:00:01.000Z',
    completedAt: '2026-09-03T12:00:02.000Z',
    outcomes: [
      {
        recordId,
        resourceType: 'PATIENT',
        localResourceId,
        sourceRevision: 2,
        status: 'ACCEPTED',
        canonicalResourceId: '40000000-0000-7000-8000-000000000001',
        centralPersonId: null,
        chsMedicalId: null,
        medicalIdStatus: null,
        errors: []
      }
    ]
  }
}
