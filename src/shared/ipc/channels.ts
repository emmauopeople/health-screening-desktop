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
  }
} as const

export type AppIpcChannel = (typeof ipcChannels.app)[keyof typeof ipcChannels.app]
export type FirstRunIpcChannel = (typeof ipcChannels.firstRun)[keyof typeof ipcChannels.firstRun]
export type AuthenticationIpcChannel = (typeof ipcChannels.auth)[keyof typeof ipcChannels.auth]
