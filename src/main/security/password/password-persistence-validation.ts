import { validateStoredPasswordCredential } from './password-credential-validation'
import type { StoredPasswordCredential } from './password-types'

export function validateStoredPasswordCredentialForPersistence(
  value: unknown
): StoredPasswordCredential {
  return validateStoredPasswordCredential(value)
}
