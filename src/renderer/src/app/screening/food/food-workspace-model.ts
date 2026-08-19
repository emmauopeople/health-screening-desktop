import type {
  ScreeningFoodCatalogItem,
  ScreeningFoodFrequencyCode,
  ScreeningFoodRecentSuggestion,
  ScreeningFoodResponse,
  ScreeningFoodSaveDraftRequest,
  ScreeningFoodWorkspace
} from '@shared/ipc'

export type FoodDraftLoadStatus = 'NOT_LOADED' | 'LOADING' | 'READY' | 'ERROR'
export type FoodDraftSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
export type FoodResponseDraft = ScreeningFoodResponse | ''
export type FoodFrequencyDraft = ScreeningFoodFrequencyCode | ''

export interface FoodDraftRowState {
  readonly localKey: string
  readonly id: string | null
  readonly catalogCode: string | null
  readonly foodName: string
  readonly frequencyCode: FoodFrequencyDraft
  readonly preparationNote: string
}

export interface FoodValidationError {
  readonly fieldId: string
  readonly message: string
}

export interface FoodDraftState {
  readonly loadStatus: FoodDraftLoadStatus
  readonly saveStatus: FoodDraftSaveStatus
  readonly workspace: ScreeningFoodWorkspace | null
  readonly foodResponse: FoodResponseDraft
  readonly rows: readonly FoodDraftRowState[]
  readonly validationErrors: readonly FoodValidationError[]
  readonly statusMessage: string | null
  readonly validationFocusRequestToken: string | null
  readonly dirty: boolean
}

let nextLocalFoodRowId = 1

