import {
  patientAmendmentNoteSchema,
  type LocalUserRole,
  type PatientAmendDemographicsRequest,
  type PatientDemographicAmendmentReasonCode,
  type PublicPatientDetail
} from '@shared/ipc'

export type PatientDemographicAmendmentPatch = PatientAmendDemographicsRequest['patch']

export type PatientDemographicDraft = Readonly<{
  givenName: string | null
  familyName: string | null
  otherNames: string | null
  dateOfBirth: string | null
  approximateAgeYears: number | null
  ageAsOfDate: string | null
  sex: PublicPatientDetail['sex']
  village: string | null
  quarter: string | null
  phone: string | null
  alternateContactName: string | null
  alternateContactPhone: string | null
  residenceNotes: string | null
  status: PublicPatientDetail['status']
}>

export type PatientDemographicDraftField = keyof PatientDemographicDraft

export type PatientDemographicAmendmentReasonSelection = PatientDemographicAmendmentReasonCode | ''

export type PatientDemographicAmendmentValidationField =
  | 'summary'
  | 'name'
  | 'dateOfBirth'
  | 'approximateAgeYears'
  | 'ageAsOfDate'
  | 'reasonCode'
  | 'reasonNote'
  | 'status'

export type PatientDemographicAmendmentValidationErrors = Partial<
  Record<PatientDemographicAmendmentValidationField, string>
>

export interface PatientDemographicAmendmentValidationInput {
  readonly basePatient: PublicPatientDetail
  readonly draft: PatientDemographicDraft
  readonly reasonCode: PatientDemographicAmendmentReasonSelection
  readonly reasonNote: string
  readonly userRole: LocalUserRole
  readonly today: string
}

export interface PatientDemographicAmendmentValidationResult {
  readonly errors: PatientDemographicAmendmentValidationErrors
  readonly focusField: PatientDemographicAmendmentValidationField | null
  readonly patch: PatientDemographicAmendmentPatch | null
  readonly normalizedReasonNote: string | null
}

export interface PatientDemographicConflictField {
  readonly fieldName: PatientDemographicDraftField
  readonly originalValue: string | number | null
  readonly latestValue: string | number | null
  readonly intendedValue: string | number | null
}

export const patientDemographicDraftFieldOrder = Object.freeze([
  'givenName',
  'familyName',
  'otherNames',
  'dateOfBirth',
  'approximateAgeYears',
  'ageAsOfDate',
  'sex',
  'village',
  'quarter',
  'phone',
  'alternateContactName',
  'alternateContactPhone',
  'residenceNotes',
  'status'
] as const satisfies readonly PatientDemographicDraftField[])

export const patientDemographicAmendmentReasonOptions = Object.freeze([
  'DATA_ENTRY_CORRECTION',
  'PATIENT_REPORTED_CHANGE',
  'CONTACT_INFORMATION_UPDATE',
  'RESIDENCE_INFORMATION_UPDATE',
  'STATUS_CHANGE',
  'OTHER'
] as const satisfies readonly PatientDemographicAmendmentReasonCode[])

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const maximumReasonNoteCodePoints = 500

export function createPatientDemographicDraft(
  patient: PublicPatientDetail
): PatientDemographicDraft {
  return Object.freeze({
    givenName: patient.givenName,
    familyName: patient.familyName,
    otherNames: patient.otherNames,
    dateOfBirth: patient.dateOfBirth,
    approximateAgeYears: patient.approximateAgeYears,
    ageAsOfDate: patient.ageAsOfDate,
    sex: patient.sex,
    village: patient.village,
    quarter: patient.quarter,
    phone: patient.phone,
    alternateContactName: patient.alternateContactName,
    alternateContactPhone: patient.alternateContactPhone,
    residenceNotes: patient.residenceNotes,
    status: patient.status
  })
}

export function createPatientDemographicPatch(
  basePatient: PublicPatientDetail,
  draft: PatientDemographicDraft
): PatientDemographicAmendmentPatch | null {
  const baseDraft = createPatientDemographicDraft(basePatient)
  const entries: Partial<PatientDemographicAmendmentPatch> = {}

  for (const field of patientDemographicDraftFieldOrder) {
    const nextValue = normalizeDraftValue(field, draft[field])

    if (!areDemographicValuesEqual(normalizeDraftValue(field, baseDraft[field]), nextValue)) {
      assignPatchValue(entries, field, nextValue)
    }
  }

  return Object.keys(entries).length === 0 ? null : Object.freeze(entries)
}

export function getPatientDemographicChangedFields(
  basePatient: PublicPatientDetail,
  draft: PatientDemographicDraft
): readonly PatientDemographicDraftField[] {
  const patch = createPatientDemographicPatch(basePatient, draft)

  if (patch === null) {
    return Object.freeze([])
  }

  return Object.freeze(
    patientDemographicDraftFieldOrder.filter((field) =>
      Object.prototype.hasOwnProperty.call(patch, field)
    )
  )
}

