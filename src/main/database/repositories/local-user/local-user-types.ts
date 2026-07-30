import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import type { StoredPasswordCredential } from '@main/security'

export type LocalUserRole = 'LOCAL_ADMIN' | 'NURSE' | 'TRAINED_SCREENER'

export type Username = string & { readonly __brand: 'Username' }
export type NormalizedUsername = string & { readonly __brand: 'NormalizedUsername' }
export type UserDisplayName = string & { readonly __brand: 'UserDisplayName' }

export interface UsernameIdentity {
  readonly username: Username
  readonly usernameNormalized: NormalizedUsername
}

export interface LocalUserRecord {
  readonly id: EntityId
  readonly username: Username
  readonly displayName: UserDisplayName
  readonly role: LocalUserRole
  readonly isActive: boolean
  readonly mustChangePassword: boolean
  readonly failedLoginCount: number
  readonly lockedUntil: UtcTimestamp | null
  readonly lastLoginAt: UtcTimestamp | null
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface LocalUserAuthenticationRecord {
  readonly user: LocalUserRecord
  readonly credential: StoredPasswordCredential
}

export interface LocalUserAuthenticationStateSnapshot {
  readonly failedLoginCount: number
  readonly lockedUntil: UtcTimestamp | null
  readonly lastLoginAt: UtcTimestamp | null
  readonly updatedAt: UtcTimestamp
}

export interface CreateLocalUserInput {
  readonly id: EntityId
  readonly username: Username
  readonly displayName: UserDisplayName
  readonly credential: StoredPasswordCredential
  readonly role: LocalUserRole
  readonly mustChangePassword: boolean
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface UpdateLocalUserAuthenticationStateInput {
  readonly id: EntityId
  readonly expected: LocalUserAuthenticationStateSnapshot
  readonly next: LocalUserAuthenticationStateSnapshot
}

export interface LocalUserRepository {
  hasAny(): boolean
  getById(id: EntityId): LocalUserRecord | null
  getByUsername(username: Username): LocalUserRecord | null
  getAuthenticationByUsername(username: Username): LocalUserAuthenticationRecord | null
  insert(connection: DatabaseTransactionConnection, input: CreateLocalUserInput): LocalUserRecord
  updateAuthenticationState(
    connection: DatabaseTransactionConnection,
    input: UpdateLocalUserAuthenticationStateInput
  ): LocalUserRecord
}
