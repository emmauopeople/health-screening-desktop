import { describe, expect, it, vi } from 'vitest'

import {
  createPasswordCredentialService,
  createStoredPasswordCredential,
  PasswordCredentialFormatError,
  PasswordHashingError,
  PasswordValidationError,
  PasswordVerificationError,
  scryptV1PasswordParameters,
  type PasswordCryptoProvider,
  type ScryptV1PasswordParameters
} from '@main/security'

interface RecordedScryptCall {
  readonly password: Buffer
  readonly salt: Buffer
  readonly keyLength: number
  readonly parameters: ScryptV1PasswordParameters
}

interface RecordingCryptoProvider extends PasswordCryptoProvider {
  readonly randomBytes: ReturnType<typeof vi.fn<(length: number) => Promise<Uint8Array>>>
  readonly scrypt: ReturnType<
    typeof vi.fn<
      (
        password: Uint8Array,
        salt: Uint8Array,
        keyLength: number,
        parameters: ScryptV1PasswordParameters
      ) => Promise<Uint8Array>
    >
  >
  readonly timingSafeEqual: ReturnType<
    typeof vi.fn<(left: Uint8Array, right: Uint8Array) => boolean>
  >
  readonly scryptCalls: RecordedScryptCall[]
  readonly timingSafeEqualCalls: ReadonlyArray<readonly [Buffer, Buffer]>
}

const exactPassword = '  Exact passphrase \u00e9  '
const wrongPassword = 'Wrong passphrase!'

describe('password credential service', () => {
  it('hashes exact validated passwords with fixed parameters and immutable credentials', async () => {
    const salt = fixedBytes(32, 11)
    const provider = createRecordingCryptoProvider({ salts: [salt] })
    const service = createPasswordCredentialService(provider)

    const credential = await service.hash(exactPassword)

    expect(provider.randomBytes).toHaveBeenCalledWith(scryptV1PasswordParameters.saltBytes)
    expect(provider.scryptCalls).toHaveLength(1)
    expect(provider.scryptCalls[0]).toEqual({
      password: Buffer.from(exactPassword, 'utf8'),
      salt,
      keyLength: scryptV1PasswordParameters.derivedKeyBytes,
      parameters: scryptV1PasswordParameters
    })
    expect(Object.isFrozen(credential)).toBe(true)
    expect(credential).not.toHaveProperty('password')
    expect(credential.passwordSalt).toHaveLength(43)
    expect(credential.passwordHash).toMatch(
      /^scrypt-v1\$N=32768\$r=8\$p=3\$dk=64\$[A-Za-z0-9_-]{86}$/u
    )
  })

  it('uses a fresh salt for each successful hash of the same password', async () => {
    const provider = createRecordingCryptoProvider({
      salts: [fixedBytes(32, 1), fixedBytes(32, 2)]
    })
    const service = createPasswordCredentialService(provider)

    const first = await service.hash(exactPassword)
    const second = await service.hash(exactPassword)

    expect(first.passwordSalt).not.toBe(second.passwordSalt)
    expect(first.passwordHash).not.toBe(second.passwordHash)
  })

  it('validates password input before invoking crypto providers', async () => {
    const provider = createRecordingCryptoProvider()
    const service = createPasswordCredentialService(provider)

    await expect(service.hash('too-short')).rejects.toBeInstanceOf(PasswordValidationError)

    expect(provider.randomBytes).not.toHaveBeenCalled()
    expect(provider.scrypt).not.toHaveBeenCalled()
  })

  it('verifies matching credentials and compares equal-length derived keys', async () => {
    const salt = fixedBytes(32, 7)
    const storedKey = deriveTestKey(Buffer.from(exactPassword, 'utf8'), salt)
    const credential = createStoredPasswordCredential(storedKey, salt)
    const provider = createRecordingCryptoProvider()
    const service = createPasswordCredentialService(provider)

    await expect(service.verify(exactPassword, credential)).resolves.toBe(true)
    await expect(service.verify(wrongPassword, credential)).resolves.toBe(false)

    expect(provider.timingSafeEqualCalls).toHaveLength(2)
    for (const [left, right] of provider.timingSafeEqualCalls) {
      expect(left.byteLength).toBe(64)
      expect(right.byteLength).toBe(64)
    }
  })

  it('preserves leading spaces and Unicode composition during verification', async () => {
    const provider = createRecordingCryptoProvider()
    const service = createPasswordCredentialService(provider)
    const spacedSalt = fixedBytes(32, 21)
    const composedSalt = fixedBytes(32, 22)
    const spacedCredential = createStoredPasswordCredential(
      deriveTestKey(Buffer.from(' password1234 ', 'utf8'), spacedSalt),
      spacedSalt
    )
    const composed = 'aaaaaaaaaaa\u00e9'
    const decomposed = 'aaaaaaaaaaae\u0301'
    const composedCredential = createStoredPasswordCredential(
      deriveTestKey(Buffer.from(composed, 'utf8'), composedSalt),
      composedSalt
    )

    await expect(service.verify(' password1234 ', spacedCredential)).resolves.toBe(true)
    await expect(service.verify('password1234', spacedCredential)).resolves.toBe(false)
    await expect(service.verify(composed, composedCredential)).resolves.toBe(true)
    await expect(service.verify(decomposed, composedCredential)).resolves.toBe(false)
  })

  it('maps malformed credentials to format errors before derivation', async () => {
    const provider = createRecordingCryptoProvider()
    const service = createPasswordCredentialService(provider)

    await expect(
      service.verify(exactPassword, {
        passwordHash: 'legacy-hash',
        passwordSalt: 'legacy-salt'
      })
    ).rejects.toBeInstanceOf(PasswordCredentialFormatError)

    expect(provider.scrypt).not.toHaveBeenCalled()
    expect(provider.timingSafeEqual).not.toHaveBeenCalled()
  })

  it('maps provider failures to clean hashing or verification errors', async () => {
    const secretFailure = new Error('C:\\secret\\crypto.log SecretPassw0rd!')
    secretFailure.name = 'C:\\secret\\CryptoProviderError'
    const randomFailureProvider = createRecordingCryptoProvider({
      randomFailure: secretFailure
    })
    const scryptFailureProvider = createRecordingCryptoProvider({
      scryptFailure: secretFailure
    })
    const compareFailureProvider = createRecordingCryptoProvider({
      timingSafeEqualFailure: secretFailure
    })
    const synchronousRandomFailureProvider: PasswordCryptoProvider = {
      randomBytes() {
        throw secretFailure
      },
      scrypt: vi.fn(async () => fixedBytes(64, 1)),
      timingSafeEqual: vi.fn(() => false)
    }
    const credential = createStoredPasswordCredential(
      deriveTestKey(Buffer.from(exactPassword, 'utf8'), fixedBytes(32, 5)),
      fixedBytes(32, 5)
    )

    const syncHashError = await captureAsyncError(() =>
      createPasswordCredentialService(synchronousRandomFailureProvider).hash(exactPassword)
    )
    const hashError = await captureAsyncError(() =>
      createPasswordCredentialService(randomFailureProvider).hash(exactPassword)
    )
    const hashScryptError = await captureAsyncError(() =>
      createPasswordCredentialService(scryptFailureProvider).hash(exactPassword)
    )
    const verifyError = await captureAsyncError(() =>
      createPasswordCredentialService(scryptFailureProvider).verify(exactPassword, credential)
    )
    const compareError = await captureAsyncError(() =>
      createPasswordCredentialService(compareFailureProvider).verify(exactPassword, credential)
    )

    expect(syncHashError).toBeInstanceOf(PasswordHashingError)
    expect(hashError).toBeInstanceOf(PasswordHashingError)
    expect(hashScryptError).toBeInstanceOf(PasswordHashingError)
    expect(verifyError).toBeInstanceOf(PasswordVerificationError)
    expect(compareError).toBeInstanceOf(PasswordVerificationError)
    expectSafePasswordError(syncHashError)
    expectSafePasswordError(hashError)
    expectSafePasswordError(hashScryptError)
    expectSafePasswordError(verifyError)
    expectSafePasswordError(compareError)
  })
})

