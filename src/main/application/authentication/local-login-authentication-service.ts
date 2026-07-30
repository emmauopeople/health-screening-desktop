import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  LocalUserAuthenticationStateConflictError,
  LocalUserNotFoundError,
  parseAuditActionCode,
  parseAuditEntityType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type AuditMetadata,
  type CreateAuditEventInput,
  type InstallationRecord,
  type LocalUserAuthenticationRecord,
  type LocalUserRecord
} from '@main/database'
import type { DatabaseTransactionContext } from '@main/database/transaction'
import { getErrorType } from '@main/foundation/error-type'
import type { UtcTimestamp } from '@main/foundation'
import {
  PasswordCredentialFormatError,
  PasswordValidationError,
  PasswordVerificationError,
  type StoredPasswordCredential
} from '@main/security'

import {
  getLocalLoginErrorType,
  isLocalLoginError,
  LocalLoginConcurrencyError,
  LocalLoginPersistenceError,
  LocalLoginStateIntegrityError,
  LocalLoginUnavailableError,
  LocalLoginValidationError,
  LocalLoginVerificationError,
  rebuildLocalLoginError
} from './local-login-errors'
import {
  assertNonDecreasingLocalLoginTime,
  createActiveLockAttemptState,
  createInvalidPasswordTransition,
  createSuccessfulLoginState,
  evaluateLocalLoginPolicyState,
  getLocalUserAuthenticationStateSnapshot
} from './local-login-policy'
import type {
  LocalLoginAuthenticationService,
  LocalLoginAuthenticationServiceDependencies,
  LocalLoginResult,
  ParsedLocalLoginInput
} from './local-login-types'
import { parseLocalLoginInput } from './local-login-validation'

const localLoginSucceededAction = parseAuditActionCode('LOCAL_LOGIN_SUCCEEDED')
const localLoginRejectedInvalidCredentialsAction = parseAuditActionCode(
  'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS'
)
const localLoginRejectedAccountInactiveAction = parseAuditActionCode(
  'LOCAL_LOGIN_REJECTED_ACCOUNT_INACTIVE'
)
const localLoginRejectedAccountLockedAction = parseAuditActionCode(
  'LOCAL_LOGIN_REJECTED_ACCOUNT_LOCKED'
)
const localUserEntityType = parseAuditEntityType('LOCAL_USER')
const authenticationEntityType = parseAuditEntityType('AUTHENTICATION')

