import { describe, expect, it } from 'vitest'

import type { ScreeningLifestyleWorkspace } from '@shared/ipc'
import {
  createAlcoholBaselineRequest,
  createAlcoholSaveDraftRequest,
  createLifestyleCompleteRequest,
  collapseLifestylePanels,
  createLifestyleDraftStateFromWorkspace,
  getAlcoholCardStatus,
  getAlcoholCardSummary,
  isAlcoholComplete,
  mapAlcoholBaselineStatus,
  mergeLifestyleBaselineSaveWorkspace,
  toggleLifestyleCard,
  updateAlcoholResponse,
  validateAlcoholCompletionReadiness,
  validateLifestyleCompletionReadiness,
  validateAlcoholBaseline,
  validateAlcoholWeeklyDraft,
  validateCompleteAlcoholWeekly,
  type AlcoholBaselineForm,
  type AlcoholWeeklyForm
} from '../../../src/renderer/src/app/screening/lifestyle/lifestyle-workspace-model'
import {
  getTobaccoBaselineForEditableForm,
  getTobaccoBaselineForInterpretation,
  getTobaccoCardStatus,
  getTobaccoCardSummary,
  mapTobaccoBaselineStatus,
  toggleTobaccoBaselineProduct,
  updateTobaccoResponse,
  validateTobaccoCompletionReadiness,
  validateTobaccoBaseline,
  validateTobaccoWeeklyDraft,
  type TobaccoBaselineForm,
  type TobaccoWeeklyForm
} from '../../../src/renderer/src/app/screening/lifestyle/tobacco-workspace-model'
import { validateWorkCompletionReadiness } from '../../../src/renderer/src/app/screening/lifestyle/activity-workspace-model'

const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const alcoholBaselineId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tobaccoBaselineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const workBaselineId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const alcoholId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const timestamp = '2026-08-06T08:15:00.000Z'

