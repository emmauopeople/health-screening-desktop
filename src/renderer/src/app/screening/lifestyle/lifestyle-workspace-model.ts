import type {
  ScreeningLifestyleSaveAlcoholBaselineRequest,
  ScreeningLifestyleCompleteRequest,
  ScreeningLifestyleSaveDraftRequest,
  ScreeningLifestyleWorkspace
} from '@shared/ipc'
import { compareLifestyleDecimalQuantities } from '@shared/lifestyle-alcohol-quantity'

import {
  createInitialTobaccoBaselineForm,
  createInitialTobaccoWeeklyForm,
  getTobaccoBaselineForEditableForm,
  getTobaccoBaselineForInterpretation,
  tobaccoBaselineToForm,
  tobaccoToRequest,
  tobaccoWeeklyToForm,
  validateTobaccoCompletionReadiness,
  validateTobaccoWeeklyDraft,
  type TobaccoBaselineForm,
  type TobaccoFieldError,
  type TobaccoWeeklyForm
} from './tobacco-workspace-model'
import {
  createInitialOtherActivityForm,
  createInitialPhysicalActivityForm,
  createInitialWorkBaselineForm,
  createInitialWorkWeeklyForm,
  otherActivityToForm,
  physicalActivityToForm,
  workBaselineToForm,
  workWeeklyToForm,
  otherActivityToRequest,
  physicalActivityToRequest,
  validateCompleteOtherActivity,
  validateCompletePhysicalActivity,
  validateOtherActivity,
  validatePhysicalActivity,
  validateWorkCompletionReadiness,
  workWeeklyToRequest,
  type ActivityFieldError,
  type OtherActivityForm,
  type PhysicalActivityForm,
  type WorkBaselineForm,
  type WorkWeeklyForm
} from './activity-workspace-model'

export * from './activity-workspace-model'

export {
  createInitialTobaccoBaselineForm,
  createInitialTobaccoWeeklyForm,
  createEmptyTobaccoProductForm,
  createTobaccoBaselineRequest,
  getTobaccoBaselineForEditableForm,
  getTobaccoBaselineForInterpretation,
  getTobaccoCardStatus,
  getTobaccoCardSummary,
  mapTobaccoBaselineStatus,
  tobaccoBaselineToForm,
  tobaccoToRequest,
  tobaccoWeeklyToForm,
  validateTobaccoBaseline,
  validateTobaccoCompletionReadiness,
  validateCompleteTobaccoWeekly,
  validateTobaccoWeeklyDraft,
  tobaccoFrequencyOptions,
  tobaccoProductOptions,
  tobaccoUnitOptions,
  tobaccoWeeklyOptions,
  toggleTobaccoBaselineProduct,
  type TobaccoBaselineForm,
  type TobaccoCardStatus,
  type TobaccoFieldError,
  type TobaccoProductForm,
  type TobaccoWeeklyForm
} from './tobacco-workspace-model'

export type AlcoholEverResponse = 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | ''
export type AlcoholWeeklyResponse =
  'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
export type LifestyleLoadStatus = 'NOT_LOADED' | 'LOADING' | 'READY' | 'ERROR'
export type LifestyleSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
export type AlcoholFieldError = { readonly fieldId: string; readonly message: string }
export type LifestyleBaselineSaveDomain = 'ALCOHOL' | 'TOBACCO' | 'WORK'
export type AlcoholCardStatus =
  'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BASELINE_REVIEW' | 'VALIDATION_ERROR' | 'LOCKED'

export interface LifestyleCompletionReadiness {
  readonly validationErrors: readonly AlcoholFieldError[]
  readonly tobaccoValidationErrors: readonly TobaccoFieldError[]
  readonly physicalActivityValidationErrors: readonly ActivityFieldError[]
  readonly workValidationErrors: readonly ActivityFieldError[]
  readonly otherActivityValidationErrors: readonly ActivityFieldError[]
}

export interface AlcoholBaselineForm {
  readonly everConsumed: AlcoholEverResponse
  readonly consumedPast12Months: AlcoholEverResponse
  readonly commonBeverageTypes: readonly AlcoholBeverageCode[]
  readonly otherBeverageDescription: string
}

export type AlcoholBeverageCode =
  'BEER' | 'WINE' | 'SPIRITS' | 'COCKTAILS' | 'FORTIFIED_WINE' | 'OTHER'

export interface AlcoholWeeklyForm {
  readonly id: string | null
  readonly weeklyResponse: AlcoholWeeklyResponse
  readonly drinkingDays: string
  readonly totalStandardizedDrinks: string
  readonly largestOneDayAmount: string
  readonly daysAtLargestAmount: string
  readonly commonBeverageTypes: readonly AlcoholBeverageCode[]
  readonly otherBeverageDescription: string
}

