import {
  createStoredPasswordCredential,
  parseStoredPasswordCredential,
  type ParsedStoredPasswordCredential
} from './password-credential-format'
import { createNodePasswordCryptoProvider } from './password-crypto'
import {
  getPasswordCredentialErrorType,
  isPasswordCredentialError,
  PasswordCredentialFormatError,
  PasswordHashingError,
  PasswordValidationError,
  PasswordVerificationError,
  rebuildPasswordCredentialError
} from './password-errors'
import { scryptV1PasswordParameters } from './password-parameters'
import { parsePlaintextPassword } from './password-validation'
import type {
  PasswordCredentialService,
  PasswordCryptoProvider,
  PlaintextPassword,
  StoredPasswordCredential
} from './password-types'

export function createPasswordCredentialService(
  cryptoProvider: PasswordCryptoProvider = createNodePasswordCryptoProvider()
): PasswordCredentialService {
  return Object.freeze({
    async hash(password: unknown): Promise<StoredPasswordCredential> {
      const plaintextPassword = parsePlaintextForHash(password)
      let passwordBytes: Buffer | undefined
      let saltBytes: Uint8Array | undefined
      let derivedKeyBytes: Uint8Array | undefined

      try {
        passwordBytes = Buffer.from(plaintextPassword, 'utf8')
        saltBytes = await cryptoProvider.randomBytes(scryptV1PasswordParameters.saltBytes)

        if (saltBytes.byteLength !== scryptV1PasswordParameters.saltBytes) {
          throw new PasswordHashingError()
        }

        derivedKeyBytes = await cryptoProvider.scrypt(
          passwordBytes,
          saltBytes,
          scryptV1PasswordParameters.derivedKeyBytes,
          scryptV1PasswordParameters
        )

        if (derivedKeyBytes.byteLength !== scryptV1PasswordParameters.derivedKeyBytes) {
          throw new PasswordHashingError()
        }

        return createStoredPasswordCredential(derivedKeyBytes, saltBytes)
      } catch (error) {
        if (error instanceof PasswordHashingError) {
          throw new PasswordHashingError(error.errorType)
        }

        if (error instanceof PasswordCredentialFormatError) {
          throw new PasswordHashingError(error.errorType)
        }

        throw new PasswordHashingError(getPasswordCredentialErrorType(error))
      } finally {
        zeroBuffer(passwordBytes)
        zeroBuffer(saltBytes)
        zeroBuffer(derivedKeyBytes)
      }
    },

    async verify(password: unknown, credential: unknown): Promise<boolean> {
      const plaintextPassword = parsePlaintextForVerification(password)
      const parsedCredential = parseCredentialForVerification(credential)
      let passwordBytes: Buffer | undefined
      let candidateKeyBytes: Uint8Array | undefined

      try {
        passwordBytes = Buffer.from(plaintextPassword, 'utf8')
        candidateKeyBytes = await cryptoProvider.scrypt(
          passwordBytes,
          parsedCredential.saltBytes,
          parsedCredential.parameters.derivedKeyBytes,
          parsedCredential.parameters
        )

        if (candidateKeyBytes.byteLength !== parsedCredential.derivedKeyBytes.byteLength) {
          throw new PasswordVerificationError()
        }

        return cryptoProvider.timingSafeEqual(candidateKeyBytes, parsedCredential.derivedKeyBytes)
      } catch (error) {
        if (error instanceof PasswordVerificationError) {
          throw new PasswordVerificationError(error.errorType)
        }

        throw new PasswordVerificationError(getPasswordCredentialErrorType(error))
      } finally {
        zeroBuffer(passwordBytes)
        zeroBuffer(candidateKeyBytes)
        zeroBuffer(parsedCredential.saltBytes)
        zeroBuffer(parsedCredential.derivedKeyBytes)
      }
    }
  })
}

function parsePlaintextForHash(password: unknown): PlaintextPassword {
  try {
    return parsePlaintextPassword(password)
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      throw new PasswordValidationError(error.errorType)
    }

    throw new PasswordValidationError(getPasswordCredentialErrorType(error))
  }
}

function parsePlaintextForVerification(password: unknown): PlaintextPassword {
  try {
    return parsePlaintextPassword(password)
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      throw new PasswordValidationError(error.errorType)
    }

    throw new PasswordValidationError(getPasswordCredentialErrorType(error))
  }
}

function parseCredentialForVerification(credential: unknown): ParsedStoredPasswordCredential {
  try {
    return parseStoredPasswordCredential(credential)
  } catch (error) {
    if (isPasswordCredentialError(error)) {
      const rebuiltError = rebuildPasswordCredentialError(error)

      if (rebuiltError instanceof PasswordCredentialFormatError) {
        throw rebuiltError
      }

      throw new PasswordCredentialFormatError(rebuiltError.errorType)
    }

    throw new PasswordCredentialFormatError(getPasswordCredentialErrorType(error))
  }
}

function zeroBuffer(bytes: Uint8Array | undefined): void {
  bytes?.fill(0)
}
