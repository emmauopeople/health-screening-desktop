import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  LocalUserAuthenticationStateConflictError,
  LocalUserCredentialStateConflictError,
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
  type LocalUserAuthenticationStateSnapshot,
  type LocalUserRecord
} from '@main/database'
import type { DatabaseTransactionContext } from '@main/database/transaction'
import {
  EntityIdGenerationError,
  UtcClockError,
  type EntityId,
  type UtcTimestamp
} from '@main/foundation'
import { getErrorType } from '@main/foundation/error-type'
import {
  PasswordCredentialFormatError,
  PasswordHashingError,
  PasswordValidationError,
  PasswordVerificationError,
  type StoredPasswordCredential
} from '@main/security'

import {
  getLocalForcedPasswordChangeErrorType,
  isLocalForcedPasswordChangeError,
  LocalForcedPasswordChangeConcurrencyError,
  LocalForcedPasswordChangeHashingError,
  LocalForcedPasswordChangePersistenceError,
  LocalForcedPasswordChangeStateIntegrityError,
  LocalForcedPasswordChangeUnavailableError,
  LocalForcedPasswordChangeValidationError,
  LocalForcedPasswordChangeVerificationError,
  rebuildLocalForcedPasswordChangeError
} from './forced-password-change-errors'
import {
  createForcedPasswordChangeActiveLockAttemptState,
  createForcedPasswordChangeInvalidCurrentPasswordTransition,
  createForcedPasswordChangeProofState,
  evaluateForcedPasswordChangeState
} from './forced-password-change-policy'
import type {
  LocalForcedPasswordChangeRejectionReason,
  LocalForcedPasswordChangeResult,
  LocalForcedPasswordChangeService,
  LocalForcedPasswordChangeServiceDependencies,
  ParsedLocalForcedPasswordChangeInput
} from './forced-password-change-types'
import { parseLocalForcedPasswordChangeInput } from './forced-password-change-validation'
import {
  assertNonDecreasingLocalLoginTime,
  getLocalUserAuthenticationStateSnapshot
} from './local-login-policy'

const passwordChangeSucceededAction = parseAuditActionCode('LOCAL_PASSWORD_CHANGE_SUCCEEDED')
const passwordChangeRejectedInvalidCurrentPasswordAction = parseAuditActionCode(
  'LOCAL_PASSWORD_CHANGE_REJECTED_INVALID_CURRENT_PASSWORD'
)
const passwordChangeRejectedAccountLockedAction = parseAuditActionCode(
  'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_LOCKED'
)
const passwordChangeRejectedAccountInactiveAction = parseAuditActionCode(
  'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_INACTIVE'
)
const passwordChangeRejectedNotRequiredAction = parseAuditActionCode(
  'LOCAL_PASSWORD_CHANGE_REJECTED_NOT_REQUIRED'
)
const passwordChangeRejectedReusedPasswordAction = parseAuditActionCode(
  'LOCAL_PASSWORD_CHANGE_REJECTED_REUSED_PASSWORD'
)
const localUserEntityType = parseAuditEntityType('LOCAL_USER')

interface RevalidatedForcedPasswordChangeObservation {
  readonly authentication: LocalUserAuthenticationRecord
  readonly snapshot: LocalUserAuthenticationStateSnapshot
}

