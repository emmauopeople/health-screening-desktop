export const ipcChannels = {
  app: {
    getInfo: 'health-screening:app:get-info',
    getHealth: 'health-screening:app:get-health'
  }
} as const

export type AppIpcChannel = (typeof ipcChannels.app)[keyof typeof ipcChannels.app]
