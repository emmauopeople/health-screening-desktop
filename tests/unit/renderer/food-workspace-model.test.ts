import { describe, expect, it } from 'vitest'

import type { ScreeningFoodWorkspace } from '@shared/ipc'
import {
  addFoodRow,
  applyFoodCatalogSelection,
  createFoodDraftStateFromWorkspace,
  createFoodSaveDraftRequest,
  createInitialFoodDraftState,
  parseFoodFrequencyDraft,
  updateFoodResponse,
  updateFoodRow
} from '../../../src/renderer/src/app/screening/food/food-workspace-model'

const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('Food renderer workspace model', () => {
  it('creates a permissive blank draft save request', () => {
    const state = createInitialFoodDraftState()
    const loaded = { ...state, loadStatus: 'READY' as const }

    const result = createFoodSaveDraftRequest(encounterId, loaded)

    expect(result).toEqual({
      status: 'VALID',
      request: {
        encounterId,
        expectedVersion: null,
        foodResponse: null,
        rows: []
      }
    })
  })

  it('sends only approved renderer-controlled fields for reported foods', () => {
    const workspace = publicFoodWorkspace()
    const catalogItem = workspace.catalogItems[0]
    if (catalogItem === undefined) throw new Error('Expected catalog item.')
    const withRow = addFoodRow(
      updateFoodResponse(createFoodDraftStateFromWorkspace(workspace), 'REPORTED')
    )
    const rowKey = withRow.rows[0]?.localKey ?? ''
    const state = updateFoodRow(withRow, rowKey, (row) => ({
      ...applyFoodCatalogSelection(row, catalogItem),
      frequencyCode: '1_DAY',
      preparationNote: ' boiled '
    }))

    const result = createFoodSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request).toEqual({
      encounterId,
      expectedVersion: 3,
      foodResponse: 'REPORTED',
      rows: [
        {
          id: null,
          sequenceNumber: 1,
          catalogCode: 'RICE',
          foodName: 'Rice',
          frequencyCode: '1_DAY',
          preparationNote: 'boiled'
        }
      ]
    })
    expect(JSON.stringify(result.request)).not.toContain('foodNameNormalized')
    expect(JSON.stringify(result.request)).not.toContain('patientId')
    expect(JSON.stringify(result.request)).not.toContain('updatedAt')
  })

  it('rejects duplicate normalized custom foods and oversized notes', () => {
    const withRows = addFoodRow(
      addFoodRow(
        updateFoodResponse({ ...createInitialFoodDraftState(), loadStatus: 'READY' }, 'REPORTED')
      )
    )
    const firstKey = withRows.rows[0]?.localKey ?? ''
    const secondKey = withRows.rows[1]?.localKey ?? ''
    const state = updateFoodRow(
      updateFoodRow(withRows, firstKey, (row) => ({ ...row, foodName: 'Rice' })),
      secondKey,
      (row) => ({ ...row, foodName: '  rice  ', preparationNote: 'x'.repeat(201) })
    )

    const result = createFoodSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('INVALID')
    if (result.status !== 'INVALID') return
    expect(result.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining(['Food is already listed.', 'Note must be 200 characters or less.'])
    )
  })

  it('excludes blank placeholder rows while preserving saved rows from workspace mapping', () => {
    const state = addFoodRow(createFoodDraftStateFromWorkspace(publicFoodWorkspaceWithRows()))

    const result = createFoodSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request.rows).toEqual([
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        sequenceNumber: 1,
        catalogCode: null,
        foodName: 'Cassava',
        frequencyCode: null,
        preparationNote: null
      }
    ])
  })

  it('parses only approved frequency draft values', () => {
    expect(parseFoodFrequencyDraft('')).toBe('')
    expect(parseFoodFrequencyDraft('1_DAY')).toBe('1_DAY')
    expect(parseFoodFrequencyDraft('2_TO_3_DAYS')).toBe('2_TO_3_DAYS')
    expect(parseFoodFrequencyDraft('4_TO_6_DAYS')).toBe('4_TO_6_DAYS')
    expect(parseFoodFrequencyDraft('EVERY_DAY')).toBe('EVERY_DAY')
    expect(parseFoodFrequencyDraft('YES')).toBeNull()
  })

  it('updates only the selected row frequency while preserving row integrity', () => {
    const state = createFoodDraftStateFromWorkspace(publicFoodWorkspaceWithTwoRows())
    const firstRow = state.rows[0]
    const secondRow = state.rows[1]
    if (firstRow === undefined || secondRow === undefined) throw new Error('Expected rows.')

    const updated = updateFoodRow(state, firstRow.localKey, (row) => ({
      ...row,
      frequencyCode: '4_TO_6_DAYS'
    }))

    expect(updated.rows[0]).toEqual({
      ...firstRow,
      frequencyCode: '4_TO_6_DAYS'
    })
    expect(updated.rows[1]).toBe(secondRow)
    expect(updated.rows[0]?.id).toBe(firstRow.id)
    expect(updated.rows[0]?.localKey).toBe(firstRow.localKey)
    expect(updated.rows[0]?.catalogCode).toBe(firstRow.catalogCode)
    expect(updated.rows[0]?.foodName).toBe(firstRow.foodName)
    expect(updated.rows[0]?.preparationNote).toBe(firstRow.preparationNote)
  })
})

function publicFoodWorkspace(): ScreeningFoodWorkspace {
  return {
    encounterId,
    draft: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      encounterId,
      foodResponse: null,
      rowVersion: 3,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-07',
      rows: [],
      updatedAt: '2026-08-07T10:00:00.000Z'
    },
    catalogItems: [
      {
        code: 'RICE',
        displayName: 'Rice',
        normalizedSearchName: 'rice',
        sortOrder: 1
      }
    ],
    recentFoods: []
  }
}

function publicFoodWorkspaceWithRows(): ScreeningFoodWorkspace {
  return {
    ...publicFoodWorkspace(),
    draft: {
      ...publicFoodWorkspace().draft!,
      foodResponse: 'REPORTED',
      rows: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          sequenceNumber: 1,
          catalogCode: null,
          foodNameSnapshot: 'Cassava',
          foodNameNormalized: 'cassava',
          frequencyCode: null,
          preparationNote: null,
          updatedAt: '2026-08-07T10:00:00.000Z'
        }
      ]
    }
  }
}

function publicFoodWorkspaceWithTwoRows(): ScreeningFoodWorkspace {
  const workspace = publicFoodWorkspaceWithRows()
  return {
    ...workspace,
    draft: {
      ...workspace.draft!,
      rows: [
        ...workspace.draft!.rows,
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          sequenceNumber: 2,
          catalogCode: 'RICE',
          foodNameSnapshot: 'Rice',
          foodNameNormalized: 'rice',
          frequencyCode: '1_DAY',
          preparationNote: 'boiled',
          updatedAt: '2026-08-07T10:00:00.000Z'
        }
      ]
    }
  }
}