export interface LifestyleDraftState {
  readonly loadStatus: LifestyleLoadStatus
  readonly saveStatus: LifestyleSaveStatus
  readonly statusMessage: string | null
  readonly workspace: ScreeningLifestyleWorkspace | null
  readonly alcoholExpanded: boolean
  readonly baselineOpen: boolean
  readonly baselineForm: AlcoholBaselineForm
  readonly alcohol: AlcoholWeeklyForm
  readonly validationErrors: readonly AlcoholFieldError[]
  readonly tobaccoExpanded: boolean
  readonly tobaccoBaselineOpen: boolean
  readonly tobaccoBaselineForm: TobaccoBaselineForm
  readonly tobacco: TobaccoWeeklyForm
  readonly tobaccoValidationErrors: readonly TobaccoFieldError[]
  readonly physicalActivityExpanded: boolean
  readonly physicalActivity: PhysicalActivityForm
  readonly physicalActivityValidationErrors: readonly ActivityFieldError[]
  readonly workExpanded: boolean
  readonly workBaselineOpen: boolean
  readonly workBaselineForm: WorkBaselineForm
  readonly work: WorkWeeklyForm
  readonly workValidationErrors: readonly ActivityFieldError[]
  readonly otherActivityExpanded: boolean
  readonly otherActivity: OtherActivityForm
  readonly otherActivityValidationErrors: readonly ActivityFieldError[]
  readonly alcoholBaselineReviewConfirmedVersionId: string | null
  readonly tobaccoBaselineReviewConfirmedVersionId: string | null
  readonly validationFocusRequestToken: string | null
  readonly dirty: boolean
}

export type LifestyleExpandedCard =
  'ALCOHOL' | 'TOBACCO' | 'PHYSICAL_ACTIVITY' | 'WORK' | 'OTHER_ACTIVITY'

export const alcoholBeverageOptions: readonly {
  readonly value: AlcoholBeverageCode
  readonly label: string
}[] = Object.freeze([
  { value: 'BEER', label: 'Beer' },
  { value: 'WINE', label: 'Wine' },
  { value: 'SPIRITS', label: 'Spirits' },
  { value: 'COCKTAILS', label: 'Cocktails' },
  { value: 'FORTIFIED_WINE', label: 'Fortified wine' },
  { value: 'OTHER', label: 'Other' }
])

export const alcoholWeeklyOptions: readonly {
  readonly value: Exclude<AlcoholWeeklyResponse, ''>
  readonly label: string
}[] = Object.freeze([
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
])

export function createInitialLifestyleDraftState(): LifestyleDraftState {
  return {
    loadStatus: 'NOT_LOADED',
    saveStatus: 'IDLE',
    statusMessage: null,
    workspace: null,
    alcoholExpanded: true,
    baselineOpen: false,
    baselineForm: emptyAlcoholBaselineForm(),
    alcohol: emptyAlcoholWeeklyForm(),
    validationErrors: [],
    tobaccoExpanded: false,
    tobaccoBaselineOpen: false,
    tobaccoBaselineForm: createInitialTobaccoBaselineForm(),
    tobacco: createInitialTobaccoWeeklyForm(),
    tobaccoValidationErrors: [],
    physicalActivityExpanded: false,
    physicalActivity: createInitialPhysicalActivityForm(),
    physicalActivityValidationErrors: [],
    workExpanded: false,
    workBaselineOpen: false,
    workBaselineForm: createInitialWorkBaselineForm(),
    work: createInitialWorkWeeklyForm(),
    workValidationErrors: [],
    otherActivityExpanded: false,
    otherActivity: createInitialOtherActivityForm(),
    otherActivityValidationErrors: [],
    alcoholBaselineReviewConfirmedVersionId: null,
    tobaccoBaselineReviewConfirmedVersionId: null,
    validationFocusRequestToken: null,
    dirty: false
  }
}

export function createLifestyleDraftStateFromWorkspace(
  workspace: ScreeningLifestyleWorkspace,
  options: Partial<Pick<LifestyleDraftState, 'saveStatus' | 'statusMessage'>> = {}
): LifestyleDraftState {
  const baseline = getAlcoholBaselineForEditableForm(workspace)
  const tobaccoBaseline = getTobaccoBaselineForEditableForm(workspace)
  const workBaseline = workspace.activeWorkBaseline ?? workspace.referencedWorkBaseline
  return {
    loadStatus: 'READY',
    saveStatus: options.saveStatus ?? 'IDLE',
    statusMessage: options.statusMessage ?? null,
    workspace,
    alcoholExpanded: true,
    baselineOpen: false,
    baselineForm: baseline ? baselineToForm(baseline) : emptyAlcoholBaselineForm(),
    alcohol: workspace.draft?.alcohol
      ? alcoholWeeklyToForm(workspace.draft.alcohol)
      : emptyAlcoholWeeklyForm(),
    validationErrors: [],
    tobaccoExpanded: false,
    tobaccoBaselineOpen: false,
    tobaccoBaselineForm: tobaccoBaseline
      ? tobaccoBaselineToForm(tobaccoBaseline)
      : createInitialTobaccoBaselineForm(),
    tobacco: workspace.draft?.tobacco
      ? tobaccoWeeklyToForm(workspace.draft.tobacco)
      : createInitialTobaccoWeeklyForm(),
    tobaccoValidationErrors: [],
    physicalActivityExpanded: false,
    physicalActivity: workspace.draft?.physicalActivity
      ? physicalActivityToForm(workspace.draft.physicalActivity)
      : createInitialPhysicalActivityForm(),
    physicalActivityValidationErrors: [],
    workExpanded: false,
    workBaselineOpen: false,
    workBaselineForm: workBaseline
      ? workBaselineToForm(workBaseline)
      : createInitialWorkBaselineForm(),
    work: workspace.draft?.work
      ? workWeeklyToForm(workspace.draft.work)
      : createInitialWorkWeeklyForm(),
    workValidationErrors: [],
    otherActivityExpanded: false,
    otherActivity: otherActivityToForm(workspace),
    otherActivityValidationErrors: [],
    alcoholBaselineReviewConfirmedVersionId: null,
    tobaccoBaselineReviewConfirmedVersionId: null,
    validationFocusRequestToken: null,
    dirty: false
  }
}

