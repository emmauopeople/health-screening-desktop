import type { scryptV1PasswordParameters } from './password-parameters'

export type PlaintextPassword = string & { readonly __brand: 'PlaintextPassword' }
export type PasswordHash = string & { readonly __brand: 'PasswordHash' }
export type PasswordSalt = string & { readonly __brand: 'PasswordSalt' }

export interface StoredPasswordCredential {
  readonly passwordHash: PasswordHash
  readonly passwordSalt: PasswordSalt
}

export interface PasswordCredentialService {
  hash(password: unknown): Promise<StoredPasswordCredential>
  verify(password: unknown, credential: unknown): Promise<boolean>
}

export type ScryptV1PasswordParameters = typeof scryptV1PasswordParameters

export interface PasswordCryptoProvider {
  randomBytes(length: number): Promise<Uint8Array>
  scrypt(
    password: Uint8Array,
    salt: Uint8Array,
    keyLength: number,
    parameters: ScryptV1PasswordParameters
  ): Promise<Uint8Array>
  timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean
}