export function createLocalForcedPasswordChangeService({
  installationRepository,
  localUserRepository,
  auditEventRepository,
  passwordCredentialService,
  transactionExecutor,
  clock
}: LocalForcedPasswordChangeServiceDependencies): LocalForcedPasswordChangeService {
  const changePassword = async (input: unknown): Promise<LocalForcedPasswordChangeResult> => {
    let parsedInput: ParsedLocalForcedPasswordChangeInput | undefined
    let observedAuthentication: LocalUserAuthenticationRecord | undefined
    let replacementCredential: StoredPasswordCredential | undefined

    try {
      parsedInput = parseLocalForcedPasswordChangeInput(input)

      if (parsedInput.newPassword !== parsedInput.confirmNewPassword) {
        return createRejectedResult('NEW_PASSWORD_CONFIRMATION_MISMATCH', null)
      }

      const installation = readInitializedInstallation(installationRepository)
      observedAuthentication = readAuthenticationObservation(
        localUserRepository,
        parsedInput.userId
      )
      const observation = observedAuthentication
      const observationTime = readObservationTime(clock)
      const observedSnapshot = getLocalUserAuthenticationStateSnapshot(observation.user)
      const observedPolicy = evaluateForcedPasswordChangeState(observedSnapshot, observationTime)

      if (observedPolicy.activeLock) {
        return transactionExecutor.run((context) =>
          finalizeActiveLockAttempt({
            context,
            installation,
            observation,
            observationTime
          })
        )
      }

      const currentPasswordVerified = await verifyPassword(
        passwordCredentialService,
        parsedInput.currentPassword,
        observation.credential
      )

      if (!currentPasswordVerified) {
        return transactionExecutor.run((context) =>
          finalizeInvalidCurrentPassword({
            context,
            installation,
            observation,
            observationTime
          })
        )
      }

      if (!observation.user.isActive) {
        return transactionExecutor.run((context) =>
          finalizeAccountInactive({
            context,
            installation,
            observation,
            observationTime
          })
        )
      }

      if (!observation.user.mustChangePassword) {
        return transactionExecutor.run((context) =>
          finalizeChangeNotRequired({
            context,
            installation,
            observation,
            observationTime
          })
        )
      }

      const reusesCurrentPassword = await verifyPassword(
        passwordCredentialService,
        parsedInput.newPassword,
        observation.credential
      )

      if (reusesCurrentPassword) {
        return transactionExecutor.run((context) =>
          finalizeReusedPassword({
            context,
            installation,
            observation,
            observationTime
          })
        )
      }

      replacementCredential = await hashReplacementPassword(
        passwordCredentialService,
        parsedInput.newPassword
      )
      const nextCredential = await validateReplacementCredential({
        passwordCredentialService,
        currentPassword: parsedInput.currentPassword,
        newPassword: parsedInput.newPassword,
        currentCredential: observation.credential,
        replacementCredential
      })

      return transactionExecutor.run((context) =>
        finalizeSuccessfulChange({
          context,
          installation,
          observation,
          observationTime,
          nextCredential
        })
      )
    } catch (error) {
      throw toForcedPasswordChangeBoundaryError(error)
    } finally {
      parsedInput = undefined
      observedAuthentication = undefined
      replacementCredential = undefined
    }
  }

  return Object.freeze({
    changePassword
  })

  function finalizeActiveLockAttempt({
    context,
    installation,
    observation,
    observationTime
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime,
      requireActiveLock: true
    })
    const updated = localUserRepository.updateAuthenticationState(context.connection, {
      id: revalidated.authentication.user.id,
      expected: revalidated.snapshot,
      next: createForcedPasswordChangeActiveLockAttemptState(revalidated.snapshot, transactionTime)
    })

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: null,
      action: passwordChangeRejectedAccountLockedAction,
      entityType: localUserEntityType,
      entityId: updated.id,
      occurredAt: transactionTime,
      metadata: createLockedAuditMetadata({
        failedLoginCount: updated.failedLoginCount,
        lockApplied: false,
        retryAt: updated.lockedUntil
      })
    })

    return createRejectedResult('ACCOUNT_LOCKED', updated.lockedUntil)
  }

  function finalizeInvalidCurrentPassword({
    context,
    installation,
    observation,
    observationTime
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime
    })

    if (!revalidated.authentication.user.isActive) {
      insertAuditEvent(context, {
        installationId: installation.id,
        userId: null,
        action: passwordChangeRejectedInvalidCurrentPasswordAction,
        entityType: localUserEntityType,
        entityId: revalidated.authentication.user.id,
        occurredAt: transactionTime,
        metadata: createInvalidCurrentPasswordAuditMetadata({
          failedLoginCount: revalidated.authentication.user.failedLoginCount
        })
      })

      return createRejectedResult('CURRENT_PASSWORD_INVALID', null)
    }

    const transition = createForcedPasswordChangeInvalidCurrentPasswordTransition(
      revalidated.snapshot,
      transactionTime
    )
    const updated = localUserRepository.updateAuthenticationState(context.connection, {
      id: revalidated.authentication.user.id,
      expected: revalidated.snapshot,
      next: transition.nextState
    })
    const isLockedOutcome = transition.reason === 'ACCOUNT_LOCKED'

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: null,
      action: isLockedOutcome
        ? passwordChangeRejectedAccountLockedAction
        : passwordChangeRejectedInvalidCurrentPasswordAction,
      entityType: localUserEntityType,
      entityId: updated.id,
      occurredAt: transactionTime,
      metadata: isLockedOutcome
        ? createLockedAuditMetadata({
            failedLoginCount: updated.failedLoginCount,
            lockApplied: transition.lockApplied,
            retryAt: transition.retryAt
          })
        : createInvalidCurrentPasswordAuditMetadata({
            failedLoginCount: updated.failedLoginCount
          })
    })

    return createRejectedResult(
      transition.reason === 'ACCOUNT_LOCKED' ? 'ACCOUNT_LOCKED' : 'CURRENT_PASSWORD_INVALID',
      transition.retryAt
    )
  }

  function finalizeAccountInactive({
    context,
    installation,
    observation,
    observationTime
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime
    })

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: null,
      action: passwordChangeRejectedAccountInactiveAction,
      entityType: localUserEntityType,
      entityId: revalidated.authentication.user.id,
      occurredAt: transactionTime,
      metadata: Object.freeze({
        outcome: 'account_inactive'
      })
    })

    return createRejectedResult('ACCOUNT_INACTIVE', null)
  }

  function finalizeChangeNotRequired({
    context,
    installation,
    observation,
    observationTime
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime
    })

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: revalidated.authentication.user.id,
      action: passwordChangeRejectedNotRequiredAction,
      entityType: localUserEntityType,
      entityId: revalidated.authentication.user.id,
      occurredAt: transactionTime,
      metadata: Object.freeze({
        outcome: 'not_required'
      })
    })

    return createRejectedResult('PASSWORD_CHANGE_NOT_REQUIRED', null)
  }

  function finalizeReusedPassword({
    context,
    installation,
    observation,
    observationTime
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime
    })

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: revalidated.authentication.user.id,
      action: passwordChangeRejectedReusedPasswordAction,
      entityType: localUserEntityType,
      entityId: revalidated.authentication.user.id,
      occurredAt: transactionTime,
      metadata: Object.freeze({
        outcome: 'reused_password'
      })
    })

    return createRejectedResult('NEW_PASSWORD_REUSES_CURRENT_PASSWORD', null)
  }

  function finalizeSuccessfulChange({
    context,
    installation,
    observation,
    observationTime,
    nextCredential
  }: {
    readonly context: DatabaseTransactionContext
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
    readonly nextCredential: StoredPasswordCredential
  }): LocalForcedPasswordChangeResult {
    const transactionTime = readTransactionTime(context)
    const revalidated = revalidateObservation({
      installation,
      observation,
      observationTime,
      transactionTime
    })
    const authenticationUpdated = localUserRepository.updateAuthenticationState(
      context.connection,
      {
        id: revalidated.authentication.user.id,
        expected: revalidated.snapshot,
        next: createForcedPasswordChangeProofState(revalidated.snapshot, transactionTime)
      }
    )
    const credentialUpdated = localUserRepository.updateCredentialState(context.connection, {
      id: authenticationUpdated.id,
      expected: Object.freeze({
        credential: revalidated.authentication.credential,
        mustChangePassword: true,
        updatedAt: authenticationUpdated.updatedAt
      }),
      next: Object.freeze({
        credential: nextCredential,
        mustChangePassword: false,
        updatedAt: transactionTime
      })
    })
    const safeUser = freezeLocalUserRecord(credentialUpdated)

    insertAuditEvent(context, {
      installationId: installation.id,
      userId: safeUser.id,
      action: passwordChangeSucceededAction,
      entityType: localUserEntityType,
      entityId: safeUser.id,
      occurredAt: transactionTime,
      metadata: Object.freeze({
        forced_change_completed: true,
        outcome: 'password_changed',
        role: safeUser.role
      })
    })

    return Object.freeze({
      status: 'PASSWORD_CHANGED' as const,
      user: safeUser
    })
  }

  function revalidateObservation({
    installation,
    observation,
    observationTime,
    transactionTime,
    requireActiveLock = false
  }: {
    readonly installation: InstallationRecord
    readonly observation: LocalUserAuthenticationRecord
    readonly observationTime: UtcTimestamp
    readonly transactionTime: UtcTimestamp
    readonly requireActiveLock?: boolean
  }): RevalidatedForcedPasswordChangeObservation {
    assertObservationTimeCanFinalize(observationTime, transactionTime)

    const currentInstallation = installationRepository.get()

    if (currentInstallation === null || currentInstallation.id !== installation.id) {
      throw new LocalForcedPasswordChangeConcurrencyError()
    }

    const currentUser = localUserRepository.getById(observation.user.id)

    if (currentUser === null) {
      throw new LocalForcedPasswordChangeConcurrencyError()
    }

    const currentAuthentication = localUserRepository.getAuthenticationByUsername(
      observation.user.username
    )

    if (currentAuthentication === null) {
      throw new LocalForcedPasswordChangeConcurrencyError()
    }

    requireMatchingAuthenticationObservation(observation, currentAuthentication)
    requireMatchingLocalUserRecord(currentUser, currentAuthentication.user)

    const snapshot = getLocalUserAuthenticationStateSnapshot(currentAuthentication.user)
    const policy = evaluateForcedPasswordChangeState(snapshot, transactionTime)

    if (requireActiveLock && !policy.activeLock) {
      throw new LocalForcedPasswordChangeConcurrencyError()
    }

    return Object.freeze({
      authentication: currentAuthentication,
      snapshot
    })
  }

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
  installationRepository: LocalForcedPasswordChangeServiceDependencies['installationRepository']
): InstallationRecord {
  try {
    const installation = installationRepository.get()

    if (installation === null) {
      throw new LocalForcedPasswordChangeUnavailableError()
    }

    return installation
  } catch (error) {
    if (error instanceof LocalForcedPasswordChangeUnavailableError) {
      throw new LocalForcedPasswordChangeUnavailableError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new LocalForcedPasswordChangeUnavailableError(getErrorType(error))
    }

    throw error
  }
}

