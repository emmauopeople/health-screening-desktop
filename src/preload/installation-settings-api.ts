import {
  createInstallationSettingsFailure,
  ipcChannels,
  installationSettingsAssignInitialLocationRequestSchema,
  installationSettingsAssignInitialLocationResultSchema,
  installationSettingsGetConfiguredLocationRequestSchema,
  installationSettingsGetConfiguredLocationResultSchema,
  installationSettingsListEligibleLocationsRequestSchema,
  installationSettingsListEligibleLocationsResultSchema,
  installationSettingsReconfigureLocationRequestSchema,
  installationSettingsReconfigureLocationResultSchema,
  type InstallationSettingsAssignInitialLocationRequest,
  type InstallationSettingsAssignInitialLocationResult,
  type InstallationSettingsGetConfiguredLocationResult,
  type InstallationSettingsListEligibleLocationsResult,
  type InstallationSettingsReconfigureLocationRequest,
  type InstallationSettingsReconfigureLocationResult
} from '@shared/ipc'

import type { IpcInvoke } from './authentication-api'

export interface InstallationSettingsApi {
  getConfiguredLocation(): Promise<InstallationSettingsGetConfiguredLocationResult>
  listEligibleLocations(): Promise<InstallationSettingsListEligibleLocationsResult>
  assignInitialLocation(
    request: InstallationSettingsAssignInitialLocationRequest
  ): Promise<InstallationSettingsAssignInitialLocationResult>
  reconfigureLocation(
    request: InstallationSettingsReconfigureLocationRequest
  ): Promise<InstallationSettingsReconfigureLocationResult>
}

export function createInstallationSettingsApi(invoke: IpcInvoke): InstallationSettingsApi {
  return Object.freeze({
    getConfiguredLocation: () =>
      invokeInstallationSettings({
        invoke,
        channel: ipcChannels.installationSettings.getConfiguredLocation,
        request: {},
        requestSchema: installationSettingsGetConfiguredLocationRequestSchema,
        resultSchema: installationSettingsGetConfiguredLocationResultSchema,
        unavailableFailure: createInstallationSettingsFailure(
          'IPC_UNAVAILABLE'
        ) as InstallationSettingsGetConfiguredLocationResult
      }),
    listEligibleLocations: () =>
      invokeInstallationSettings({
        invoke,
        channel: ipcChannels.installationSettings.listEligibleLocations,
        request: {},
        requestSchema: installationSettingsListEligibleLocationsRequestSchema,
        resultSchema: installationSettingsListEligibleLocationsResultSchema,
        unavailableFailure: createInstallationSettingsFailure(
          'IPC_UNAVAILABLE'
        ) as InstallationSettingsListEligibleLocationsResult
      }),
    assignInitialLocation: (request: InstallationSettingsAssignInitialLocationRequest) =>
      invokeInstallationSettings({
        invoke,
        channel: ipcChannels.installationSettings.assignInitialLocation,
        request,
        requestSchema: installationSettingsAssignInitialLocationRequestSchema,
        resultSchema: installationSettingsAssignInitialLocationResultSchema,
        unavailableFailure: createInstallationSettingsFailure(
          'IPC_UNAVAILABLE'
        ) as InstallationSettingsAssignInitialLocationResult
      }),
    reconfigureLocation: (request: InstallationSettingsReconfigureLocationRequest) =>
      invokeInstallationSettings({
        invoke,
        channel: ipcChannels.installationSettings.reconfigureLocation,
        request,
        requestSchema: installationSettingsReconfigureLocationRequestSchema,
        resultSchema: installationSettingsReconfigureLocationResultSchema,
        unavailableFailure: createInstallationSettingsFailure(
          'IPC_UNAVAILABLE'
        ) as InstallationSettingsReconfigureLocationResult
      })
  })
}

interface InvokeInstallationSettingsInput<TResult> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  requestSchema: {
    safeParse(value: unknown): { success: true; data: unknown } | { success: false }
  }
  resultSchema: {
    safeParse(value: unknown): { success: true; data: TResult } | { success: false }
  }
  unavailableFailure: TResult
}

async function invokeInstallationSettings<TResult>({
  invoke,
  channel,
  request,
  requestSchema,
  resultSchema,
  unavailableFailure
}: InvokeInstallationSettingsInput<TResult>): Promise<TResult> {
  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    return createInstallationSettingsFailure('VALIDATION_FAILED') as TResult
  }

  try {
    const response = await invoke(channel, requestResult.data)
    const responseResult = safeParseIpcValue(resultSchema, response)

    if (!responseResult.success) {
      return unavailableFailure
    }

    return responseResult.data
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
