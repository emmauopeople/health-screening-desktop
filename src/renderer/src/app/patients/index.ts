export { PatientOverviewWorkspace } from './PatientOverviewWorkspace'
export { PatientRegistrationWorkspace } from './PatientRegistrationWorkspace'
export { PatientSearchWorkspace } from './PatientSearchWorkspace'
export { DirtyPatientTabDialog, ReplacePatientDialog } from './PatientTabDialogs'
export { PatientTabsBar } from './PatientTabsBar'
export {
  activatePatientTab,
  closePatientTab,
  emptyPatientTabState,
  getActivePatientTab,
  isPatientTabDirty,
  maximumOpenPatientTabs,
  openPatientTab,
  refreshPatientTabSummary,
  replacePatientTab,
  type PatientOpenResult,
  type PatientTabState,
  type PatientWorkspaceTab
} from './patient-tab-controller'
