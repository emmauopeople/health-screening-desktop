import type { PublicAuthenticatedUser, UtcTimestamp } from '@shared/ipc'

export type RendererAuthenticationRoute =
  | { readonly status: 'AUTH_LOADING' }
  | { readonly status: 'LOGIN_REQUIRED'; readonly revision: number }
  | {
      readonly status: 'PASSWORD_CHANGE_REQUIRED'
      readonly user: PublicAuthenticatedUser
      readonly expiresAt: UtcTimestamp
      readonly revision: number
    }
  | {
      readonly status: 'SESSION_ACTIVE'
      readonly user: PublicAuthenticatedUser
      readonly idleExpiresAt: UtcTimestamp
      readonly absoluteExpiresAt: UtcTimestamp
      readonly revision: number
    }
  | {
      readonly status: 'SESSION_LOCKED'
      readonly user: PublicAuthenticatedUser
      readonly reason: 'MANUAL' | 'IDLE_TIMEOUT'
      readonly absoluteExpiresAt: UtcTimestamp
      readonly revision: number
    }
  | {
      readonly status: 'AUTH_UNAVAILABLE'
      readonly message: string
      readonly retryable: boolean
    }
