export const ipcChannels = {
  app: {
    getInfo: 'health-screening:app:get-info',
    getHealth: 'health-screening:app:get-health'
  },
  firstRun: {
    getState: 'health-screening:first-run:get-state',
    initialize: 'health-screening:first-run:initialize'
  },
  auth: {
    getSession: 'health-screening:auth:get-session',
    login: 'health-screening:auth:login',
    changeRequiredPassword: 'health-screening:auth:change-required-password',
    unlock: 'health-screening:auth:unlock',
    lock: 'health-screening:auth:lock',
    logout: 'health-screening:auth:logout',
    recordActivity: 'health-screening:auth:record-activity',
    sessionChanged: 'health-screening:auth:session-changed'
  },
  patient: {
    search: 'health-screening:patient:search',
    get: 'health-screening:patient:get',
    create: 'health-screening:patient:create',
    amendDemographics: 'health-screening:patient:amend-demographics',
    listDemographicAmendmentHistory: 'health-screening:patient:list-demographic-amendment-history',
    recordAcknowledgment: 'health-screening:patient:record-acknowledgment',
    listAcknowledgmentHistory: 'health-screening:patient:list-acknowledgment-history',
    listRecent: 'health-screening:patient:list-recent',
    findDuplicates: 'health-screening:patient:find-duplicates',
    markNotDuplicate: 'health-screening:patient:mark-not-duplicate'
  },
  screeningSessions: {
    getWorkspaceContext: 'health-screening:screening-sessions:get-workspace-context',
    ensureCurrent: 'health-screening:screening-sessions:ensure-current',
    create: 'health-screening:screening-sessions:create',
    close: 'health-screening:screening-sessions:close',
    reopen: 'health-screening:screening-sessions:reopen',
    getById: 'health-screening:screening-sessions:get-by-id',
    list: 'health-screening:screening-sessions:list'
  },
  referrals: {
    search: 'health-screening:referrals:search',
    getDetail: 'health-screening:referrals:get-detail',
    updateStatus: 'health-screening:referrals:update-status',
    recordFollowup: 'health-screening:referrals:record-followup'
  },
  screeningEncounters: {
    start: 'health-screening:screening-encounters:start',
    complete: 'health-screening:screening-encounters:complete',
    getVitalsDraft: 'health-screening:screening-encounters:vitals:get-draft',
    saveVitalsDraft: 'health-screening:screening-encounters:vitals:save-draft',
    completeVitalsStep: 'health-screening:screening-encounters:vitals:complete-step',
    management: {
      search: 'health-screening:screening-encounters:management:search',
      getDetail: 'health-screening:screening-encounters:management:get-detail',
      getPatientContext: 'health-screening:screening-encounters:management:get-patient-context',
      addAddendum: 'health-screening:screening-encounters:management:add-addendum',
      openFlag: 'health-screening:screening-encounters:management:open-flag',
      resolveFlag: 'health-screening:screening-encounters:management:resolve-flag',
      cancelDraft: 'health-screening:screening-encounters:management:cancel-draft',
      voidEmptyDraft: 'health-screening:screening-encounters:management:void-empty-draft'
    },
    lifestyle: {
      getWorkspace: 'health-screening:screening-encounters:lifestyle:get-workspace',
      saveAlcoholBaseline: 'health-screening:screening-encounters:lifestyle:save-alcohol-baseline',
      saveTobaccoBaseline: 'health-screening:screening-encounters:lifestyle:save-tobacco-baseline',
      saveWorkBaseline: 'health-screening:screening-encounters:lifestyle:save-work-baseline',
      saveDraft: 'health-screening:screening-encounters:lifestyle:save-draft',
      complete: 'health-screening:screening-encounters:lifestyle:complete',
      reopen: 'health-screening:screening-encounters:lifestyle:reopen'
    },
    food: {
      getWorkspace: 'health-screening:screening-encounters:food:get-workspace',
      saveDraft: 'health-screening:screening-encounters:food:save-draft'
    },
    otc: {
      getWorkspace: 'health-screening:screening-encounters:otc:get-workspace',
      saveDraft: 'health-screening:screening-encounters:otc:save-draft'
    }
  },
  installationSettings: {
    getConfiguredLocation: 'health-screening:installation-settings:get-configured-location',
    listEligibleLocations: 'health-screening:installation-settings:list-eligible-locations',
    assignInitialLocation: 'health-screening:installation-settings:assign-initial-location',
    reconfigureLocation: 'health-screening:installation-settings:reconfigure-location'
  }
} as const

export type AppIpcChannel = (typeof ipcChannels.app)[keyof typeof ipcChannels.app]
export type FirstRunIpcChannel = (typeof ipcChannels.firstRun)[keyof typeof ipcChannels.firstRun]
export type AuthenticationIpcChannel = (typeof ipcChannels.auth)[keyof typeof ipcChannels.auth]
export type PatientIpcChannel = (typeof ipcChannels.patient)[keyof typeof ipcChannels.patient]
export type ReferralIpcChannel = (typeof ipcChannels.referrals)[keyof typeof ipcChannels.referrals]
export type ScreeningSessionIpcChannel =
  (typeof ipcChannels.screeningSessions)[keyof typeof ipcChannels.screeningSessions]
export type ScreeningEncounterIpcChannel =
  | (typeof ipcChannels.screeningEncounters)[Exclude<
      keyof typeof ipcChannels.screeningEncounters,
      'lifestyle' | 'food' | 'otc' | 'management'
    >]
  | ScreeningEncounterManagementIpcChannel
  | ScreeningLifestyleIpcChannel
  | ScreeningFoodIpcChannel
  | ScreeningOtcIpcChannel
export type ScreeningLifestyleIpcChannel =
  (typeof ipcChannels.screeningEncounters.lifestyle)[keyof typeof ipcChannels.screeningEncounters.lifestyle]
export type ScreeningFoodIpcChannel =
  (typeof ipcChannels.screeningEncounters.food)[keyof typeof ipcChannels.screeningEncounters.food]
export type ScreeningOtcIpcChannel =
  (typeof ipcChannels.screeningEncounters.otc)[keyof typeof ipcChannels.screeningEncounters.otc]
export type ScreeningEncounterManagementIpcChannel =
  (typeof ipcChannels.screeningEncounters.management)[keyof typeof ipcChannels.screeningEncounters.management]
export type InstallationSettingsIpcChannel =
  (typeof ipcChannels.installationSettings)[keyof typeof ipcChannels.installationSettings]