function readAuthenticationObservation(
  localUserRepository: LocalForcedPasswordChangeServiceDependencies['localUserRepository'],
  userId: EntityId
): LocalUserAuthenticationRecord {
  try {
    const trustedUser = localUserRepository.getById(userId)

    if (trustedUser === null) {
      throw new LocalForcedPasswordChangeUnavailableError()
    }

    const authentication = localUserRepository.getAuthenticationByUsername(trustedUser.username)

    if (authentication === null) {
      throw new LocalForcedPasswordChangeUnavailableError()
    }

    requireMatchingLocalUserRecord(trustedUser, authentication.user)

    return authentication
  } catch (error) {
    if (error instanceof LocalForcedPasswordChangeUnavailableError) {
      throw new LocalForcedPasswordChangeUnavailableError(error.errorType)
    }

    if (
      error instanceof LocalForcedPasswordChangeConcurrencyError ||
      error instanceof LocalForcedPasswordChangeStateIntegrityError
    ) {
      throw error
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new LocalForcedPasswordChangeUnavailableError(getErrorType(error))
    }

    throw error
  }
}

function readObservationTime(
  clock: LocalForcedPasswordChangeServiceDependencies['clock']
): UtcTimestamp {
  try {
    return clock.now()
  } catch (error) {
    throw new LocalForcedPasswordChangeUnavailableError(getErrorType(error))
  }
}