export function createLocalLoginAuthenticationService({
  installationRepository,
  localUserRepository,
  auditEventRepository,
  passwordCredentialService,
  transactionExecutor,
  clock,
  dummyCredential
}: LocalLoginAuthenticationServiceDependencies): LocalLoginAuthenticationService {
  const authenticate = async (input: unknown): Promise<LocalLoginResult> => {
    let parsedInput: ParsedLocalLoginInput | undefined
    let observedAuthentication: LocalUserAuthenticationRecord | null | undefined

    try {
      parsedInput = parseLocalLoginInput(input)
      const parsedCommand = parsedInput
      const installation = readInitializedInstallation(installationRepository)
      observedAuthentication = readAuthenticationObservation(localUserRepository, parsedCommand)
      const observationTime = readObservationTime(clock)

      if (observedAuthentication !== null) {
        evaluateLocalLoginPolicyState(
          getLocalUserAuthenticationStateSnapshot(observedAuthentication.user),
          observationTime
        )
      }

      const passwordVerified =
        observedAuthentication !== null &&
        evaluateLocalLoginPolicyState(
          getLocalUserAuthenticationStateSnapshot(observedAuthentication.user),
          observationTime
        ).activeLock
          ? 'SKIPPED'
          : await verifyCandidatePassword(
              passwordCredentialService,
              parsedCommand,
              observedAuthentication?.credential ?? dummyCredential
            )

      const observedRecord = observedAuthentication

      return transactionExecutor.run((context) => {
        const transactionTime = context.nowUtc()
        assertNonDecreasingLocalLoginTime(observationTime, transactionTime)
        const currentInstallation = installationRepository.get()

        if (currentInstallation === null) {
          throw new LocalLoginConcurrencyError()
        }

        if (currentInstallation.id !== installation.id) {
          throw new LocalLoginConcurrencyError()
        }

        const currentAuthentication = localUserRepository.getAuthenticationByUsername(
          parsedCommand.username
        )

        if (observedRecord === null) {
          if (currentAuthentication !== null) {
            throw new LocalLoginConcurrencyError()
          }

          insertAuditEvent(context, {
            installationId: installation.id,
            userId: null,
            action: localLoginRejectedInvalidCredentialsAction,
            entityType: authenticationEntityType,
            entityId: null,
            occurredAt: transactionTime,
            metadata: Object.freeze({
              outcome: 'invalid_credentials',
              user_resolved: false
            })
          })

          return createRejectedResult('INVALID_CREDENTIALS', null)
        }

        if (currentAuthentication === null) {
          throw new LocalLoginConcurrencyError()
        }

        requireMatchingAuthenticationObservation(observedRecord, currentAuthentication)

        const currentSnapshot = getLocalUserAuthenticationStateSnapshot(currentAuthentication.user)
        const policy = evaluateLocalLoginPolicyState(currentSnapshot, transactionTime)

        if (passwordVerified === 'SKIPPED') {
          if (!policy.activeLock) {
            throw new LocalLoginConcurrencyError()
          }

          const updated = localUserRepository.updateAuthenticationState(context.connection, {
            id: currentAuthentication.user.id,
            expected: currentSnapshot,
            next: createActiveLockAttemptState(currentSnapshot, transactionTime)
          })
          insertAuditEvent(context, {
            installationId: installation.id,
            userId: null,
            action: localLoginRejectedAccountLockedAction,
            entityType: localUserEntityType,
            entityId: currentAuthentication.user.id,
            occurredAt: transactionTime,
            metadata: createLockedAuditMetadata({
              failedLoginCount: updated.failedLoginCount,
              lockApplied: false,
              retryAt: updated.lockedUntil
            })
          })

          return createRejectedResult('ACCOUNT_LOCKED', updated.lockedUntil)
        }

        if (!passwordVerified) {
          if (!currentAuthentication.user.isActive) {
            insertAuditEvent(context, {
              installationId: installation.id,
              userId: null,
              action: localLoginRejectedInvalidCredentialsAction,
              entityType: localUserEntityType,
              entityId: currentAuthentication.user.id,
              occurredAt: transactionTime,
              metadata: createInvalidCredentialsAuditMetadata({
                failedLoginCount: currentAuthentication.user.failedLoginCount,
                userResolved: true
              })
            })

            return createRejectedResult('INVALID_CREDENTIALS', null)
          }

          const transition = createInvalidPasswordTransition(currentSnapshot, transactionTime)
          const updated = localUserRepository.updateAuthenticationState(context.connection, {
            id: currentAuthentication.user.id,
            expected: currentSnapshot,
            next: transition.nextState
          })
          const isLockedOutcome = transition.reason === 'ACCOUNT_LOCKED'

          insertAuditEvent(context, {
            installationId: installation.id,
            userId: null,
            action: isLockedOutcome
              ? localLoginRejectedAccountLockedAction
              : localLoginRejectedInvalidCredentialsAction,
            entityType: localUserEntityType,
            entityId: currentAuthentication.user.id,
            occurredAt: transactionTime,
            metadata: isLockedOutcome
              ? createLockedAuditMetadata({
                  failedLoginCount: updated.failedLoginCount,
                  lockApplied: transition.lockApplied,
                  retryAt: transition.retryAt
                })
              : createInvalidCredentialsAuditMetadata({
                  failedLoginCount: updated.failedLoginCount,
                  userResolved: true
                })
          })

          return createRejectedResult(transition.reason, transition.retryAt)
        }

        if (!currentAuthentication.user.isActive) {
          insertAuditEvent(context, {
            installationId: installation.id,
            userId: null,
            action: localLoginRejectedAccountInactiveAction,
            entityType: localUserEntityType,
            entityId: currentAuthentication.user.id,
            occurredAt: transactionTime,
            metadata: Object.freeze({
              outcome: 'account_inactive'
            })
          })

          return createRejectedResult('ACCOUNT_INACTIVE', null)
        }

        const updated = localUserRepository.updateAuthenticationState(context.connection, {
          id: currentAuthentication.user.id,
          expected: currentSnapshot,
          next: createSuccessfulLoginState(currentSnapshot, transactionTime)
        })
        const safeUser = freezeLocalUserRecord(updated)

        insertAuditEvent(context, {
          installationId: installation.id,
          userId: updated.id,
          action: localLoginSucceededAction,
          entityType: localUserEntityType,
          entityId: updated.id,
          occurredAt: transactionTime,
          metadata: Object.freeze({
            outcome: 'authenticated',
            must_change_password: updated.mustChangePassword,
            role: updated.role
          })
        })

        return Object.freeze({
          status: 'AUTHENTICATED' as const,
          user: safeUser
        })
      })
    } catch (error) {
      throw toLocalLoginBoundaryError(error)
    } finally {
      parsedInput = undefined
      observedAuthentication = undefined
    }
  }

  return Object.freeze({
    authenticate
  })

  function insertAuditEvent(
    context: DatabaseTransactionContext,
    input: Omit<CreateAuditEventInput, 'id'>
  ): void {
    auditEventRepository.insert(context.connection, {
      id: context.newEntityId(),
      ...input
    })
  }
}

