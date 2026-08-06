import type {
  PublicScreeningSession,
  PublicScreeningSessionWorkspaceLocation,
  ScreeningSessionErrorCode,
  ScreeningSessionStatus
} from '@shared/ipc'

export const screeningSessionPageSizes = Object.freeze([25, 50, 100] as const)

export type ScreeningSessionWorkspaceCommandId =
  'HOME_TODAYS_SESSION' | 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'

export type ScreeningSessionTextValidationResult =
  | { readonly status: 'VALID'; readonly value: string | null }
  | { readonly status: 'INVALID'; readonly message: string }

export function formatScreeningSessionStatus(status: ScreeningSessionStatus): string {
  return status === 'OPEN' ? 'Open' : 'Closed'
}

export function formatScreeningSessionTimestamp(timestamp: string | null): string {
  if (timestamp === null) {
    return 'Not recorded'
  }

  return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC`
}

export function formatProtocolVersionLabel(protocolVersionId: string): string {
  return `Protocol version ${protocolVersionId.slice(-8)}`
}

export function createSessionIdentityText(
  session: PublicScreeningSession,
  locations: readonly PublicScreeningSessionWorkspaceLocation[]
): string {
  return `${resolveLocationName(session.locationId, locations)} on ${session.sessionDate}`
}

export function resolveLocationName(
  locationId: string,
  locations: readonly PublicScreeningSessionWorkspaceLocation[]
): string {
  return locations.find((location) => location.id === locationId)?.name ?? 'Location on record'
}

export function validateOptionalLifecycleText(
  value: string,
  fieldLabel: string
): ScreeningSessionTextValidationResult {
  const textValidation = validateLifecycleTextSafety(value, fieldLabel)

  if (textValidation !== null) {
    return textValidation
  }

  if (value.length === 0 || value.trim().length === 0) {
    return { status: 'VALID', value: null }
  }

  return { status: 'VALID', value }
}

export function validateRequiredLifecycleText(
  value: string,
  fieldLabel: string
): ScreeningSessionTextValidationResult {
  if (value.trim().length === 0) {
    return { status: 'INVALID', message: `${fieldLabel} is required.` }
  }

  const textValidation = validateLifecycleTextSafety(value, fieldLabel)

  if (textValidation !== null) {
    return textValidation
  }

  return { status: 'VALID', value }
}

export function getScreeningSessionFailureMessage(code: ScreeningSessionErrorCode): string {
  switch (code) {
    case 'VALIDATION_FAILED':
      return 'Review the session details and try again.'
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to manage screening sessions.'
    case 'IPC_UNAVAILABLE':
      return 'The desktop service is unavailable. Try again after local services reconnect.'
    case 'INTERNAL_ERROR':
      return 'The application could not complete the screening-session request.'
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required before managing screening sessions.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'The active session is not authorized for this screening-session action.'
  }
}

export function isProtectedScreeningSessionFailure(code: ScreeningSessionErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}

function validateLifecycleTextSafety(
  value: string,
  fieldLabel: string
): Extract<ScreeningSessionTextValidationResult, { readonly status: 'INVALID' }> | null {
  if (Array.from(value).length > 500) {
    return { status: 'INVALID', message: `${fieldLabel} must be 500 characters or fewer.` }
  }

  if (hasUnsafeLifecycleControl(value)) {
    return {
      status: 'INVALID',
      message: `${fieldLabel} contains unsupported control characters.`
    }
  }

  if (hasUnpairedSurrogate(value)) {
    return { status: 'INVALID', message: `${fieldLabel} contains unsupported characters.` }
  }

  return null
}

function hasUnsafeLifecycleControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (
      codePoint !== undefined &&
      ((codePoint >= 0x00 && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true
    }
  }

  return false
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true
      }

      index += 1
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }

  return false
}
