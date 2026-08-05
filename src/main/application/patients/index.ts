export { createPatientDemographicAmendmentService } from './patient-demographic-amendment-service'
export { createPatientRegistryService } from './patient-service'
export {
  createProductionPatientDemographicAmendmentService,
  createProductionPatientRegistryService,
  type ProductionPatientRegistryServiceOptions
} from './patient-service-composition'
export type {
  AmendPatientDemographicsRequest,
  AmendPatientDemographicsResult,
  ListPatientDemographicAmendmentHistoryRequest,
  ListPatientDemographicAmendmentHistoryResult,
  PatientDemographicAmendmentService,
  PatientDemographicAmendmentServiceActor,
  PatientDemographicAmendmentServiceDependencies,
  PatientDemographicPatch
} from './patient-demographic-amendment-service-types'
export type {
  PatientRegistryService,
  PatientRegistryServiceDependencies,
  PatientServiceActor
} from './patient-service-types'
