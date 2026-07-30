import type { AppHealth, AppInfo, FirstRunPublicInconsistencyCode } from '@shared/ipc'

export const fallbackApplicationName: AppInfo['applicationName'] =
  'Health Screening Offline Desktop'

export type RendererStartupState =
  | { status: 'LOADING' }
  | { status: 'SETUP_REQUIRED'; info: AppInfo; health: AppHealth }
  | {
      status: 'SETUP_COMPLETE'
      info: AppInfo
      health: AppHealth
      deploymentName: string
      timeZone: string
    }
  | {
      status: 'INCONSISTENT'
      info: AppInfo
      health: AppHealth
      code: FirstRunPublicInconsistencyCode
    }
  | { status: 'UNAVAILABLE'; message: string; canRetry: boolean }

export type SetupSubmissionState =
  | { status: 'IDLE' }
  | { status: 'SUBMITTING' }
  | { status: 'FORM_ERROR'; message: string }
  | { status: 'SERVICE_ERROR'; message: string }
