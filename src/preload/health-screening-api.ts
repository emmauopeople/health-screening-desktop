import {
  appGetHealthRequestSchema,
  appGetHealthResultSchema,
  appGetInfoRequestSchema,
  appGetInfoResultSchema,
  createFirstRunFailure,
  createIpcFailure,
  firstRunGetStateRequestSchema,
  firstRunGetStateResultSchema,
  firstRunInitializeRequestSchema,
  firstRunInitializeResultSchema,
  ipcChannels,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetSummaryRequestSchema,
  patientGetSummaryResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type FirstRunGetStateResult,
  type FirstRunInitializeRequest,
  type FirstRunInitializeResult,
  type HealthScreeningApi,
  type PatientCreateRequest,
  type PatientCreateResult,
  type PatientFindDuplicatesRequest,
  type PatientFindDuplicatesResult,
  type PatientGetSummaryRequest,
  type PatientGetSummaryResult,
  type PatientSearchRequest,
  type PatientSearchResult
} from '@shared/ipc'

import { createAuthenticationApi, type IpcInvoke, type IpcSubscribe } from './authentication-api'

export type { IpcInvoke, IpcSubscribe }

type PatientUnavailableResult = Extract<PatientSearchResult, { ok: false }>

export function createHealthScreeningApi(
  invoke: IpcInvoke,
  subscribe?: IpcSubscribe
): HealthScreeningApi {
  return Object.freeze({
    app: Object.freeze({
      getInfo: () =>
        invokeValidated<AppGetInfoResult>({
          invoke,
          channel: ipcChannels.app.getInfo,
          request: appGetInfoRequestSchema.parse({}),
          resultSchema: appGetInfoResultSchema,
          unavailableResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetInfoResult
        }),
      getHealth: () =>
        invokeValidated<AppGetHealthResult>({
          invoke,
          channel: ipcChannels.app.getHealth,
          request: appGetHealthRequestSchema.parse({}),
          resultSchema: appGetHealthResultSchema,
          unavailableResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetHealthResult
        })
    }),
    firstRun: Object.freeze({
      getState: () =>
        invokeValidated<FirstRunGetStateResult>({
          invoke,
          channel: ipcChannels.firstRun.getState,
          request: firstRunGetStateRequestSchema.parse({}),
          resultSchema: firstRunGetStateResultSchema,
          unavailableResult: createFirstRunFailure('IPC_UNAVAILABLE') as FirstRunGetStateResult
        }),
      initialize: (request: FirstRunInitializeRequest) => {
        const requestResult = safeParseIpcValue(firstRunInitializeRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createFirstRunFailure('VALIDATION_FAILED') as FirstRunInitializeResult
          )
        }

        return invokeValidated<FirstRunInitializeResult>({
          invoke,
          channel: ipcChannels.firstRun.initialize,
          request: requestResult.data,
          resultSchema: firstRunInitializeResultSchema,
          unavailableResult: createFirstRunFailure('IPC_UNAVAILABLE') as FirstRunInitializeResult
        })
      }
    }),
    auth: createAuthenticationApi({ invoke, subscribe }),
    patient: Object.freeze({
      search: (request: PatientSearchRequest) => {
        const requestResult = safeParseIpcValue(patientSearchRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createPatientUnavailableResult('VALIDATION_FAILED') as PatientSearchResult
          )
        }

        return invokeValidated<PatientSearchResult>({
          invoke,
          channel: ipcChannels.patient.search,
          request: requestResult.data,
          resultSchema: patientSearchResultSchema,
          unavailableResult: createPatientUnavailableResult(
            'IPC_UNAVAILABLE'
          ) as PatientSearchResult
        })
      },
      getSummary: (request: PatientGetSummaryRequest) => {
        const requestResult = safeParseIpcValue(patientGetSummaryRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createPatientUnavailableResult('VALIDATION_FAILED') as PatientGetSummaryResult
          )
        }

        return invokeValidated<PatientGetSummaryResult>({
          invoke,
          channel: ipcChannels.patient.getSummary,
          request: requestResult.data,
          resultSchema: patientGetSummaryResultSchema,
          unavailableResult: createPatientUnavailableResult(
            'IPC_UNAVAILABLE'
          ) as PatientGetSummaryResult
        })
      },
      findDuplicates: (request: PatientFindDuplicatesRequest) => {
        const requestResult = safeParseIpcValue(patientFindDuplicatesRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createPatientUnavailableResult('VALIDATION_FAILED') as PatientFindDuplicatesResult
          )
        }

        return invokeValidated<PatientFindDuplicatesResult>({
          invoke,
          channel: ipcChannels.patient.findDuplicates,
          request: requestResult.data,
          resultSchema: patientFindDuplicatesResultSchema,
          unavailableResult: createPatientUnavailableResult(
            'IPC_UNAVAILABLE'
          ) as PatientFindDuplicatesResult
        })
      },
      create: (request: PatientCreateRequest) => {
        const requestResult = safeParseIpcValue(patientCreateRequestSchema, request)

        if (!requestResult.success) {
          return Promise.resolve(
            createPatientUnavailableResult('VALIDATION_FAILED') as PatientCreateResult
          )
        }

        return invokeValidated<PatientCreateResult>({
          invoke,
          channel: ipcChannels.patient.create,
          request: requestResult.data,
          resultSchema: patientCreateResultSchema,
          unavailableResult: createPatientUnavailableResult(
            'IPC_UNAVAILABLE'
          ) as PatientCreateResult
        })
      }
    })
  })
}

interface InvokeValidatedInput<TResult> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  resultSchema: {
    safeParse(value: unknown): { success: true; data: TResult } | { success: false }
  }
  unavailableResult: TResult
}

async function invokeValidated<TResult>({
  invoke,
  channel,
  request,
  resultSchema,
  unavailableResult
}: InvokeValidatedInput<TResult>): Promise<TResult> {
  try {
    const response = await invoke(channel, request)
    const result = safeParseIpcValue(resultSchema, response)

    if (!result.success) {
      return unavailableResult
    }

    return result.data
  } catch {
    return unavailableResult
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

function createPatientUnavailableResult(
  code: 'VALIDATION_FAILED' | 'IPC_UNAVAILABLE'
): PatientUnavailableResult {
  if (code === 'VALIDATION_FAILED') {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.'
      }
    }
  }

  return {
    ok: false,
    error: {
      code: 'IPC_UNAVAILABLE',
      message: 'The desktop service is unavailable.'
    }
  }
}
