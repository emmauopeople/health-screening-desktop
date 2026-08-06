import { describe, expect, it } from 'vitest'

import {
  formatScreeningSessionStatus,
  validateOptionalLifecycleText,
  validateRequiredLifecycleText
} from '../../../src/renderer/src/app/screening/screening-session-workspace-model'

describe('screening session workspace model', () => {
  it('formats public lifecycle statuses without internal terminology', () => {
    expect(formatScreeningSessionStatus('OPEN')).toBe('Open')
    expect(formatScreeningSessionStatus('CLOSED')).toBe('Closed')
  })

  it('accepts ordinary and 500-code-point lifecycle text', () => {
    expect(validateOptionalLifecycleText('Reviewed by site lead', 'Session notes')).toEqual({
      status: 'VALID',
      value: 'Reviewed by site lead'
    })
    expect(validateRequiredLifecycleText('Needed to correct closure', 'Reopen reason')).toEqual({
      status: 'VALID',
      value: 'Needed to correct closure'
    })

    const fiveHundredSupplementary = '😀'.repeat(500)
    expect(validateOptionalLifecycleText(fiveHundredSupplementary, 'Session notes')).toEqual({
      status: 'VALID',
      value: fiveHundredSupplementary
    })
  })

  it('normalizes optional blank text to null while requiring reopen reasons', () => {
    expect(validateOptionalLifecycleText('   ', 'Close reason')).toEqual({
      status: 'VALID',
      value: null
    })
    expect(validateRequiredLifecycleText('   ', 'Reopen reason')).toEqual({
      status: 'INVALID',
      message: 'Reopen reason is required.'
    })
  })

  it('rejects overlength, unsafe controls, line separators, and unpaired surrogates', () => {
    expect(validateOptionalLifecycleText('😀'.repeat(501), 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes must be 500 characters or fewer.'
    })
    expect(validateOptionalLifecycleText('\n', 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes contains unsupported control characters.'
    })
    expect(validateOptionalLifecycleText(String.fromCharCode(0x85), 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes contains unsupported control characters.'
    })
    expect(validateOptionalLifecycleText('\u2028', 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes contains unsupported control characters.'
    })
    expect(validateOptionalLifecycleText('\ud800', 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes contains unsupported characters.'
    })
    expect(validateOptionalLifecycleText('\udc00', 'Session notes')).toEqual({
      status: 'INVALID',
      message: 'Session notes contains unsupported characters.'
    })
  })
})
