export {
  disposeAuditReportIpcHandlers,
  disposeApplicationIpcHandlers,
  disposeScreeningEncounterIpcHandlers,
  disposeScreeningOtcIpcHandlers,
  disposeReferralIpcHandlers,
  registerApplicationIpcHandlers,
  registerAuditReportIpcHandlers,
  registerScreeningEncounterIpcHandlers,
  registerScreeningOtcIpcHandlers,
  registerReferralIpcHandlers,
  ApplicationIpcRegistrationError,
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
