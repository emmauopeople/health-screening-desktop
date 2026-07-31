import { describe, expect, it } from 'vitest'

import * as securityApi from '@main/security'
import * as passwordApi from '@main/security/password'

const removedLowLevelExports = [
  'createStoredPasswordCredential',
  'serializePasswordHash',
  'serializePasswordSalt',
  'parsePasswordHash',
  'parsePasswordSalt',
  'parseStoredPasswordCredential',
  'validateStoredPasswordCredential',
  'createNodePasswordCryptoProvider',
  'passwordHashAlgorithm',
  'passwordHashPrefix',
  'passwordDerivedKeyCharacterLength',
  'passwordSaltCharacterLength',
  'getPasswordCredentialErrorType',
  'isPasswordCredentialError',
  'rebuildPasswordCredentialError'
] as const

describe('password public API', () => {
  it('keeps low-level credential bypass helpers out of application-facing barrels', () => {
    for (const api of [securityApi, passwordApi]) {
      for (const exportName of removedLowLevelExports) {
        expect(Object.prototype.hasOwnProperty.call(api, exportName)).toBe(false)
      }
    }
  })

  it('continues to expose the reviewed password credential service API', () => {
    expect(securityApi.createPasswordCredentialService).toBe(
      passwordApi.createPasswordCredentialService
    )
    const service = securityApi.createPasswordCredentialService()

    expect(typeof service.validateCredential).toBe('function')
    expect(securityApi.scryptV1PasswordParameters).toBe(passwordApi.scryptV1PasswordParameters)
    expect(securityApi.PasswordValidationError).toBe(passwordApi.PasswordValidationError)
    expect(securityApi.PasswordCredentialFormatError).toBe(
      passwordApi.PasswordCredentialFormatError
    )
    expect(securityApi.PasswordHashingError).toBe(passwordApi.PasswordHashingError)
    expect(securityApi.PasswordVerificationError).toBe(passwordApi.PasswordVerificationError)
  })
})