function readTransactionTime(context: DatabaseTransactionContext): UtcTimestamp {
  try {
    return context.nowUtc()
  } catch (error) {
    if (error instanceof UtcClockError) {
      throw new LocalForcedPasswordChangeUnavailableError(error.errorType)
    }

    throw error
  }
}

async function verifyPassword(
  passwordCredentialService: LocalForcedPasswordChangeServiceDependencies['passwordCredentialService'],
  password: ParsedLocalForcedPasswordChangeInput['currentPassword'],
  credential: StoredPasswordCredential
): Promise<boolean> {
  try {
    return await passwordCredentialService.verify(password, credential)
  } catch (error) {
    if (
      error instanceof PasswordVerificationError ||
      error instanceof PasswordCredentialFormatError ||
      error instanceof PasswordValidationError
    ) {
      throw new LocalForcedPasswordChangeVerificationError(error.errorType)
    }

    throw new LocalForcedPasswordChangeVerificationError(getErrorType(error))
  }
}

async function hashReplacementPassword(
  passwordCredentialService: LocalForcedPasswordChangeServiceDependencies['passwordCredentialService'],
  password: ParsedLocalForcedPasswordChangeInput['newPassword']
): Promise<StoredPasswordCredential> {
  try {
    return await passwordCredentialService.hash(password)
  } catch (error) {
    if (
      error instanceof PasswordHashingError ||
      error instanceof PasswordCredentialFormatError ||
      error instanceof PasswordValidationError
    ) {
      throw new LocalForcedPasswordChangeHashingError(error.errorType)
    }

    throw new LocalForcedPasswordChangeHashingError(getErrorType(error))
  }
}

