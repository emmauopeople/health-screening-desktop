import { describe, expect, it, vi } from 'vitest'

import {
  createAuthenticationFormController,
  createLoginRequest,
  createRequiredPasswordChangeRequest,
  createUnlockRequest,
  readLoginFormValues,
  readRequiredPasswordChangeFormValues,
  readUnlockFormValues,
  requiredPasswordChangeFieldsMatch
} from '../../../src/renderer/src/app/authentication/authentication-form-controller'

describe('authentication form controller and request builders', () => {
  it('serializes exact login, password-change, and unlock values without normalization', () => {
    const loginValues = readLoginFormValues(
      formData({
        username: ' Admin.User ',
        password: '  Exact Passphrase  '
      })
    )

    expect(createLoginRequest(loginValues)).toEqual({
      username: ' Admin.User ',
      password: '  Exact Passphrase  '
    })

    const passwordChangeValues = readRequiredPasswordChangeFormValues(
      formData({
        currentPassword: ' Current Passphrase ',
        newPassword: ' New Passphrase ',
        confirmNewPassword: ' New Passphrase '
      })
    )

    expect(createRequiredPasswordChangeRequest(passwordChangeValues)).toEqual({
      currentPassword: ' Current Passphrase ',
      newPassword: ' New Passphrase ',
      confirmNewPassword: ' New Passphrase '
    })
    expect(requiredPasswordChangeFieldsMatch(passwordChangeValues)).toBe(true)

    expect(
      createUnlockRequest(readUnlockFormValues(formData({ password: ' Unlock Pass ' })))
    ).toEqual({
      password: ' Unlock Pass '
    })
  })

  it('rejects missing required form values before invoking the preload API', () => {
    expect(() => createLoginRequest(readLoginFormValues(formData({ username: 'admin' })))).toThrow(
      'Required authentication form value is missing.'
    )
    expect(() =>
      createRequiredPasswordChangeRequest(
        readRequiredPasswordChangeFormValues(
          formData({
            currentPassword: 'current',
            newPassword: 'replacement'
          })
        )
      )
    ).toThrow('Required authentication form value is missing.')
    expect(() => createUnlockRequest(readUnlockFormValues(formData({})))).toThrow(
      'Required authentication form value is missing.'
    )
  })

  it('ignores duplicate submissions and stale completions', () => {
    const states: unknown[] = []
    const controller = createAuthenticationFormController({
      onState: (state) => states.push(state)
    })

    const first = controller.begin()
    const duplicate = controller.begin()
    controller.fail(99, 'stale')
    controller.fail(first ?? 0, 'Invalid credentials')
    const second = controller.begin()
    controller.complete(first ?? 0)
    controller.complete(second ?? 0)
    controller.dispose()
    controller.begin()

    expect(duplicate).toBeNull()
    expect(states).toEqual([
      { status: 'SUBMITTING' },
      { status: 'ERROR', message: 'Invalid credentials' },
      { status: 'SUBMITTING' },
      { status: 'IDLE' }
    ])
  })
})

function formData(values: Record<string, unknown>): { get(name: string): unknown } {
  const get = vi.fn((name: string) => values[name])

  return { get }
}
