import { describe, expect, it } from 'vitest'

import type { ScreeningLifestyleWorkspace } from '@shared/ipc'
import {
  createAlcoholBaselineRequest,
  createAlcoholSaveDraftRequest,
  createLifestyleDraftStateFromWorkspace,
  getAlcoholCardStatus,
  getAlcoholCardSummary,
  isAlcoholComplete,
  mapAlcoholBaselineStatus,
  updateAlcoholResponse,
  validateAlcoholBaseline,
  validateAlcoholWeeklyDraft,
  type AlcoholBaselineForm,
  type AlcoholWeeklyForm
} from '../../../src/renderer/src/app/screening/lifestyle/lifestyle-workspace-model'

const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const alcoholBaselineId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tobaccoBaselineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const workBaselineId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const alcoholId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const timestamp = '2026-08-06T08:15:00.000Z'

describe('Lifestyle Alcohol workspace model', () => {
  it.each([
    [
      { everConsumed: 'NO', consumedPast12Months: '' },
      { status: 'NEVER', consumedPast12Months: 'NO' }
    ],
    [
      { everConsumed: 'DECLINED', consumedPast12Months: '' },
      { status: 'DECLINED', consumedPast12Months: 'DECLINED' }
    ],
    [
      { everConsumed: 'YES', consumedPast12Months: 'YES' },
      { status: 'CURRENT', consumedPast12Months: 'YES' }
    ],
    [
      { everConsumed: 'YES', consumedPast12Months: 'NO' },
      { status: 'FORMER', consumedPast12Months: 'NO' }
    ],
    [
      { everConsumed: 'UNKNOWN', consumedPast12Months: 'DECLINED' },
      { status: 'DECLINED', consumedPast12Months: 'DECLINED' }
    ],
    [
      { everConsumed: 'UNKNOWN', consumedPast12Months: '' },
      { status: 'UNKNOWN', consumedPast12Months: 'UNKNOWN' }
    ]
  ] as const)('maps baseline answers to %j', (form, expected) => {
    expect(
      mapAlcoholBaselineStatus({
        ...form,
        commonBeverageTypes: [],
        otherBeverageDescription: ''
      })
    ).toEqual(expected)
  })

  it('clears quantitative and beverage details when leaving the Yes branch', () => {
    const form = completeWeekly()
    expect(updateAlcoholResponse(form, 'NO')).toEqual({
      ...form,
      weeklyResponse: 'NO',
      drinkingDays: '',
      totalStandardizedDrinks: '',
      largestOneDayAmount: '',
      daysAtLargestAmount: '',
      commonBeverageTypes: [],
      otherBeverageDescription: ''
    })
  })

  it('allows an incomplete noncontradictory Yes draft', () => {
    const form: AlcoholWeeklyForm = { ...emptyWeekly(), weeklyResponse: 'YES', drinkingDays: '2' }
    expect(validateAlcoholWeeklyDraft(form)).toEqual([])
    expect(isAlcoholComplete(form)).toBe(false)
  })

  it('accepts decimal quantities that are equal within floating-point tolerance', () => {
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '3',
        totalStandardizedDrinks: '0.3',
        largestOneDayAmount: '0.1',
        daysAtLargestAmount: '3'
      })
    ).toEqual([])
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '3',
        totalStandardizedDrinks: '0.29',
        largestOneDayAmount: '0.1',
        daysAtLargestAmount: '3'
      }).map((error) => error.fieldId)
    ).toContain('totalStandardizedDrinks')
  })

  it('accepts a valid seven-day quantity combination', () => {
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '4',
        totalStandardizedDrinks: '8',
        largestOneDayAmount: '3',
        daysAtLargestAmount: '2'
      })
    ).toEqual([])
  })

  it('rejects invalid present values without coercing blanks to zero', () => {
    const form: AlcoholWeeklyForm = {
      ...emptyWeekly(),
      weeklyResponse: 'YES',
      drinkingDays: '0',
      totalStandardizedDrinks: '-1',
      largestOneDayAmount: '4',
      daysAtLargestAmount: '3'
    }
    const errors = validateAlcoholWeeklyDraft(form)
    expect(errors.map((error) => error.fieldId)).toEqual(
      expect.arrayContaining(['drinkingDays', 'totalStandardizedDrinks'])
    )
    expect(createAlcoholSaveDraftRequest(encounterId, stateFor(form)).alcohol).toMatchObject({
      drinkingDays: 0,
      totalStandardizedDrinks: -1
    })
  })

  it('rejects contradictory largest amount and day counts', () => {
    const form: AlcoholWeeklyForm = {
      ...completeWeekly(),
      totalStandardizedDrinks: '3',
      largestOneDayAmount: '4',
      daysAtLargestAmount: '4'
    }
    expect(validateAlcoholWeeklyDraft(form).map((error) => error.fieldId)).toEqual(
      expect.arrayContaining([
        'largestOneDayAmount',
        'daysAtLargestAmount',
        'totalStandardizedDrinks'
      ])
    )
  })

  it('rejects a weekly total that cannot contain the highest amount on each reported day', () => {
    const errors = validateAlcoholWeeklyDraft({
      ...completeWeekly(),
      drinkingDays: '4',
      totalStandardizedDrinks: '3',
      largestOneDayAmount: '3',
      daysAtLargestAmount: '2'
    })
    expect(errors).toContainEqual({
      fieldId: 'totalStandardizedDrinks',
      message:
        'The total number of drinks is too low for the highest amount and number of days entered.'
    })
  })

  it('requires an exact subtotal when every drinking day had the highest amount', () => {
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '2',
        totalStandardizedDrinks: '5',
        largestOneDayAmount: '2',
        daysAtLargestAmount: '2'
      }).map((error) => error.fieldId)
    ).toContain('totalStandardizedDrinks')
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '2',
        totalStandardizedDrinks: '4',
        largestOneDayAmount: '2',
        daysAtLargestAmount: '2'
      })
    ).toEqual([])
  })

  it('requires additional drinks when other drinking days remain', () => {
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '3',
        totalStandardizedDrinks: '4',
        largestOneDayAmount: '2',
        daysAtLargestAmount: '2'
      }).map((error) => error.fieldId)
    ).toContain('totalStandardizedDrinks')
    expect(
      validateAlcoholWeeklyDraft({
        ...completeWeekly(),
        drinkingDays: '3',
        totalStandardizedDrinks: '5',
        largestOneDayAmount: '2',
        daysAtLargestAmount: '2'
      })
    ).toEqual([])
  })

  it('requires Other descriptions for baseline and weekly completion', () => {
    const baseline: AlcoholBaselineForm = {
      everConsumed: 'YES',
      consumedPast12Months: 'YES',
      commonBeverageTypes: ['OTHER'],
      otherBeverageDescription: ''
    }
    expect(validateAlcoholBaseline(baseline).map((error) => error.fieldId)).toContain(
      'baselineOtherBeverageDescription'
    )
    const weekly = { ...completeWeekly(), commonBeverageTypes: ['OTHER'] as const }
    expect(isAlcoholComplete(weekly)).toBe(false)
  })

  it('preserves unseen Lifestyle sections when building the Alcohol Save Draft request', () => {
    const workspace = workspaceWithDraft()
    const state = createLifestyleDraftStateFromWorkspace(workspace)
    const request = createAlcoholSaveDraftRequest(encounterId, state)
    expect(request.tobacco).toEqual({
      id: workspace.draft?.tobacco?.id,
      weeklyResponse: workspace.draft?.tobacco?.weeklyResponse,
      products: []
    })
    expect(request.physicalActivity).toEqual({
      id: workspace.draft?.physicalActivity?.id,
      weeklyResponse: workspace.draft?.physicalActivity?.weeklyResponse,
      sedentaryMinutesPerDay: workspace.draft?.physicalActivity?.sedentaryMinutesPerDay,
      activities: []
    })
    expect(request.work).toEqual({
      id: workspace.draft?.work?.id,
      weeklyResponse: workspace.draft?.work?.weeklyResponse
    })
    expect(request.otherActivities).toEqual([
      expect.objectContaining({ id: workspace.draft?.otherActivities[0]?.id })
    ])
    expect(request.alcohol).toMatchObject({ id: alcoholId, weeklyResponse: 'YES' })
  })

  it('uses the active baseline and draft versions for a baseline save', () => {
    const state = createLifestyleDraftStateFromWorkspace(workspaceWithDraft())
    const request = createAlcoholBaselineRequest(encounterId, state)
    expect(request).toMatchObject({
      expectedBaselineVersion: 2,
      expectedDraftVersion: 4,
      status: 'CURRENT'
    })
  })

  it('uses the active baseline for editing while interpreting the weekly draft from the reference', () => {
    const workspace = workspaceWithDraft()
    const referenced = {
      ...workspace.referencedAlcoholBaseline!,
      id: 'abababab-abab-4bab-8bab-abababababab',
      version: 1,
      status: 'FORMER' as const,
      consumedPast12Months: 'NO' as const
    }
    const active = {
      ...workspace.activeAlcoholBaseline!,
      version: 2,
      status: 'CURRENT' as const,
      consumedPast12Months: 'YES' as const
    }
    const distinctWorkspace: ScreeningLifestyleWorkspace = {
      ...workspace,
      draft: {
        ...workspace.draft!,
        status: 'COMPLETE',
        alcoholBaselineVersionId: referenced.id
      },
      activeAlcoholBaseline: active,
      referencedAlcoholBaseline: referenced
    }
    const state = createLifestyleDraftStateFromWorkspace(distinctWorkspace)
    const request = createAlcoholBaselineRequest(encounterId, state)

    expect(state.baselineForm.consumedPast12Months).toBe('YES')
    expect(request).toMatchObject({
      expectedBaselineVersion: 2,
      status: 'CURRENT',
      consumedPast12Months: 'YES'
    })
    expect(getAlcoholCardStatus(state, true)).toBe('BASELINE_REVIEW')
    expect(
      getAlcoholCardSummary({ ...state, alcohol: updateAlcoholResponse(state.alcohol, 'NO') }, true)
    ).toBe('Former • No use this week')
  })

  it('uses the active baseline for editing while interpreting the weekly draft from the reference', () => {
    const workspace = workspaceWithDraft()
    const referenced = {
      ...workspace.referencedAlcoholBaseline!,
      id: 'abababab-abab-4bab-8bab-abababababab',
      version: 1,
      status: 'FORMER' as const,
      consumedPast12Months: 'NO' as const
    }
    const active = {
      ...workspace.activeAlcoholBaseline!,
      version: 2,
      status: 'CURRENT' as const,
      consumedPast12Months: 'YES' as const
    }
    const distinctWorkspace: ScreeningLifestyleWorkspace = {
      ...workspace,
      draft: {
        ...workspace.draft!,
        status: 'COMPLETE',
        alcoholBaselineVersionId: referenced.id
      },
      activeAlcoholBaseline: active,
      referencedAlcoholBaseline: referenced
    }
    const state = createLifestyleDraftStateFromWorkspace(distinctWorkspace)
    const request = createAlcoholBaselineRequest(encounterId, state)

    expect(state.baselineForm.consumedPast12Months).toBe('YES')
    expect(request).toMatchObject({
      expectedBaselineVersion: 2,
      status: 'CURRENT',
      consumedPast12Months: 'YES'
    })
    expect(getAlcoholCardStatus(state, true)).toBe('BASELINE_REVIEW')
    expect(
      getAlcoholCardSummary({ ...state, alcohol: updateAlcoholResponse(state.alcohol, 'NO') }, true)
    ).toBe('Former • No use this week')
  })

  it.each([
    ['FORMER', 'Former • Use reported • Review baseline'],
    ['NEVER', 'Never • Use reported • Review baseline']
  ] as const)('reports the exact %s baseline in the review summary', (baselineStatus, summary) => {
    const workspace = workspaceWithDraft({ baselineStatus, draftStatus: 'COMPLETE' })
    const state = createLifestyleDraftStateFromWorkspace(workspace)
    expect(getAlcoholCardStatus(state, true)).toBe('BASELINE_REVIEW')
    expect(getAlcoholCardStatus(state, false)).toBe('LOCKED')
    expect(getAlcoholCardSummary(state, true)).toBe(summary)
  })

  it.each([
    ['CURRENT', 'Current • No use this week'],
    ['FORMER', 'Former • No use this week'],
    ['NEVER', 'Never • No use this week'],
    ['UNKNOWN', 'Unknown • No use this week'],
    ['DECLINED', 'Declined • No use this week']
  ] as const)('reports %s for a completed no-use week', (baselineStatus, summary) => {
    const workspace = workspaceWithDraft({ baselineStatus, draftStatus: 'COMPLETE' })
    const state = createLifestyleDraftStateFromWorkspace(workspace)
    expect(
      getAlcoholCardSummary({ ...state, alcohol: updateAlcoholResponse(state.alcohol, 'NO') }, true)
    ).toBe(summary)
  })

  it.each([
    ['CURRENT', 'Current • No use this week'],
    ['FORMER', 'Former • No use this week'],
    ['NEVER', 'Never • No use this week'],
    ['UNKNOWN', 'Unknown • No use this week'],
    ['DECLINED', 'Declined • No use this week']
  ] as const)('reports %s for a completed no-use week', (baselineStatus, summary) => {
    const workspace = workspaceWithDraft({ baselineStatus, draftStatus: 'COMPLETE' })
    const state = createLifestyleDraftStateFromWorkspace(workspace)
    expect(
      getAlcoholCardSummary({ ...state, alcohol: updateAlcoholResponse(state.alcohol, 'NO') }, true)
    ).toBe(summary)
  })
})

