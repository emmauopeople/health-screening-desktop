import type { HistoryResourceType } from '@shared/central-history/contract.mjs'

export const historyTypeLabels: Record<HistoryResourceType, string> = {
  SCREENING_ENCOUNTER: 'Screening encounter',
  VITALS: 'Vitals',
  LIFESTYLE: 'Lifestyle',
  FOOD: 'Food',
  OTC: 'OTC medication',
  REFERRAL: 'Referral',
  REFERRAL_STATUS: 'Referral status change',
  REFERRAL_FOLLOWUP: 'Referral follow-up',
  ENCOUNTER_ADDENDUM: 'Addendum',
  ENCOUNTER_REVIEW_FLAG: 'Review flag',
  ENCOUNTER_REVIEW_STATUS: 'Review status change'
}
export function historyInstant(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
