import { describe, expect, it } from 'vitest'

import {
  parseContractUuid,
  parseIdentityResolutionAcknowledgmentResponse,
  parseIdentityResolutionPullResponse,
  parseSyncBatchResponse
} from '@main/application/sync-transport'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

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

  it('accepts bounded identity deliveries and their matching acknowledgment', () => {
    const pull = parseIdentityResolutionPullResponse(identityPullResponse())
    expect(pull.deliveries[0]).toMatchObject({
      localPatientCode: 'PT-000001',
      chsMedicalId: 'CHS-2345-6789-ABCD'
    })

    expect(
      parseIdentityResolutionAcknowledgmentResponse(
        JSON.stringify({
          contractVersion: '1.0',
          acknowledgmentId: '70000000-0000-4000-8000-000000000001',
          resolutionReference: '50000000-0000-7000-8000-000000000001',
          status: 'ACKNOWLEDGED',
          acknowledgedAt: '2026-09-03T12:00:02.000Z',
          replayed: false
        }),
        parseEntityId('70000000-0000-4000-8000-000000000001'),
        parseContractUuid('50000000-0000-7000-8000-000000000001'),
        parseUtcTimestamp('2026-09-03T12:00:01.000Z')
      )
    ).toMatchObject({ status: 'ACKNOWLEDGED', replayed: false })
  })

  it('rejects duplicate patients, malformed Medical IDs, and mismatched acknowledgments', () => {
    const valid = JSON.parse(identityPullResponse()) as {
      deliveries: Record<string, unknown>[]
    }
    expect(() =>
      parseIdentityResolutionPullResponse(
        JSON.stringify({ ...valid, deliveries: [valid.deliveries[0], valid.deliveries[0]] })
      )
    ).toThrow()
    expect(() =>
      parseIdentityResolutionPullResponse(
        JSON.stringify({
          ...valid,
          deliveries: [{ ...valid.deliveries[0], chsMedicalId: 'CHS-ABCI-EFGH-JKMN' }]
        })
      )
    ).toThrow()
    expect(() =>
      parseIdentityResolutionAcknowledgmentResponse(
        JSON.stringify({
          contractVersion: '1.0',
          acknowledgmentId: '70000000-0000-4000-8000-000000000002',
          resolutionReference: '50000000-0000-7000-8000-000000000001',
          status: 'ACKNOWLEDGED',
          acknowledgedAt: '2026-09-03T12:00:00.000Z',
          replayed: false
        }),
        parseEntityId('70000000-0000-4000-8000-000000000001'),
        parseContractUuid('50000000-0000-7000-8000-000000000001'),
        parseUtcTimestamp('2026-09-03T12:00:01.000Z')
      )
    ).toThrow()
  })
})

function identityPullResponse(): string {
  return JSON.stringify({
    contractVersion: '1.0',
    deliveries: [
      {
        resolutionReference: '50000000-0000-7000-8000-000000000001',
        localPatientReference: localResourceId,
        localPatientCode: 'PT-000001',
        sourceRevision: 2,
        centralPersonId: '60000000-0000-7000-8000-000000000001',
        chsMedicalId: 'CHS-2345-6789-ABCD',
        resolvedAt: '2026-09-03T12:00:00.000Z'
      }
    ],
    hasMore: false,
    serverTime: '2026-09-03T12:00:01.000Z'
  })
}

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
