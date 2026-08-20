import { describe, expect, it } from 'vitest'

import type { ScreeningOtcDraftRow, ScreeningOtcResponse, ScreeningOtcWorkspace } from '@shared/ipc'
import {
  addOtcRow,
  createBlankOtcRow,
  createOtcDraftStateFromWorkspace,
  createOtcSaveDraftRequest,
  createInitialOtcDraftState,
  mergeOtcSaveWorkspace,
  moveOtcRow,
  removeOtcRow,
  updateOtcResponse,
  updateOtcRow
} from '../../../src/renderer/src/app/screening/otc/otc-workspace-model'

const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('OTC renderer workspace model', () => {
  it('maps a blank workspace and preserves recent medication suggestions', () => {
    const state = createOtcDraftStateFromWorkspace(workspace({ draft: null }))

    expect(state.otcResponse).toBe('')
    expect(state.rows).toEqual([])
    expect(state.workspace?.recentMedications).toEqual([{ productNameSnapshot: 'Ibuprofen' }])
  })

  it('maps nullable fields and preserves persisted row identity', () => {
    const state = createOtcDraftStateFromWorkspace(workspace({ rows: [persistedRow()] }))
    const row = state.rows[0]

    expect(row).toMatchObject({
      localKey: persistedRow().id,
      id: persistedRow().id,
      productName: 'Ibuprofen',
      reasonForUse: '',
      doseText: '200 mg',
      frequencyText: '',
      durationText: '',
      sourceOfMedication: '',
      currentlyTakingResponse: ''
    })
  })

  it('clears rows for explicit non-reported responses but preserves them for unfinished drafts', () => {
    const withRow = addOtcRow(
      updateOtcResponse({ ...createInitialOtcDraftState(), loadStatus: 'READY' }, 'REPORTED')
    )
    const nonReported = updateOtcResponse(withRow, 'NONE_REPORTED')
    const unfinished = updateOtcResponse(withRow, '')

    expect(nonReported.rows).toEqual([])
    expect(unfinished.rows).toHaveLength(1)
  })

  it('omits only a completely blank new row and preserves meaningful partial rows', () => {
    const state = addOtcRow(
      addOtcRow(
        updateOtcResponse({ ...createInitialOtcDraftState(), loadStatus: 'READY' }, 'REPORTED')
      )
    )
    const partialKey = state.rows[0]?.localKey ?? ''
    const partial = updateOtcRow(state, partialKey, (row) => ({
      ...row,
      reasonForUse: 'pain relief'
    }))
    const result = createOtcSaveDraftRequest(encounterId, partial)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request.rows).toEqual([
      {
        id: null,
        sequenceNumber: 1,
        productName: null,
        reasonForUse: 'pain relief',
        doseText: null,
        frequencyText: null,
        durationText: null,
        sourceOfMedication: null,
        currentlyTakingResponse: null
      }
    ])
    expect(result.request.rows).toHaveLength(1)
  })

  it('preserves meaningful rows for an unfinished nullable response', () => {
    const state = createOtcDraftStateFromWorkspace(
      workspace({ otcResponse: null, rows: [persistedRow()] })
    )
    const result = createOtcSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request.otcResponse).toBeNull()
    expect(result.request.rows).toHaveLength(1)
    expect(result.reconciliation.localKeyBySequence.get(1)).toBe(persistedRow().id)
  })

  it.each([
    ['productName', { productName: 'Ibuprofen' }],
    ['reasonForUse', { reasonForUse: 'Headache' }],
    ['doseText', { doseText: '200 mg' }],
    ['frequencyText', { frequencyText: 'twice daily' }],
    ['durationText', { durationText: 'three days' }],
    ['sourceOfMedication', { sourceOfMedication: 'Clinic' }],
    ['currentlyTakingResponse', { currentlyTakingResponse: 'YES' as const }]
  ])('keeps a row meaningful when only %s is entered', (_field, update) => {
    const row = { ...createBlankOtcRow(), ...update }
    const state = {
      ...createInitialOtcDraftState(),
      loadStatus: 'READY' as const,
      otcResponse: '' as const,
      rows: [row]
    }
    const result = createOtcSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request.rows).toHaveLength(1)
  })

  it('omits a persisted row after every editable field is cleared', () => {
    const mapped = createOtcDraftStateFromWorkspace(workspace({ rows: [persistedRow()] }))
    const rowKey = mapped.rows[0]?.localKey
    if (rowKey === undefined) throw new Error('Expected a persisted row.')
    const cleared = updateOtcRow(mapped, rowKey, (row) => ({
      ...row,
      productName: '',
      doseText: '',
      reasonForUse: '',
      frequencyText: '',
      durationText: '',
      sourceOfMedication: '',
      currentlyTakingResponse: ''
    }))
    const result = createOtcSaveDraftRequest(encounterId, cleared)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request.rows).toEqual([])
  })

  it('normalizes blank text to null and sends only the approved save fields', () => {
    const state = updateOtcRow(
      updateOtcRow(
        updateOtcResponse(
          createOtcDraftStateFromWorkspace(workspace({ rows: [persistedRow()] })),
          'REPORTED'
        ),
        persistedRow().id,
        (row) => ({ ...row, reasonForUse: '  ', sourceOfMedication: ' clinic ' })
      ),
      persistedRow().id,
      (row) => ({ ...row, currentlyTakingResponse: 'YES' })
    )
    const result = createOtcSaveDraftRequest(encounterId, state)

    expect(result.status).toBe('VALID')
    if (result.status !== 'VALID') return
    expect(result.request).toEqual({
      encounterId,
      expectedVersion: 4,
      otcResponse: 'REPORTED',
      rows: [
        {
          id: persistedRow().id,
          sequenceNumber: 1,
          productName: 'Ibuprofen',
          reasonForUse: null,
          doseText: '200 mg',
          frequencyText: null,
          durationText: null,
          sourceOfMedication: 'clinic',
          currentlyTakingResponse: 'YES'
        }
      ]
    })
  })

  it('regenerates sequence numbers while preserving local keys through row operations', () => {
    const first = createBlankOtcRow()
    const second = createBlankOtcRow()
    const state = {
      ...createInitialOtcDraftState(),
      loadStatus: 'READY' as const,
      otcResponse: 'REPORTED' as const,
      rows: [first, second]
    }
    const moved = moveOtcRow(state, first.localKey, 'DOWN')
    const removed = removeOtcRow(moved, first.localKey)
    const result = createOtcSaveDraftRequest(encounterId, removed)

    expect(moved.rows.map((row) => row.localKey)).toEqual([second.localKey, first.localKey])
    expect(removed.rows.map((row) => row.localKey)).toEqual([second.localKey])
    expect(result.status).toBe('VALID')
  })

  it('merges authoritative rows while retaining matching local keys', () => {
    const local = createOtcDraftStateFromWorkspace(workspace({ rows: [persistedRow()] }))
    const localKey = local.rows[0]?.localKey
    const saved = mergeOtcSaveWorkspace(local, workspace({ rowVersion: 5 }))

    expect(saved.workspace?.draft?.rowVersion).toBe(5)
    expect(saved.rows[0]?.localKey).toBe(localKey)
    expect(saved.dirty).toBe(false)
    expect(saved.statusMessage).toBe('Draft saved')
  })

  it('reconciles filtered new rows by submitted sequence rather than local array position', () => {
    const blankBefore = createBlankOtcRow()
    const firstNew = { ...createBlankOtcRow(), productName: 'Ibuprofen' }
    const blankBetween = createBlankOtcRow()
    const secondNew = { ...createBlankOtcRow(), reasonForUse: 'Headache' }
    const current = {
      ...createInitialOtcDraftState(),
      loadStatus: 'READY' as const,
      otcResponse: '' as const,
      rows: [blankBefore, firstNew, blankBetween, secondNew]
    }
    const requestResult = createOtcSaveDraftRequest(encounterId, current)
    if (requestResult.status !== 'VALID') throw new Error('Expected a valid partial request.')
    const saved = mergeOtcSaveWorkspace(
      current,
      workspace({
        otcResponse: null,
        rows: [
          persistedRowWith({
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            sequenceNumber: 1,
            productNameSnapshot: 'Ibuprofen',
            productNameNormalized: 'ibuprofen',
            reasonForUse: null,
            doseText: null
          }),
          persistedRowWith({
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            sequenceNumber: 2,
            productNameSnapshot: null,
            productNameNormalized: null,
            reasonForUse: 'Headache',
            doseText: null
          })
        ]
      }),
      requestResult.reconciliation
    )

    expect(saved.rows.map((row) => row.localKey)).toEqual([firstNew.localKey, secondNew.localKey])
    expect(saved.rows.map((row) => row.id)).toEqual([
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    ])
  })

  it('clears only errors belonging to the exact row prefix', () => {
    const first = { ...createBlankOtcRow(), localKey: 'local-otc-row-1' }
    const tenth = { ...createBlankOtcRow(), localKey: 'local-otc-row-10' }
    const state = {
      ...createInitialOtcDraftState(),
      loadStatus: 'READY' as const,
      rows: [first, tenth],
      validationErrors: [
        { fieldId: 'local-otc-row-1:productName', message: 'first' },
        { fieldId: 'local-otc-row-10:productName', message: 'tenth' }
      ]
    }
    const updated = updateOtcRow(state, first.localKey, (row) => ({
      ...row,
      productName: 'Ibuprofen'
    }))

    expect(updated.validationErrors).toEqual([
      { fieldId: 'local-otc-row-10:productName', message: 'tenth' }
    ])
  })
})

