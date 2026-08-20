import {
  OTC_DOSE_TEXT_MAX_LENGTH,
  OTC_DURATION_TEXT_MAX_LENGTH,
  OTC_FREQUENCY_TEXT_MAX_LENGTH,
  OTC_PRODUCT_NAME_MAX_LENGTH,
  OTC_REASON_FOR_USE_MAX_LENGTH,
  OTC_SOURCE_OF_MEDICATION_MAX_LENGTH
} from '@shared/otc-text-limits'
import type {
  ScreeningOtcCurrentlyTakingResponse,
  ScreeningOtcDraftRow,
  ScreeningOtcResponse,
  ScreeningOtcSaveDraftRequest,
  ScreeningOtcWorkspace
} from '@shared/ipc'

export type OtcDraftLoadStatus = 'NOT_LOADED' | 'LOADING' | 'READY' | 'ERROR'
export type OtcDraftSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
export type OtcResponseDraft = ScreeningOtcResponse | ''
export type OtcCurrentlyTakingDraft = ScreeningOtcCurrentlyTakingResponse | ''

export interface OtcDraftRowState {
  readonly localKey: string
  readonly id: string | null
  readonly productName: string
  readonly reasonForUse: string
  readonly doseText: string
  readonly frequencyText: string
  readonly durationText: string
  readonly sourceOfMedication: string
  readonly currentlyTakingResponse: OtcCurrentlyTakingDraft
}

export interface OtcValidationError {
  readonly fieldId: string
  readonly message: string
}

export interface OtcDraftState {
  readonly instanceToken: string
  readonly localRevision: number
  readonly loadStatus: OtcDraftLoadStatus
  readonly saveStatus: OtcDraftSaveStatus
  readonly workspace: ScreeningOtcWorkspace | null
  readonly otcResponse: OtcResponseDraft
  readonly rows: readonly OtcDraftRowState[]
  readonly validationErrors: readonly OtcValidationError[]
  readonly statusMessage: string | null
  readonly validationFocusRequestToken: string | null
  readonly dirty: boolean
}

export interface OtcSaveDraftReconciliation {
  readonly localKeyBySequence: ReadonlyMap<number, string>
}

let nextLocalOtcRowId = 1
let nextOtcInstanceId = 1

