import type {
  ScreeningOtcGetWorkspaceRequest,
  ScreeningOtcSaveDraftRequest,
  ScreeningOtcWorkspace
} from '@shared/ipc'

export const otcEncounterId = '88888888-8888-4888-8888-888888888888'
export const otcDraftId = '99999999-9999-4999-8999-999999999999'
export const otcDraftRowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const otcTimestamp = '2026-08-19T12:00:00.000Z'

export const validOtcGetWorkspaceRequest: ScreeningOtcGetWorkspaceRequest = {
  encounterId: otcEncounterId
}

export const validOtcSaveDraftRequest: ScreeningOtcSaveDraftRequest = {
  encounterId: otcEncounterId,
  expectedVersion: null,
  otcResponse: 'REPORTED',
  rows: [
    {
      id: null,
      sequenceNumber: 1,
      productName: 'Pain reliever',
      reasonForUse: 'Headache',
      doseText: '1 tablet',
      frequencyText: 'Daily',
      durationText: '2 days',
      sourceOfMedication: 'Pharmacy',
      currentlyTakingResponse: 'YES'
    }
  ]
}

export const validOtcWorkspace: ScreeningOtcWorkspace = {
  encounterId: otcEncounterId,
  draft: {
    id: otcDraftId,
    encounterId: otcEncounterId,
    otcResponse: 'REPORTED',
    rowVersion: 1,
    periodStart: '2026-08-13',
    periodEnd: '2026-08-19',
    rows: [
      {
        id: otcDraftRowId,
        sequenceNumber: 1,
        productNameSnapshot: 'Pain reliever',
        productNameNormalized: 'pain reliever',
        reasonForUse: 'Headache',
        doseText: '1 tablet',
        frequencyText: 'Daily',
        durationText: '2 days',
        sourceOfMedication: 'Pharmacy',
        currentlyTakingResponse: 'YES',
        updatedAt: otcTimestamp
      }
    ],
    updatedAt: otcTimestamp
  },
  recentMedications: [{ productNameSnapshot: 'Cough syrup' }]
}

Object.freeze(validOtcGetWorkspaceRequest)
Object.freeze(validOtcSaveDraftRequest.rows[0])
Object.freeze(validOtcSaveDraftRequest.rows)
Object.freeze(validOtcSaveDraftRequest)
Object.freeze(validOtcWorkspace.draft?.rows[0])
Object.freeze(validOtcWorkspace.draft?.rows)
Object.freeze(validOtcWorkspace.draft)
Object.freeze(validOtcWorkspace.recentMedications[0])
Object.freeze(validOtcWorkspace.recentMedications)
Object.freeze(validOtcWorkspace)