/**
 * Close every Lifestyle card and nested panel after a successful persistence
 * operation. Form values are intentionally left untouched by this transition.
 */
export function collapseLifestylePanels(state: LifestyleDraftState): LifestyleDraftState {
  return {
    ...state,
    alcoholExpanded: false,
    baselineOpen: false,
    tobaccoExpanded: false,
    tobaccoBaselineOpen: false,
    physicalActivityExpanded: false,
    workExpanded: false,
    workBaselineOpen: false,
    otherActivityExpanded: false
  }
}

export function mergeLifestyleBaselineSaveWorkspace(
  current: LifestyleDraftState,
  workspace: ScreeningLifestyleWorkspace,
  domain: LifestyleBaselineSaveDomain,
  statusMessage: string
): LifestyleDraftState {
  const authoritative = createLifestyleDraftStateFromWorkspace(workspace, {
    saveStatus: 'SAVED',
    statusMessage
  })
  const alcoholBaselineId = getAlcoholBaselineForInterpretation(workspace)?.id ?? null
  const tobaccoBaselineId = getTobaccoBaselineForInterpretation(workspace)?.id ?? null

  return {
    ...authoritative,
    alcoholExpanded: domain === 'ALCOHOL' ? true : current.alcoholExpanded,
    baselineOpen: domain === 'ALCOHOL' ? false : current.baselineOpen,
    baselineForm: domain === 'ALCOHOL' ? authoritative.baselineForm : current.baselineForm,
    alcohol: current.alcohol,
    validationErrors: validateAlcoholWeeklyDraft(current.alcohol),
    tobaccoExpanded: domain === 'TOBACCO' ? true : current.tobaccoExpanded,
    tobaccoBaselineOpen: domain === 'TOBACCO' ? false : current.tobaccoBaselineOpen,
    tobaccoBaselineForm:
      domain === 'TOBACCO' ? authoritative.tobaccoBaselineForm : current.tobaccoBaselineForm,
    tobacco: current.tobacco,
    tobaccoValidationErrors: validateTobaccoWeeklyDraft(current.tobacco),
    physicalActivityExpanded: current.physicalActivityExpanded,
    physicalActivity: current.physicalActivity,
    physicalActivityValidationErrors: validatePhysicalActivity(current.physicalActivity),
    workExpanded: domain === 'WORK' ? true : current.workExpanded,
    workBaselineOpen: domain === 'WORK' ? false : current.workBaselineOpen,
    workBaselineForm: domain === 'WORK' ? authoritative.workBaselineForm : current.workBaselineForm,
    work: current.work,
    workValidationErrors: domain === 'WORK' ? [] : current.workValidationErrors,
    otherActivityExpanded: current.otherActivityExpanded,
    otherActivity: current.otherActivity,
    otherActivityValidationErrors: validateOtherActivity(current.otherActivity),
    alcoholBaselineReviewConfirmedVersionId:
      current.alcoholBaselineReviewConfirmedVersionId === alcoholBaselineId
        ? current.alcoholBaselineReviewConfirmedVersionId
        : null,
    tobaccoBaselineReviewConfirmedVersionId:
      current.tobaccoBaselineReviewConfirmedVersionId === tobaccoBaselineId
        ? current.tobaccoBaselineReviewConfirmedVersionId
        : null,
    validationFocusRequestToken: null,
    dirty: current.dirty
  }
}

/**
 * Keep the two implemented cards mutually exclusive while preserving their
 * local clinical form values. Closing a card also closes its nested panel.
 */
