export { createOtcRepository } from './otc-repository'
export {
  normalizeOtcDoseText,
  normalizeOtcDurationText,
  normalizeOtcFrequencyText,
  normalizeOtcProductName,
  normalizeOtcReasonForUse,
  normalizeOtcSourceOfMedication,
  normalizeOptionalOtcProductName,
  isRowPermittingOtcResponse,
  otcCurrentlyTakingResponseCodes,
  otcResponseCodes,
  otcSourceTypes,
  parseOtcDate,
  parseOtcDraftOwnershipInput,
  parseOtcDraftUpdateInput
} from './otc-validation'
export type {
  OtcCurrentlyTakingResponse,
  OtcDate,
  OtcDraftOwnershipInput,
  OtcDraftRecord,
  OtcDraftRowInput,
  OtcDraftRowRecord,
  OtcDraftUpdateInput,
  OtcDraftUpdateResult,
  OtcRecentMedicationSuggestionRecord,
  OtcRepository,
  OtcResponse,
  OtcSourceType
} from './otc-types'
