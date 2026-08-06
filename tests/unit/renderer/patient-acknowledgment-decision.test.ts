import { describe, expect, it } from 'vitest'

import {
  validatePatientAcknowledgmentDecision,
  type PatientAcknowledgmentDecisionSelection
} from '../../../src/renderer/src/app/patients/patient-acknowledgment-decision'

describe('patient acknowledgment decision helpers', () => {
  it('requires an explicit acknowledged or declined decision', () => {
    expect(validate({ decision: '' }).errors.decision).toBe('Select an acknowledgment decision.')
    expect(
      validate({ decision: 'NOT_REQUESTED' as PatientAcknowledgmentDecisionSelection }).status
    ).toBeNull()
    expect(validate({ decision: 'ACKNOWLEDGED' }).status).toBe('ACKNOWLEDGED')
    expect(validate({ decision: 'DECLINED' }).status).toBe('DECLINED')
  })

  it('normalizes empty optional notes to null and preserves nonempty notes exactly', () => {
    expect(validate({ decision: 'ACKNOWLEDGED', note: '' }).normalizedNote).toBeNull()
    expect(
      validate({ decision: 'ACKNOWLEDGED', note: '  Patient chose yes.  ' }).normalizedNote
    ).toBe('  Patient chose yes.  ')
  })

  it('validates the shared safe-note boundary', () => {
    const fiveHundredSupplementaryCharacters = '\u{1f600}'.repeat(500)

    expect(
      validate({ decision: 'ACKNOWLEDGED', note: fiveHundredSupplementaryCharacters }).errors
    ).toEqual({})
    expect(
      validate({ decision: 'DECLINED', note: 'Patient reported language ok.' }).errors
    ).toEqual({})
    expect(validate({ decision: 'ACKNOWLEDGED', note: '\u{1f600}'.repeat(501) }).errors.note).toBe(
      'Decision note must be 500 characters or fewer.'
    )

    for (const unsafeNote of [
      '\u0000',
      '\t',
      '\n',
      '\r',
      '\u001f',
      '\u007f',
      '\u0085',
      '\u009f',
      '\u2028',
      '\u2029'
    ]) {
      expect(validate({ decision: 'DECLINED', note: unsafeNote }).errors.note).toBe(
        'Decision note contains unsupported control characters.'
      )
    }

    for (const unsafeNote of [String.fromCharCode(0xd800), String.fromCharCode(0xdc00)]) {
      expect(validate({ decision: 'DECLINED', note: unsafeNote }).errors.note).toBe(
        'Decision note contains unsupported characters.'
      )
    }
  })
})

function validate({
  decision,
  note = ''
}: {
  readonly decision: PatientAcknowledgmentDecisionSelection
  readonly note?: string
}): ReturnType<typeof validatePatientAcknowledgmentDecision> {
  return validatePatientAcknowledgmentDecision({ decision, note })
}