function workspace({
  draft = { rows: [persistedRow()], rowVersion: 4 },
  rows,
  rowVersion,
  otcResponse
}: {
  readonly draft?: {
    readonly rows: readonly ReturnType<typeof persistedRow>[]
    readonly rowVersion: number
  } | null
  readonly rows?: readonly ReturnType<typeof persistedRow>[]
  readonly otcResponse?: ScreeningOtcResponse | null
  readonly rowVersion?: number
} = {}): ScreeningOtcWorkspace {
  const resolvedRows = rows ?? (draft === null ? [] : draft.rows)
  const resolvedRowVersion = rowVersion ?? (draft === null ? 1 : draft.rowVersion)
  return {
    encounterId,
    draft:
      draft === null
        ? null
        : {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            encounterId,
            otcResponse: otcResponse === undefined ? 'REPORTED' : otcResponse,
            rowVersion: resolvedRowVersion,
            periodStart: '2026-07-31',
            periodEnd: '2026-08-06',
            rows: [...resolvedRows],
            updatedAt: '2026-08-06T08:15:00.000Z'
          },
    recentMedications: [{ productNameSnapshot: 'Ibuprofen' }]
  }
}

function persistedRow(): ScreeningOtcDraftRow {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    sequenceNumber: 1,
    productNameSnapshot: 'Ibuprofen',
    productNameNormalized: 'ibuprofen',
    reasonForUse: null,
    doseText: '200 mg',
    frequencyText: null,
    durationText: null,
    sourceOfMedication: null,
    currentlyTakingResponse: null,
    updatedAt: '2026-08-06T08:15:00.000Z'
  }
}

function persistedRowWith(overrides: Partial<ScreeningOtcDraftRow>): ScreeningOtcDraftRow {
  return { ...persistedRow(), ...overrides }
}
