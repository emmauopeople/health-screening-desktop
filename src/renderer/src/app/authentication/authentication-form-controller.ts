import type {
  AuthChangeRequiredPasswordRequest,
  AuthLoginRequest,
  AuthUnlockRequest
} from '@shared/ipc'

export type AuthenticationOperationState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'SUBMITTING' }
  | { readonly status: 'ERROR'; readonly message: string }

export interface AuthenticationFormController {
  getState(): AuthenticationOperationState
  begin(): number | null
  isCurrent(operationId: number): boolean
  complete(operationId: number): void
  fail(operationId: number, message: string): void
  reset(): void
  dispose(): void
}

export interface AuthenticationFormControllerOptions {
  readonly onState?: (state: AuthenticationOperationState) => void
}

export interface FormDataReader {
  get(name: string): unknown
}

export interface LoginFormValues {
  readonly username: string | null
  readonly password: string | null
}

export interface RequiredPasswordChangeFormValues {
  readonly currentPassword: string | null
  readonly newPassword: string | null
  readonly confirmNewPassword: string | null
}

export interface UnlockFormValues {
  readonly password: string | null
}

export const authenticationFormCopy = {
  reviewFormMessage: 'Review the form and correct missing or invalid values.',
  loginHeading: 'Login',
  loginSubmitLabel: 'Sign In',
  loginSubmittingLabel: 'Signing in...',
  passwordChangeHeading: 'Change required password.',
  passwordChangeStatement: 'This local account must set a new password before work can continue.',
  passwordChangeSubmitLabel: 'Change password',
  passwordChangeSubmittingLabel: 'Changing password...',
  lockedHeading: 'Session Locked',
  unlockSubmitLabel: 'Unlock',
  unlockSubmittingLabel: 'Unlocking...',
  lockLabel: 'Lock',
  lockingLabel: 'Locking...',
  signOutLabel: 'Sign out',
  signingOutLabel: 'Signing out...',
  exitLabel: 'Exit application',
  loginExitLabel: 'Exit Application'
} as const

export const authenticationPasswordHelp =
  'Use the local password for this account. The desktop service validates the password policy.'

export function createAuthenticationFormController({
  onState = noop
}: AuthenticationFormControllerOptions = {}): AuthenticationFormController {
  let state: AuthenticationOperationState = Object.freeze({ status: 'IDLE' as const })
  let activeOperationId: number | undefined
  let sequence = 0
  let disposed = false

  function setState(nextState: AuthenticationOperationState): void {
    state = Object.freeze(nextState)
    onState(state)
  }

  function isCurrent(operationId: number): boolean {
    return !disposed && activeOperationId === operationId
  }

  return Object.freeze({
    getState(): AuthenticationOperationState {
      return state
    },
    begin(): number | null {
      if (disposed || state.status === 'SUBMITTING') {
        return null
      }

      sequence += 1
      activeOperationId = sequence
      setState({ status: 'SUBMITTING' })

      return activeOperationId
    },
    isCurrent(operationId: number): boolean {
      return isCurrent(operationId)
    },
    complete(operationId: number): void {
      if (!isCurrent(operationId)) {
        return
      }

      activeOperationId = undefined
      setState({ status: 'IDLE' })
    },
    fail(operationId: number, message: string): void {
      if (!isCurrent(operationId)) {
        return
      }

      activeOperationId = undefined
      setState({ status: 'ERROR', message })
    },
    reset(): void {
      if (disposed) {
        return
      }

      activeOperationId = undefined
      setState({ status: 'IDLE' })
    },
    dispose(): void {
      disposed = true
      activeOperationId = undefined
    }
  })
}

function noop(): void {
  return undefined
}

export function readLoginFormValues(formData: FormDataReader): LoginFormValues {
  return {
    username: stringFormValue(formData.get('username')),
    password: stringFormValue(formData.get('password'))
  }
}

export function createLoginRequest(values: LoginFormValues): AuthLoginRequest {
  return {
    username: requiredText(values.username),
    password: requiredText(values.password)
  }
}

export function readRequiredPasswordChangeFormValues(
  formData: FormDataReader
): RequiredPasswordChangeFormValues {
  return {
    currentPassword: stringFormValue(formData.get('currentPassword')),
    newPassword: stringFormValue(formData.get('newPassword')),
    confirmNewPassword: stringFormValue(formData.get('confirmNewPassword'))
  }
}

export function createRequiredPasswordChangeRequest(
  values: RequiredPasswordChangeFormValues
): AuthChangeRequiredPasswordRequest {
  return {
    currentPassword: requiredText(values.currentPassword),
    newPassword: requiredText(values.newPassword),
    confirmNewPassword: requiredText(values.confirmNewPassword)
  }
}

export function requiredPasswordChangeFieldsMatch(
  values: RequiredPasswordChangeFormValues
): boolean {
  return typeof values.newPassword === 'string' && values.newPassword === values.confirmNewPassword
}

export function readUnlockFormValues(formData: FormDataReader): UnlockFormValues {
  return {
    password: stringFormValue(formData.get('password'))
  }
}

export function createUnlockRequest(values: UnlockFormValues): AuthUnlockRequest {
  return {
    password: requiredText(values.password)
  }
}

export function clearAuthenticationPasswordFields(form: HTMLFormElement): void {
  for (const control of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    control.value = ''
  }
}

export function focusFirstInvalidAuthenticationControl(form: HTMLFormElement): void {
  const invalidControl = form.querySelector<HTMLInputElement>('input:invalid')

  invalidControl?.focus()
}

function stringFormValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function requiredText(value: string | null): string {
  if (typeof value !== 'string') {
    throw new Error('Required authentication form value is missing.')
  }

  return value
}