export const otcResponseOptions = Object.freeze([
  { value: 'REPORTED', label: 'Yes' },
  { value: 'NONE_REPORTED', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
] as const)

export const otcCurrentlyTakingOptions = Object.freeze([
  { value: '', label: 'Not recorded' },
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' }
] as const)

export function createInitialOtcDraftState(): OtcDraftState {
  return {
    instanceToken: `otc-instance-${nextOtcInstanceId++}`,
    localRevision: 0,
    loadStatus: 'NOT_LOADED',
    saveStatus: 'IDLE',
    workspace: null,
    otcResponse: '',
    rows: [],
    validationErrors: [],
    statusMessage: null,
    validationFocusRequestToken: null,
    dirty: false
  }
}

export function createOtcDraftStateFromWorkspace(
  workspace: ScreeningOtcWorkspace,
  options: Partial<
    Pick<
      OtcDraftState,
      | 'instanceToken'
      | 'localRevision'
      | 'saveStatus'
      | 'statusMessage'
      | 'validationFocusRequestToken'
    >
  > = {}
): OtcDraftState {
  return {
    instanceToken: options.instanceToken ?? `otc-instance-${nextOtcInstanceId++}`,
    localRevision: options.localRevision ?? 0,
    loadStatus: 'READY',
    saveStatus: options.saveStatus ?? 'IDLE',
    workspace,
    otcResponse: workspace.draft?.otcResponse ?? '',
    rows: workspace.draft?.rows.map(createOtcRowState) ?? [],
    validationErrors: [],
    statusMessage: options.statusMessage ?? null,
    validationFocusRequestToken: options.validationFocusRequestToken ?? null,
    dirty: false
  }
}

export function mergeOtcSaveWorkspace(
  current: OtcDraftState,
  workspace: ScreeningOtcWorkspace,
  reconciliation: OtcSaveDraftReconciliation = { localKeyBySequence: new Map() },
  statusMessage = 'Draft saved'
): OtcDraftState {
  const localKeysById = new Map(
    current.rows.filter((row) => row.id !== null).map((row) => [row.id, row.localKey])
  )
  const rows =
    workspace.draft?.rows.map((row) => ({
      ...createOtcRowState(row),
      localKey:
        localKeysById.get(row.id) ??
        reconciliation.localKeyBySequence.get(row.sequenceNumber) ??
        `local-otc-row-${nextLocalOtcRowId++}`
    })) ?? []

  return {
    ...createOtcDraftStateFromWorkspace(workspace, {
      instanceToken: current.instanceToken,
      localRevision: current.localRevision,
      saveStatus: 'SAVED',
      statusMessage
    }),
    rows,
    dirty: false
  }
}

export function createBlankOtcRow(): OtcDraftRowState {
  return {
    localKey: `local-otc-row-${nextLocalOtcRowId++}`,
    id: null,
    productName: '',
    reasonForUse: '',
    doseText: '',
    frequencyText: '',
    durationText: '',
    sourceOfMedication: '',
    currentlyTakingResponse: ''
  }
}

export function updateOtcResponse(
  state: OtcDraftState,
  otcResponse: OtcResponseDraft
): OtcDraftState {
  return {
    ...state,
    localRevision: state.localRevision + 1,
    otcResponse,
    rows: otcResponse === 'REPORTED' || otcResponse === '' ? state.rows : [],
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: [],
    dirty: true
  }
}

export function addOtcRow(state: OtcDraftState): OtcDraftState {
  return {
    ...state,
    localRevision: state.localRevision + 1,
    rows: [...state.rows, createBlankOtcRow()],
    saveStatus: 'IDLE',
    statusMessage: null,
    dirty: true
  }
}

export function updateOtcRow(
  state: OtcDraftState,
  localKey: string,
  update: (row: OtcDraftRowState) => OtcDraftRowState
): OtcDraftState {
  return {
    ...state,
    localRevision: state.localRevision + 1,
    rows: state.rows.map((row) => (row.localKey === localKey ? update(row) : row)),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: state.validationErrors.filter(
      (error) => !error.fieldId.startsWith(`${localKey}:`)
    ),
    dirty: true
  }
}

export function removeOtcRow(state: OtcDraftState, localKey: string): OtcDraftState {
  return {
    ...state,
    localRevision: state.localRevision + 1,
    rows: state.rows.filter((row) => row.localKey !== localKey),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: state.validationErrors.filter(
      (error) => !error.fieldId.startsWith(`${localKey}:`)
    ),
    dirty: true
  }
}

export function moveOtcRow(
  state: OtcDraftState,
  localKey: string,
  direction: 'UP' | 'DOWN'
): OtcDraftState {
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
    localRevision: state.localRevision + 1,
    rows,
    saveStatus: 'IDLE',
    statusMessage: null,
    dirty: true
  }
}

export function parseOtcCurrentlyTakingDraft(value: string): OtcCurrentlyTakingDraft | null {
  switch (value) {
    case '':
      return ''
    case 'YES':
    case 'NO':
    case 'UNKNOWN':
      return value
    default:
      return null
  }
}

