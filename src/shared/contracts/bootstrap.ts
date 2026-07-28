export interface ApplicationStatus {
  applicationName: 'Health Screening Offline Desktop'
  status: 'Engineering foundation'
  clinicalFeaturesImplemented: false
  databaseConfigured: false
  businessIpcImplemented: false
}

export interface HealthScreeningApi {
  getApplicationStatus: () => ApplicationStatus
}

export const applicationStatus: ApplicationStatus = {
  applicationName: 'Health Screening Offline Desktop',
  status: 'Engineering foundation',
  clinicalFeaturesImplemented: false,
  databaseConfigured: false,
  businessIpcImplemented: false
}