export function toggleLifestyleCard(
  state: LifestyleDraftState,
  card: LifestyleExpandedCard
): LifestyleDraftState {
  if (card === 'ALCOHOL') {
    const alcoholExpanded = !state.alcoholExpanded
    return {
      ...state,
      alcoholExpanded,
      baselineOpen: alcoholExpanded ? state.baselineOpen : false,
      tobaccoExpanded: false,
      tobaccoBaselineOpen: false,
      physicalActivityExpanded: false,
      workExpanded: false,
      workBaselineOpen: false,
      otherActivityExpanded: false
    }
  }

  const expanded =
    card === 'TOBACCO'
      ? state.tobaccoExpanded
      : card === 'PHYSICAL_ACTIVITY'
        ? state.physicalActivityExpanded
        : card === 'WORK'
          ? state.workExpanded
          : state.otherActivityExpanded
  const nextExpanded = !expanded
  return {
    ...state,
    tobaccoExpanded: card === 'TOBACCO' ? nextExpanded : false,
    tobaccoBaselineOpen: false,
    alcoholExpanded: false,
    baselineOpen: false,
    physicalActivityExpanded: card === 'PHYSICAL_ACTIVITY' ? nextExpanded : false,
    workExpanded: card === 'WORK' ? nextExpanded : false,
    workBaselineOpen: card === 'WORK' && nextExpanded ? state.workBaselineOpen : false,
    otherActivityExpanded: card === 'OTHER_ACTIVITY' ? nextExpanded : false
  }
}

export function updateAlcoholResponse(
  alcohol: AlcoholWeeklyForm,
  weeklyResponse: AlcoholWeeklyResponse
): AlcoholWeeklyForm {
  if (weeklyResponse === 'YES' || weeklyResponse === '') {
    return { ...alcohol, weeklyResponse }
  }

  return {
    ...alcohol,
    weeklyResponse,
    drinkingDays: '',
    totalStandardizedDrinks: '',
    largestOneDayAmount: '',
    daysAtLargestAmount: '',
    commonBeverageTypes: [],
    otherBeverageDescription: ''
  }
}

export function toggleBeverage(
  selected: readonly AlcoholBeverageCode[],
  code: AlcoholBeverageCode
): readonly AlcoholBeverageCode[] {
  return selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]
}

export function mapAlcoholBaselineStatus(form: AlcoholBaselineForm): {
  readonly status: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly consumedPast12Months: Exclude<AlcoholEverResponse, ''>
} | null {
  if (form.everConsumed === '') return null
  if (form.everConsumed === 'NO') return { status: 'NEVER', consumedPast12Months: 'NO' }
  if (form.everConsumed === 'DECLINED') {
    return { status: 'DECLINED', consumedPast12Months: 'DECLINED' }
  }
  if (form.consumedPast12Months === 'YES') {
    return { status: 'CURRENT', consumedPast12Months: 'YES' }
  }
  if (form.everConsumed === 'YES' && form.consumedPast12Months === 'NO') {
    return { status: 'FORMER', consumedPast12Months: 'NO' }
  }
  if (form.consumedPast12Months === 'DECLINED') {
    return { status: 'DECLINED', consumedPast12Months: 'DECLINED' }
  }
  if (form.consumedPast12Months === 'NO') {
    return { status: 'UNKNOWN', consumedPast12Months: 'NO' }
  }
  return { status: 'UNKNOWN', consumedPast12Months: 'UNKNOWN' }
}

export function validateAlcoholBaseline(form: AlcoholBaselineForm): readonly AlcoholFieldError[] {
  const errors: AlcoholFieldError[] = []
  if (form.everConsumed === '')
    errors.push({ fieldId: 'baselineEverConsumed', message: 'Select an answer.' })
  if (
    (form.everConsumed === 'YES' || form.everConsumed === 'UNKNOWN') &&
    form.consumedPast12Months === ''
  ) {
    errors.push({ fieldId: 'baselineConsumedPast12Months', message: 'Select an answer.' })
  }
  if (
    (form.everConsumed === 'NO' || form.everConsumed === 'DECLINED') &&
    form.consumedPast12Months !== ''
  ) {
    errors.push({
      fieldId: 'baselineConsumedPast12Months',
      message: 'This answer is not applicable to the selected response.'
    })
  }
  if (!form.commonBeverageTypes.includes('OTHER') && form.otherBeverageDescription.trim() !== '') {
    errors.push({
      fieldId: 'baselineOtherBeverageDescription',
      message: 'Select Other before entering a description.'
    })
  }
  if (
    !isBaselineBeverageApplicable(form) &&
    (form.commonBeverageTypes.length > 0 || form.otherBeverageDescription.trim() !== '')
  ) {
    errors.push({
      fieldId: 'baselineCommonBeverageTypes',
      message: 'Beverage types are not applicable to this response.'
    })
  }
  if (form.commonBeverageTypes.includes('OTHER') && form.otherBeverageDescription.trim() === '') {
    errors.push({
      fieldId: 'baselineOtherBeverageDescription',
      message: 'Enter an Other beverage description.'
    })
  }
  if (form.commonBeverageTypes.includes('OTHER') && form.otherBeverageDescription.length > 500) {
    errors.push({
      fieldId: 'baselineOtherBeverageDescription',
      message: 'Use 500 characters or fewer.'
    })
  }
  return errors
}

