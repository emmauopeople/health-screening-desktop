import { zeroByteBuffersBestEffort, zeroBytesBestEffort } from './password-buffer-cleanup'
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

type DataCredentialPropertyDescriptor = PropertyDescriptor & { readonly value: unknown }

export interface ParsedStoredPasswordCredential {
  readonly passwordHash: PasswordHash
  readonly passwordSalt: PasswordSalt
  readonly derivedKeyBytes: Buffer
  readonly saltBytes: Buffer
  readonly parameters: typeof scryptV1PasswordParameters
}

const base64UrlPattern = /^[A-Za-z0-9_-]+$/u
const credentialPropertyNames = Object.freeze(['passwordHash', 'passwordSalt'] as const)

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
  const decodedBuffers: Uint8Array[] = []

  try {
    return parsePasswordHashInternal(value, decodedBuffers)
  } catch (error) {
    zeroByteBuffersBestEffort(decodedBuffers)
    throw toCleanFormatError(error)
  }
}

export function parsePasswordSalt(value: unknown): {
  readonly passwordSalt: PasswordSalt
  readonly saltBytes: Buffer
} {
  const decodedBuffers: Uint8Array[] = []

  try {
    return parsePasswordSaltInternal(value, decodedBuffers)
  } catch (error) {
    zeroByteBuffersBestEffort(decodedBuffers)
    throw toCleanFormatError(error)
  }
}

export function parseStoredPasswordCredential(value: unknown): ParsedStoredPasswordCredential {
  const decodedBuffers: Uint8Array[] = []

  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new PasswordCredentialFormatError()
    }

    const dataProperties = readStoredCredentialDataProperties(value)
    const parsedHash = parsePasswordHashInternal(dataProperties.passwordHash, decodedBuffers)
    const parsedSalt = parsePasswordSaltInternal(dataProperties.passwordSalt, decodedBuffers)

    return Object.freeze({
      passwordHash: parsedHash.passwordHash,
      passwordSalt: parsedSalt.passwordSalt,
      derivedKeyBytes: parsedHash.derivedKeyBytes,
      saltBytes: parsedSalt.saltBytes,
      parameters: parsedHash.parameters
    })
  } catch (error) {
    zeroByteBuffersBestEffort(decodedBuffers)
    throw toCleanFormatError(error)
  }
}

function parsePasswordHashInternal(
  value: unknown,
  decodedBuffers: Uint8Array[]
): ParsedPasswordHash {
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

  const derivedKeyBytes = decodeCanonicalBase64Url(
    encodedKey,
    passwordDerivedKeyCharacterLength,
    scryptV1PasswordParameters.derivedKeyBytes
  )
  decodedBuffers.push(derivedKeyBytes)

  return Object.freeze({
    passwordHash: value as PasswordHash,
    derivedKeyBytes,
    parameters: scryptV1PasswordParameters
  })
}

function parsePasswordSaltInternal(
  value: unknown,
  decodedBuffers: Uint8Array[]
): {
  readonly passwordSalt: PasswordSalt
  readonly saltBytes: Buffer
} {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new PasswordCredentialFormatError()
  }

  const saltBytes = decodeCanonicalBase64Url(
    value,
    passwordSaltCharacterLength,
    scryptV1PasswordParameters.saltBytes
  )
  decodedBuffers.push(saltBytes)

  return Object.freeze({
    passwordSalt: value as PasswordSalt,
    saltBytes
  })
}

function readStoredCredentialDataProperties(value: object): {
  readonly passwordHash: unknown
  readonly passwordSalt: unknown
} {
  let descriptors: PropertyDescriptorMap

  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new PasswordCredentialFormatError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== credentialPropertyNames.length ||
    !credentialPropertyNames.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new PasswordCredentialFormatError()
  }

  const passwordHashDescriptor = descriptors.passwordHash
  const passwordSaltDescriptor = descriptors.passwordSalt

  if (
    passwordHashDescriptor === undefined ||
    passwordSaltDescriptor === undefined ||
    !isDataPropertyDescriptor(passwordHashDescriptor) ||
    !isDataPropertyDescriptor(passwordSaltDescriptor)
  ) {
    throw new PasswordCredentialFormatError()
  }

  return Object.freeze({
    passwordHash: passwordHashDescriptor.value,
    passwordSalt: passwordSaltDescriptor.value
  })
}

function isDataPropertyDescriptor(
  descriptor: PropertyDescriptor
): descriptor is DataCredentialPropertyDescriptor {
  return Object.prototype.hasOwnProperty.call(descriptor, 'value')
}

function encodeCanonicalBase64Url(bytes: Uint8Array): string {
  const temporaryBytes = Buffer.from(bytes)

  try {
    return temporaryBytes.toString('base64url')
  } finally {
    zeroBytesBestEffort(temporaryBytes)
  }
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
    zeroBytesBestEffort(decoded)
    throw new PasswordCredentialFormatError()
  }

  return decoded
}

function toCleanFormatError(error: unknown): PasswordCredentialFormatError {
  if (error instanceof PasswordCredentialFormatError) {
    return new PasswordCredentialFormatError(error.errorType)
  }

  return new PasswordCredentialFormatError()
}
