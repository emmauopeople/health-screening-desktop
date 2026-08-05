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
    update: 'health-screening:patient:update',
    amendDemographics: 'health-screening:patient:amend-demographics',
    listDemographicAmendmentHistory: 'health-screening:patient:list-demographic-amendment-history',
    recordAcknowledgment: 'health-screening:patient:record-acknowledgment',
    listAcknowledgmentHistory: 'health-screening:patient:list-acknowledgment-history',
    listRecent: 'health-screening:patient:list-recent',
    findDuplicates: 'health-screening:patient:find-duplicates',
    markNotDuplicate: 'health-screening:patient:mark-not-duplicate'
  }
} as const

export type AppIpcChannel = (typeof ipcChannels.app)[keyof typeof ipcChannels.app]
export type FirstRunIpcChannel = (typeof ipcChannels.firstRun)[keyof typeof ipcChannels.firstRun]
export type AuthenticationIpcChannel = (typeof ipcChannels.auth)[keyof typeof ipcChannels.auth]
export type PatientIpcChannel = (typeof ipcChannels.patient)[keyof typeof ipcChannels.patient]
