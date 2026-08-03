import type { PatientSex, PublicPatientSummary } from '@shared/ipc'

export function formatPatientResidence(patient: PublicPatientSummary): string {
  if (patient.village === null && patient.quarter === null) {
    return 'Not available'
  }

  if (patient.village !== null && patient.quarter !== null) {
    return `${patient.village} / ${patient.quarter}`
  }

  return patient.village ?? patient.quarter ?? 'Not available'
}

export function formatPatientSex(sex: PatientSex | null): string {
  switch (sex) {
    case 'FEMALE':
      return 'Female'
    case 'MALE':
      return 'Male'
    case 'OTHER':
      return 'Other'
    case 'UNKNOWN':
      return 'Unknown'
    default:
      return 'Not available'
  }
}

export function formatUnavailableClinicalValue(): string {
  return 'Not available'
}

export function formatPatientTabLabel(patient: PublicPatientSummary): string {
  return `${patient.patientCode} ${patient.displayName}`
}