function readInitializedInstallation(
  installationRepository: LocalLoginAuthenticationServiceDependencies['installationRepository']
): InstallationRecord {
  try {
    const installation = installationRepository.get()

    if (installation === null) {
      throw new LocalLoginUnavailableError()
    }

    return installation
  } catch (error) {
    if (error instanceof LocalLoginUnavailableError) {
      throw new LocalLoginUnavailableError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new LocalLoginStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new LocalLoginUnavailableError(getErrorType(error))
    }

    throw error
  }
}

function readAuthenticationObservation(
  localUserRepository: LocalLoginAuthenticationServiceDependencies['localUserRepository'],
  parsedInput: ParsedLocalLoginInput
): LocalUserAuthenticationRecord | null {
  try {
    return localUserRepository.getAuthenticationByUsername(parsedInput.username)
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new LocalLoginStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new LocalLoginUnavailableError(getErrorType(error))
    }

    throw error
  }
}

function readObservationTime(
  clock: LocalLoginAuthenticationServiceDependencies['clock']
): UtcTimestamp {
  try {
    return clock.now()
  } catch (error) {
    throw new LocalLoginUnavailableError(getErrorType(error))
  }
}

async function verifyCandidatePassword(
  passwordCredentialService: LocalLoginAuthenticationServiceDependencies['passwordCredentialService'],
  parsedInput: ParsedLocalLoginInput,
  credential: StoredPasswordCredential
): Promise<boolean> {
  try {
    return await passwordCredentialService.verify(parsedInput.password, credential)
  } catch (error) {
    if (
      error instanceof PasswordVerificationError ||
      error instanceof PasswordCredentialFormatError ||
      error instanceof PasswordValidationError
    ) {
      throw new LocalLoginVerificationError(error.errorType)
    }

    throw new LocalLoginVerificationError(getErrorType(error))
  }
}

function requireMatchingAuthenticationObservation(
  observed: LocalUserAuthenticationRecord,
  current: LocalUserAuthenticationRecord
): void {
  if (
    observed.user.id !== current.user.id ||
    observed.user.username !== current.user.username ||
    observed.user.isActive !== current.user.isActive ||
    observed.user.failedLoginCount !== current.user.failedLoginCount ||
    observed.user.lockedUntil !== current.user.lockedUntil ||
    observed.user.lastLoginAt !== current.user.lastLoginAt ||
    observed.user.updatedAt !== current.user.updatedAt ||
    observed.credential.passwordHash !== current.credential.passwordHash ||
    observed.credential.passwordSalt !== current.credential.passwordSalt
  ) {
    throw new LocalLoginConcurrencyError()
  }
}

