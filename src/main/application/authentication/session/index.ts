export {
  createProductionLocalAuthenticationSessionService,
  type ProductionLocalAuthenticationSessionServiceOptions
} from './local-session-composition'
export {
  getLocalSessionErrorType,
  isLocalSessionError,
  LocalSessionAuthenticationError,
  LocalSessionAuthorizationError,
  LocalSessionCompositionError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError,
  rebuildLocalSessionError,
  type LocalSessionError,
  type LocalSessionErrorCode
} from './local-session-errors'
export {
  addUtcMilliseconds,
  assertLocalSessionStateInvariants,
  assertNonBackwardLocalSessionTime,
  copyLocalSessionSnapshot,
  createActiveLocalSessionContext,
  createActiveLocalSessionState,
  createLockedLocalSessionState,
  createPasswordChangeRequiredLocalSessionState,
  createSignedOutLocalSessionState,
  evaluateLocalSessionDeadlines,
  localSessionAbsoluteLifetimeHours,
  localSessionAbsoluteLifetimeMilliseconds,
  localSessionIdleTimeoutMilliseconds,
  localSessionIdleTimeoutMinutes,
  localSessionPasswordChangeContextMilliseconds,
  localSessionPasswordChangeContextMinutes,
  refreshActiveLocalSessionActivity,
  type LocalSessionDeadlineEvaluation
} from './local-session-policy'
export { createLocalAuthenticationSessionService } from './local-session-service'
export {
  parseCredentialFreeLocalSessionUser,
  parseLocalSessionPasswordChangeInput,
  parseLocalSessionRoleList,
  parseLocalSessionUnlockInput
} from './local-session-validation'
export type {
  ActiveLocalSessionContext,
  ActiveLocalSessionSnapshot,
  LocalAuthenticationSessionService,
  LocalAuthenticationSessionServiceDependencies,
  LocalSessionLockReason,
  LocalSessionLoginResult,
  LocalSessionPasswordChangeInput,
  LocalSessionPasswordChangeResult,
  LocalSessionSnapshot,
  LocalSessionState,
  LocalSessionUnlockInput,
  LocalSessionUnlockResult,
  ParsedLocalSessionPasswordChangeInput,
  ParsedLocalSessionRoleList,
  ParsedLocalSessionUnlockInput,
  PasswordChangeRequiredLocalSessionSnapshot
} from './local-session-types'
