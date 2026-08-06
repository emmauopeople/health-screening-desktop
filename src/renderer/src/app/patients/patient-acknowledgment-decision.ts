import { patientAmendmentNoteSchema, type PatientAcknowledgmentDecisionStatus } from '@shared/ipc'

export type PatientAcknowledgmentDecisionSelection = PatientAcknowledgmentDecisionStatus | ''

export type PatientAcknowledgmentDecisionValidationField = 'decision' | 'note'

export type PatientAcknowledgmentDecisionValidationErrors = Partial<
  Record<PatientAcknowledgmentDecisionValidationField, string>
>

export interface PatientAcknowledgmentDecisionValidationInput {
  readonly decision: PatientAcknowledgmentDecisionSelection
  readonly note: string
}

export interface PatientAcknowledgmentDecisionValidationResult {
  readonly errors: PatientAcknowledgmentDecisionValidationErrors
  readonly focusField: PatientAcknowledgmentDecisionValidationField | null
  readonly status: PatientAcknowledgmentDecisionStatus | null
  readonly normalizedNote: string | null
}

const maximumDecisionNoteCodePoints = 500

export function validatePatientAcknowledgmentDecision(
  input: PatientAcknowledgmentDecisionValidationInput
): PatientAcknowledgmentDecisionValidationResult {
  const errors: PatientAcknowledgmentDecisionValidationErrors = {}
  let focusField: PatientAcknowledgmentDecisionValidationField | null = null
  const status = isPatientAcknowledgmentDecisionStatus(input.decision) ? input.decision : null

  const setFocus = (field: PatientAcknowledgmentDecisionValidationField): void => {
    focusField ??= field
  }

  if (status === null) {
    errors.decision = 'Select an acknowledgment decision.'
    setFocus('decision')
  }

  const sharedNoteCompatible = patientAmendmentNoteSchema.safeParse(input.note).success

  if (countUnicodeCodePoints(input.note) > maximumDecisionNoteCodePoints) {
    errors.note = 'Decision note must be 500 characters or fewer.'
    setFocus('note')
  } else if (containsUnsafeAcknowledgmentNoteCharacter(input.note)) {
    errors.note = 'Decision note contains unsupported control characters.'
    setFocus('note')
  } else if (containsUnpairedSurrogate(input.note)) {
    errors.note = 'Decision note contains unsupported characters.'
    setFocus('note')
  } else if (!sharedNoteCompatible) {
    errors.note = 'Decision note contains unsupported control characters.'
    setFocus('note')
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    focusField,
    status,
    normalizedNote: input.note.trim().length === 0 ? null : input.note
  })
}

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length
}

export function isPatientAcknowledgmentDecisionStatus(
  value: PatientAcknowledgmentDecisionSelection
): value is PatientAcknowledgmentDecisionStatus {
  return value === 'ACKNOWLEDGED' || value === 'DECLINED'
}

function containsUnsafeAcknowledgmentNoteCharacter(value: string): boolean {
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
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (Number.isNaN(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true
      }

      index += 1
      continue
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }

  return false
}
