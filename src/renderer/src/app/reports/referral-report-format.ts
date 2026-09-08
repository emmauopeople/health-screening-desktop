import type { PublicReferralDetail } from '@shared/ipc'

export function referralTreatmentSummary(referral: PublicReferralDetail): string {
  const actions = Array.from(
    new Set(referral.followups.flatMap((followup) => followup.treatmentActions.map(formatCode)))
  )
  return actions.length === 0 ? 'None recorded' : actions.join(', ')
}

export function referralMedicationSummary(referral: PublicReferralDetail): string {
  const medications = Array.from(
    new Set(
      referral.followups.flatMap((followup) =>
        followup.medicationChanges.map((medication) => {
          const details = [
            medication.medicationName,
            medication.dosage,
            medication.frequency
          ].filter((value): value is string => value !== null)
          return `${formatCode(medication.changeType)}: ${details.join(' / ')}`
        })
      )
    )
  )
  return medications.length === 0 ? 'None recorded' : medications.join('; ')
}

export function formatReferralReason(referral: PublicReferralDetail): string {
  const reason = referral.reasonText ?? referral.reasonCodes.map(formatCode).join(', ')
  const bloodPressure = referral.triggeringBloodPressure
  return bloodPressure === undefined || bloodPressure === null
    ? reason
    : `${reason} - BP ${bloodPressure.systolic}/${bloodPressure.diastolic} mmHg`
}

function formatCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}