export function applyPatientDemographicPatch(
  patient: PublicPatientDetail,
  patch: PatientDemographicAmendmentPatch
): PublicPatientDetail {
  const nextPatient: PublicPatientDetail = { ...patient }

  for (const field of patientDemographicDraftFieldOrder) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      assignPatientValue(nextPatient, field, patch[field])
    }
  }

  return Object.freeze(nextPatient)
}

export function applyPatientDemographicPatchToDraft(
  patient: PublicPatientDetail,
  patch: PatientDemographicAmendmentPatch,
  userRole: LocalUserRole
): PatientDemographicDraft {
  const nextDraft = createPatientDemographicDraft(patient)
  const mergedDraft: PatientDemographicDraft = {
    ...nextDraft,
    ...patch,
    status: userRole === 'TRAINED_SCREENER' ? patient.status : (patch.status ?? nextDraft.status)
  }

  return Object.freeze(mergedDraft)
}

export function validatePatientDemographicAmendment(
  input: PatientDemographicAmendmentValidationInput
): PatientDemographicAmendmentValidationResult {
  const errors: PatientDemographicAmendmentValidationErrors = {}
  let focusField: PatientDemographicAmendmentValidationField | null = null
  const patch = createPatientDemographicPatch(input.basePatient, input.draft)
  const hasDateOfBirth = input.draft.dateOfBirth !== null
  const hasApproximateAge = input.draft.approximateAgeYears !== null
  const trimmedReasonNote = input.reasonNote.trim()

  const setFocus = (field: PatientDemographicAmendmentValidationField): void => {
    focusField ??= field
  }

  if (patch === null) {
    errors.summary = 'Change at least one demographic field before saving.'
    setFocus('summary')
  }

  if (!hasAnyName(input.draft)) {
    errors.name = 'At least one name field is required.'
    setFocus('name')
  }

  if (hasDateOfBirth && (hasApproximateAge || input.draft.ageAsOfDate !== null)) {
    errors.dateOfBirth = 'Use either date of birth or approximate age, not both.'
    errors.approximateAgeYears = 'Use either approximate age or date of birth, not both.'
    setFocus('dateOfBirth')
  }

  if (!hasDateOfBirth && !hasApproximateAge) {
    errors.dateOfBirth = 'Enter a date of birth or approximate age.'
    errors.approximateAgeYears = 'Enter a date of birth or approximate age.'
    setFocus('dateOfBirth')
  }

  if (
    input.draft.dateOfBirth !== null &&
    (!isValidLocalDate(input.draft.dateOfBirth) || input.draft.dateOfBirth > input.today)
  ) {
    errors.dateOfBirth = 'Date of birth must be today or earlier.'
    setFocus('dateOfBirth')
  }

  if (
    input.draft.approximateAgeYears !== null &&
    (!Number.isInteger(input.draft.approximateAgeYears) ||
      input.draft.approximateAgeYears < 0 ||
      input.draft.approximateAgeYears > 120)
  ) {
    errors.approximateAgeYears = 'Approximate age must be between 0 and 120.'
    setFocus('approximateAgeYears')
  }

  if (input.draft.approximateAgeYears !== null && input.draft.ageAsOfDate === null) {
    errors.ageAsOfDate = 'Age as of date is required when approximate age is used.'
    setFocus('ageAsOfDate')
  }

  if (
    input.draft.ageAsOfDate !== null &&
    (!isValidLocalDate(input.draft.ageAsOfDate) || input.draft.ageAsOfDate > input.today)
  ) {
    errors.ageAsOfDate = 'Age as of date must be today or earlier.'
    setFocus('ageAsOfDate')
  }

  if (!isPatientDemographicAmendmentReasonCode(input.reasonCode)) {
    errors.reasonCode = 'Select a reason for this demographic amendment.'
    setFocus('reasonCode')
  }

  const sharedNoteCompatible = patientAmendmentNoteSchema.safeParse(input.reasonNote).success

  if (countUnicodeCodePoints(input.reasonNote) > maximumReasonNoteCodePoints) {
    errors.reasonNote = 'Reason note must be 500 characters or fewer.'
    setFocus('reasonNote')
  } else if (containsUnsafeAmendmentNoteCharacter(input.reasonNote)) {
    errors.reasonNote = 'Reason note contains unsupported control characters.'
    setFocus('reasonNote')
  } else if (containsUnpairedSurrogate(input.reasonNote)) {
    errors.reasonNote = 'Reason note contains unsupported characters.'
    setFocus('reasonNote')
  } else if (!sharedNoteCompatible) {
    errors.reasonNote = 'Reason note contains unsupported control characters.'
    setFocus('reasonNote')
  }

  const statusChanged = patch?.status !== undefined

  if (input.userRole === 'TRAINED_SCREENER' && statusChanged) {
    errors.status = 'Only nurses and local administrators can change patient status.'
    setFocus('status')
  }

  if (input.reasonCode === 'OTHER' && trimmedReasonNote.length === 0) {
    errors.reasonNote = 'Enter a reason note when Other is selected.'
    setFocus('reasonNote')
  } else if (statusChanged && trimmedReasonNote.length === 0) {
    errors.reasonNote = 'Enter a reason note when changing patient status.'
    setFocus('reasonNote')
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    focusField,
    patch,
    normalizedReasonNote: trimmedReasonNote.length === 0 ? null : input.reasonNote
  })
}

