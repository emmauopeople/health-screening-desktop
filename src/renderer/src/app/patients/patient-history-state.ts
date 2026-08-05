import type {
  PublicPatientAcknowledgmentHistoryRecord,
  PublicPatientDemographicAmendmentRecord
} from '@shared/ipc'

export type PatientHistoryPageSize = 25 | 50 | 100

export type DemographicHistoryItem = PublicPatientDemographicAmendmentRecord
export type AcknowledgmentHistoryItem = PublicPatientAcknowledgmentHistoryRecord

export type HistoryLoadState<TItem> =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'LOADING'
      readonly page: number
      readonly pageSize: PatientHistoryPageSize
    }
  | {
      readonly status: 'READY'
      readonly items: readonly TItem[]
      readonly page: number
      readonly pageSize: PatientHistoryPageSize
      readonly total: number
    }
  | {
      readonly status: 'EMPTY'
      readonly page: number
      readonly pageSize: PatientHistoryPageSize
    }
  | {
      readonly status: 'ERROR'
      readonly message: string
      readonly page: number
      readonly pageSize: PatientHistoryPageSize
    }
