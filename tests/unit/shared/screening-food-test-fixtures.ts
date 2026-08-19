import type { ScreeningFoodSaveDraftRequest, ScreeningFoodWorkspace } from '@shared/ipc'

export const foodEncounterId = '33333333-3333-4333-8333-333333333333'
export const foodDraftId = '44444444-4444-4444-8444-444444444444'
export const foodDraftRowId = '55555555-5555-4555-8555-555555555555'
export const foodTimestamp = '2026-08-18T12:00:00.000Z'

export const validFoodSaveDraftRequest: ScreeningFoodSaveDraftRequest = {
  encounterId: foodEncounterId,
  expectedVersion: 1,
  foodResponse: 'REPORTED',
  rows: [
    {
      id: foodDraftRowId,
      sequenceNumber: 1,
      catalogCode: 'RICE',
      foodName: 'Rice',
      frequencyCode: '2_TO_3_DAYS',
      preparationNote: 'Boiled'
    }
  ]
}

export const validFoodWorkspace: ScreeningFoodWorkspace = {
  encounterId: foodEncounterId,
  draft: {
    id: foodDraftId,
    encounterId: foodEncounterId,
    foodResponse: 'REPORTED',
    rowVersion: 2,
    periodStart: '2026-08-12',
    periodEnd: '2026-08-18',
    rows: [
      {
        id: foodDraftRowId,
        sequenceNumber: 1,
        catalogCode: 'RICE',
        foodNameSnapshot: 'Rice',
        foodNameNormalized: 'rice',
        frequencyCode: '2_TO_3_DAYS',
        preparationNote: 'Boiled',
        updatedAt: foodTimestamp
      }
    ],
    updatedAt: foodTimestamp
  },
  catalogItems: [
    {
      code: 'RICE',
      displayName: 'Rice',
      normalizedSearchName: 'rice',
      sortOrder: 1
    },
    {
      code: 'BEANS',
      displayName: 'Beans',
      normalizedSearchName: 'beans',
      sortOrder: 2
    }
  ],
  recentFoods: [
    {
      catalogCode: null,
      foodNameSnapshot: 'Cassava',
      foodNameNormalized: 'cassava',
      lastRecordedAt: foodTimestamp
    }
  ]
}
