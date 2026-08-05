import type {
  PatientAcknowledgmentStatus,
  PatientDemographicAmendmentPublicFieldName,
  PatientDemographicAmendmentReasonCode,
  PatientDemographicAmendmentValue
} from '@shared/ipc'

const demographicFieldLabels = Object.freeze({
  givenName: 'Given name',
  familyName: 'Family name',
  otherNames: 'Other names',
  dateOfBirth: 'Date of birth',
  approximateAgeYears: 'Approximate age',
  ageAsOfDate: 'Age as of date',
  sex: 'Sex',
  village: 'Village',
  quarter: 'Quarter',
  phone: 'Phone',
  alternateContactName: 'Alternate contact',
  alternateContactPhone: 'Alternate phone',
  residenceNotes: 'Residence notes',
  status: 'Status'
} satisfies Record<PatientDemographicAmendmentPublicFieldName, string>)

const demographicReasonLabels = Object.freeze({
  DATA_ENTRY_CORRECTION: 'Data entry correction',
  PATIENT_REPORTED_CHANGE: 'Patient-reported change',
  CONTACT_INFORMATION_UPDATE: 'Contact information update',
  RESIDENCE_INFORMATION_UPDATE: 'Residence information update',
  STATUS_CHANGE: 'Status change',
  OTHER: 'Other'
} satisfies Record<PatientDemographicAmendmentReasonCode, string>)

const acknowledgmentStatusLabels = Object.freeze({
  NOT_REQUESTED: 'Not requested',
  ACKNOWLEDGED: 'Acknowledged',
  DECLINED: 'Declined'
} satisfies Record<PatientAcknowledgmentStatus, string>)

export function formatDemographicFieldLabel(
  fieldName: PatientDemographicAmendmentPublicFieldName
): string {
  return demographicFieldLabels[fieldName]
}

export function formatDemographicReasonLabel(
  reasonCode: PatientDemographicAmendmentReasonCode
): string {
  return demographicReasonLabels[reasonCode]
}

export function formatAcknowledgmentStatusLabel(status: PatientAcknowledgmentStatus): string {
  return acknowledgmentStatusLabels[status]
}

export function formatHistoryValue(value: PatientDemographicAmendmentValue): string {
  if (value === null) {
    return 'Not recorded'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return value
}

export function formatRowVersionTransition(
  priorRowVersion: number | null,
  resultingRowVersion: number | null
): string {
  if (priorRowVersion === null || resultingRowVersion === null) {
    return 'Version information not available'
  }

  return `Version ${priorRowVersion} to ${resultingRowVersion}`
}
