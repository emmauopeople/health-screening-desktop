export { createLocalLoginAuthenticationService } from './local-login-authentication-service'
export {
  createProductionLocalLoginAuthenticationService,
  type ProductionLocalLoginAuthenticationServiceOptions
} from './local-login-composition'
export {
  getLocalLoginErrorType,
  isLocalLoginError,
  LocalLoginCompositionError,
  LocalLoginConcurrencyError,
  LocalLoginPersistenceError,
  LocalLoginStateIntegrityError,
  LocalLoginUnavailableError,
  LocalLoginValidationError,
  LocalLoginVerificationError,
  rebuildLocalLoginError,
  type LocalLoginError,
  type LocalLoginErrorCode
} from './local-login-errors'
export {
  addLocalLoginLockDuration,
  assertNonDecreasingLocalLoginTime,
  createActiveLockAttemptState,
  createInvalidPasswordTransition,
  createSuccessfulLoginState,
  evaluateLocalLoginPolicyState,
  getLocalUserAuthenticationStateSnapshot,
  localLoginLockDurationMinutes,
  localLoginMaximumFailedAttempts,
  type LocalLoginInvalidPasswordTransition,
  type LocalLoginPolicyEvaluation
} from './local-login-policy'
export { parseLocalLoginInput } from './local-login-validation'
export type {
  LocalLoginAuthenticationService,
  LocalLoginAuthenticationServiceDependencies,
  LocalLoginInput,
  LocalLoginRejectionReason,
  LocalLoginResult,
  ParsedLocalLoginInput
} from './local-login-types'
