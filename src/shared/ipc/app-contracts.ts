import { z } from 'zod'

import type {
  AuthChangeRequiredPasswordRequest,
  AuthChangeRequiredPasswordResult,
  AuthGetSessionResult,
  AuthLockResult,
  AuthLoginRequest,
  AuthLoginResult,
  AuthLogoutResult,
  AuthRecordActivityResult,
  AuthenticationSessionChangedListener,
  AuthUnlockRequest,
  AuthUnlockResult
} from './authentication-contracts'
import type {
  FirstRunGetStateResult as SharedFirstRunGetStateResult,
  FirstRunInitializeRequest as SharedFirstRunInitializeRequest,
  FirstRunInitializeResult as SharedFirstRunInitializeResult
} from './first-run-contracts'
import type {
  InstallationSettingsAssignInitialLocationRequest,
  InstallationSettingsAssignInitialLocationResult,
  InstallationSettingsGetConfiguredLocationResult,
  InstallationSettingsListEligibleLocationsResult,
  InstallationSettingsReconfigureLocationRequest,
  InstallationSettingsReconfigureLocationResult
} from './installation-settings-contracts'
import type {
  PatientAmendDemographicsRequest,
  PatientAmendDemographicsResult,
  PatientCreateRequest,
  PatientCreateResult,
  PatientFindDuplicatesRequest,
  PatientFindDuplicatesResult,
  PatientGetRequest,
  PatientGetResult,
  PatientListAcknowledgmentHistoryRequest,
  PatientListAcknowledgmentHistoryResult,
  PatientListDemographicAmendmentHistoryRequest,
  PatientListDemographicAmendmentHistoryResult,
  PatientListRecentRequest,
  PatientListRecentResult,
  PatientMarkNotDuplicateRequest,
  PatientMarkNotDuplicateResult,
  PatientRecordAcknowledgmentRequest,
  PatientRecordAcknowledgmentResult,
  PatientSearchRequest,
  PatientSearchResult
} from './patient-contracts'
import { createIpcResultSchema } from './result'
import type {
  ScreeningEncounterStartRequest,
  ScreeningEncounterStartResult,
  ScreeningVitalsCompleteStepResult,
  ScreeningVitalsGetDraftRequest,
  ScreeningVitalsGetDraftResult,
  ScreeningVitalsSaveDraftRequest,
  ScreeningVitalsSaveDraftResult
} from './screening-encounter-contracts'
import type { ScreeningFoodApi } from './screening-food-contracts'
import type { ScreeningLifestyleApi } from './screening-lifestyle-contracts'
import type { ScreeningOtcApi } from './screening-otc-contracts'
import type {
  ScreeningSessionCloseRequest,
  ScreeningSessionCloseResult,
  ScreeningSessionCreateRequest,
  ScreeningSessionCreateResult,
  ScreeningSessionEnsureCurrentResult,
  ScreeningSessionGetByIdRequest,
  ScreeningSessionGetByIdResult,
  ScreeningSessionGetWorkspaceContextResult,
  ScreeningSessionListRequest,
  ScreeningSessionListResult,
  ScreeningSessionReopenRequest,
  ScreeningSessionReopenResult
} from './screening-session-contracts'

export const appGetInfoRequestSchema = z.object({}).strict()
export const appGetHealthRequestSchema = z.object({}).strict()

export type AppGetInfoRequest = z.infer<typeof appGetInfoRequestSchema>
export type AppGetHealthRequest = z.infer<typeof appGetHealthRequestSchema>

export const appInfoSchema = z
  .object({
    applicationName: z.literal('Health Screening Offline Desktop'),
    applicationVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    packaged: z.boolean()
  })
  .strict()

export type AppInfo = z.infer<typeof appInfoSchema>

export const appHealthSchema = z
  .object({
    status: z.literal('ready'),
    ipc: z.literal('available'),
    database: z.union([z.literal('ready'), z.literal('unavailable')]),
    clinicalFeatures: z.literal('not-implemented')
  })
  .strict()

export type AppHealth = z.infer<typeof appHealthSchema>

export const appGetInfoResultSchema = createIpcResultSchema(appInfoSchema)
export const appGetHealthResultSchema = createIpcResultSchema(appHealthSchema)

export type AppGetInfoResult = z.infer<typeof appGetInfoResultSchema>
export type AppGetHealthResult = z.infer<typeof appGetHealthResultSchema>

export interface HealthScreeningApi {
  app: {
    getInfo(): Promise<AppGetInfoResult>
    getHealth(): Promise<AppGetHealthResult>
  }
  firstRun: {
    getState(): Promise<SharedFirstRunGetStateResult>
    initialize(request: SharedFirstRunInitializeRequest): Promise<SharedFirstRunInitializeResult>
  }
  auth: {
    getSession(): Promise<AuthGetSessionResult>
    login(request: AuthLoginRequest): Promise<AuthLoginResult>
    changeRequiredPassword(
      request: AuthChangeRequiredPasswordRequest
    ): Promise<AuthChangeRequiredPasswordResult>
    unlock(request: AuthUnlockRequest): Promise<AuthUnlockResult>
    lock(): Promise<AuthLockResult>
    logout(): Promise<AuthLogoutResult>
    recordActivity(): Promise<AuthRecordActivityResult>
    onSessionChanged(listener: AuthenticationSessionChangedListener): () => void
  }
  patient: {
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
    markNotDuplicate(
      request: PatientMarkNotDuplicateRequest
    ): Promise<PatientMarkNotDuplicateResult>
  }
  screeningSessions: {
    getWorkspaceContext(): Promise<ScreeningSessionGetWorkspaceContextResult>
    ensureCurrent(): Promise<ScreeningSessionEnsureCurrentResult>
    create(request: ScreeningSessionCreateRequest): Promise<ScreeningSessionCreateResult>
    close(request: ScreeningSessionCloseRequest): Promise<ScreeningSessionCloseResult>
    reopen(request: ScreeningSessionReopenRequest): Promise<ScreeningSessionReopenResult>
    getById(request: ScreeningSessionGetByIdRequest): Promise<ScreeningSessionGetByIdResult>
    list(request: ScreeningSessionListRequest): Promise<ScreeningSessionListResult>
  }
  screeningEncounters: {
    start(request: ScreeningEncounterStartRequest): Promise<ScreeningEncounterStartResult>
    vitals: {
      getDraft(request: ScreeningVitalsGetDraftRequest): Promise<ScreeningVitalsGetDraftResult>
      saveDraft(request: ScreeningVitalsSaveDraftRequest): Promise<ScreeningVitalsSaveDraftResult>
      completeStep(
        request: ScreeningVitalsSaveDraftRequest
      ): Promise<ScreeningVitalsCompleteStepResult>
    }
    lifestyle: ScreeningLifestyleApi
    food: ScreeningFoodApi
    otc: ScreeningOtcApi
  }
  installationSettings: {
    getConfiguredLocation(): Promise<InstallationSettingsGetConfiguredLocationResult>
    listEligibleLocations(): Promise<InstallationSettingsListEligibleLocationsResult>
    assignInitialLocation(
      request: InstallationSettingsAssignInitialLocationRequest
    ): Promise<InstallationSettingsAssignInitialLocationResult>
    reconfigureLocation(
      request: InstallationSettingsReconfigureLocationRequest
    ): Promise<InstallationSettingsReconfigureLocationResult>
  }
}