async function validateReplacementCredential({
  passwordCredentialService,
  currentPassword,
  newPassword,
  currentCredential,
  replacementCredential
}: {
  readonly passwordCredentialService: LocalForcedPasswordChangeServiceDependencies['passwordCredentialService']
  readonly currentPassword: ParsedLocalForcedPasswordChangeInput['currentPassword']
  readonly newPassword: ParsedLocalForcedPasswordChangeInput['newPassword']
  readonly currentCredential: StoredPasswordCredential
  readonly replacementCredential: StoredPasswordCredential
}): Promise<StoredPasswordCredential> {
  try {
    const validatedReplacement = passwordCredentialService.validateCredential(replacementCredential)

    if (credentialsMatch(validatedReplacement, currentCredential)) {
      throw new LocalForcedPasswordChangeHashingError()
    }

    const verifiesNewPassword = await passwordCredentialService.verify(
      newPassword,
      validatedReplacement
    )

    if (verifiesNewPassword !== true) {
      throw new LocalForcedPasswordChangeHashingError()
    }

    const verifiesCurrentPassword = await passwordCredentialService.verify(
      currentPassword,
      validatedReplacement
    )

    if (verifiesCurrentPassword !== false) {
      throw new LocalForcedPasswordChangeHashingError()
    }

    return validatedReplacement
  } catch (error) {
    if (error instanceof LocalForcedPasswordChangeHashingError) {
      throw new LocalForcedPasswordChangeHashingError(error.errorType)
    }

    if (
      error instanceof PasswordHashingError ||
      error instanceof PasswordCredentialFormatError ||
      error instanceof PasswordValidationError ||
      error instanceof PasswordVerificationError
    ) {
      throw new LocalForcedPasswordChangeHashingError(error.errorType)
    }

    throw new LocalForcedPasswordChangeHashingError(getErrorType(error))
  }
}

function credentialsMatch(
  left: StoredPasswordCredential,
  right: StoredPasswordCredential
): boolean {
  return left.passwordHash === right.passwordHash && left.passwordSalt === right.passwordSalt
}

function assertObservationTimeCanFinalize(
  observationTime: UtcTimestamp,
  transactionTime: UtcTimestamp
): void {
  try {
    assertNonDecreasingLocalLoginTime(observationTime, transactionTime)
  } catch (error) {
    throw new LocalForcedPasswordChangeStateIntegrityError(getErrorType(error))
  }
}

function requireMatchingAuthenticationObservation(
  observed: LocalUserAuthenticationRecord,
  current: LocalUserAuthenticationRecord
): void {
  requireMatchingLocalUserRecord(observed.user, current.user)

  if (
    observed.credential.passwordHash !== current.credential.passwordHash ||
    observed.credential.passwordSalt !== current.credential.passwordSalt
  ) {
    throw new LocalForcedPasswordChangeConcurrencyError()
  }
}

function requireMatchingLocalUserRecord(observed: LocalUserRecord, current: LocalUserRecord): void {
  if (
    observed.id !== current.id ||
    observed.username !== current.username ||
    observed.displayName !== current.displayName ||
    observed.role !== current.role ||
    observed.isActive !== current.isActive ||
    observed.mustChangePassword !== current.mustChangePassword ||
    observed.failedLoginCount !== current.failedLoginCount ||
    observed.lockedUntil !== current.lockedUntil ||
    observed.lastLoginAt !== current.lastLoginAt ||
    observed.createdAt !== current.createdAt ||
    observed.updatedAt !== current.updatedAt
  ) {
    throw new LocalForcedPasswordChangeConcurrencyError()
  }
}