export function validateAlcoholWeeklyDraft(form: AlcoholWeeklyForm): readonly AlcoholFieldError[] {
  const errors: AlcoholFieldError[] = []
  if (form.weeklyResponse !== 'YES') {
    if (hasAlcoholDetails(form)) {
      errors.push({ fieldId: 'weeklyResponse', message: 'Clear the hidden alcohol details.' })
    }
    return errors
  }

  const drinkingDays = parseOptionalInteger(form.drinkingDays)
  const total = parseOptionalPositive(form.totalStandardizedDrinks)
  const largest = parseOptionalPositive(form.largestOneDayAmount)
  const daysAtLargest = parseOptionalInteger(form.daysAtLargestAmount)

  validateOptionalInteger(
    drinkingDays,
    form.drinkingDays,
    'drinkingDays',
    'On how many of the past 7 days did you drink alcohol?',
    1,
    7,
    errors
  )
  validateOptionalPositive(
    total,
    form.totalStandardizedDrinks,
    'totalStandardizedDrinks',
    'How many drinks did you have in total during the past 7 days?',
    errors
  )
  validateOptionalPositive(
    largest,
    form.largestOneDayAmount,
    'largestOneDayAmount',
    'What was the highest number of drinks you had on any one day?',
    errors
  )
  validateOptionalInteger(
    daysAtLargest,
    form.daysAtLargestAmount,
    'daysAtLargestAmount',
    'On how many days did you have that highest number?',
    1,
    7,
    errors
  )
  if (largest !== null && total !== null && largest > total) {
    errors.push({
      fieldId: 'largestOneDayAmount',
      message: 'The highest number of drinks cannot exceed the total number of drinks.'
    })
  }
  if (daysAtLargest !== null && drinkingDays !== null && daysAtLargest > drinkingDays) {
    errors.push({
      fieldId: 'daysAtLargestAmount',
      message: 'The number of days at the highest amount cannot exceed the drinking days entered.'
    })
  }
  if (total !== null && largest !== null && daysAtLargest !== null) {
    const highestAmountSubtotal = largest * daysAtLargest
    const subtotalComparison = compareLifestyleDecimalQuantities(total, highestAmountSubtotal)
    const totalIsTooLow = subtotalComparison < 0
    const sameNumberOfDaysRequiresExactTotal =
      drinkingDays !== null && drinkingDays === daysAtLargest && subtotalComparison !== 0
    const additionalDaysRequireAdditionalDrinks =
      drinkingDays !== null && drinkingDays > daysAtLargest && subtotalComparison <= 0
    if (
      totalIsTooLow ||
      sameNumberOfDaysRequiresExactTotal ||
      additionalDaysRequireAdditionalDrinks
    ) {
      errors.push({
        fieldId: 'totalStandardizedDrinks',
        message:
          'The total number of drinks is too low for the highest amount and number of days entered.'
      })
    }
  }
  if (!form.commonBeverageTypes.includes('OTHER') && form.otherBeverageDescription.trim() !== '') {
    errors.push({
      fieldId: 'weeklyOtherBeverageDescription',
      message: 'Select Other before entering a description.'
    })
  }
  if (form.otherBeverageDescription.length > 500) {
    errors.push({
      fieldId: 'weeklyOtherBeverageDescription',
      message: 'Use 500 characters or fewer.'
    })
  }
  return errors
}

export function isAlcoholComplete(form: AlcoholWeeklyForm): boolean {
  return validateCompleteAlcoholWeekly(form).length === 0
}

export function validateCompleteAlcoholWeekly(
  form: AlcoholWeeklyForm
): readonly AlcoholFieldError[] {
  const errors = [...validateAlcoholWeeklyDraft(form)]
  if (form.weeklyResponse === '') {
    errors.push({ fieldId: 'weeklyResponse', message: 'Select a weekly alcohol response.' })
    return errors
  }
  if (form.weeklyResponse === 'YES') {
    const required: readonly [keyof AlcoholWeeklyForm, string, string][] = [
      ['drinkingDays', 'drinkingDays', 'Enter drinking days to complete this answer.'],
      [
        'totalStandardizedDrinks',
        'totalStandardizedDrinks',
        'Enter total drinks to complete this answer.'
      ],
      [
        'largestOneDayAmount',
        'largestOneDayAmount',
        'Enter the highest daily amount to complete this answer.'
      ],
      [
        'daysAtLargestAmount',
        'daysAtLargestAmount',
        'Enter days at the highest amount to complete this answer.'
      ]
    ]
    for (const [property, fieldId, message] of required) {
      if (form[property] === '') errors.push({ fieldId, message })
    }
    if (form.commonBeverageTypes.includes('OTHER') && form.otherBeverageDescription.trim() === '') {
      errors.push({
        fieldId: 'weeklyOtherBeverageDescription',
        message: 'Enter an Other beverage description to complete this answer.'
      })
    }
  }
  return errors
}