export function createOtcSaveDraftRequest(
  encounterId: string,
  state: OtcDraftState
):
  | {
      readonly status: 'VALID'
      readonly request: ScreeningOtcSaveDraftRequest
      readonly reconciliation: OtcSaveDraftReconciliation
    }
  | { readonly status: 'INVALID'; readonly errors: readonly OtcValidationError[] } {
  const errors = validateOtcDraftForSave(state)
  if (errors.length > 0) return { status: 'INVALID', errors }
  const rows =
    state.otcResponse === 'REPORTED' || state.otcResponse === ''
      ? state.rows.filter((row) => !isBlankOtcRow(row))
      : []
  const localKeyBySequence = new Map<number, string>()
  rows.forEach((row, index) => localKeyBySequence.set(index + 1, row.localKey))

  return {
    status: 'VALID',
    request: {
      encounterId,
      expectedVersion: state.workspace?.draft?.rowVersion ?? null,
      otcResponse: state.otcResponse === '' ? null : state.otcResponse,
      rows: rows.map((row, index) => ({
        id: row.id,
        sequenceNumber: index + 1,
        productName: toNullableText(row.productName),
        reasonForUse: toNullableText(row.reasonForUse),
        doseText: toNullableText(row.doseText),
        frequencyText: toNullableText(row.frequencyText),
        durationText: toNullableText(row.durationText),
        sourceOfMedication: toNullableText(row.sourceOfMedication),
        currentlyTakingResponse:
          row.currentlyTakingResponse === '' ? null : row.currentlyTakingResponse
      }))
    },
    reconciliation: { localKeyBySequence }
  }
}

export function validateOtcDraftForSave(
  state: Pick<OtcDraftState, 'otcResponse' | 'rows'>
): readonly OtcValidationError[] {
  const errors: OtcValidationError[] = []
  for (const row of state.rows) {
    if (isBlankOtcRow(row)) continue
    validateText(errors, row, 'productName', row.productName, OTC_PRODUCT_NAME_MAX_LENGTH)
    validateText(errors, row, 'reasonForUse', row.reasonForUse, OTC_REASON_FOR_USE_MAX_LENGTH)
    validateText(errors, row, 'doseText', row.doseText, OTC_DOSE_TEXT_MAX_LENGTH)
    validateText(errors, row, 'frequencyText', row.frequencyText, OTC_FREQUENCY_TEXT_MAX_LENGTH)
    validateText(errors, row, 'durationText', row.durationText, OTC_DURATION_TEXT_MAX_LENGTH)
    validateText(
      errors,
      row,
      'sourceOfMedication',
      row.sourceOfMedication,
      OTC_SOURCE_OF_MEDICATION_MAX_LENGTH
    )
  }
  return errors
}

export function validateOtcDraftForContinue(
  state: Pick<OtcDraftState, 'otcResponse' | 'rows'>
): readonly OtcValidationError[] {
  const errors = [...validateOtcDraftForSave(state)]
  const meaningfulRows = state.rows.filter((row) => !isBlankOtcRow(row))

  if (state.otcResponse === '') {
    errors.push({
      fieldId: 'otc-response',
      message: 'Select an OTC response before continuing.'
    })
    return errors
  }

  if (state.otcResponse !== 'REPORTED') return errors

  if (meaningfulRows.length === 0) {
    errors.push({
      fieldId: 'otc-response',
      message: 'Add at least one medication before continuing.'
    })
    return errors
  }

  const firstRowByProduct = new Map<string, string>()
  for (const row of meaningfulRows) {
    const productName = row.productName.trim()
    if (productName.length === 0) {
      errors.push({
        fieldId: `${row.localKey}:productName`,
        message: 'Enter the medication name.'
      })
    } else {
      const normalized = normalizeOtcProductName(productName)
      const firstRow = firstRowByProduct.get(normalized)
      if (firstRow === undefined) firstRowByProduct.set(normalized, row.localKey)
      else
        errors.push({
          fieldId: `${row.localKey}:productName`,
          message: 'Each medication may be reported only once.'
        })
    }

    if (row.reasonForUse.trim().length === 0)
      errors.push({
        fieldId: `${row.localKey}:reasonForUse`,
        message: 'Enter the reason for use.'
      })

    if (row.currentlyTakingResponse === '')
      errors.push({
        fieldId: `${row.localKey}:currentlyTakingResponse`,
        message: 'Select whether the patient is currently taking this medication.'
      })
  }

  return errors
}