function createRejectedResult(
  reason: LocalForcedPasswordChangeRejectionReason,
  retryAt: UtcTimestamp | null
): Extract<LocalForcedPasswordChangeResult, { readonly status: 'REJECTED' }> {
  return Object.freeze({
    status: 'REJECTED' as const,
    reason,
    retryAt
  })
}

function createInvalidCurrentPasswordAuditMetadata({
  failedLoginCount
}: {
  readonly failedLoginCount: number
}): AuditMetadata {
  return Object.freeze({
    failed_login_count: failedLoginCount,
    outcome: 'invalid_current_password'
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
    throw new LocalForcedPasswordChangeStateIntegrityError()
  }

  return Object.freeze({
    failed_login_count: failedLoginCount,
    lock_applied: lockApplied,
    outcome: 'account_locked',
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

function toForcedPasswordChangeBoundaryError(error: unknown): Error {
  if (isLocalForcedPasswordChangeError(error)) {
    return rebuildLocalForcedPasswordChangeError(error)
  }

  if (error instanceof PasswordValidationError) {
    return new LocalForcedPasswordChangeValidationError(error.errorType)
  }

  if (error instanceof PasswordHashingError) {
    return new LocalForcedPasswordChangeHashingError(error.errorType)
  }

  if (
    error instanceof PasswordVerificationError ||
    error instanceof PasswordCredentialFormatError
  ) {
    return new LocalForcedPasswordChangeVerificationError(error.errorType)
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return mapTransactionExecutionError(error)
  }

  if (
    error instanceof LocalUserAuthenticationStateConflictError ||
    error instanceof LocalUserCredentialStateConflictError ||
    error instanceof LocalUserNotFoundError
  ) {
    return new LocalForcedPasswordChangeConcurrencyError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
  }

  if (error instanceof UtcClockError) {
    return new LocalForcedPasswordChangeUnavailableError(error.errorType)
  }

  if (
    error instanceof RepositoryReadError ||
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryWriteError ||
    error instanceof AuditEventAlreadyExistsError ||
    error instanceof DatabaseTransactionStateError ||
    error instanceof DatabaseTransactionAsyncWorkError ||
    error instanceof EntityIdGenerationError
  ) {
    return new LocalForcedPasswordChangePersistenceError(
      getLocalForcedPasswordChangeErrorType(error)
    )
  }

  return new LocalForcedPasswordChangePersistenceError(getLocalForcedPasswordChangeErrorType(error))
}

function mapTransactionExecutionError(error: DatabaseTransactionExecutionError): Error {
  if (error.errorType === 'LocalForcedPasswordChangeValidationError') {
    return new LocalForcedPasswordChangeValidationError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangeUnavailableError') {
    return new LocalForcedPasswordChangeUnavailableError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangeStateIntegrityError') {
    return new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangeConcurrencyError') {
    return new LocalForcedPasswordChangeConcurrencyError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangeVerificationError') {
    return new LocalForcedPasswordChangeVerificationError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangeHashingError') {
    return new LocalForcedPasswordChangeHashingError(error.errorType)
  }

  if (error.errorType === 'LocalForcedPasswordChangePersistenceError') {
    return new LocalForcedPasswordChangePersistenceError(error.errorType)
  }

  if (
    error.errorType === 'LocalUserAuthenticationStateConflictError' ||
    error.errorType === 'LocalUserCredentialStateConflictError' ||
    error.errorType === 'LocalUserNotFoundError'
  ) {
    return new LocalForcedPasswordChangeConcurrencyError(error.errorType)
  }

  if (error.errorType === 'RepositoryDataIntegrityError') {
    return new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
  }

  if (error.errorType === 'UtcClockError') {
    return new LocalForcedPasswordChangeUnavailableError(error.errorType)
  }

  return new LocalForcedPasswordChangePersistenceError(error.errorType)
}
