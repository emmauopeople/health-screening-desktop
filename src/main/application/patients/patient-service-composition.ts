import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createPatientAcknowledgmentRepository,
  createPatientDemographicAmendmentRepository,
  createPatientRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createPatientAcknowledgmentService } from './patient-acknowledgment-service'
import type { PatientAcknowledgmentService } from './patient-acknowledgment-service-types'
import { createPatientDemographicAmendmentService } from './patient-demographic-amendment-service'
import type { PatientDemographicAmendmentService } from './patient-demographic-amendment-service-types'
import { createPatientRegistryService } from './patient-service'
import type { PatientRegistryService } from './patient-service-types'

export interface ProductionPatientRegistryServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionPatientRegistryService({
  connection,
  logger
}: ProductionPatientRegistryServiceOptions): PatientRegistryService {
  return createPatientRegistryService({
    installationRepository: createInstallationRepository(connection),
    patientRepository: createPatientRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}

export function createProductionPatientDemographicAmendmentService({
  connection,
  logger
}: ProductionPatientRegistryServiceOptions): PatientDemographicAmendmentService {
  return createPatientDemographicAmendmentService({
    installationRepository: createInstallationRepository(connection),
    patientRepository: createPatientRepository(connection),
    patientDemographicAmendmentRepository: createPatientDemographicAmendmentRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}

export function createProductionPatientAcknowledgmentService({
  connection,
  logger
}: ProductionPatientRegistryServiceOptions): PatientAcknowledgmentService {
  return createPatientAcknowledgmentService({
    installationRepository: createInstallationRepository(connection),
    patientRepository: createPatientRepository(connection),
    patientAcknowledgmentRepository: createPatientAcknowledgmentRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
