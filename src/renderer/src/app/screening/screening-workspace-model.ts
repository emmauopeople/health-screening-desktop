import type {
  PatientErrorCode,
  PatientSex,
  PublicPatientSummary,
  ScreeningEncounterStartSuccessData,
  ScreeningSessionErrorCode
} from '@shared/ipc'

export type ScreeningStepId = 'VITALS' | 'LIFESTYLE' | 'FOOD' | 'OTC' | 'REVIEW'

export interface ScreeningStepDefinition {
  readonly id: ScreeningStepId
  readonly label: string
}

export const screeningSteps: readonly ScreeningStepDefinition[] = Object.freeze([
  Object.freeze({ id: 'VITALS', label: 'Vitals' }),
  Object.freeze({ id: 'LIFESTYLE', label: 'Lifestyle' }),
  Object.freeze({ id: 'FOOD', label: 'Food' }),
  Object.freeze({ id: 'OTC', label: 'OTC Medications' }),
  Object.freeze({ id: 'REVIEW', label: 'Review' })
])

export function getPatientTabLabel(patient: PublicPatientSummary): string {
  return patient.displayName
}

export function formatPatientDemographicSummary(patient: PublicPatientSummary): string {
  const ageText =
    patient.approximateAgeYears !== null
      ? `${patient.approximateAgeYears} years`
      : patient.dateOfBirth !== null
        ? `Born ${patient.dateOfBirth}`
        : 'Age not recorded'
  const villageText = patient.village ?? 'Village not recorded'

  return `${ageText} | ${formatPatientSex(patient.sex)} | ${villageText}`
}

export function formatPatientContact(patient: PublicPatientSummary): string {
  return patient.phone ?? 'No phone recorded'
}

export function formatPatientSex(sex: PatientSex): string {
  switch (sex) {
    case 'FEMALE':
      return 'Female'
    case 'MALE':
      return 'Male'
    case 'OTHER':
      return 'Other'
    case 'UNKNOWN':
      return 'Sex not recorded'
  }
}

export function getInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.at(0)?.toUpperCase() ?? '')
    .join('')

  return initials.length > 0 ? initials : 'P'
}

export function getPatientFailureMessage(code: PatientErrorCode): string {
  switch (code) {
    case 'VALIDATION_FAILED':
      return 'Review the patient search and try again.'
    case 'IPC_FORBIDDEN':
      return 'This window cannot search patients.'
    case 'IPC_UNAVAILABLE':
      return 'Patient search is unavailable. Try again after local services reconnect.'
    case 'INTERNAL_ERROR':
      return 'The application could not complete the patient search.'
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required before searching patients.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'The active session is not authorized to search patients.'
  }
}

export function getSessionFailureMessage(code: ScreeningSessionErrorCode): string {
  switch (code) {
    case 'VALIDATION_FAILED':
      return 'Review the session selection and try again.'
    case 'IPC_FORBIDDEN':
      return 'This window cannot load screening sessions.'
    case 'IPC_UNAVAILABLE':
      return 'Screening sessions are unavailable. Try again after local services reconnect.'
    case 'INTERNAL_ERROR':
      return 'The application could not load screening sessions.'
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required before screening.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'The active session is not authorized for screening sessions.'
  }
}

export function isProtectedPatientFailure(code: PatientErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}

export function isProtectedSessionFailure(code: ScreeningSessionErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}

export function getEncounterStartMessage(status: ScreeningEncounterStartSuccessData['status']): {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
} {
  switch (status) {
    case 'STARTED':
      return { tone: 'STATUS', text: 'Screening encounter started.' }
    case 'ALREADY_EXISTS':
      return { tone: 'STATUS', text: 'Existing screening encounter opened.' }
    case 'PATIENT_NOT_FOUND':
      return { tone: 'ALERT', text: 'The selected patient is no longer available.' }
    case 'PATIENT_INELIGIBLE':
      return { tone: 'ALERT', text: 'This patient is not eligible for screening.' }
    case 'SESSION_NOT_FOUND':
      return { tone: 'ALERT', text: 'The selected screening session is no longer available.' }
    case 'SESSION_CLOSED':
      return { tone: 'ALERT', text: 'This screening session is closed.' }
    case 'SESSION_NOT_CURRENT':
      return { tone: 'ALERT', text: 'Use an open screening session for today.' }
    case 'LOCATION_NOT_FOUND':
      return { tone: 'ALERT', text: 'The session location is no longer available.' }
    case 'LOCATION_INACTIVE':
      return { tone: 'ALERT', text: 'The session location is inactive.' }
    case 'FORBIDDEN':
      return { tone: 'ALERT', text: 'You are not authorized to start screening here.' }
    case 'VALIDATION_FAILED':
      return { tone: 'ALERT', text: 'Review the selected patient and session.' }
    case 'AUTHENTICATION_REQUIRED':
      return { tone: 'ALERT', text: 'Sign in is required before screening.' }
    case 'UNAVAILABLE':
      return { tone: 'ALERT', text: 'Screening start is unavailable. Try again.' }
  }
}