export function validateAlcoholCompletionReadiness(
  state: LifestyleDraftState
): readonly AlcoholFieldError[] {
  const errors: AlcoholFieldError[] = []
  const baseline = state.workspace ? getAlcoholBaselineForInterpretation(state.workspace) : null
  const hasReferencedBaseline =
    state.workspace?.draft?.alcoholBaselineVersionId !== null &&
    state.workspace?.draft?.alcoholBaselineVersionId !== undefined &&
    baseline !== null &&
    baseline !== undefined
  if (!hasReferencedBaseline) {
    errors.push({
      fieldId: 'alcohol-baseline-reference',
      message: 'Save an Alcohol baseline to complete Lifestyle.'
    })
  }
  errors.push(...validateCompleteAlcoholWeekly(state.alcohol))
  if (
    hasBaselineReviewConflict(baseline?.status, state.alcohol.weeklyResponse) &&
    state.alcoholBaselineReviewConfirmedVersionId !== baseline?.id
  ) {
    errors.push({
      fieldId: 'alcohol-baseline-review-confirmation',
      message: 'Confirm the referenced Alcohol baseline review.'
    })
  }
  return errors
}

export function validateLifestyleCompletionReadiness(
  state: LifestyleDraftState
): LifestyleCompletionReadiness {
  return {
    validationErrors: validateAlcoholCompletionReadiness(state),
    tobaccoValidationErrors: validateTobaccoCompletionReadiness(state),
    physicalActivityValidationErrors: validateCompletePhysicalActivity(state.physicalActivity),
    workValidationErrors: validateWorkCompletionReadiness(state),
    otherActivityValidationErrors: validateCompleteOtherActivity(state.otherActivity)
  }
}

export function hasLifestyleCompletionReadinessErrors(
  readiness: LifestyleCompletionReadiness
): boolean {
  return (
    readiness.validationErrors.length > 0 ||
    readiness.tobaccoValidationErrors.length > 0 ||
    readiness.physicalActivityValidationErrors.length > 0 ||
    readiness.workValidationErrors.length > 0 ||
    readiness.otherActivityValidationErrors.length > 0
  )
}

export function getAlcoholCardStatus(
  state: LifestyleDraftState,
  editable: boolean
): AlcoholCardStatus {
  if (!editable) return state.workspace?.draft?.status === 'COMPLETE' ? 'COMPLETE' : 'LOCKED'
  if (state.loadStatus !== 'READY' || state.workspace === null) return 'NOT_STARTED'
  if (state.validationErrors.length > 0) return 'VALIDATION_ERROR'
  if (state.workspace.draft === null && state.workspace.activeAlcoholBaseline === null) {
    return 'NOT_STARTED'
  }
  const baseline = getAlcoholBaselineForInterpretation(state.workspace)
  const response = state.alcohol.weeklyResponse
  const hasReferencedBaseline =
    state.workspace.draft?.alcoholBaselineVersionId !== null &&
    state.workspace.draft?.alcoholBaselineVersionId !== undefined &&
    baseline !== null &&
    baseline !== undefined
  if (
    hasReferencedBaseline &&
    hasBaselineReviewConflict(baseline?.status, response) &&
    state.alcoholBaselineReviewConfirmedVersionId !== baseline?.id
  ) {
    return 'BASELINE_REVIEW'
  }
  if (validateAlcoholCompletionReadiness(state).length === 0) {
    return 'COMPLETE'
  }
  if (baseline !== null && baseline !== undefined) return 'IN_PROGRESS'
  return 'NOT_STARTED'
}

export function getAlcoholCardSummary(state: LifestyleDraftState, editable: boolean): string {
  const status = getAlcoholCardStatus(state, editable)
  if (status === 'LOCKED') return 'Locked'
  if (status === 'BASELINE_REVIEW') {
    const baseline =
      state.workspace === null ? null : getAlcoholBaselineForInterpretation(state.workspace)
    const baselineLabel =
      baseline?.status === 'FORMER'
        ? 'Former'
        : baseline?.status === 'NEVER'
          ? 'Never'
          : baseline?.status === 'CURRENT'
            ? 'Current'
            : baseline?.status === 'UNKNOWN'
              ? 'Unknown'
              : baseline?.status === 'DECLINED'
                ? 'Declined'
                : 'Review baseline'
    return `${baselineLabel} • Use reported • Review baseline`
  }
  if (status === 'COMPLETE') {
    if (state.alcohol.weeklyResponse === 'NO') {
      const baseline =
        state.workspace === null ? null : getAlcoholBaselineForInterpretation(state.workspace)
      return `${formatAlcoholBaselineStatus(baseline)} • No use this week`
    }
    return 'Alcohol complete'
  }
  if (status === 'IN_PROGRESS') return 'Alcohol draft in progress'
  if (state.workspace?.activeAlcoholBaseline === null) return 'Baseline required'
  return 'Not started'
}