function createRecordingCryptoProvider(
  options: {
    salts?: Buffer[]
    randomFailure?: Error
    scryptFailure?: Error
    timingSafeEqualFailure?: Error
  } = {}
): RecordingCryptoProvider {
  const salts = [...(options.salts ?? [fixedBytes(32, 1)])]
  const scryptCalls: RecordedScryptCall[] = []
  const timingSafeEqualCalls: Array<readonly [Buffer, Buffer]> = []

  const provider: RecordingCryptoProvider = {
    scryptCalls,
    timingSafeEqualCalls,
    randomBytes: vi.fn(async (length: number): Promise<Uint8Array> => {
      if (options.randomFailure !== undefined) {
        throw options.randomFailure
      }

      const salt = salts.shift() ?? fixedBytes(length, salts.length + 50)

      return Buffer.from(salt)
    }),
    scrypt: vi.fn(
      async (
        password: Uint8Array,
        salt: Uint8Array,
        keyLength: number,
        parameters: ScryptV1PasswordParameters
      ): Promise<Uint8Array> => {
        if (options.scryptFailure !== undefined) {
          throw options.scryptFailure
        }

        const passwordCopy = Buffer.from(password)
        const saltCopy = Buffer.from(salt)
        scryptCalls.push({
          password: passwordCopy,
          salt: saltCopy,
          keyLength,
          parameters
        })

        return deriveTestKey(passwordCopy, saltCopy, keyLength)
      }
    ),
    timingSafeEqual: vi.fn((left: Uint8Array, right: Uint8Array): boolean => {
      if (options.timingSafeEqualFailure !== undefined) {
        throw options.timingSafeEqualFailure
      }

      const leftCopy = Buffer.from(left)
      const rightCopy = Buffer.from(right)
      timingSafeEqualCalls.push([leftCopy, rightCopy])

      return leftCopy.equals(rightCopy)
    })
  }

  return provider
}

function deriveTestKey(
  password: Uint8Array,
  salt: Uint8Array,
  keyLength: number = scryptV1PasswordParameters.derivedKeyBytes
): Buffer {
  const key = Buffer.alloc(keyLength)

  for (let index = 0; index < key.length; index += 1) {
    key[index] = (password[index % password.length]! + salt[index % salt.length]! + index) % 256
  }

  return key
}

function fixedBytes(length: number, seed: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (seed + index) % 256))
}

function expectSafePasswordError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    'SecretPassw0rd',
    'crypto.log',
    'C:\\',
    'secret',
    'legacy-hash',
    'legacy-salt'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

async function captureAsyncError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
