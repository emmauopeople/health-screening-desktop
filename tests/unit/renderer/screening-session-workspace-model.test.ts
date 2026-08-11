import { describe, expect, it } from 'vitest'

import {
  screeningPatientSearchPageSize,
  screeningPatientTabLimit
} from '../../../src/renderer/src/app/screening/screening-session-workspace-model'

describe('screening workspace model', () => {
  it('keeps the Patients workspace bounded to approved limits', () => {
    expect(screeningPatientSearchPageSize).toBe(25)
    expect(screeningPatientTabLimit).toBe(4)
  })
})