function emptyWeekly(): AlcoholWeeklyForm {
  return {
    id: null,
    weeklyResponse: '',
    drinkingDays: '',
    totalStandardizedDrinks: '',
    largestOneDayAmount: '',
    daysAtLargestAmount: '',
    commonBeverageTypes: [],
    otherBeverageDescription: ''
  }
}

function completeWeekly(): AlcoholWeeklyForm {
  return {
    ...emptyWeekly(),
    weeklyResponse: 'YES',
    drinkingDays: '2',
    totalStandardizedDrinks: '3',
    largestOneDayAmount: '2',
    daysAtLargestAmount: '1',
    commonBeverageTypes: ['BEER']
  }
}

function stateFor(
  alcohol: AlcoholWeeklyForm
): ReturnType<typeof createLifestyleDraftStateFromWorkspace> {
  return {
    ...createLifestyleDraftStateFromWorkspace(workspaceWithDraft()),
    alcohol
  }
}

function workspaceWithDraft({
  baselineStatus = 'CURRENT',
  draftStatus = 'IN_PROGRESS'
}: {
  baselineStatus?: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  draftStatus?: 'IN_PROGRESS' | 'COMPLETE'
} = {}): ScreeningLifestyleWorkspace {
  return {
    encounterId,
    draft: {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      encounterId,
      status: draftStatus,
      rowVersion: 4,
      periodStart: '2026-07-31',
      periodEnd: '2026-08-06',
      alcoholBaselineVersionId: alcoholBaselineId,
      tobaccoBaselineVersionId: tobaccoBaselineId,
      workBaselineVersionId: workBaselineId,
      alcohol: {
        id: alcoholId,
        weeklyResponse: 'YES',
        drinkingDays: 2,
        totalStandardizedDrinks: 3,
        largestOneDayAmount: 2,
        daysAtLargestAmount: 1,
        commonBeverageTypes: ['BEER'],
        otherBeverageDescription: null,
        updatedAt: timestamp
      },
      tobacco: {
        id: '12121212-1212-4121-8121-121212121212',
        weeklyResponse: 'YES',
        products: [],
        updatedAt: timestamp
      },
      physicalActivity: {
        id: '13131313-1313-4131-8131-131313131313',
        weeklyResponse: 'YES',
        sedentaryMinutesPerDay: 30,
        activities: [],
        updatedAt: timestamp
      },
      work: {
        id: '14141414-1414-4141-8141-141414141414',
        weeklyResponse: 'USUAL',
        updatedAt: timestamp
      },
      otherActivities: [
        {
          id: '15151515-1515-4151-8151-151515151515',
          sequenceNumber: 1,
          category: 'SPORT',
          description: 'Walking',
          daysInPastSevenDays: 2,
          averageMinutesPerDay: 30,
          intensity: 'LIGHT',
          updatedAt: timestamp
        }
      ],
      updatedAt: timestamp
    },
    activeAlcoholBaseline: {
      id: alcoholBaselineId,
      version: 2,
      status: baselineStatus,
      everConsumed: baselineStatus === 'NEVER' ? 'NO' : 'YES',
      consumedPast12Months: baselineStatus === 'CURRENT' ? 'YES' : 'NO',
      commonBeverageTypes: ['BEER'],
      otherBeverageDescription: null,
      updatedAt: timestamp
    },
    activeTobaccoBaseline: null,
    activeWorkBaseline: null,
    referencedAlcoholBaseline: {
      id: alcoholBaselineId,
      version: 2,
      status: baselineStatus,
      everConsumed: baselineStatus === 'NEVER' ? 'NO' : 'YES',
      consumedPast12Months: baselineStatus === 'CURRENT' ? 'YES' : 'NO',
      commonBeverageTypes: ['BEER'],
      otherBeverageDescription: null,
      updatedAt: timestamp
    },
    referencedTobaccoBaseline: null,
    referencedWorkBaseline: null
  }
}
