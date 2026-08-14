import type {
  ScreeningLifestyleSaveDraftRequest,
  ScreeningLifestyleSaveTobaccoBaselineRequest,
  ScreeningLifestyleWorkspace
} from '@shared/ipc'

export type TobaccoEverResponse = 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | ''
export type TobaccoFrequency =
  'EVERY_DAY' | 'SOME_DAYS' | 'NOT_AT_ALL' | 'UNKNOWN' | 'DECLINED' | ''
export type TobaccoWeeklyResponse =
  'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
export type TobaccoProductType =
  | 'CIGARETTE'
  | 'ROLLED_TOBACCO'
  | 'CIGAR_PIPE'
  | 'SMOKELESS'
  | 'SNUFF'
  | 'HOOKAH'
  | 'VAPE'
  | 'OTHER'
export type TobaccoQuantityUnit =
  'STICKS_CIGARETTES' | 'SESSIONS' | 'PORTIONS' | 'PINS' | 'PODS_CARTRIDGES' | 'OTHER'
export type TobaccoFieldError = { readonly fieldId: string; readonly message: string }
export type TobaccoCardStatus =
  'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BASELINE_REVIEW' | 'VALIDATION_ERROR' | 'LOCKED'

export interface TobaccoBaselineForm {
  readonly everRegularlyUsed: TobaccoEverResponse
  readonly currentUseFrequency: TobaccoFrequency
  readonly formerUseApproximateStopDate: string
  readonly productTypes: readonly TobaccoProductType[]
  readonly otherProductDescription: string
}

export interface TobaccoProductForm {
  readonly clientKey: string
  readonly id: string | null
  readonly sequenceNumber: number
  readonly productType: TobaccoProductType | ''
  readonly daysUsed: string
  readonly averageQuantityPerUseDay: string
  readonly unit: TobaccoQuantityUnit | ''
  readonly secondhandSmokeExposure: boolean | null
  readonly otherProductDescription: string
  readonly otherUnitDescription: string
}

export interface TobaccoWeeklyForm {
  readonly id: string | null
  readonly weeklyResponse: TobaccoWeeklyResponse
  readonly products: readonly TobaccoProductForm[]
}

