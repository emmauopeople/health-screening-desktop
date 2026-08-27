export {
  disposeApplicationIpcHandlers,
  disposeScreeningEncounterIpcHandlers,
  disposeScreeningOtcIpcHandlers,
  disposeReferralIpcHandlers,
  registerApplicationIpcHandlers,
  registerScreeningEncounterIpcHandlers,
  registerScreeningOtcIpcHandlers,
  registerReferralIpcHandlers,
  type ApplicationIpcDisposer,
  type ApplicationIpcHandlerDependencies,
  type ApplicationIpcMain
} from './register-handlers'
export * from './authentication'
export {
  isIpcSenderAllowed,
  type IpcSenderValidationEvent,
  type IpcSenderFrame
} from './sender-policy'