export function getAlcoholBaselineForEditableForm(
  workspace: ScreeningLifestyleWorkspace
): ScreeningLifestyleWorkspace['activeAlcoholBaseline'] {
  return workspace.activeAlcoholBaseline ?? workspace.referencedAlcoholBaseline
}

export function getAlcoholBaselineForInterpretation(
  workspace: ScreeningLifestyleWorkspace
): ScreeningLifestyleWorkspace['activeAlcoholBaseline'] {
  return workspace.draft?.alcoholBaselineVersionId
    ? (workspace.referencedAlcoholBaseline ?? workspace.activeAlcoholBaseline)
    : workspace.activeAlcoholBaseline
}

function formatAlcoholBaselineStatus(
  baseline: ScreeningLifestyleWorkspace['activeAlcoholBaseline']
): string {
  return baseline?.status === 'FORMER'
    ? 'Former'
    : baseline?.status === 'NEVER'
      ? 'Never'
      : baseline?.status === 'CURRENT'
        ? 'Current'
        : baseline?.status === 'UNKNOWN'
          ? 'Unknown'
          : baseline?.status === 'DECLINED'
            ? 'Declined'
            : 'Unknown'
}

export function createAlcoholBaselineRequest(
  encounterId: string,
  state: LifestyleDraftState
): ScreeningLifestyleSaveAlcoholBaselineRequest | null {
  const mapping = mapAlcoholBaselineStatus(state.baselineForm)
  if (mapping === null) return null
  return {
    encounterId,
    expectedBaselineVersion: state.workspace?.activeAlcoholBaseline?.version ?? null,
    expectedDraftVersion: state.workspace?.draft?.rowVersion ?? null,
    status: mapping.status,
    everConsumed: state.baselineForm.everConsumed as Exclude<AlcoholEverResponse, ''>,
    consumedPast12Months: mapping.consumedPast12Months,
    commonBeverageTypes: [...state.baselineForm.commonBeverageTypes],
    otherBeverageDescription: state.baselineForm.commonBeverageTypes.includes('OTHER')
      ? nullableTrim(state.baselineForm.otherBeverageDescription)
      : null
  }
}

export function createAlcoholSaveDraftRequest(
  encounterId: string,
  state: LifestyleDraftState
): ScreeningLifestyleSaveDraftRequest {
  const draft = state.workspace?.draft
  return {
    encounterId,
    expectedVersion: draft?.rowVersion ?? null,
    alcohol: alcoholToRequest(state.alcohol),
    tobacco: shouldPersistTobacco(state) ? tobaccoToRequest(state.tobacco) : null,
    physicalActivity: shouldPersistPhysicalActivity(state)
      ? physicalActivityToRequest(state.physicalActivity)
      : null,
    work: shouldPersistWork(state) ? workWeeklyToRequest(state.work) : null,
    ...otherActivityToRequest(state.otherActivity)
  }
}

export function createLifestyleCompleteRequest(
  encounterId: string,
  state: LifestyleDraftState
): ScreeningLifestyleCompleteRequest {
  const alcoholBaseline = state.workspace
    ? getAlcoholBaselineForInterpretation(state.workspace)
    : null
  const tobaccoBaseline = state.workspace
    ? getTobaccoBaselineForInterpretation(state.workspace)
    : null
  return {
    ...createAlcoholSaveDraftRequest(encounterId, state),
    alcoholBaselineReviewConfirmedVersionId:
      hasBaselineReviewConflict(alcoholBaseline?.status, state.alcohol.weeklyResponse) &&
      state.alcoholBaselineReviewConfirmedVersionId === alcoholBaseline?.id
        ? state.alcoholBaselineReviewConfirmedVersionId
        : null,
    tobaccoBaselineReviewConfirmedVersionId:
      hasBaselineReviewConflict(tobaccoBaseline?.status, state.tobacco.weeklyResponse) &&
      state.tobaccoBaselineReviewConfirmedVersionId === tobaccoBaseline?.id
        ? state.tobaccoBaselineReviewConfirmedVersionId
        : null
  }
}

export function hasBaselineReviewConflict(
  baselineStatus: string | undefined,
  weeklyResponse: string
): boolean {
  return (baselineStatus === 'FORMER' || baselineStatus === 'NEVER') && weeklyResponse === 'YES'
}

function shouldPersistTobacco(state: LifestyleDraftState): boolean {
  return (
    (state.workspace?.draft?.tobacco !== null && state.workspace?.draft?.tobacco !== undefined) ||
    state.tobacco.weeklyResponse !== '' ||
    state.tobacco.products.length > 0
  )
}

function shouldPersistPhysicalActivity(state: LifestyleDraftState): boolean {
  return (
    (state.workspace?.draft?.physicalActivity !== null &&
      state.workspace?.draft?.physicalActivity !== undefined) ||
    state.physicalActivity.weeklyResponse !== '' ||
    state.physicalActivity.sedentaryTimeResponse !== '' ||
    state.physicalActivity.sedentaryMinutesPerDay !== '' ||
    state.physicalActivity.activities.length > 0
  )
}