export function getOtcFieldError(
  errors: readonly OtcValidationError[],
  fieldId: string
): OtcValidationError | undefined {
  return errors.find((error) => error.fieldId === fieldId)
}

export function getOtcControlId(fieldId: string): string {
  return `otc-${fieldId.replace(/[^A-Za-z0-9_-]/gu, '-')}`
}

export function getOtcResponseControlId(response: OtcResponseDraft): string {
  return getOtcControlId(`otc-response-${response === '' ? 'UNFINISHED' : response}`)
}

export function getOtcErrorId(fieldId: string): string {
  return `otc-error-${fieldId.replace(/[^A-Za-z0-9_-]/gu, '-')}`
}

export function getOtcDescribedBy(
  errors: readonly OtcValidationError[],
  fieldId: string
): string | undefined {
  return getOtcFieldError(errors, fieldId) === undefined ? undefined : getOtcErrorId(fieldId)
}

export function isBlankOtcRow(row: OtcDraftRowState): boolean {
  return (
    row.productName.trim().length === 0 &&
    row.reasonForUse.trim().length === 0 &&
    row.doseText.trim().length === 0 &&
    row.frequencyText.trim().length === 0 &&
    row.durationText.trim().length === 0 &&
    row.sourceOfMedication.trim().length === 0 &&
    row.currentlyTakingResponse === ''
  )
}

export function isMeaningfulOtcRow(row: OtcDraftRowState): boolean {
  return !isBlankOtcRow(row)
}

export function normalizeOtcProductName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

export function getOtcStatusMessage(status: string): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for OTC.'
    case 'VALIDATION_FAILED':
      return 'OTC draft could not be saved. Check the highlighted fields.'
    case 'VERSION_CONFLICT':
      return 'OTC draft changed elsewhere. Reload and try again.'
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
      return 'OTC is unavailable.'
  }
}

export function getOtcFailureMessage(
  code: 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
): string {
  return code === 'IPC_FORBIDDEN'
    ? 'This window is not allowed to open OTC.'
    : 'OTC is unavailable.'
}

function createOtcRowState(row: ScreeningOtcDraftRow): OtcDraftRowState {
  return {
    localKey: row.id,
    id: row.id,
    productName: row.productNameSnapshot ?? '',
    reasonForUse: row.reasonForUse ?? '',
    doseText: row.doseText ?? '',
    frequencyText: row.frequencyText ?? '',
    durationText: row.durationText ?? '',
    sourceOfMedication: row.sourceOfMedication ?? '',
    currentlyTakingResponse: row.currentlyTakingResponse ?? ''
  }
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function validateText(
  errors: OtcValidationError[],
  row: OtcDraftRowState,
  field: keyof Pick<
    OtcDraftRowState,
    | 'productName'
    | 'reasonForUse'
    | 'doseText'
    | 'frequencyText'
    | 'durationText'
    | 'sourceOfMedication'
  >,
  value: string,
  maximumLength: number
): void {
  const trimmed = value.trim()
  if (trimmed.length > maximumLength) {
    errors.push({
      fieldId: `${row.localKey}:${field}`,
      message: `${getOtcFieldLabel(field)} must be ${maximumLength} characters or less.`
    })
  } else if (trimmed.length > 0 && !isSafeText(trimmed)) {
    errors.push({
      fieldId: `${row.localKey}:${field}`,
      message: `${getOtcFieldLabel(field)} has invalid text.`
    })
  }
}

function getOtcFieldLabel(field: string): string {
  switch (field) {
    case 'productName':
      return 'Medication name'
    case 'reasonForUse':
      return 'Reason for use'
    case 'doseText':
      return 'Dose'
    case 'frequencyText':
      return 'Frequency'
    case 'durationText':
      return 'Duration'
    case 'sourceOfMedication':
      return 'Source'
    default:
      return 'Field'
  }
}

function isSafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31))
      return false
    if (code === 127) return false
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
