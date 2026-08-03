export {
  getPatientRegistryErrorType,
  isPatientRegistryError,
  PatientRegistryCreationError,
  PatientRegistryNotFoundError,
  PatientRegistryStateIntegrityError,
  PatientRegistryValidationError,
  rebuildPatientRegistryError,
  type PatientRegistryError,
  type PatientRegistryErrorCode
} from './patient-service-errors'
export { createPatientRegistryService } from './patient-service'
export {
  createProductionPatientRegistryService,
  type ProductionPatientRegistryServiceOptions
} from './patient-service-composition'
export type {
  PatientRegistryActor,
  PatientRegistryService,
  PatientRegistryServiceDependencies
} from './patient-service-types'