export const tobaccoFrequencyOptions: readonly {
  readonly value: Exclude<TobaccoFrequency, ''>
  readonly label: string
}[] = Object.freeze([
  { value: 'EVERY_DAY', label: 'Every day' },
  { value: 'SOME_DAYS', label: 'Some days' },
  { value: 'NOT_AT_ALL', label: 'Not at all' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' }
])

export const tobaccoWeeklyOptions: readonly {
  readonly value: Exclude<TobaccoWeeklyResponse, ''>
  readonly label: string
}[] = Object.freeze([
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
])

export const tobaccoProductOptions: readonly {
  readonly value: TobaccoProductType
  readonly label: string
}[] = Object.freeze([
  { value: 'CIGARETTE', label: 'Cigarettes' },
  { value: 'ROLLED_TOBACCO', label: 'Rolled tobacco' },
  { value: 'CIGAR_PIPE', label: 'Cigar or pipe' },
  { value: 'SMOKELESS', label: 'Smokeless or chewing tobacco' },
  { value: 'SNUFF', label: 'Snuff' },
  { value: 'HOOKAH', label: 'Shisha or hookah' },
  { value: 'VAPE', label: 'Vape or e-cigarette' },
  { value: 'OTHER', label: 'Other' }
])

export const tobaccoUnitOptions: readonly {
  readonly value: TobaccoQuantityUnit
  readonly label: string
}[] = Object.freeze([
  { value: 'STICKS_CIGARETTES', label: 'Sticks or cigarettes' },
  { value: 'SESSIONS', label: 'Sessions' },
  { value: 'PORTIONS', label: 'Portions' },
  { value: 'PINS', label: 'Pinches' },
  { value: 'PODS_CARTRIDGES', label: 'Pods or cartridges' },
  { value: 'OTHER', label: 'Other' }
])

let nextClientKey = 0

export function createInitialTobaccoBaselineForm(): TobaccoBaselineForm {
  return {
    everRegularlyUsed: '',
    currentUseFrequency: '',
    formerUseApproximateStopDate: '',
    productTypes: [],
    otherProductDescription: ''
  }
}

export function createInitialTobaccoWeeklyForm(): TobaccoWeeklyForm {
  return { id: null, weeklyResponse: '', products: [] }
}

export function createEmptyTobaccoProductForm(sequenceNumber: number): TobaccoProductForm {
  nextClientKey += 1
  return {
    clientKey: `new-tobacco-product-${nextClientKey}`,
    id: null,
    sequenceNumber,
    productType: '',
    daysUsed: '',
    averageQuantityPerUseDay: '',
    unit: '',
    secondhandSmokeExposure: null,
    otherProductDescription: '',
    otherUnitDescription: ''
  }
}

export function getTobaccoBaselineForEditableForm(
  workspace: ScreeningLifestyleWorkspace
): ScreeningLifestyleWorkspace['activeTobaccoBaseline'] {
  return workspace.activeTobaccoBaseline ?? workspace.referencedTobaccoBaseline
}

export function getTobaccoBaselineForInterpretation(
  workspace: ScreeningLifestyleWorkspace
): ScreeningLifestyleWorkspace['activeTobaccoBaseline'] {
  return workspace.draft?.tobaccoBaselineVersionId
    ? (workspace.referencedTobaccoBaseline ?? workspace.activeTobaccoBaseline)
    : workspace.activeTobaccoBaseline
}

export function tobaccoBaselineToForm(
  baseline: NonNullable<ScreeningLifestyleWorkspace['activeTobaccoBaseline']>
): TobaccoBaselineForm {
  return {
    everRegularlyUsed: baseline.everRegularlyUsed,
    currentUseFrequency: baseline.currentUseFrequency,
    formerUseApproximateStopDate: baseline.formerUseApproximateStopDate ?? '',
    productTypes: [...baseline.productTypes],
    otherProductDescription: baseline.otherProductDescription ?? ''
  }
}

export function tobaccoWeeklyToForm(
  tobacco: NonNullable<NonNullable<ScreeningLifestyleWorkspace['draft']>['tobacco']>
): TobaccoWeeklyForm {
  return {
    id: tobacco.id,
    weeklyResponse: toTobaccoWeeklyResponse(tobacco.weeklyResponse),
    products: tobacco.products.map((product) => ({
      clientKey: product.id,
      id: product.id,
      sequenceNumber: product.sequenceNumber,
      productType: product.productType,
      daysUsed: String(product.daysUsed),
      averageQuantityPerUseDay: String(product.averageQuantityPerUseDay),
      unit: product.unit,
      secondhandSmokeExposure: product.secondhandSmokeExposure,
      otherProductDescription: product.otherProductDescription ?? '',
      otherUnitDescription: product.otherUnitDescription ?? ''
    }))
  }
}

export function mapTobaccoBaselineStatus(form: TobaccoBaselineForm): {
  readonly status:
    'CURRENT_DAILY' | 'CURRENT_SOME_DAYS' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly currentUseFrequency: Exclude<TobaccoFrequency, ''>
} | null {
  if (form.everRegularlyUsed === '') return null
  if (form.everRegularlyUsed === 'NO') return { status: 'NEVER', currentUseFrequency: 'NOT_AT_ALL' }
  if (form.everRegularlyUsed === 'DECLINED') {
    return { status: 'DECLINED', currentUseFrequency: 'DECLINED' }
  }
  if (form.currentUseFrequency === 'EVERY_DAY') {
    return { status: 'CURRENT_DAILY', currentUseFrequency: 'EVERY_DAY' }
  }
  if (form.currentUseFrequency === 'SOME_DAYS') {
    return { status: 'CURRENT_SOME_DAYS', currentUseFrequency: 'SOME_DAYS' }
  }
  if (form.currentUseFrequency === 'NOT_AT_ALL' && form.everRegularlyUsed === 'YES') {
    return { status: 'FORMER', currentUseFrequency: 'NOT_AT_ALL' }
  }
  if (form.currentUseFrequency === 'DECLINED') {
    return { status: 'DECLINED', currentUseFrequency: 'DECLINED' }
  }
  return {
    status: 'UNKNOWN',
    currentUseFrequency: form.currentUseFrequency === 'UNKNOWN' ? 'UNKNOWN' : 'UNKNOWN'
  }
}

export function validateTobaccoBaseline(form: TobaccoBaselineForm): readonly TobaccoFieldError[] {
  const errors: TobaccoFieldError[] = []
  const mapping = mapTobaccoBaselineStatus(form)
  if (form.everRegularlyUsed === '') {
    errors.push({ fieldId: 'tobacco-baseline-ever-used', message: 'Select an answer.' })
  }
  if (
    (form.everRegularlyUsed === 'YES' || form.everRegularlyUsed === 'UNKNOWN') &&
    form.currentUseFrequency === ''
  ) {
    errors.push({ fieldId: 'tobacco-baseline-frequency', message: 'Select an answer.' })
  }
  if (
    mapping?.status === 'FORMER' &&
    form.formerUseApproximateStopDate !== '' &&
    !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/u.test(form.formerUseApproximateStopDate)
  ) {
    errors.push({
      fieldId: 'tobacco-baseline-stop-date',
      message: 'Enter a year or year-month.'
    })
  }
  if (mapping?.status !== 'FORMER' && form.formerUseApproximateStopDate !== '') {
    errors.push({
      fieldId: 'tobacco-baseline-stop-date',
      message: 'This date is only available for former use.'
    })
  }
  if (!baselineProductsApplicable(form) && form.productTypes.length > 0) {
    errors.push({
      fieldId: 'tobacco-baseline-product-types',
      message: 'Product types are not applicable to this response.'
    })
  }
  if (new Set(form.productTypes).size !== form.productTypes.length) {
    errors.push({ fieldId: 'tobacco-baseline-product-types', message: 'Choose each product once.' })
  }
  if (!form.productTypes.includes('OTHER') && form.otherProductDescription.trim() !== '') {
    errors.push({
      fieldId: 'tobacco-baseline-other-product',
      message: 'Select Other before entering a description.'
    })
  }
  if (form.productTypes.includes('OTHER') && form.otherProductDescription.trim() === '') {
    errors.push({ fieldId: 'tobacco-baseline-other-product', message: 'Enter a description.' })
  }
  if (form.otherProductDescription.length > 500) {
    errors.push({
      fieldId: 'tobacco-baseline-other-product',
      message: 'Use 500 characters or fewer.'
    })
  }
  return errors
}

export function validateTobaccoWeeklyDraft(form: TobaccoWeeklyForm): readonly TobaccoFieldError[] {
  const errors: TobaccoFieldError[] = []
  if (form.weeklyResponse !== 'YES') {
    if (form.products.length > 0) {
      errors.push({ fieldId: 'tobacco-weekly-response', message: 'Clear the hidden product rows.' })
    }
    return errors
  }
  if (form.products.length > 20) {
    errors.push({ fieldId: 'tobacco-products', message: 'Use 20 product rows or fewer.' })
  }
  const productTypes = form.products
    .map((product) => product.productType)
    .filter((productType): productType is TobaccoProductType => productType !== '')
  const duplicateTypes = new Set(
    productTypes.filter((type, index) => productTypes.indexOf(type) !== index)
  )
  const sequences = form.products.map((product) => product.sequenceNumber)
  if (new Set(sequences).size !== sequences.length) {
    errors.push({ fieldId: 'tobacco-products', message: 'Product rows must have unique order.' })
  }
  form.products.forEach((product) => {
    const prefix = `tobacco-product-${product.clientKey}`
    if (product.productType === '') {
      errors.push({ fieldId: `${prefix}-type`, message: 'Select a product type.' })
    } else if (duplicateTypes.has(product.productType)) {
      errors.push({ fieldId: `${prefix}-type`, message: 'Choose each product type once.' })
    }
    const days = parseInteger(product.daysUsed)
    if (days === null || days < 1 || days > 7) {
      errors.push({ fieldId: `${prefix}-days`, message: 'Enter a whole number from 1 to 7.' })
    }
    const quantity = parsePositiveNumber(product.averageQuantityPerUseDay)
    if (quantity === null) {
      errors.push({ fieldId: `${prefix}-quantity`, message: 'Enter a quantity greater than zero.' })
    }
    if (product.unit === '') {
      errors.push({ fieldId: `${prefix}-unit`, message: 'Select a quantity unit.' })
    }
    if (product.productType !== 'OTHER' && product.otherProductDescription.trim() !== '') {
      errors.push({
        fieldId: `${prefix}-other-product`,
        message: 'Clear the hidden product description.'
      })
    }
    if (product.productType === 'OTHER' && product.otherProductDescription.trim() === '') {
      errors.push({ fieldId: `${prefix}-other-product`, message: 'Enter a product description.' })
    }
    if (product.otherProductDescription.length > 500) {
      errors.push({ fieldId: `${prefix}-other-product`, message: 'Use 500 characters or fewer.' })
    }
    if (product.unit !== 'OTHER' && product.otherUnitDescription.trim() !== '') {
      errors.push({
        fieldId: `${prefix}-other-unit`,
        message: 'Clear the hidden unit description.'
      })
    }
    if (product.unit === 'OTHER' && product.otherUnitDescription.trim() === '') {
      errors.push({ fieldId: `${prefix}-other-unit`, message: 'Enter a unit description.' })
    }
    if (product.otherUnitDescription.length > 500) {
      errors.push({ fieldId: `${prefix}-other-unit`, message: 'Use 500 characters or fewer.' })
    }
  })
  return errors
}

export function isTobaccoComplete(form: TobaccoWeeklyForm): boolean {
  if (form.weeklyResponse === '') return false
  if (form.weeklyResponse !== 'YES') return form.products.length === 0
  return form.products.length > 0 && validateTobaccoWeeklyDraft(form).length === 0
}

export function updateTobaccoResponse(
  form: TobaccoWeeklyForm,
  response: TobaccoWeeklyResponse
): TobaccoWeeklyForm {
  return response === 'YES' || response === ''
    ? { ...form, weeklyResponse: response }
    : { ...form, weeklyResponse: response, products: [] }
}

export function createTobaccoBaselineRequest(
  encounterId: string,
  workspace: ScreeningLifestyleWorkspace | null,
  form: TobaccoBaselineForm
): ScreeningLifestyleSaveTobaccoBaselineRequest | null {
  const mapping = mapTobaccoBaselineStatus(form)
  if (mapping === null) return null
  return {
    encounterId,
    expectedBaselineVersion: workspace?.activeTobaccoBaseline?.version ?? null,
    expectedDraftVersion: workspace?.draft?.rowVersion ?? null,
    status: mapping.status,
    everRegularlyUsed: form.everRegularlyUsed as Exclude<TobaccoEverResponse, ''>,
    formerUseApproximateStopDate:
      mapping.status === 'FORMER' ? nullableTrim(form.formerUseApproximateStopDate) : null,
    currentUseFrequency: mapping.currentUseFrequency,
    productTypes: [...form.productTypes],
    otherProductDescription: form.productTypes.includes('OTHER')
      ? nullableTrim(form.otherProductDescription)
      : null
  }
}

export function tobaccoToRequest(
  form: TobaccoWeeklyForm
): ScreeningLifestyleSaveDraftRequest['tobacco'] {
  const response = form.weeklyResponse === '' ? null : form.weeklyResponse
  return {
    id: form.id,
    weeklyResponse: response,
    products:
      response === 'YES'
        ? form.products.map((product) => ({
            id: product.id,
            sequenceNumber: product.sequenceNumber,
            productType: product.productType as TobaccoProductType,
            daysUsed: Number(product.daysUsed),
            averageQuantityPerUseDay: Number(product.averageQuantityPerUseDay),
            unit: product.unit as TobaccoQuantityUnit,
            secondhandSmokeExposure: product.secondhandSmokeExposure,
            otherProductDescription:
              product.productType === 'OTHER'
                ? nullableTrim(product.otherProductDescription)
                : null,
            otherUnitDescription:
              product.unit === 'OTHER' ? nullableTrim(product.otherUnitDescription) : null
          }))
        : []
  }
}

export function getTobaccoCardStatus(
  state: {
    readonly loadStatus: string
    readonly saveStatus: string
    readonly tobaccoValidationErrors: readonly TobaccoFieldError[]
    readonly workspace: ScreeningLifestyleWorkspace | null
    readonly tobacco: TobaccoWeeklyForm
  },
  editable: boolean
): TobaccoCardStatus {
  if (!editable) return 'LOCKED'
  if (state.loadStatus !== 'READY' || state.workspace === null) return 'NOT_STARTED'
  if (state.tobaccoValidationErrors.length > 0 || state.saveStatus === 'ERROR') {
    return 'VALIDATION_ERROR'
  }
  const baseline = getTobaccoBaselineForInterpretation(state.workspace)
  if (baseline === null || baseline === undefined) return 'NOT_STARTED'
  if (
    state.tobacco.weeklyResponse === 'YES' &&
    ['FORMER', 'NEVER', 'UNKNOWN', 'DECLINED'].includes(baseline.status)
  ) {
    return 'BASELINE_REVIEW'
  }
  if (isTobaccoComplete(state.tobacco)) return 'COMPLETE'
  return 'IN_PROGRESS'
}

export function getTobaccoCardSummary(
  state: Parameters<typeof getTobaccoCardStatus>[0],
  editable: boolean
): string {
  const status = getTobaccoCardStatus(state, editable)
  if (status === 'LOCKED') return 'Locked'
  const baseline = state.workspace ? getTobaccoBaselineForInterpretation(state.workspace) : null
  const baselineLabel = formatTobaccoBaselineStatus(baseline?.status)
  if (status === 'BASELINE_REVIEW') return `${baselineLabel} • Use reported • Review baseline`
  if (status === 'COMPLETE' && state.tobacco.weeklyResponse === 'NO') {
    return `${baselineLabel} • No use this week`
  }
  if (status === 'COMPLETE') return `${baselineLabel} • Use reported`
  if (baseline === null || baseline === undefined) return 'Baseline required'
  return 'Tobacco draft in progress'
}

function baselineProductsApplicable(form: TobaccoBaselineForm): boolean {
  return form.everRegularlyUsed === 'YES' || form.everRegularlyUsed === 'UNKNOWN'
}

function formatTobaccoBaselineStatus(status: string | undefined): string {
  return status === 'CURRENT_DAILY'
    ? 'Current'
    : status === 'CURRENT_SOME_DAYS'
      ? 'Current'
      : status === 'FORMER'
        ? 'Former'
        : status === 'NEVER'
          ? 'Never'
          : status === 'DECLINED'
            ? 'Declined'
            : 'Unknown'
}

function toTobaccoWeeklyResponse(value: string | null): TobaccoWeeklyResponse {
  return value === 'YES' ||
    value === 'NO' ||
    value === 'UNKNOWN' ||
    value === 'DECLINED' ||
    value === 'PREFER_NOT_TO_ANSWER'
    ? value
    : ''
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parsePositiveNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function nullableTrim(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
