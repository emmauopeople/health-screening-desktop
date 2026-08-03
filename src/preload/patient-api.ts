import {
  createPatientFailure,
  ipcChannels,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetRequestSchema,
  patientGetResultSchema,
  patientListRecentRequestSchema,
  patientListRecentResultSchema,
  patientMarkNotDuplicateRequestSchema,
  patientMarkNotDuplicateResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  patientUpdateRequestSchema,
  patientUpdateResultSchema,
  type PatientCreateRequest,
  type PatientCreateResult,
  type PatientFindDuplicatesRequest,
  type PatientFindDuplicatesResult,
  type PatientGetRequest,
  type PatientGetResult,
  type PatientListRecentRequest,
  type PatientListRecentResult,
  type PatientMarkNotDuplicateRequest,
  type PatientMarkNotDuplicateResult,
  type PatientSearchRequest,
  type PatientSearchResult,
  type PatientUpdateRequest,
  type PatientUpdateResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface PatientApi {
  search(request: PatientSearchRequest): Promise<PatientSearchResult>
  get(request: PatientGetRequest): Promise<PatientGetResult>
  create(request: PatientCreateRequest): Promise<PatientCreateResult>
  update(request: PatientUpdateRequest): Promise<PatientUpdateResult>
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
    update: (request: PatientUpdateRequest) =>
      invokePatient({
        invoke,
        channel: ipcChannels.patient.update,
        request,
        requestSchema: patientUpdateRequestSchema,
        resultSchema: patientUpdateResultSchema,
        validationFailure: createPatientFailure('VALIDATION_FAILED') as PatientUpdateResult,
        unavailableFailure: createPatientFailure('IPC_UNAVAILABLE') as PatientUpdateResult
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
