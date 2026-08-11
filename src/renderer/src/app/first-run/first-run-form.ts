import type { FirstRunInitializeRequest, FirstRunLocationType } from '@shared/ipc'

export const defaultFirstRunTimeZone = 'Africa/Douala'
export const passwordMismatchMessage = 'Passwords do not match'
export const reviewFormMessage = 'Review the form and correct missing or invalid values.'

export const firstRunFormCopy = {
  heading: 'Set up this screening installation.',
  statement:
    'This one-time setup creates the local installation, first administrator, and configured screening location on this computer.',
  offlineStatement: 'Internet access is not required for this setup.',
  submitLabel: 'Initialize application',
  submittingLabel: 'Initializing local application...',
  exitLabel: 'Exit application'
} as const

export const firstRunLocationTypeOptions = [
  { value: 'CHURCH', label: 'Church' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'VILLAGE', label: 'Village' },
  { value: 'COMMUNITY_SITE', label: 'Community site' },
  { value: 'OTHER', label: 'Other' }
] as const satisfies ReadonlyArray<{ value: FirstRunLocationType; label: string }>

export const firstRunFormFieldsets = [
  {
    legend: 'Installation',
    fields: [
      { name: 'deploymentName', label: 'Deployment name', required: true },
      { name: 'timeZone', label: 'Time zone', required: true }
    ]
  },
  {
    legend: 'Administrator',
    fields: [
      { name: 'username', label: 'Administrator username', required: true },
      { name: 'displayName', label: 'Administrator display name', required: true },
      { name: 'temporaryPassword', label: 'Temporary password', required: true },
      { name: 'confirmTemporaryPassword', label: 'Confirm temporary password', required: true }
    ]
  },
  {
    legend: 'Configured screening location',
    fields: [
      { name: 'locationName', label: 'Location name', required: true },
      { name: 'locationType', label: 'Location type', required: true },
      { name: 'village', label: 'Village', required: false },
      { name: 'subdivision', label: 'Subdivision', required: false },
      { name: 'region', label: 'Region', required: false },
      { name: 'directions', label: 'Directions', required: false }
    ]
  }
] as const

export interface FirstRunSetupFormValues {
  deploymentName: string | null
  timeZone: string | null
  username: string | null
  displayName: string | null
  temporaryPassword: string | null
  confirmTemporaryPassword: string | null
  locationName: string | null
  locationType: string | null
  village: string | null
  subdivision: string | null
  region: string | null
  directions: string | null
}

export interface FormDataReader {
  get(name: string): unknown
}

export function readFirstRunSetupFormValues(formData: FormDataReader): FirstRunSetupFormValues {
  return {
    deploymentName: stringFormValue(formData.get('deploymentName')),
    timeZone: stringFormValue(formData.get('timeZone')),
    username: stringFormValue(formData.get('username')),
    displayName: stringFormValue(formData.get('displayName')),
    temporaryPassword: stringFormValue(formData.get('temporaryPassword')),
    confirmTemporaryPassword: stringFormValue(formData.get('confirmTemporaryPassword')),
    locationName: stringFormValue(formData.get('locationName')),
    locationType: stringFormValue(formData.get('locationType')),
    village: stringFormValue(formData.get('village')),
    subdivision: stringFormValue(formData.get('subdivision')),
    region: stringFormValue(formData.get('region')),
    directions: stringFormValue(formData.get('directions'))
  }
}

export function createFirstRunInitializeRequest(
  values: FirstRunSetupFormValues
): FirstRunInitializeRequest {
  return {
    deploymentName: requiredText(values.deploymentName),
    timeZone: requiredText(values.timeZone),
    administrator: {
      username: requiredText(values.username),
      displayName: requiredText(values.displayName),
      temporaryPassword: requiredText(values.temporaryPassword)
    },
    initialLocation: {
      name: requiredText(values.locationName),
      locationType: requiredLocationType(values.locationType),
      village: optionalText(values.village),
      subdivision: optionalText(values.subdivision),
      region: optionalText(values.region),
      directions: optionalText(values.directions)
    }
  }
}

export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  return value.trim().length === 0 ? null : value
}

export function passwordsMatch(values: FirstRunSetupFormValues): boolean {
  return (
    typeof values.temporaryPassword === 'string' &&
    values.temporaryPassword === values.confirmTemporaryPassword
  )
}

function stringFormValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function requiredText(value: string | null): string {
  if (typeof value !== 'string') {
    throw new Error('Required first-run form value is missing.')
  }

  return value
}

function requiredLocationType(value: string | null): FirstRunLocationType {
  const match = firstRunLocationTypeOptions.find((option) => option.value === value)

  if (match === undefined) {
    throw new Error('First-run location type is invalid.')
  }

  return match.value
}
