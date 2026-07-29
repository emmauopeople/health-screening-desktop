import { zeroBytesBestEffort } from './password-buffer-cleanup'
import {
  parseStoredPasswordCredential,
  type ParsedStoredPasswordCredential
} from './password-credential-format'
import { getPasswordCredentialErrorType, PasswordCredentialFormatError } from './password-errors'
import type { StoredPasswordCredential } from './password-types'

export function validateStoredPasswordCredentialForPersistence(
  value: unknown
): StoredPasswordCredential {
  let parsedCredential: ParsedStoredPasswordCredential | undefined

  try {
    parsedCredential = parseStoredPasswordCredential(value)

    return Object.freeze({
      passwordHash: parsedCredential.passwordHash,
      passwordSalt: parsedCredential.passwordSalt
    })
  } catch (error) {
    if (error instanceof PasswordCredentialFormatError) {
      throw new PasswordCredentialFormatError(error.errorType)
    }

    throw new PasswordCredentialFormatError(getPasswordCredentialErrorType(error))
  } finally {
    zeroBytesBestEffort(parsedCredential?.derivedKeyBytes)
    zeroBytesBestEffort(parsedCredential?.saltBytes)
  }
}
