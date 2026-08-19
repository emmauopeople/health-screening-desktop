import { describe, expect, it } from 'vitest'

import {
  RepositoryValidationError,
  foodFrequencyCodes,
  foodResponseCodes,
  type FoodDraftRowInput,
  normalizeFoodName,
  normalizePreparationNote,
  parseFoodDraftUpdateInput
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

const ids = Object.freeze({
  draft: parseEntityId('f1000000-0000-4000-8000-000000000001'),
  user: parseEntityId('f1000000-0000-4000-8000-000000000002'),
  row1: parseEntityId('f1000000-0000-4000-8000-000000000003'),
  row2: parseEntityId('f1000000-0000-4000-8000-000000000004')
})
const now = parseUtcTimestamp('2026-08-10T12:00:00.000Z')

describe('Food validation', () => {
  it('exposes the exact approved response and frequency vocabularies', () => {
    expect(foodResponseCodes).toEqual(['REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER'])
    expect(foodFrequencyCodes).toEqual(['1_DAY', '2_TO_3_DAYS', '4_TO_6_DAYS', 'EVERY_DAY'])
  })

  it('normalizes food names by trimming, collapsing normalized whitespace, and lowercasing', () => {
    expect(normalizeFoodName('  Rice   and   beans  ')).toEqual({
      snapshot: 'Rice   and   beans',
      normalized: 'rice and beans'
    })
  })

  it('converts blank notes to null and preserves valid notes', () => {
    expect(normalizePreparationNote(null)).toBeNull()
    expect(normalizePreparationNote('   ')).toBeNull()
    expect(normalizePreparationNote('  boiled portion  ')).toBe('boiled portion')
  })

  it('enforces food-name and note boundaries without truncation', () => {
    expect(() => normalizeFoodName('a'.repeat(100))).not.toThrow()
    expect(() => normalizeFoodName('a'.repeat(101))).toThrow(RepositoryValidationError)
    expect(() => normalizeFoodName('   ')).toThrow(RepositoryValidationError)
    expect(() => normalizePreparationNote('a'.repeat(200))).not.toThrow()
    expect(() => normalizePreparationNote('a'.repeat(201))).toThrow(RepositoryValidationError)
    expect(() => normalizeFoodName('Rice\u0000')).toThrow(RepositoryValidationError)
  })

  it('rejects duplicate normalized rows and invalid vocabularies', () => {
    expect(() =>
      parseFoodDraftUpdateInput({
        id: ids.draft,
        expectedRowVersion: 1,
        foodResponse: 'REPORTED',
        rows: [
          row({ id: ids.row1, foodNameSnapshot: 'Rice', sequenceNumber: 1 }),
          row({ id: ids.row2, foodNameSnapshot: '  RICE  ', sequenceNumber: 2 })
        ],
        actorId: ids.user,
        occurredAt: now
      })
    ).toThrow(RepositoryValidationError)
    expect(() =>
      parseFoodDraftUpdateInput({
        id: ids.draft,
        expectedRowVersion: 1,
        foodResponse: 'NO_FOOD_REPORTED' as never,
        rows: [],
        actorId: ids.user,
        occurredAt: now
      })
    ).toThrow(RepositoryValidationError)
    expect(() =>
      parseFoodDraftUpdateInput({
        id: ids.draft,
        expectedRowVersion: 1,
        foodResponse: 'REPORTED',
        rows: [row({ frequencyCode: 'WEEKLY' as never })],
        actorId: ids.user,
        occurredAt: now
      })
    ).toThrow(RepositoryValidationError)
  })

  it('allows REPORTED with zero rows and rejects rows for non-reported responses', () => {
    expect(
      parseFoodDraftUpdateInput({
        id: ids.draft,
        expectedRowVersion: 1,
        foodResponse: 'REPORTED',
        rows: [],
        actorId: ids.user,
        occurredAt: now
      })
    ).toMatchObject({ foodResponse: 'REPORTED', rows: [] })
    expect(() =>
      parseFoodDraftUpdateInput({
        id: ids.draft,
        expectedRowVersion: 1,
        foodResponse: 'UNKNOWN',
        rows: [row()],
        actorId: ids.user,
        occurredAt: now
      })
    ).toThrow(RepositoryValidationError)
  })
})

function row(
  overrides: {
    readonly id?: EntityId
    readonly sequenceNumber?: number
    readonly foodNameSnapshot?: string
    readonly frequencyCode?: '1_DAY' | '2_TO_3_DAYS' | '4_TO_6_DAYS' | 'EVERY_DAY'
  } = {}
): FoodDraftRowInput {
  return {
    id: overrides.id ?? ids.row1,
    sequenceNumber: overrides.sequenceNumber ?? 1,
    catalogCode: null,
    foodNameSnapshot: overrides.foodNameSnapshot ?? 'Rice',
    frequencyCode: overrides.frequencyCode ?? null,
    preparationNote: null,
    sourceType: 'PATIENT_REPORTED' as const
  }
}