function shouldPersistWork(state: LifestyleDraftState): boolean {
  return (
    (state.workspace?.draft?.work !== null && state.workspace?.draft?.work !== undefined) ||
    state.work.weeklyResponse !== ''
  )
}

function emptyAlcoholBaselineForm(): AlcoholBaselineForm {
  return {
    everConsumed: '',
    consumedPast12Months: '',
    commonBeverageTypes: [],
    otherBeverageDescription: ''
  }
}

function emptyAlcoholWeeklyForm(): AlcoholWeeklyForm {
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

function baselineToForm(
  baseline: NonNullable<ScreeningLifestyleWorkspace['activeAlcoholBaseline']>
): AlcoholBaselineForm {
  return {
    everConsumed: baseline.everConsumed,
    consumedPast12Months: baseline.consumedPast12Months,
    commonBeverageTypes: [...baseline.commonBeverageTypes],
    otherBeverageDescription: baseline.otherBeverageDescription ?? ''
  }
}

function alcoholWeeklyToForm(
  alcohol: NonNullable<NonNullable<ScreeningLifestyleWorkspace['draft']>['alcohol']>
): AlcoholWeeklyForm {
  return {
    id: alcohol.id,
    weeklyResponse: toAlcoholWeeklyResponse(alcohol.weeklyResponse),
    drinkingDays: numberToInput(alcohol.drinkingDays),
    totalStandardizedDrinks: numberToInput(alcohol.totalStandardizedDrinks),
    largestOneDayAmount: numberToInput(alcohol.largestOneDayAmount),
    daysAtLargestAmount: numberToInput(alcohol.daysAtLargestAmount),
    commonBeverageTypes: [...alcohol.commonBeverageTypes],
    otherBeverageDescription: alcohol.otherBeverageDescription ?? ''
  }
}

function toAlcoholWeeklyResponse(value: string | null): AlcoholWeeklyResponse {
  return value === 'YES' ||
    value === 'NO' ||
    value === 'UNKNOWN' ||
    value === 'DECLINED' ||
    value === 'PREFER_NOT_TO_ANSWER'
    ? value
    : ''
}

function alcoholToRequest(
  alcohol: AlcoholWeeklyForm
): ScreeningLifestyleSaveDraftRequest['alcohol'] {
  const response = alcohol.weeklyResponse === '' ? null : alcohol.weeklyResponse
  return {
    id: alcohol.id,
    weeklyResponse: response,
    drinkingDays: response === 'YES' ? parseOptionalInteger(alcohol.drinkingDays) : null,
    totalStandardizedDrinks:
      response === 'YES' ? parseOptionalNumber(alcohol.totalStandardizedDrinks) : null,
    largestOneDayAmount:
      response === 'YES' ? parseOptionalNumber(alcohol.largestOneDayAmount) : null,
    daysAtLargestAmount:
      response === 'YES' ? parseOptionalInteger(alcohol.daysAtLargestAmount) : null,
    commonBeverageTypes: response === 'YES' ? [...alcohol.commonBeverageTypes] : [],
    otherBeverageDescription:
      response === 'YES' && alcohol.commonBeverageTypes.includes('OTHER')
        ? nullableTrim(alcohol.otherBeverageDescription)
        : null
  }
}

function hasAlcoholDetails(form: AlcoholWeeklyForm): boolean {
  return (
    form.drinkingDays !== '' ||
    form.totalStandardizedDrinks !== '' ||
    form.largestOneDayAmount !== '' ||
    form.daysAtLargestAmount !== '' ||
    form.commonBeverageTypes.length > 0 ||
    form.otherBeverageDescription.trim() !== ''
  )
}

function isBaselineBeverageApplicable(form: AlcoholBaselineForm): boolean {
  return (
    form.everConsumed === 'YES' ||
    form.everConsumed === 'UNKNOWN' ||
    form.consumedPast12Months === 'YES'
  )
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function parseOptionalPositive(value: string): number | null {
  const parsed = parseOptionalNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}
function parseOptionalInteger(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}
function validateOptionalInteger(
  parsed: number | null,
  raw: string,
  fieldId: string,
  label: string,
  min: number,
  max: number,
  errors: AlcoholFieldError[]
): void {
  if (raw.trim() !== '' && (parsed === null || parsed < min || parsed > max)) {
    errors.push({ fieldId, message: `${label} must be a whole number from ${min} to ${max}.` })
  }
}
function validateOptionalPositive(
  parsed: number | null,
  raw: string,
  fieldId: string,
  label: string,
  errors: AlcoholFieldError[]
): void {
  if (raw.trim() !== '' && (parsed === null || parsed <= 0)) {
    errors.push({ fieldId, message: `${label} must be greater than zero.` })
  }
}
function numberToInput(value: number | null): string {
  return value === null ? '' : String(value)
}
function nullableTrim(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
