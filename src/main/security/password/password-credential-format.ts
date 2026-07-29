import { PasswordCredentialFormatError } from './password-errors'
import {
  passwordDerivedKeyCharacterLength,
  passwordHashAlgorithm,
  passwordHashPrefix,
  passwordSaltCharacterLength,
  scryptV1PasswordParameters
} from './password-parameters'
import type { PasswordHash, PasswordSalt, StoredPasswordCredential } from './password-types'

interface ParsedPasswordHash {
  readonly passwordHash: PasswordHash
  readonly derivedKeyBytes: Buffer
  readonly parameters: typeof scryptV1PasswordParameters
}

export interface ParsedStoredPasswordCredential {
  readonly passwordHash: PasswordHash
  readonly passwordSalt: PasswordSalt
  readonly derivedKeyBytes: Buffer
  readonly saltBytes: Buffer
  readonly parameters: typeof scryptV1PasswordParameters
}

const base64UrlPattern = /^[A-Za-z0-9_-]+$/u

export function createStoredPasswordCredential(
  derivedKeyBytes: Uint8Array,
  saltBytes: Uint8Array
): StoredPasswordCredential {
  return Object.freeze({
    passwordHash: serializePasswordHash(derivedKeyBytes),
    passwordSalt: serializePasswordSalt(saltBytes)
  })
}

export function serializePasswordHash(derivedKeyBytes: Uint8Array): PasswordHash {
  if (derivedKeyBytes.byteLength !== scryptV1PasswordParameters.derivedKeyBytes) {
    throw new PasswordCredentialFormatError()
  }

  const encodedKey = encodeCanonicalBase64Url(derivedKeyBytes)

  if (encodedKey.length !== passwordDerivedKeyCharacterLength) {
    throw new PasswordCredentialFormatError()
  }

  return `${passwordHashPrefix}${encodedKey}` as PasswordHash
}

export function serializePasswordSalt(saltBytes: Uint8Array): PasswordSalt {
  if (saltBytes.byteLength !== scryptV1PasswordParameters.saltBytes) {
    throw new PasswordCredentialFormatError()
  }

  const encodedSalt = encodeCanonicalBase64Url(saltBytes)

  if (encodedSalt.length !== passwordSaltCharacterLength) {
    throw new PasswordCredentialFormatError()
  }

  return encodedSalt as PasswordSalt
}

export function parsePasswordHash(value: unknown): ParsedPasswordHash {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new PasswordCredentialFormatError()
  }

  const segments = value.split('$')

  if (
    segments.length !== 6 ||
    segments[0] !== passwordHashAlgorithm ||
    segments[1] !== `N=${scryptV1PasswordParameters.N}` ||
    segments[2] !== `r=${scryptV1PasswordParameters.r}` ||
    segments[3] !== `p=${scryptV1PasswordParameters.p}` ||
    segments[4] !== `dk=${scryptV1PasswordParameters.derivedKeyBytes}`
  ) {
    throw new PasswordCredentialFormatError()
  }

  const encodedKey = segments[5]

  if (encodedKey === undefined) {
    throw new PasswordCredentialFormatError()
  }

  return Object.freeze({
    passwordHash: value as PasswordHash,
    derivedKeyBytes: decodeCanonicalBase64Url(
      encodedKey,
      passwordDerivedKeyCharacterLength,
      scryptV1PasswordParameters.derivedKeyBytes
    ),
    parameters: scryptV1PasswordParameters
  })
}

export function parsePasswordSalt(value: unknown): {
  readonly passwordSalt: PasswordSalt
  readonly saltBytes: Buffer
} {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new PasswordCredentialFormatError()
  }

  return Object.freeze({
    passwordSalt: value as PasswordSalt,
    saltBytes: decodeCanonicalBase64Url(
      value,
      passwordSaltCharacterLength,
      scryptV1PasswordParameters.saltBytes
    )
  })
}

export function parseStoredPasswordCredential(value: unknown): ParsedStoredPasswordCredential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PasswordCredentialFormatError()
  }

  const candidate = value as Record<string, unknown>

  if (!hasExactStoredCredentialKeys(candidate)) {
    throw new PasswordCredentialFormatError()
  }

  const parsedHash = parsePasswordHash(candidate.passwordHash)
  const parsedSalt = parsePasswordSalt(candidate.passwordSalt)

  return Object.freeze({
    passwordHash: parsedHash.passwordHash,
    passwordSalt: parsedSalt.passwordSalt,
    derivedKeyBytes: parsedHash.derivedKeyBytes,
    saltBytes: parsedSalt.saltBytes,
    parameters: parsedHash.parameters
  })
}

function hasExactStoredCredentialKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)

  return (
    keys.length === 2 &&
    Object.prototype.hasOwnProperty.call(value, 'passwordHash') &&
    Object.prototype.hasOwnProperty.call(value, 'passwordSalt')
  )
}

function encodeCanonicalBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function decodeCanonicalBase64Url(
  value: string,
  expectedCharacterLength: number,
  expectedByteLength: number
): Buffer {
  if (
    value.length !== expectedCharacterLength ||
    value.includes('=') ||
    !base64UrlPattern.test(value)
  ) {
    throw new PasswordCredentialFormatError()
  }

  let decoded: Buffer

  try {
    decoded = Buffer.from(value, 'base64url')
  } catch {
    throw new PasswordCredentialFormatError()
  }

  if (decoded.byteLength !== expectedByteLength || encodeCanonicalBase64Url(decoded) !== value) {
    decoded.fill(0)
    throw new PasswordCredentialFormatError()
  }

  return decoded
}