describe('Lifestyle Alcohol workspace model', () => {
  it('does not let module-level save errors make Alcohol or Tobacco cards invalid', () => {
    const alcoholState = createLifestyleDraftStateFromWorkspace(workspaceWithDraft())
    const tobaccoState = createLifestyleDraftStateFromWorkspace(
      tobaccoWorkspaceWithStatus('CURRENT_DAILY', 'YES')
    )
    const tobaccoStateWithModuleError = {
      ...tobaccoState,
      saveStatus: 'ERROR',
      statusMessage: 'Draft could not be saved.'
    }

    expect(
      getAlcoholCardStatus(
        { ...alcoholState, saveStatus: 'ERROR', statusMessage: 'Draft could not be saved.' },
        true
      )
    ).not.toBe('VALIDATION_ERROR')
    expect(getTobaccoCardStatus(tobaccoStateWithModuleError, true)).not.toBe('VALIDATION_ERROR')
    expect(
      getAlcoholCardStatus(
        {
          ...alcoholState,
          validationErrors: [{ fieldId: 'drinkingDays', message: 'Enter days.' }]
        },
        true
      )
    ).toBe('VALIDATION_ERROR')
    expect(
      getTobaccoCardStatus(
        {
          ...tobaccoState,
          tobaccoValidationErrors: [{ fieldId: 'tobacco-weekly-response', message: 'Select.' }]
        },
        true
      )
    ).toBe('VALIDATION_ERROR')
  })

  it.each(['ALCOHOL', 'TOBACCO', 'WORK'] as const)(
    'preserves unsaved Lifestyle state while accepting an authoritative %s baseline save',
    (domain) => {
      const workspace = workspaceWithAllReferencedBaselines()
      const current = unsavedStateForBaselineMerge(workspace)
      const authoritative = authoritativeBaselineWorkspace(workspace, domain)

      const merged = mergeLifestyleBaselineSaveWorkspace(
        current,
        authoritative,
        domain,
        'Baseline saved'
      )
      const authoritativeState = createLifestyleDraftStateFromWorkspace(authoritative)

      expect(merged.workspace).toBe(authoritative)
      expect(merged.alcohol).toEqual(current.alcohol)
      expect(merged.tobacco).toEqual(current.tobacco)
      expect(merged.physicalActivity).toEqual(current.physicalActivity)
      expect(merged.work).toEqual(current.work)
      expect(merged.otherActivity).toEqual(current.otherActivity)
      expect(merged.validationFocusRequestToken).toBeNull()
      expect(merged.dirty).toBe(true)
      expect(merged.baselineOpen).toBe(domain === 'ALCOHOL' ? false : current.baselineOpen)
      expect(merged.tobaccoBaselineOpen).toBe(
        domain === 'TOBACCO' ? false : current.tobaccoBaselineOpen
      )
      expect(merged.workBaselineOpen).toBe(domain === 'WORK' ? false : current.workBaselineOpen)
      expect(merged.baselineForm).toEqual(
        domain === 'ALCOHOL' ? authoritativeState.baselineForm : current.baselineForm
      )
      expect(merged.tobaccoBaselineForm).toEqual(
        domain === 'TOBACCO' ? authoritativeState.tobaccoBaselineForm : current.tobaccoBaselineForm
      )
      expect(merged.workBaselineForm).toEqual(
        domain === 'WORK' ? authoritativeState.workBaselineForm : current.workBaselineForm
      )
      expect(merged.alcoholBaselineReviewConfirmedVersionId).toBe(
        domain === 'ALCOHOL' ? null : alcoholBaselineId
      )
      expect(merged.tobaccoBaselineReviewConfirmedVersionId).toBe(
        domain === 'TOBACCO' ? null : tobaccoBaselineId
      )
    }
  )

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

  it('collapses every Lifestyle panel without changing clinical form values', () => {
    const state = {
      ...createLifestyleDraftStateFromWorkspace(workspaceWithDraft()),
      alcoholExpanded: true,
      baselineOpen: true,
      tobaccoExpanded: true,
      tobaccoBaselineOpen: true
    }

    const collapsed = collapseLifestylePanels(state)

    expect(collapsed).toMatchObject({
      alcoholExpanded: false,
      baselineOpen: false,
      tobaccoExpanded: false,
      tobaccoBaselineOpen: false,
      alcohol: state.alcohol,
      tobacco: state.tobacco,
      baselineForm: state.baselineForm,
      tobaccoBaselineForm: state.tobaccoBaselineForm,
      workspace: state.workspace,
      dirty: state.dirty
    })
  })

  it('keeps card expansion mutually exclusive and closes nested panels', () => {
    const state = {
      ...createLifestyleDraftStateFromWorkspace(workspaceWithDraft()),
      alcoholExpanded: true,
      baselineOpen: true,
      tobaccoExpanded: false,
      tobaccoBaselineOpen: false
    }

    const tobaccoOpened = toggleLifestyleCard(state, 'TOBACCO')
    expect(tobaccoOpened).toMatchObject({
      alcoholExpanded: false,
      baselineOpen: false,
      tobaccoExpanded: true,
      tobaccoBaselineOpen: false
    })

    const tobaccoClosed = toggleLifestyleCard(
      { ...tobaccoOpened, tobaccoBaselineOpen: true },
      'TOBACCO'
    )
    expect(tobaccoClosed).toMatchObject({
      alcoholExpanded: false,
      baselineOpen: false,
      tobaccoExpanded: false,
      tobaccoBaselineOpen: false
    })

    const alcoholOpened = toggleLifestyleCard(
      { ...tobaccoClosed, tobaccoExpanded: true, tobaccoBaselineOpen: true },
      'ALCOHOL'
    )
    expect(alcoholOpened).toMatchObject({
      alcoholExpanded: true,
      baselineOpen: false,
      tobaccoExpanded: false,
      tobaccoBaselineOpen: false
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
      sedentaryTimeResponse: workspace.draft?.physicalActivity?.sedentaryTimeResponse,
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

  it('does not manufacture an unseen Tobacco weekly record', () => {
    const workspace = workspaceWithDraft()
    const state = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: { ...workspace.draft!, tobacco: null }
    })
    expect(createAlcoholSaveDraftRequest(encounterId, state).tobacco).toBeNull()
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

  it.each([
    ['FORMER', 'Former • Use reported • Review baseline'],
    ['NEVER', 'Never • Use reported • Review baseline']
  ] as const)('reports the exact %s baseline in the review summary', (baselineStatus, summary) => {
    const workspace = workspaceWithDraft({ baselineStatus, draftStatus: 'COMPLETE' })
    const state = createLifestyleDraftStateFromWorkspace(workspace)
    expect(getAlcoholCardStatus(state, true)).toBe('BASELINE_REVIEW')
    expect(getAlcoholCardStatus(state, false)).toBe('COMPLETE')
    expect(getAlcoholCardSummary(state, true)).toBe(summary)
  })

  it('requires completion fields without rejecting an incomplete draft', () => {
    const incomplete = { ...emptyWeekly(), weeklyResponse: 'YES' as const, drinkingDays: '2' }
    expect(validateAlcoholWeeklyDraft(incomplete)).toEqual([])
    expect(validateCompleteAlcoholWeekly(incomplete).map((error) => error.fieldId)).toEqual(
      expect.arrayContaining([
        'totalStandardizedDrinks',
        'largestOneDayAmount',
        'daysAtLargestAmount'
      ])
    )
  })

  it('uses exact referenced baselines for completion review confirmation IDs', () => {
    const workspace = workspaceWithDraft()
    const referenced = {
      ...workspace.activeAlcoholBaseline!,
      id: 'abababab-abab-4bab-8bab-abababababab',
      status: 'FORMER' as const,
      version: 1
    }
    const state = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: { ...workspace.draft!, alcoholBaselineVersionId: referenced.id },
      activeAlcoholBaseline: { ...workspace.activeAlcoholBaseline!, status: 'CURRENT', version: 2 },
      referencedAlcoholBaseline: referenced
    })
    const withoutConfirmation = createLifestyleCompleteRequest(encounterId, state)
    expect(withoutConfirmation.alcoholBaselineReviewConfirmedVersionId).toBeNull()
    const withConfirmation = createLifestyleCompleteRequest(encounterId, {
      ...state,
      alcoholBaselineReviewConfirmedVersionId: referenced.id
    })
    expect(withConfirmation.alcoholBaselineReviewConfirmedVersionId).toBe(referenced.id)
  })

  it('uses the same Alcohol readiness for card status and Continue validation', () => {
    const workspace = workspaceWithDraft()
    const missingReference = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: { ...workspace.draft!, alcoholBaselineVersionId: null },
      referencedAlcoholBaseline: null
    })

    expect(
      validateAlcoholCompletionReadiness(missingReference).map((error) => error.fieldId)
    ).toContain('alcohol-baseline-reference')
    expect(getAlcoholCardStatus(missingReference, true)).toBe('IN_PROGRESS')

    const reviewRequired = createLifestyleDraftStateFromWorkspace(
      workspaceWithDraft({ baselineStatus: 'FORMER' })
    )
    expect(
      validateAlcoholCompletionReadiness(reviewRequired).map((error) => error.fieldId)
    ).toEqual(['alcohol-baseline-review-confirmation'])
    expect(getAlcoholCardStatus(reviewRequired, true)).toBe('BASELINE_REVIEW')

    const confirmed = {
      ...reviewRequired,
      alcoholBaselineReviewConfirmedVersionId: alcoholBaselineId
    }
    expect(validateAlcoholCompletionReadiness(confirmed)).toEqual([])
    expect(getAlcoholCardStatus(confirmed, true)).toBe('COMPLETE')
  })

  it('reports all authoritative readiness errors through the Lifestyle Continue evaluator', () => {
    const state = createLifestyleDraftStateFromWorkspace({
      ...workspaceWithDraft(),
      draft: {
        ...workspaceWithDraft().draft!,
        alcoholBaselineVersionId: null,
        tobaccoBaselineVersionId: null,
        workBaselineVersionId: null,
        physicalActivity: null,
        work: null,
        otherActivityResponse: null,
        otherActivities: []
      },
      referencedAlcoholBaseline: null,
      referencedTobaccoBaseline: null,
      referencedWorkBaseline: null
    })
    const readiness = validateLifestyleCompletionReadiness(state)

    expect(readiness.validationErrors.map((error) => error.fieldId)).toContain(
      'alcohol-baseline-reference'
    )
    expect(readiness.tobaccoValidationErrors.map((error) => error.fieldId)).toContain(
      'tobacco-baseline-reference'
    )
    expect(readiness.physicalActivityValidationErrors.map((error) => error.fieldId)).toEqual(
      expect.arrayContaining(['physical-weekly-response', 'physical-sedentary-response'])
    )
    expect(readiness.workValidationErrors.map((error) => error.fieldId)).toContain(
      'work-baseline-status'
    )
    expect(readiness.otherActivityValidationErrors.map((error) => error.fieldId)).toContain(
      'other-weekly-response'
    )
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

describe('Lifestyle Tobacco workspace model', () => {
  it.each([
    ['CURRENT_DAILY', 'YES', 'Current | Use reported'],
    ['CURRENT_DAILY', 'NO', 'Current | No use this week'],
    ['CURRENT_DAILY', 'UNKNOWN', 'Current | Weekly use unknown'],
    ['CURRENT_DAILY', 'DECLINED', 'Current | Weekly response declined'],
    ['CURRENT_DAILY', 'PREFER_NOT_TO_ANSWER', 'Current | Prefer not to answer'],
    ['CURRENT_DAILY', '', 'Current | Tobacco draft in progress'],
    ['FORMER', 'YES', 'Former | Use reported | Review baseline'],
    ['FORMER', 'NO', 'Former | No use this week'],
    ['FORMER', 'UNKNOWN', 'Former | Weekly use unknown'],
    ['FORMER', 'DECLINED', 'Former | Weekly response declined'],
    ['FORMER', 'PREFER_NOT_TO_ANSWER', 'Former | Prefer not to answer'],
    ['FORMER', '', 'Former | Tobacco draft in progress'],
    ['NEVER', 'YES', 'Never | Use reported | Review baseline'],
    ['NEVER', 'NO', 'Never | No use this week'],
    ['NEVER', 'UNKNOWN', 'Never | Weekly use unknown'],
    ['NEVER', 'DECLINED', 'Never | Weekly response declined'],
    ['NEVER', 'PREFER_NOT_TO_ANSWER', 'Never | Prefer not to answer'],
    ['NEVER', '', 'Never | Tobacco draft in progress'],
    ['UNKNOWN', 'YES', 'Unknown | Use reported'],
    ['UNKNOWN', 'NO', 'Unknown | No use this week'],
    ['UNKNOWN', 'UNKNOWN', 'Unknown | Weekly use unknown'],
    ['UNKNOWN', 'DECLINED', 'Unknown | Weekly response declined'],
    ['UNKNOWN', 'PREFER_NOT_TO_ANSWER', 'Unknown | Prefer not to answer'],
    ['UNKNOWN', '', 'Unknown | Tobacco draft in progress'],
    ['DECLINED', 'YES', 'Declined | Use reported'],
    ['DECLINED', 'NO', 'Declined | No use this week'],
    ['DECLINED', 'UNKNOWN', 'Declined | Weekly use unknown'],
    ['DECLINED', 'DECLINED', 'Declined | Weekly response declined'],
    ['DECLINED', 'PREFER_NOT_TO_ANSWER', 'Declined | Prefer not to answer'],
    ['DECLINED', '', 'Declined | Tobacco draft in progress']
  ] as const)('summarizes %s baseline with %s weekly response', (status, response, summary) => {
    const state = createLifestyleDraftStateFromWorkspace(
      tobaccoWorkspaceWithStatus(status, response)
    )
    expect(getTobaccoCardSummary(state, true)).toBe(
      summary.replaceAll(' | ', ` ${String.fromCodePoint(0x2022)} `)
    )
  })

  it('uses the same Tobacco readiness for card status and Continue validation', () => {
    const workspace = tobaccoWorkspaceWithStatus('FORMER', 'YES')
    const product = {
      id: '16161616-1616-4161-8161-161616161616',
      sequenceNumber: 1,
      productType: 'CIGARETTE' as const,
      daysUsed: 2,
      averageQuantityPerUseDay: 3,
      unit: 'STICKS_CIGARETTES' as const,
      secondhandSmokeExposure: null,
      otherProductDescription: null,
      otherUnitDescription: null,
      updatedAt: timestamp
    }
    const reviewRequired = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: {
        ...workspace.draft!,
        tobacco: { ...workspace.draft!.tobacco!, products: [product] }
      }
    })

    expect(
      validateTobaccoCompletionReadiness(reviewRequired).map((error) => error.fieldId)
    ).toEqual(['tobacco-baseline-review-confirmation'])
    expect(getTobaccoCardStatus(reviewRequired, true)).toBe('BASELINE_REVIEW')

    const confirmed = {
      ...reviewRequired,
      tobaccoBaselineReviewConfirmedVersionId: tobaccoBaselineId
    }
    expect(validateTobaccoCompletionReadiness(confirmed)).toEqual([])
    expect(getTobaccoCardStatus(confirmed, true)).toBe('COMPLETE')

    const missingReference = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: { ...workspace.draft!, tobaccoBaselineVersionId: null },
      referencedTobaccoBaseline: null
    })
    expect(
      validateTobaccoCompletionReadiness(missingReference).map((error) => error.fieldId)
    ).toContain('tobacco-baseline-reference')
    expect(getTobaccoCardStatus(missingReference, true)).toBe('IN_PROGRESS')
  })

  it('keeps Work incomplete until the weekly answer has an exact referenced baseline', () => {
    const workspace = workspaceWithDraft()
    const workBaseline = {
      id: workBaselineId,
      version: 2,
      status: 'EMPLOYED' as const,
      occupationJobTitle: 'Farmer',
      usualPhysicalDemand: 'MODERATE_LABOR' as const,
      typicalWorkdaysPerWeek: 5,
      typicalHoursPerWorkday: 8,
      shiftPattern: 'DAY' as const,
      description: null,
      updatedAt: timestamp
    }
    const state = createLifestyleDraftStateFromWorkspace({
      ...workspace,
      draft: { ...workspace.draft!, workBaselineVersionId: null },
      activeWorkBaseline: workBaseline,
      referencedWorkBaseline: null
    })

    expect(validateWorkCompletionReadiness(state).map((error) => error.fieldId)).toContain(
      'work-baseline-status'
    )
    expect(
      validateWorkCompletionReadiness({
        ...state,
        workspace: {
          ...state.workspace!,
          draft: { ...state.workspace!.draft!, workBaselineVersionId: workBaselineId },
          referencedWorkBaseline: workBaseline
        }
      })
    ).toEqual([])
  })

  it('clears a hidden baseline Other description when Other is deselected', () => {
    const form: TobaccoBaselineForm = {
      everRegularlyUsed: 'YES',
      currentUseFrequency: 'EVERY_DAY',
      formerUseApproximateStopDate: '',
      productTypes: ['OTHER'],
      otherProductDescription: 'Persisted description'
    }
    const cleared = toggleTobaccoBaselineProduct(form, 'OTHER')
    expect(cleared.productTypes).toEqual([])
    expect(cleared.otherProductDescription).toBe('')
    expect(toggleTobaccoBaselineProduct(cleared, 'OTHER').otherProductDescription).toBe('')
  })

  it.each([
    ['NO', '', 'NEVER', 'NOT_AT_ALL'],
    ['DECLINED', '', 'DECLINED', 'DECLINED'],
    ['YES', 'EVERY_DAY', 'CURRENT_DAILY', 'EVERY_DAY'],
    ['YES', 'SOME_DAYS', 'CURRENT_SOME_DAYS', 'SOME_DAYS'],
    ['YES', 'NOT_AT_ALL', 'FORMER', 'NOT_AT_ALL'],
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
    ['UNKNOWN', 'DECLINED', 'DECLINED', 'DECLINED']
  ] as const)('maps %s/%s to %s', (everRegularlyUsed, currentUseFrequency, status, frequency) => {
    expect(
      mapTobaccoBaselineStatus({
        everRegularlyUsed,
        currentUseFrequency,
        formerUseApproximateStopDate: '',
        productTypes: [],
        otherProductDescription: ''
      })
    ).toEqual({ status, currentUseFrequency: frequency })
  })

  it('uses the active baseline for editing and the exact referenced baseline for interpretation', () => {
    const workspace = workspaceWithDraft()
    const referenced = {
      id: 'abababab-abab-4bab-8bab-abababababab',
      version: 1,
      status: 'FORMER' as const,
      everRegularlyUsed: 'YES' as const,
      formerUseApproximateStopDate: '2024' as const,
      currentUseFrequency: 'NOT_AT_ALL' as const,
      productTypes: ['CIGARETTE' as const],
      otherProductDescription: null,
      updatedAt: timestamp
    }
    const active = {
      ...referenced,
      id: tobaccoBaselineId,
      version: 2,
      status: 'CURRENT_DAILY' as const,
      currentUseFrequency: 'EVERY_DAY' as const,
      formerUseApproximateStopDate: null
    }
    const distinct = {
      ...workspace,
      draft: { ...workspace.draft!, tobaccoBaselineVersionId: referenced.id },
      activeTobaccoBaseline: active,
      referencedTobaccoBaseline: referenced
    }
    expect(getTobaccoBaselineForEditableForm(distinct)).toBe(active)
    expect(getTobaccoBaselineForInterpretation(distinct)).toBe(referenced)
    expect(
      getTobaccoCardSummary(
        {
          ...createLifestyleDraftStateFromWorkspace(distinct),
          tobacco: { id: null, weeklyResponse: 'YES', products: [] }
        },
        true
      )
    ).toContain('Former')
  })

  it('clears hidden products when leaving Yes and preserves stable row fields', () => {
    const form: TobaccoWeeklyForm = {
      id: '12121212-1212-4121-8121-121212121212',
      weeklyResponse: 'YES',
      products: [
        {
          clientKey: 'existing',
          id: '13131313-1313-4131-8131-131313131313',
          sequenceNumber: 1,
          productType: 'VAPE',
          daysUsed: '2',
          averageQuantityPerUseDay: '1',
          unit: 'SESSIONS',
          secondhandSmokeExposure: true,
          otherProductDescription: '',
          otherUnitDescription: ''
        }
      ]
    }
    expect(updateTobaccoResponse(form, 'NO')).toEqual({
      ...form,
      weeklyResponse: 'NO',
      products: []
    })
    expect(validateTobaccoWeeklyDraft({ ...form, products: [] })).toEqual([])
  })

  it('validates approximate stop dates and baseline Other descriptions', () => {
    const base: TobaccoBaselineForm = {
      everRegularlyUsed: 'YES',
      currentUseFrequency: 'NOT_AT_ALL',
      formerUseApproximateStopDate: '2024-13',
      productTypes: ['OTHER'],
      otherProductDescription: ''
    }
    expect(validateTobaccoBaseline(base).map((error) => error.fieldId)).toEqual(
      expect.arrayContaining(['tobacco-baseline-stop-date', 'tobacco-baseline-other-product'])
    )
    expect(
      validateTobaccoBaseline({
        ...base,
        formerUseApproximateStopDate: '2024-02',
        otherProductDescription: 'Smokeless product'
      })
    ).toEqual([])
    expect(
      validateTobaccoBaseline({
        ...base,
        formerUseApproximateStopDate: '2024-02',
        productTypes: ['VAPE'],
        otherProductDescription: 'hidden'
      }).map((error) => error.fieldId)
    ).toContain('tobacco-baseline-other-product')
  })

  it('rejects duplicate product types and invalid rows while allowing incomplete Yes', () => {
    expect(validateTobaccoWeeklyDraft({ id: null, weeklyResponse: 'YES', products: [] })).toEqual(
      []
    )
    const product = {
      clientKey: 'one',
      id: null,
      sequenceNumber: 1,
      productType: 'VAPE' as const,
      daysUsed: '2',
      averageQuantityPerUseDay: '1',
      unit: 'SESSIONS' as const,
      secondhandSmokeExposure: null,
      otherProductDescription: '',
      otherUnitDescription: ''
    }
    const errors = validateTobaccoWeeklyDraft({
      id: null,
      weeklyResponse: 'YES',
      products: [product, { ...product, clientKey: 'two', sequenceNumber: 2 }]
    })
    expect(errors.map((error) => error.fieldId)).toContain('tobacco-product-one-type')
    expect(
      validateTobaccoWeeklyDraft({ id: null, weeklyResponse: 'NO', products: [product] })
    ).toEqual([{ fieldId: 'tobacco-weekly-response', message: 'Clear the hidden product rows.' }])
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

function workspaceWithAllReferencedBaselines(): ScreeningLifestyleWorkspace {
  const workspace = tobaccoWorkspaceWithStatus('CURRENT_DAILY', 'YES')
  const workBaseline = {
    id: workBaselineId,
    version: 2,
    status: 'EMPLOYED' as const,
    occupationJobTitle: 'Farmer',
    usualPhysicalDemand: 'MODERATE_LABOR' as const,
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY' as const,
    description: null,
    updatedAt: timestamp
  }
  return {
    ...workspace,
    draft: {
      ...workspace.draft!,
      workBaselineVersionId: workBaseline.id,
      physicalActivity: {
        ...workspace.draft!.physicalActivity!,
        activities: [
          {
            id: '17171717-1717-4171-8171-171717171717',
            sequenceNumber: 1,
            activityDomain: 'EXERCISE',
            description: null,
            intensity: 'LIGHT',
            daysInPastSevenDays: 2,
            averageMinutesPerActiveDay: 30,
            weeklyMinutes: 60,
            updatedAt: timestamp
          }
        ]
      }
    },
    activeWorkBaseline: workBaseline,
    referencedWorkBaseline: workBaseline
  }
}

function unsavedStateForBaselineMerge(
  workspace: ScreeningLifestyleWorkspace
): ReturnType<typeof createLifestyleDraftStateFromWorkspace> {
  const state = createLifestyleDraftStateFromWorkspace(workspace)
  return {
    ...state,
    alcoholExpanded: false,
    baselineOpen: true,
    baselineForm: { ...state.baselineForm, everConsumed: 'DECLINED', commonBeverageTypes: [] },
    alcohol: {
      ...state.alcohol,
      drinkingDays: '6',
      totalStandardizedDrinks: '7',
      largestOneDayAmount: '4'
    },
    tobaccoExpanded: true,
    tobaccoBaselineOpen: true,
    tobaccoBaselineForm: {
      ...state.tobaccoBaselineForm,
      everRegularlyUsed: 'DECLINED',
      productTypes: []
    },
    tobacco: {
      ...state.tobacco,
      products: [
        {
          clientKey: 'local-tobacco-row',
          id: null,
          sequenceNumber: 2,
          productType: 'VAPE',
          daysUsed: '3',
          averageQuantityPerUseDay: '2',
          unit: 'SESSIONS',
          secondhandSmokeExposure: true,
          otherProductDescription: '',
          otherUnitDescription: ''
        }
      ]
    },
    physicalActivityExpanded: true,
    physicalActivity: {
      ...state.physicalActivity,
      sedentaryMinutesPerDay: '120',
      activities: [
        {
          clientKey: 'local-physical-row',
          id: null,
          sequenceNumber: 2,
          activityDomain: 'HOUSEHOLD',
          description: '',
          intensity: 'VIGOROUS',
          daysInPastSevenDays: '4',
          averageHoursPerActiveDay: '1',
          averageMinutesPerActiveDay: '15'
        }
      ]
    },
    workExpanded: true,
    workBaselineOpen: true,
    workBaselineForm: { ...state.workBaselineForm, occupationJobTitle: 'Unsaved role' },
    work: { ...state.work, weeklyResponse: 'NO_WORK' },
    otherActivityExpanded: true,
    otherActivity: {
      weeklyResponse: 'YES',
      activities: [
        {
          clientKey: 'local-other-row',
          id: null,
          sequenceNumber: 2,
          category: 'COMMUNITY',
          description: '',
          daysInPastSevenDays: '5',
          averageHoursPerDay: '0',
          averageMinutesPerDay: '45',
          intensity: 'MODERATE'
        }
      ]
    },
    alcoholBaselineReviewConfirmedVersionId: alcoholBaselineId,
    tobaccoBaselineReviewConfirmedVersionId: tobaccoBaselineId,
    validationFocusRequestToken: `${encounterId}:7`,
    dirty: true
  }
}

function authoritativeBaselineWorkspace(
  workspace: ScreeningLifestyleWorkspace,
  domain: 'ALCOHOL' | 'TOBACCO' | 'WORK'
): ScreeningLifestyleWorkspace {
  const savedAlcoholBaseline = {
    ...workspace.activeAlcoholBaseline!,
    id: 'abababab-abab-4bab-8bab-abababababab',
    version: 3,
    status: 'NEVER' as const,
    everConsumed: 'NO' as const,
    consumedPast12Months: 'NO' as const,
    commonBeverageTypes: [],
    updatedAt: '2026-08-06T09:00:00.000Z'
  }
  const savedTobaccoBaseline = {
    ...workspace.activeTobaccoBaseline!,
    id: 'edededed-eded-4ded-8ded-edededededed',
    version: 3,
    status: 'NEVER' as const,
    everRegularlyUsed: 'NO' as const,
    currentUseFrequency: 'NOT_AT_ALL' as const,
    productTypes: [],
    updatedAt: '2026-08-06T09:00:00.000Z'
  }
  const savedWorkBaseline = {
    ...workspace.activeWorkBaseline!,
    id: 'dadadada-dada-4ada-8ada-dadadadadada',
    version: 3,
    occupationJobTitle: 'Saved role',
    updatedAt: '2026-08-06T09:00:00.000Z'
  }

  if (domain === 'ALCOHOL') {
    return {
      ...workspace,
      draft: { ...workspace.draft!, alcoholBaselineVersionId: savedAlcoholBaseline.id },
      activeAlcoholBaseline: savedAlcoholBaseline,
      referencedAlcoholBaseline: savedAlcoholBaseline
    }
  }
  if (domain === 'TOBACCO') {
    return {
      ...workspace,
      draft: { ...workspace.draft!, tobaccoBaselineVersionId: savedTobaccoBaseline.id },
      activeTobaccoBaseline: savedTobaccoBaseline,
      referencedTobaccoBaseline: savedTobaccoBaseline
    }
  }
  return {
    ...workspace,
    draft: { ...workspace.draft!, workBaselineVersionId: savedWorkBaseline.id },
    activeWorkBaseline: savedWorkBaseline,
    referencedWorkBaseline: savedWorkBaseline
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
      otherActivityResponse: 'YES',
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
        sedentaryTimeResponse: 'RECORDED',
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

function tobaccoWorkspaceWithStatus(
  status: 'CURRENT_DAILY' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED',
  response: 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
): ScreeningLifestyleWorkspace {
  const workspace = workspaceWithDraft()
  const baseline = {
    id: tobaccoBaselineId,
    version: 2,
    status,
    everRegularlyUsed: status === 'NEVER' ? ('NO' as const) : ('YES' as const),
    formerUseApproximateStopDate: status === 'FORMER' ? '2024' : null,
    currentUseFrequency:
      status === 'CURRENT_DAILY'
        ? ('EVERY_DAY' as const)
        : status === 'FORMER' || status === 'NEVER'
          ? ('NOT_AT_ALL' as const)
          : status === 'DECLINED'
            ? ('DECLINED' as const)
            : ('UNKNOWN' as const),
    productTypes: ['CIGARETTE' as const],
    otherProductDescription: null,
    updatedAt: timestamp
  }
  return {
    ...workspace,
    draft: {
      ...workspace.draft!,
      tobaccoBaselineVersionId: baseline.id,
      tobacco: {
        ...workspace.draft!.tobacco!,
        weeklyResponse: response === '' ? null : response,
        products: []
      }
    },
    activeTobaccoBaseline: baseline,
    referencedTobaccoBaseline: baseline
  }
}
