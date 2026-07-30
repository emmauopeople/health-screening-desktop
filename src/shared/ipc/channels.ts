export const ipcChannels = {
  app: {
    getInfo: 'health-screening:app:get-info',
    getHealth: 'health-screening:app:get-health'
  },
  firstRun: {
    getState: 'health-screening:first-run:get-state',
    initialize: 'health-screening:first-run:initialize'
  }
} as const

export type AppIpcChannel = (typeof ipcChannels.app)[keyof typeof ipcChannels.app]
export type FirstRunIpcChannel = (typeof ipcChannels.firstRun)[keyof typeof ipcChannels.firstRun]
