import { describe, expect, it } from 'vitest'

import {
  normalizeOtcDoseText,
  normalizeOtcDurationText,
  normalizeOtcFrequencyText,
  normalizeOtcProductName,
  normalizeOtcReasonForUse,
  normalizeOtcSourceOfMedication,
  normalizeOptionalOtcProductName,
  otcCurrentlyTakingResponseCodes,
  otcResponseCodes,
  parseOtcDate,
  parseOtcDraftUpdateInput,
  RepositoryValidationError,
  type OtcDraftUpdateInput
} from '@main/database'

const ids = Object.freeze({
  draft: 'a1000000-0000-4000-8000-000000000001',
  row: 'a1000000-0000-4000-8000-000000000002',
  actor: 'a1000000-0000-4000-8000-000000000003'
})
const now = '2026-08-10T12:00:00.000Z'

describe('OTC repository validation', () => {
  it('defines exact OTC response and currently-taking vocabularies', () => {
    expect(otcResponseCodes).toEqual([
      'REPORTED',
      'NONE_REPORTED',
      'UNKNOWN',
      'DECLINED',
      'PREFER_NOT_TO_ANSWER'
    ])
    expect(otcCurrentlyTakingResponseCodes).toEqual(['YES', 'NO', 'UNKNOWN'])
  })

  it('normalizes medication names and optional text without silently truncating', () => {
    expect(normalizeOtcProductName('  Pain Reliever  ')).toEqual({
      snapshot: 'Pain Reliever',
      normalized: 'pain reliever'
    })
    expect(normalizeOptionalOtcProductName(null)).toEqual({ snapshot: null, normalized: null })
    expect(normalizeOtcReasonForUse('  headache  ')).toBe('headache')
    expect(normalizeOtcDoseText('  1 tablet  ')).toBe('1 tablet')
    expect(normalizeOtcFrequencyText('  twice daily  ')).toBe('twice daily')
    expect(normalizeOtcDurationText('  2 days  ')).toBe('2 days')
    expect(normalizeOtcSourceOfMedication('  pharmacy  ')).toBe('pharmacy')
  })

  it('rejects unsafe, blank, malformed, and oversized values', () => {
    expect(() => normalizeOtcProductName('   ')).toThrow(RepositoryValidationError)
    expect(() => normalizeOtcProductName(`a${String.fromCharCode(1)}`)).toThrow(
      RepositoryValidationError
    )
    expect(() => normalizeOtcProductName('x'.repeat(161))).toThrow(RepositoryValidationError)
    expect(() => normalizeOtcReasonForUse('x'.repeat(501))).toThrow(RepositoryValidationError)
    expect(() => parseOtcDate('2026-02-29')).toThrow(RepositoryValidationError)
    expect(parseOtcDate('2028-02-29')).toBe('2028-02-29')
  })

  it('preserves meaningful partial rows and clears rows for non-reported responses', () => {
    const partial = parseOtcDraftUpdateInput(updateInput({ productNameSnapshot: null }))
    expect(partial.rows).toHaveLength(1)
    expect(partial.rows[0]).toMatchObject({
      productNameSnapshot: null,
      reasonForUse: 'headache'
    })

    const unfinished = parseOtcDraftUpdateInput({
      ...updateInput({ productNameSnapshot: null }),
      otcResponse: null
    })
    expect(unfinished.rows).toHaveLength(1)
    expect(unfinished.rows[0]).toMatchObject({
      productNameSnapshot: null,
      reasonForUse: 'headache'
    })

    const cleared = parseOtcDraftUpdateInput({
      ...updateInput(),
      otcResponse: 'UNKNOWN'
    })
    expect(cleared.rows).toEqual([])
  })

  it('rejects fully blank rows and invalid controlled responses', () => {
    expect(() =>
      parseOtcDraftUpdateInput({
        ...updateInput(),
        rows: [
          {
            ...rowInput(),
            productNameSnapshot: null,
            reasonForUse: null,
            doseText: null,
            frequencyText: null,
            durationText: null,
            sourceOfMedication: null,
            currentlyTakingResponse: null
          }
        ]
      })
    ).toThrow(RepositoryValidationError)

    expect(() =>
      parseOtcDraftUpdateInput({
        ...updateInput(),
        otcResponse: 'YES'
      } as unknown as OtcDraftUpdateInput)
    ).toThrow(RepositoryValidationError)
  })
})

function updateInput(
  overrides: Partial<OtcDraftUpdateInput['rows'][number]> = {}
): OtcDraftUpdateInput {
  return {
    id: ids.draft as OtcDraftUpdateInput['id'],
    expectedRowVersion: 1,
    otcResponse: 'REPORTED',
    rows: [rowInput(overrides)],
    actorId: ids.actor as OtcDraftUpdateInput['actorId'],
    occurredAt: now as OtcDraftUpdateInput['occurredAt']
  }
}

function rowInput(
  overrides: Partial<OtcDraftUpdateInput['rows'][number]> = {}
): OtcDraftUpdateInput['rows'][number] {
  return {
    id: ids.row as OtcDraftUpdateInput['rows'][number]['id'],
    sequenceNumber: 1,
    productNameSnapshot: '  Pain Reliever  ',
    reasonForUse: '  headache  ',
    doseText: null,
    frequencyText: null,
    durationText: null,
    sourceOfMedication: null,
    currentlyTakingResponse: null,
    sourceType: 'PATIENT_REPORTED',
    ...overrides
  }
}