export function getPatientDemographicConflictFields(
  originalBasePatient: PublicPatientDetail,
  latestPatient: PublicPatientDetail,
  intendedPatch: PatientDemographicAmendmentPatch
): readonly PatientDemographicConflictField[] {
  const originalDraft = createPatientDemographicDraft(originalBasePatient)
  const latestDraft = createPatientDemographicDraft(latestPatient)
  const fields: PatientDemographicConflictField[] = []

  for (const field of patientDemographicDraftFieldOrder) {
    if (!Object.prototype.hasOwnProperty.call(intendedPatch, field)) {
      continue
    }

    const originalValue = normalizeDraftValue(field, originalDraft[field])
    const latestValue = normalizeDraftValue(field, latestDraft[field])

    if (!areDemographicValuesEqual(originalValue, latestValue)) {
      fields.push(
        Object.freeze({
          fieldName: field,
          originalValue,
          latestValue,
          intendedValue: normalizeDraftValue(field, intendedPatch[field])
        })
      )
    }
  }

  return Object.freeze(fields)
}

export function canRoleChangePatientStatus(role: LocalUserRole): boolean {
  return role === 'LOCAL_ADMIN' || role === 'NURSE'
}

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length
}

export function isPatientDemographicAmendmentReasonCode(
  value: PatientDemographicAmendmentReasonSelection
): value is PatientDemographicAmendmentReasonCode {
  return patientDemographicAmendmentReasonOptions.some((reasonCode) => reasonCode === value)
}

export function updatePatientDemographicDraftField<TKey extends PatientDemographicDraftField>(
  draft: PatientDemographicDraft,
  key: TKey,
  value: PatientDemographicDraft[TKey],
  today: string
): PatientDemographicDraft {
  const nextDraft: PatientDemographicDraft = { ...draft, [key]: normalizeDraftValue(key, value) }

  if (key === 'dateOfBirth' && typeof value === 'string' && isValidLocalDate(value)) {
    return Object.freeze({
      ...nextDraft,
      approximateAgeYears: null,
      ageAsOfDate: null
    })
  }

  if (key === 'approximateAgeYears') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Object.freeze({
        ...nextDraft,
        dateOfBirth: null,
        ageAsOfDate: draft.ageAsOfDate ?? today
      })
    }

    return Object.freeze({
      ...nextDraft,
      ageAsOfDate: null
    })
  }

  return Object.freeze(nextDraft)
}

function assignPatchValue(
  patch: Partial<PatientDemographicAmendmentPatch>,
  field: PatientDemographicDraftField,
  value: string | number | null
): void {
  switch (field) {
    case 'givenName':
    case 'familyName':
    case 'otherNames':
    case 'dateOfBirth':
    case 'ageAsOfDate':
    case 'village':
    case 'quarter':
    case 'phone':
    case 'alternateContactName':
    case 'alternateContactPhone':
    case 'residenceNotes':
      patch[field] = typeof value === 'string' ? value : null
      return
    case 'approximateAgeYears':
      patch.approximateAgeYears = typeof value === 'number' ? value : null
      return
    case 'sex':
      if (value === 'FEMALE' || value === 'MALE' || value === 'OTHER' || value === 'UNKNOWN') {
        patch.sex = value
      }
      return
    case 'status':
      if (value === 'ACTIVE' || value === 'INACTIVE') {
        patch.status = value
      }
      return
  }
}

function assignPatientValue(
  patient: PublicPatientDetail,
  field: PatientDemographicDraftField,
  value: PatientDemographicAmendmentPatch[PatientDemographicDraftField]
): void {
  switch (field) {
    case 'givenName':
    case 'familyName':
    case 'otherNames':
    case 'dateOfBirth':
    case 'approximateAgeYears':
    case 'ageAsOfDate':
    case 'sex':
    case 'village':
    case 'quarter':
    case 'phone':
    case 'alternateContactName':
    case 'alternateContactPhone':
    case 'residenceNotes':
    case 'status':
      Object.assign(patient, { [field]: value })
      return
  }
}

function normalizeDraftValue(
  field: PatientDemographicDraftField,
  value: PatientDemographicDraft[PatientDemographicDraftField] | undefined
): string | number | null {
  if (value === undefined || value === '') {
    return null
  }

  if (field === 'approximateAgeYears') {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  return value
}

function areDemographicValuesEqual(
  left: string | number | null,
  right: string | number | null
): boolean {
  return left === right
}

function hasAnyName(draft: PatientDemographicDraft): boolean {
  return [draft.givenName, draft.familyName, draft.otherNames].some(
    (value) => typeof value === 'string' && value.trim().length > 0
  )
}

function isValidLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function containsUnsafeAmendmentNoteCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return true
    }
  }

  return false
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true
      }

      index += 1
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }

  return false
}