function createRejectedResult(
  reason: Extract<LocalLoginResult, { readonly status: 'REJECTED' }>['reason'],
  retryAt: UtcTimestamp | null
): Extract<LocalLoginResult, { readonly status: 'REJECTED' }> {
  return Object.freeze({
    status: 'REJECTED' as const,
    reason,
    retryAt
  })
}

function createInvalidCredentialsAuditMetadata({
  userResolved,
  failedLoginCount
}: {
  readonly userResolved: boolean
  readonly failedLoginCount: number
}): AuditMetadata {
  return Object.freeze({
    outcome: 'invalid_credentials',
    user_resolved: userResolved,
    failed_login_count: failedLoginCount
  })
}

function createLockedAuditMetadata({
  failedLoginCount,
  lockApplied,
  retryAt
}: {
  readonly failedLoginCount: number
  readonly lockApplied: boolean
  readonly retryAt: UtcTimestamp | null
}): AuditMetadata {
  if (retryAt === null) {
    throw new LocalLoginStateIntegrityError()
  }

  return Object.freeze({
    outcome: 'account_locked',
    failed_login_count: failedLoginCount,
    lock_applied: lockApplied,
    retry_at: retryAt
  })
}

function freezeLocalUserRecord(user: LocalUserRecord): LocalUserRecord {
  return Object.freeze({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  })
}

function toLocalLoginBoundaryError(error: unknown): Error {
  if (isLocalLoginError(error)) {
    return rebuildLocalLoginError(error)
  }

  if (error instanceof PasswordValidationError) {
    return new LocalLoginValidationError(error.errorType)
  }

  if (
    error instanceof PasswordVerificationError ||
    error instanceof PasswordCredentialFormatError
  ) {
    return new LocalLoginVerificationError(error.errorType)
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return mapTransactionExecutionError(error)
  }

  if (
    error instanceof LocalUserAuthenticationStateConflictError ||
    error instanceof LocalUserNotFoundError
  ) {
    return new LocalLoginConcurrencyError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new LocalLoginStateIntegrityError(error.errorType)
  }

  if (
    error instanceof RepositoryReadError ||
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryWriteError ||
    error instanceof AuditEventAlreadyExistsError ||
    error instanceof DatabaseTransactionStateError ||
    error instanceof DatabaseTransactionAsyncWorkError
  ) {
    return new LocalLoginPersistenceError(getLocalLoginErrorType(error))
  }

  return new LocalLoginPersistenceError(getLocalLoginErrorType(error))
}

function mapTransactionExecutionError(error: DatabaseTransactionExecutionError): Error {
  if (error.errorType === 'LocalLoginValidationError') {
    return new LocalLoginValidationError(error.errorType)
  }

  if (error.errorType === 'LocalLoginUnavailableError') {
    return new LocalLoginUnavailableError(error.errorType)
  }

  if (error.errorType === 'LocalLoginStateIntegrityError') {
    return new LocalLoginStateIntegrityError(error.errorType)
  }

  if (error.errorType === 'LocalLoginConcurrencyError') {
    return new LocalLoginConcurrencyError(error.errorType)
  }

  if (error.errorType === 'LocalLoginVerificationError') {
    return new LocalLoginVerificationError(error.errorType)
  }

  if (error.errorType === 'LocalLoginPersistenceError') {
    return new LocalLoginPersistenceError(error.errorType)
  }

  if (
    error.errorType === 'LocalUserAuthenticationStateConflictError' ||
    error.errorType === 'LocalUserNotFoundError'
  ) {
    return new LocalLoginConcurrencyError(error.errorType)
  }

  if (error.errorType === 'RepositoryDataIntegrityError') {
    return new LocalLoginStateIntegrityError(error.errorType)
  }

  return new LocalLoginPersistenceError(error.errorType)
}