export const foodResponseOptions = Object.freeze([
  { value: 'REPORTED', label: 'Foods reported' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
] as const)

export const foodFrequencyOptions = Object.freeze([
  { value: '', label: 'Not recorded' },
  { value: '1_DAY', label: '1 day' },
  { value: '2_TO_3_DAYS', label: '2-3 days' },
  { value: '4_TO_6_DAYS', label: '4-6 days' },
  { value: 'EVERY_DAY', label: 'Every day' }
] as const)

export function createInitialFoodDraftState(): FoodDraftState {
  return {
    loadStatus: 'NOT_LOADED',
    saveStatus: 'IDLE',
    workspace: null,
    foodResponse: '',
    rows: [],
    validationErrors: [],
    statusMessage: null,
    validationFocusRequestToken: null,
    dirty: false
  }
}

export function createFoodDraftStateFromWorkspace(
  workspace: ScreeningFoodWorkspace,
  options: Partial<
    Pick<FoodDraftState, 'saveStatus' | 'statusMessage' | 'validationFocusRequestToken'>
  > = {}
): FoodDraftState {
  return {
    loadStatus: 'READY',
    saveStatus: options.saveStatus ?? 'IDLE',
    workspace,
    foodResponse: workspace.draft?.foodResponse ?? '',
    rows:
      workspace.draft?.rows.map((row) => ({
        localKey: row.id,
        id: row.id,
        catalogCode: row.catalogCode,
        foodName: row.foodNameSnapshot,
        frequencyCode: row.frequencyCode ?? '',
        preparationNote: row.preparationNote ?? ''
      })) ?? [],
    validationErrors: [],
    statusMessage: options.statusMessage ?? null,
    validationFocusRequestToken: options.validationFocusRequestToken ?? null,
    dirty: false
  }
}

export function createBlankFoodRow(): FoodDraftRowState {
  return {
    localKey: `local-food-row-${nextLocalFoodRowId++}`,
    id: null,
    catalogCode: null,
    foodName: '',
    frequencyCode: '',
    preparationNote: ''
  }
}

export function updateFoodResponse(
  state: FoodDraftState,
  foodResponse: FoodResponseDraft
): FoodDraftState {
  return {
    ...state,
    foodResponse,
    rows: foodResponse === 'REPORTED' ? state.rows : [],
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: [],
    dirty: true
  }
}

export function addFoodRow(state: FoodDraftState): FoodDraftState {
  return {
    ...state,
    rows: [...state.rows, createBlankFoodRow()],
    saveStatus: 'IDLE',
    statusMessage: null,
    dirty: true
  }
}

export function updateFoodRow(
  state: FoodDraftState,
  localKey: string,
  update: (row: FoodDraftRowState) => FoodDraftRowState
): FoodDraftState {
  return {
    ...state,
    rows: state.rows.map((row) => (row.localKey === localKey ? update(row) : row)),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: state.validationErrors.filter((error) => !error.fieldId.startsWith(localKey)),
    dirty: true
  }
}

export function removeFoodRow(state: FoodDraftState, localKey: string): FoodDraftState {
  return {
    ...state,
    rows: state.rows.filter((row) => row.localKey !== localKey),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: state.validationErrors.filter((error) => !error.fieldId.startsWith(localKey)),
    dirty: true
  }
}

export function moveFoodRow(
  state: FoodDraftState,
  localKey: string,
  direction: 'UP' | 'DOWN'
): FoodDraftState {
  const index = state.rows.findIndex((row) => row.localKey === localKey)
  const targetIndex = direction === 'UP' ? index - 1 : index + 1
  if (index < 0 || targetIndex < 0 || targetIndex >= state.rows.length) return state
  const rows = [...state.rows]
  const current = rows[index]
  const target = rows[targetIndex]
  if (current === undefined || target === undefined) return state
  rows[index] = target
  rows[targetIndex] = current
  return {
    ...state,
    rows,
    saveStatus: 'IDLE',
    statusMessage: null,
    dirty: true
  }
}

export function applyFoodCatalogSelection(
  row: FoodDraftRowState,
  item: ScreeningFoodCatalogItem
): FoodDraftRowState {
  return {
    ...row,
    catalogCode: item.code,
    foodName: item.displayName
  }
}

export function applyFoodRecentSelection(
  row: FoodDraftRowState,
  suggestion: ScreeningFoodRecentSuggestion
): FoodDraftRowState {
  return {
    ...row,
    catalogCode: suggestion.catalogCode,
    foodName: suggestion.foodNameSnapshot
  }
}

export function parseFoodFrequencyDraft(value: string): FoodFrequencyDraft | null {
  switch (value) {
    case '':
      return ''
    case '1_DAY':
    case '2_TO_3_DAYS':
    case '4_TO_6_DAYS':
    case 'EVERY_DAY':
      return value
    default:
      return null
  }
}

export function createFoodSaveDraftRequest(
  encounterId: string,
  state: FoodDraftState
):
  | { readonly status: 'VALID'; readonly request: ScreeningFoodSaveDraftRequest }
  | { readonly status: 'INVALID'; readonly errors: readonly FoodValidationError[] } {
  const errors = validateFoodDraftForSave(state)
  if (errors.length > 0) return { status: 'INVALID', errors }
  const meaningfulRows = state.rows.filter((row) => !isBlankFoodRow(row))

  return {
    status: 'VALID',
    request: {
      encounterId,
      expectedVersion: state.workspace?.draft?.rowVersion ?? null,
      foodResponse: state.foodResponse === '' ? null : state.foodResponse,
      rows: meaningfulRows.map((row, index) => ({
        id: row.id,
        sequenceNumber: index + 1,
        catalogCode: row.catalogCode,
        foodName: row.foodName.trim(),
        frequencyCode: row.frequencyCode === '' ? null : row.frequencyCode,
        preparationNote: row.preparationNote.trim().length === 0 ? null : row.preparationNote.trim()
      }))
    }
  }
}

export function validateFoodDraftForSave(
  state: Pick<FoodDraftState, 'foodResponse' | 'rows'>
): readonly FoodValidationError[] {
  const errors: FoodValidationError[] = []
  const meaningfulRows = state.rows.filter((row) => !isBlankFoodRow(row))
  const normalizedNames = new Map<string, string>()

  if (state.foodResponse !== 'REPORTED' && meaningfulRows.length > 0) {
    errors.push({
      fieldId: 'food-response',
      message: 'Food rows require Foods reported.'
    })
  }

  for (const row of state.rows) {
    if (isBlankFoodRow(row)) continue
    const name = row.foodName.trim()
    const normalized = normalizeFoodName(name)
    if (name.length === 0) {
      errors.push({ fieldId: `${row.localKey}:foodName`, message: 'Food name is required.' })
    } else if (name.length > 100) {
      errors.push({
        fieldId: `${row.localKey}:foodName`,
        message: 'Food name must be 100 characters or less.'
      })
    } else if (!isSafeText(name)) {
      errors.push({ fieldId: `${row.localKey}:foodName`, message: 'Food name has invalid text.' })
    }

    if (row.preparationNote.trim().length > 200) {
      errors.push({
        fieldId: `${row.localKey}:preparationNote`,
        message: 'Note must be 200 characters or less.'
      })
    } else if (row.preparationNote.trim().length > 0 && !isSafeText(row.preparationNote.trim())) {
      errors.push({
        fieldId: `${row.localKey}:preparationNote`,
        message: 'Note has invalid text.'
      })
    }

    if (normalized.length > 0) {
      const existingField = normalizedNames.get(normalized)
      if (existingField !== undefined) {
        errors.push({
          fieldId: `${row.localKey}:foodName`,
          message: 'Food is already listed.'
        })
      } else {
        normalizedNames.set(normalized, `${row.localKey}:foodName`)
      }
    }
  }

  return errors
}

export function getFoodFieldError(
  errors: readonly FoodValidationError[],
  fieldId: string
): FoodValidationError | undefined {
  return errors.find((error) => error.fieldId === fieldId)
}

export function getFoodControlId(fieldId: string): string {
  return `food-${fieldId.replace(/[^A-Za-z0-9_-]/gu, '-')}`
}

export function getFoodErrorId(fieldId: string): string {
  return `food-error-${fieldId.replace(/[^A-Za-z0-9_-]/gu, '-')}`
}

export function getFoodDescribedBy(
  errors: readonly FoodValidationError[],
  fieldId: string
): string | undefined {
  return getFoodFieldError(errors, fieldId) === undefined ? undefined : getFoodErrorId(fieldId)
}

export function isBlankFoodRow(row: FoodDraftRowState): boolean {
  return (
    row.id === null &&
    row.catalogCode === null &&
    row.foodName.trim().length === 0 &&
    row.frequencyCode === '' &&
    row.preparationNote.trim().length === 0
  )
}

export function normalizeFoodName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

export function getFoodStatusMessage(status: string): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for Food.'
    case 'VALIDATION_FAILED':
      return 'Food draft could not be saved. Check the highlighted fields.'
    case 'VERSION_CONFLICT':
      return 'Food draft changed elsewhere. Reload and try again.'
    case 'LOCATION_NOT_CONFIGURED':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
      return 'The screening location is unavailable.'
    case 'ENCOUNTER_NOT_FOUND':
    case 'ENCOUNTER_NOT_EDITABLE':
      return 'This screening encounter is unavailable.'
    case 'SESSION_NOT_FOUND':
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_CURRENT':
      return 'The screening session is unavailable.'
    case 'UNAVAILABLE':
    default:
      return 'Food is unavailable.'
  }
}

export function getFoodFailureMessage(
  code: 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
): string {
  switch (code) {
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to open Food.'
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Food is unavailable.'
  }
}

function isSafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return false
    }
    if (code === 127) return false
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}
