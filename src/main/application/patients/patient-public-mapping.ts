import type {
  PatientAcknowledgmentRecord,
  PatientDemographicAmendmentFieldName,
  PatientDemographicAmendmentRecord,
  PatientDetailRecord,
  PatientDuplicateCandidateRecord,
  PatientDuplicatePairRecord,
  PatientSummaryRecord
} from '@main/database'
import type {
  PublicPatientAcknowledgmentHistoryRecord,
  PublicPatientDemographicAmendmentChange,
  PublicPatientDemographicAmendmentRecord,
  PublicPatientDetail,
  PublicPatientDuplicateCandidate,
  PublicPatientDuplicatePair,
  PublicPatientSummary
} from '@shared/ipc'

const demographicFieldNameMap = Object.freeze({
  given_name: 'givenName',
  family_name: 'familyName',
  other_names: 'otherNames',
  date_of_birth: 'dateOfBirth',
  approximate_age_years: 'approximateAgeYears',
  age_as_of_date: 'ageAsOfDate',
  sex: 'sex',
  village: 'village',
  quarter: 'quarter',
  phone: 'phone',
  alternate_contact_name: 'alternateContactName',
  alternate_contact_phone: 'alternateContactPhone',
  residence_notes: 'residenceNotes',
  status: 'status'
} satisfies Record<
  PatientDemographicAmendmentFieldName,
  PublicPatientDemographicAmendmentChange['fieldName']
>)

export function toPublicPatientSummary(record: PatientSummaryRecord): PublicPatientSummary {
  return {
    id: record.id,
    patientCode: record.patientCode,
    displayName: record.displayName,
    givenName: record.givenName,
    familyName: record.familyName,
    otherNames: record.otherNames,
    dateOfBirth: record.dateOfBirth,
    approximateAgeYears: record.approximateAgeYears,
    ageAsOfDate: record.ageAsOfDate,
    sex: record.sex,
    village: record.village,
    quarter: record.quarter,
    phone: record.phone,
    status: record.status,
    rowVersion: record.rowVersion,
    updatedAt: record.updatedAt
  }
}

export function toPublicPatientDetail(record: PatientDetailRecord): PublicPatientDetail {
  return {
    ...toPublicPatientSummary(record),
    alternateContactName: record.alternateContactName,
    alternateContactPhone: record.alternateContactPhone,
    residenceNotes: record.residenceNotes,
    acknowledgment: {
      status: record.acknowledgmentStatus,
      recordedAt: record.acknowledgmentRecordedAt,
      recordedByDisplayName: record.acknowledgmentRecordedByDisplayName
    },
    createdAt: record.createdAt,
    createdByDisplayName: record.createdByDisplayName,
    updatedByDisplayName: record.updatedByDisplayName,
    clinicalStatus: 'NOT_AVAILABLE'
  }
}

export function toPublicPatientDuplicateCandidate(
  record: PatientDuplicateCandidateRecord
): PublicPatientDuplicateCandidate {
  return {
    patient: toPublicPatientSummary(record.patient),
    matchedOn: [...record.matchedOn],
    score: record.score,
    status: 'POSSIBLE_DUPLICATE'
  }
}

export function toPublicPatientDuplicatePair(
  record: PatientDuplicatePairRecord
): PublicPatientDuplicatePair {
  return {
    pairKey: record.pairKey,
    first: toPublicPatientSummary(record.first),
    second: toPublicPatientSummary(record.second),
    matchedOn: [...record.matchedOn],
    score: record.score,
    status: 'POSSIBLE_DUPLICATE'
  }
}

export function toPublicDemographicAmendmentRecord(
  record: PatientDemographicAmendmentRecord
): PublicPatientDemographicAmendmentRecord {
  return {
    amendmentId: record.id,
    patientId: record.patientId,
    priorRowVersion: record.priorRowVersion,
    resultingRowVersion: record.resultingRowVersion,
    reasonCode: record.reasonCode,
    reasonNote: record.reasonNote,
    amendedByUserId: record.amendedBy,
    amendedByDisplayName: record.amendedByDisplayName,
    amendedAt: record.amendedAt,
    changes: record.changes.map((change) => ({
      fieldName: demographicFieldNameMap[change.fieldName],
      previousValue: change.previousValue,
      newValue: change.newValue
    }))
  }
}

export function toPublicAcknowledgmentHistoryRecord(
  record: PatientAcknowledgmentRecord
): PublicPatientAcknowledgmentHistoryRecord {
  return {
    acknowledgmentId: record.id,
    patientId: record.patientId,
    status: record.status,
    sourceType: record.sourceType,
    note: record.note,
    recordedByUserId: record.recordedBy,
    recordedByDisplayName: record.recordedByDisplayName,
    recordedAt: record.recordedAt,
    priorRowVersion: record.priorRowVersion,
    resultingRowVersion: record.resultingRowVersion
  }
}
