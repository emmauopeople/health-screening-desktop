import {
  createPatientFailure,
  ipcChannels,
  patientAmendDemographicsRequestSchema,
  patientAmendDemographicsResultSchema,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetRequestSchema,
  patientGetResultSchema,
  patientListAcknowledgmentHistoryRequestSchema,
  patientListAcknowledgmentHistoryResultSchema,
  patientListDemographicAmendmentHistoryRequestSchema,
  patientListDemographicAmendmentHistoryResultSchema,
  patientListRecentRequestSchema,
  patientListRecentResultSchema,
  patientMarkNotDuplicateRequestSchema,
  patientMarkNotDuplicateResultSchema,
  patientRecordAcknowledgmentRequestSchema,
  patientRecordAcknowledgmentResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  type PatientAmendDemographicsRequest,
  type PatientAmendDemographicsResult,
  type PatientCreateRequest,
  type PatientCreateResult,
  type PatientFindDuplicatesRequest,
  type PatientFindDuplicatesResult,
  type PatientGetRequest,
  type PatientGetResult,
  type PatientListAcknowledgmentHistoryRequest,
  type PatientListAcknowledgmentHistoryResult,
  type PatientListDemographicAmendmentHistoryRequest,
  type PatientListDemographicAmendmentHistoryResult,
  type PatientListRecentRequest,
  type PatientListRecentResult,
  type PatientMarkNotDuplicateRequest,
  type PatientMarkNotDuplicateResult,
  type PatientRecordAcknowledgmentRequest,
  type PatientRecordAcknowledgmentResult,
  type PatientSearchRequest,
  type PatientSearchResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface PatientApi {
  search(request: PatientSearchRequest): Promise<PatientSearchResult>
  get(request: PatientGetRequest): Promise<PatientGetResult>
  create(request: PatientCreateRequest): Promise<PatientCreateResult>
  amendDemographics(
    request: PatientAmendDemographicsRequest
  ): Promise<PatientAmendDemographicsResult>
  listDemographicAmendmentHistory(
    request: PatientListDemographicAmendmentHistoryRequest
  ): Promise<PatientListDemographicAmendmentHistoryResult>
  recordAcknowledgment(
    request: PatientRecordAcknowledgmentRequest
  ): Promise<PatientRecordAcknowledgmentResult>
  listAcknowledgmentHistory(
    request: PatientListAcknowledgmentHistoryRequest
  ): Promise<PatientListAcknowledgmentHistoryResult>
  listRecent(request: PatientListRecentRequest): Promise<PatientListRecentResult>
  findDuplicates(request: PatientFindDuplicatesRequest): Promise<PatientFindDuplicatesResult>
  markNotDuplicate(request: PatientMarkNotDuplicateRequest): Promise<PatientMarkNotDuplicateResult>
}

export function createPatientApi(invoke: IpcInvoke): PatientApi {
  return Object.freeze({
    search: (request: PatientSearchRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.search,
        request,
        requestSchema: patientSearchRequestSchema,
        resultSchema: patientSearchResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientSearchResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientSearchResult
      }),
    get: (request: PatientGetRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.get,
        request,
        requestSchema: patientGetRequestSchema,
        resultSchema: patientGetResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientGetResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientGetResult
      }),
    create: (request: PatientCreateRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.create,
        request,
        requestSchema: patientCreateRequestSchema,
        resultSchema: patientCreateResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientCreateResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientCreateResult
      }),
    amendDemographics: (request: PatientAmendDemographicsRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.amendDemographics,
        request,
        requestSchema: patientAmendDemographicsRequestSchema,
        resultSchema: patientAmendDemographicsResultSchema,
        validationFailure: createPatientFailure(
          'VALIDATION_FAILED'
        ) as PatientAmendDemographicsResult,
        unavailableFailure: createPatientFailure(
          'IPC_UNAVAILABLE'
        ) as PatientAmendDemographicsResult
      }),
    listDemographicAmendmentHistory: (request: PatientListDemographicAmendmentHistoryRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.listDemographicAmendmentHistory,
        request,
        requestSchema: patientListDemographicAmendmentHistoryRequestSchema,
        resultSchema: patientListDemographicAmendmentHistoryResultSchema,
        validationFailure: createPatientFailure(
          'VALIDATION_FAILED'
        ) as PatientListDemographicAmendmentHistoryResult,
        unavailableFailure: createPatientFailure(
          'IPC_UNAVAILABLE'
        ) as PatientListDemographicAmendmentHistoryResult
      }),
    recordAcknowledgment: (request: PatientRecordAcknowledgmentRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.recordAcknowledgment,
        request,
        requestSchema: patientRecordAcknowledgmentRequestSchema,
        resultSchema: patientRecordAcknowledgmentResultSchema,
        validationFailure: createPatientFailure(
          'VALIDATION_FAILED'
        ) as PatientRecordAcknowledgmentResult,
        unavailableFailure: createPatientFailure(
          'IPC_UNAVAILABLE'
        ) as PatientRecordAcknowledgmentResult
      }),
    listAcknowledgmentHistory: (request: PatientListAcknowledgmentHistoryRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.listAcknowledgmentHistory,
        request,
        requestSchema: patientListAcknowledgmentHistoryRequestSchema,
        resultSchema: patientListAcknowledgmentHistoryResultSchema,
        validationFailure: createPatientFailure(
          'VALIDATION_FAILED'
        ) as PatientListAcknowledgmentHistoryResult,
        unavailableFailure: createPatientFailure(
          'IPC_UNAVAILABLE'
        ) as PatientListAcknowledgmentHistoryResult
      }),
    listRecent: (request: PatientListRecentRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.listRecent,
        request,
        requestSchema: patientListRecentRequestSchema,
        resultSchema: patientListRecentResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientListRecentResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientListRecentResult
      }),
    findDuplicates: (request: PatientFindDuplicatesRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.findDuplicates,
        request,
        requestSchema: patientFindDuplicatesRequestSchema,
        resultSchema: patientFindDuplicatesResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientFindDuplicatesResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientFindDuplicatesResult
      }),
    markNotDuplicate: (request: PatientMarkNotDuplicateRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.markNotDuplicate,
        request,
        requestSchema: patientMarkNotDuplicateRequestSchema,
        resultSchema: patientMarkNotDuplicateResultSchema,
        validationFailure: createPatientFailure(
          'VALIDATION_FAILED'
        ) as PatientMarkNotDuplicateResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientMarkNotDuplicateResult
      })
  })
}

interface InvokePatientOptions<TRequest, TResult> {
  readonly invoke: IpcInvoke
  readonly channel: string
  readonly request: TRequest
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly validationFailure: TResult
  readonly unavailableFailure: TResult
}

async function invokePatient<TRequest, TResult>({
  invoke,
  channel,
  request,
  requestSchema,
  resultSchema,
  validationFailure,
  unavailableFailure
}: InvokePatientOptions<TRequest, TResult>): Promise<TResult> {
  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    return validationFailure
  }

  try {
    const response = await invoke(channel, requestResult.data)
    const result = safeParseIpcValue(resultSchema, response)

    return result.success ? result.data : unavailableFailure
  } catch {
    return unavailableFailure
  }
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false }
}

function safeParseIpcValue<TResult>(
  schema: IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
