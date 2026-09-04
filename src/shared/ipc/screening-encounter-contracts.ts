import { z } from 'zod'

import { createIpcSuccess, createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'
import { patientLocalDateSchema } from './patient-contracts'
import {
  referralMedicationChangeTypeSchema,
  referralStatusSchema,
  referralTreatmentActionSchema,
  referralUrgencySchema
} from './referral-contracts'
import {
  VITALS_DIASTOLIC_MAX,
  VITALS_DIASTOLIC_MIN,
  VITALS_PULSE_MAX,
  VITALS_PULSE_MIN,
  VITALS_SYSTOLIC_MAX,
  VITALS_SYSTOLIC_MIN
} from '../vitals-bounds'

const unsafeTransportValue = Symbol('UnsafeScreeningEncounterIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export const screeningEncounterUuidSchema = z.string().uuid()
export const screeningEncounterUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const screeningEncounterStatusSchema = z.enum(['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])
export const screeningVitalsDraftStatusSchema = z.enum(['DRAFT', 'VITALS_COMPLETE'])
export const screeningVitalsMeasurementSiteSchema = z.enum([
  'RIGHT_ARM',
  'LEFT_ARM',
  'LEFT_LEG',
  'RIGHT_LEG'
])
export const screeningVitalsPatientPositionSchema = z.enum(['LYING', 'STANDING', 'SITTING'])
export const screeningVitalsMeasurementTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
export const screeningVitalsPositiveIntegerSchema = z.number().int().min(1).safe()
export const screeningVitalsPositiveNumberSchema = z.number().positive()
export const screeningVitalsSystolicSchema = z
  .number()
  .int()
  .min(VITALS_SYSTOLIC_MIN)
  .max(VITALS_SYSTOLIC_MAX)
  .safe()
export const screeningVitalsDiastolicSchema = z
  .number()
  .int()
  .min(VITALS_DIASTOLIC_MIN)
  .max(VITALS_DIASTOLIC_MAX)
  .safe()
export const screeningVitalsPulseSchema = z
  .number()
  .int()
  .min(VITALS_PULSE_MIN)
  .max(VITALS_PULSE_MAX)
  .safe()
export const publicScreeningVitalsReadingValueSchema = z.number().int().min(1).safe()

export const screeningEncounterStartRequestSchema = exactObject({
  patientId: screeningEncounterUuidSchema,
  screeningSessionId: screeningEncounterUuidSchema,
  repeatConfirmed: z.boolean().optional()
})
export const screeningCompletionSectionSchema = z.enum(['VITALS', 'LIFESTYLE', 'FOOD', 'OTC'])
export const screeningEncounterCompleteRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedEncounterVersion: screeningVitalsPositiveIntegerSchema,
  expectedVitalsVersion: screeningVitalsPositiveIntegerSchema,
  expectedLifestyleVersion: screeningVitalsPositiveIntegerSchema,
  expectedFoodVersion: screeningVitalsPositiveIntegerSchema,
  expectedOtcVersion: screeningVitalsPositiveIntegerSchema,
  reviewConfirmed: z.literal(true),
  alcoholBaselineReviewConfirmedVersionId: screeningEncounterUuidSchema.nullable(),
  tobaccoBaselineReviewConfirmedVersionId: screeningEncounterUuidSchema.nullable()
})
export const encounterManagementFlagCategorySchema = z.enum([
  'POSSIBLE_DATA_ERROR',
  'MISSING_INFORMATION',
  'WRONG_PATIENT',
  'DUPLICATE_ENCOUNTER',
  'OTHER'
])
export const encounterManagementFlagStatusSchema = z.enum(['OPEN', 'RESOLVED', 'DISMISSED'])
export const encounterManagementSearchRequestSchema = exactObject({
  query: z.string().max(120),
  status: z.union([z.literal('ALL'), screeningEncounterStatusSchema]),
  page: z.number().int().min(1).safe(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)])
})
export const encounterManagementGetDetailRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema
})
export const encounterManagementGetPatientContextRequestSchema = exactObject({
  patientId: screeningEncounterUuidSchema
})
export const encounterManagementGetPatientHistoryRequestSchema = exactObject({
  patientId: screeningEncounterUuidSchema,
  page: z.number().int().min(1).safe(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)])
})
export const encounterManagementAddAddendumRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  noteText: z.string().trim().min(1).max(2000)
})
export const encounterManagementOpenFlagRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  category: encounterManagementFlagCategorySchema,
  description: z.string().trim().min(1).max(1000)
})
export const encounterManagementResolveFlagRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  flagId: screeningEncounterUuidSchema,
  status: z.enum(['RESOLVED', 'DISMISSED']),
  resolutionNote: z.string().trim().min(1).max(1000)
})
export const encounterManagementVoidEmptyDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedVersion: screeningVitalsPositiveIntegerSchema,
  reason: z.string().trim().min(1).max(500)
})
export const encounterCancellationReasonCodeSchema = z.enum([
  'PATIENT_CHOSE_NOT_TO_CONTINUE',
  'CREATED_IN_ERROR',
  'UNABLE_TO_COMPLETE_TODAY',
  'OTHER'
])
export const encounterManagementCancelDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedVersion: screeningVitalsPositiveIntegerSchema,
  reasonCode: encounterCancellationReasonCodeSchema,
  note: z.string().trim().max(500).nullable()
}).superRefine((value, context) => {
  if (value.reasonCode === 'OTHER' && (value.note === null || value.note.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'A note is required for Other.'
    })
  }
  if (value.reasonCode !== 'OTHER' && value.note !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'A note is only accepted for Other.'
    })
  }
})
export const screeningVitalsGetDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema
})
export const screeningVitalsDraftReadingRequestSchema = exactObject({
  id: screeningEncounterUuidSchema.nullable(),
  sequenceNumber: screeningVitalsPositiveIntegerSchema,
  systolic: screeningVitalsSystolicSchema.nullable(),
  diastolic: screeningVitalsDiastolicSchema.nullable(),
  pulse: screeningVitalsPulseSchema.nullable(),
  measurementSite: screeningVitalsMeasurementSiteSchema.nullable(),
  patientPosition: screeningVitalsPatientPositionSchema.nullable(),
  measurementTime: screeningVitalsMeasurementTimeSchema.nullable()
})
export const screeningVitalsSaveDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedVersion: screeningVitalsPositiveIntegerSchema.nullable(),
  readings: z.array(screeningVitalsDraftReadingRequestSchema).min(1).max(12),
  weightKg: screeningVitalsPositiveNumberSchema.nullable(),
  waistCm: screeningVitalsPositiveNumberSchema.nullable(),
  notes: z.string().max(500).nullable()
})

export const publicScreeningEncounterStartSummarySchema = z
  .object({
    id: screeningEncounterUuidSchema,
    patientId: screeningEncounterUuidSchema,
    screeningSessionId: screeningEncounterUuidSchema,
    status: screeningEncounterStatusSchema,
    startedAt: screeningEncounterUtcTimestampSchema,
    recordVersion: z.number().int().min(1).safe()
  })
  .strict()
export const publicCompletedScreeningEncounterSummarySchema = z
  .object({
    id: screeningEncounterUuidSchema,
    patientId: screeningEncounterUuidSchema,
    screeningSessionId: screeningEncounterUuidSchema,
    status: z.literal('COMPLETED'),
    startedAt: screeningEncounterUtcTimestampSchema,
    completedAt: screeningEncounterUtcTimestampSchema,
    recordVersion: z.number().int().min(1).safe()
  })
  .strict()

export const publicManagedEncounterSummarySchema = z
  .object({
    id: screeningEncounterUuidSchema,
    patientId: screeningEncounterUuidSchema,
    screeningSessionId: screeningEncounterUuidSchema,
    patientCode: z.string().min(1).max(80),
    patientDisplayName: z.string().min(1).max(240),
    dateOfBirth: patientLocalDateSchema.nullable(),
    locationName: z.string().min(1).max(240),
    status: screeningEncounterStatusSchema,
    startedAt: screeningEncounterUtcTimestampSchema,
    completedAt: screeningEncounterUtcTimestampSchema.nullable(),
    noteCount: z.number().int().min(0).safe(),
    openFlagCount: z.number().int().min(0).safe(),
    recordVersion: screeningVitalsPositiveIntegerSchema,
    hasRecordedData: z.boolean()
  })
  .strict()
export const publicEncounterAddendumSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    encounterId: screeningEncounterUuidSchema,
    noteText: z.string().min(1).max(2000),
    createdBy: screeningEncounterUuidSchema,
    createdByDisplayName: z.string().min(1).max(240),
    createdAt: screeningEncounterUtcTimestampSchema
  })
  .strict()
export const publicEncounterReviewFlagSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    encounterId: screeningEncounterUuidSchema,
    category: encounterManagementFlagCategorySchema,
    description: z.string().min(1).max(1000),
    status: encounterManagementFlagStatusSchema,
    openedBy: screeningEncounterUuidSchema,
    openedByDisplayName: z.string().min(1).max(240),
    openedAt: screeningEncounterUtcTimestampSchema,
    resolvedBy: screeningEncounterUuidSchema.nullable(),
    resolvedByDisplayName: z.string().min(1).max(240).nullable(),
    resolvedAt: screeningEncounterUtcTimestampSchema.nullable(),
    resolutionNote: z.string().min(1).max(1000).nullable()
  })
  .strict()
export const publicManagedEncounterDetailSchema = z
  .object({
    encounter: publicManagedEncounterSummarySchema,
    vitals: z.array(
      z
        .object({
          sequenceNumber: z.number().int().min(1).safe(),
          systolic: z.number().int().min(1).safe(),
          diastolic: z.number().int().min(1).safe(),
          pulse: z.number().int().min(1).safe().nullable(),
          measuredAt: screeningEncounterUtcTimestampSchema
        })
        .strict()
    ),
    lifestyle: z.array(
      z.object({ questionCode: z.string().min(1), responseCode: z.string().min(1) }).strict()
    ),
    foods: z.array(
      z
        .object({
          foodName: z.string().min(1),
          frequencyCode: z.string().min(1),
          notes: z.string().nullable()
        })
        .strict()
    ),
    otcMedications: z.array(
      z
        .object({
          productName: z.string().min(1),
          reasonForUse: z.string().min(1),
          doseText: z.string().min(1).nullable().optional(),
          frequencyText: z.string().min(1).nullable().optional(),
          durationText: z.string().min(1).nullable().optional(),
          sourceOfMedication: z.string().min(1).nullable().optional(),
          currentlyTaking: z.boolean().nullable()
        })
        .strict()
    ),
    addenda: z.array(publicEncounterAddendumSchema),
    flags: z.array(publicEncounterReviewFlagSchema)
  })
  .strict()

export const publicPatientContextEncounterSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    completedAt: screeningEncounterUtcTimestampSchema,
    systolic: screeningVitalsSystolicSchema,
    diastolic: screeningVitalsDiastolicSchema,
    pulse: screeningVitalsPulseSchema,
    nextAction: z.enum(['ROUTINE', 'REFER', 'URGENT_REFERRAL']),
    weightKg: screeningVitalsPositiveNumberSchema.nullable()
  })
  .strict()
export const publicPatientContextReferralSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    status: z.enum(['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM']),
    urgency: z.string().min(1).max(80),
    dueDate: patientLocalDateSchema.nullable(),
    lastContactDate: patientLocalDateSchema.nullable()
  })
  .strict()
export const publicPatientScreeningContextSchema = z
  .object({
    recentEncounters: z.array(publicPatientContextEncounterSchema).max(6),
    thirtyDayAverage: z
      .object({
        systolic: screeningVitalsSystolicSchema,
        diastolic: screeningVitalsDiastolicSchema,
        encounterCount: z.number().int().min(1).safe()
      })
      .strict()
      .nullable(),
    activeReferral: publicPatientContextReferralSchema.nullable()
  })
  .strict()

const publicPatientHistoryMedicationChangeSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    changeType: referralMedicationChangeTypeSchema,
    medicationName: z.string().min(1).max(255),
    dosage: z.string().min(1).max(255).nullable(),
    frequency: z.string().min(1).max(255).nullable()
  })
  .strict()
const publicPatientHistoryFollowupSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    contactDate: patientLocalDateSchema,
    providerSeen: z.boolean().nullable(),
    reportedOutcome: z.string().min(1).max(2000).nullable(),
    treatmentActions: z.array(referralTreatmentActionSchema).max(3),
    medicationChanges: z.array(publicPatientHistoryMedicationChangeSchema).max(20)
  })
  .strict()
const publicPatientHistoryReferralSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    status: referralStatusSchema,
    urgency: referralUrgencySchema,
    dueDate: patientLocalDateSchema.nullable(),
    closedAt: screeningEncounterUtcTimestampSchema.nullable(),
    latestFollowup: publicPatientHistoryFollowupSchema.nullable()
  })
  .strict()
export const publicPatientHistoryEncounterSchema = publicPatientContextEncounterSchema
  .extend({ referral: publicPatientHistoryReferralSchema.nullable() })
  .strict()
export const publicPatientScreeningHistorySchema = z
  .object({
    patientId: screeningEncounterUuidSchema,
    items: z.array(publicPatientHistoryEncounterSchema).max(100),
    total: z.number().int().min(0).safe(),
    page: z.number().int().min(1).safe(),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    trendEncounters: z.array(publicPatientContextEncounterSchema).max(12),
    thirtyDayAverage: publicPatientScreeningContextSchema.shape.thirtyDayAverage
  })
  .strict()

const encounterManagementControlledStatusSchemas = [
  z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict(),
  z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_CONFIGURED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('PATIENT_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_MANAGEABLE') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_EMPTY') }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT') }).strict(),
  z.object({ status: z.literal('FLAG_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
] as const
export const encounterManagementSearchSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('LOADED'),
      items: z.array(publicManagedEncounterSummarySchema),
      total: z.number().int().min(0).safe(),
      page: z.number().int().min(1).safe(),
      pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)])
    })
    .strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementGetDetailSuccessDataSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('LOADED'), detail: publicManagedEncounterDetailSchema }).strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementGetPatientContextSuccessDataSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({ status: z.literal('LOADED'), context: publicPatientScreeningContextSchema })
      .strict(),
    ...encounterManagementControlledStatusSchemas
  ]
)
export const encounterManagementGetPatientHistorySuccessDataSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({ status: z.literal('LOADED'), history: publicPatientScreeningHistorySchema })
      .strict(),
    ...encounterManagementControlledStatusSchemas
  ]
)
export const encounterManagementAddAddendumSuccessDataSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ADDED'), addendum: publicEncounterAddendumSchema }).strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementOpenFlagSuccessDataSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OPENED'), flag: publicEncounterReviewFlagSchema }).strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementResolveFlagSuccessDataSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UPDATED'), flag: publicEncounterReviewFlagSchema }).strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementVoidEmptyDraftSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('VOIDED'),
      recordVersion: screeningVitalsPositiveIntegerSchema
    })
    .strict(),
  ...encounterManagementControlledStatusSchemas
])
export const encounterManagementCancelDraftSuccessDataSchema =
  encounterManagementVoidEmptyDraftSuccessDataSchema

export const screeningEncounterStartSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('STARTED'),
      encounter: publicScreeningEncounterStartSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_EXISTS'),
      encounter: publicScreeningEncounterStartSummarySchema
    })
    .strict(),
  z.object({ status: z.literal('REPEAT_CONFIRMATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('PATIENT_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('PATIENT_INELIGIBLE') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('SESSION_CLOSED') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_CURRENT') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict(),
  z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
  z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
])
export const screeningVitalsDraftReadingSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    sequenceNumber: screeningVitalsPositiveIntegerSchema,
    systolic: publicScreeningVitalsReadingValueSchema.nullable(),
    diastolic: publicScreeningVitalsReadingValueSchema.nullable(),
    pulse: publicScreeningVitalsReadingValueSchema.nullable(),
    measurementSite: screeningVitalsMeasurementSiteSchema.nullable(),
    patientPosition: screeningVitalsPatientPositionSchema.nullable(),
    measurementTime: screeningVitalsMeasurementTimeSchema.nullable()
  })
  .strict()
export const publicScreeningVitalsDraftSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    encounterId: screeningEncounterUuidSchema,
    status: screeningVitalsDraftStatusSchema,
    readings: z.array(screeningVitalsDraftReadingSchema).min(1).max(12),
    weightKg: screeningVitalsPositiveNumberSchema.nullable(),
    waistCm: screeningVitalsPositiveNumberSchema.nullable(),
    notes: z.string().max(500).nullable(),
    rowVersion: screeningVitalsPositiveIntegerSchema,
    updatedAt: screeningEncounterUtcTimestampSchema
  })
  .strict()
const screeningVitalsControlledStatusSchemas = [
  z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict(),
  z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_CONFIGURED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_EDITABLE') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('SESSION_CLOSED') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_CURRENT') }).strict(),
  z.object({ status: z.literal('REPEAT_REQUIRED') }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
] as const
export const screeningVitalsGetDraftSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('LOADED'),
      draft: publicScreeningVitalsDraftSchema.nullable()
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningVitalsSaveDraftSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('SAVED'),
      draft: publicScreeningVitalsDraftSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningVitalsCompleteStepSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('COMPLETED'),
      draft: publicScreeningVitalsDraftSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningEncounterCompleteSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('COMPLETED'),
      encounter: publicCompletedScreeningEncounterSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_COMPLETED'),
      encounter: publicCompletedScreeningEncounterSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('INCOMPLETE'),
      section: screeningCompletionSectionSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])

export const screeningEncounterIpcErrorCodeSchema = z.enum([
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR'
])

export type ScreeningEncounterIpcErrorCode = z.infer<typeof screeningEncounterIpcErrorCodeSchema>

export const screeningEncounterSafeErrorMessages = {
  IPC_FORBIDDEN: safeIpcErrorMessages.IPC_FORBIDDEN,
  IPC_UNAVAILABLE: safeIpcErrorMessages.IPC_UNAVAILABLE,
  INTERNAL_ERROR: safeIpcErrorMessages.INTERNAL_ERROR
} as const satisfies Record<ScreeningEncounterIpcErrorCode, string>

export const screeningEncounterFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createScreeningEncounterErrorSchema('IPC_FORBIDDEN'),
      createScreeningEncounterErrorSchema('IPC_UNAVAILABLE'),
      createScreeningEncounterErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()

export const screeningEncounterStartResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningEncounterStartSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsGetDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsGetDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsSaveDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsSaveDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsCompleteStepResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsCompleteStepSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningEncounterCompleteResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningEncounterCompleteSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementSearchResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementSearchSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementGetDetailResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementGetDetailSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementGetPatientContextResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementGetPatientContextSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementGetPatientHistoryResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementGetPatientHistorySuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementAddAddendumResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementAddAddendumSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementOpenFlagResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementOpenFlagSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementResolveFlagResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementResolveFlagSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementVoidEmptyDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementVoidEmptyDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const encounterManagementCancelDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(encounterManagementCancelDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)

export type ScreeningEncounterStatus = z.infer<typeof screeningEncounterStatusSchema>
export type EncounterManagementFlagCategory = z.infer<typeof encounterManagementFlagCategorySchema>
export type EncounterManagementFlagStatus = z.infer<typeof encounterManagementFlagStatusSchema>
export type EncounterManagementSearchRequest = z.infer<
  typeof encounterManagementSearchRequestSchema
>
export type EncounterManagementGetDetailRequest = z.infer<
  typeof encounterManagementGetDetailRequestSchema
>
export type EncounterManagementGetPatientContextRequest = z.infer<
  typeof encounterManagementGetPatientContextRequestSchema
>
export type EncounterManagementGetPatientHistoryRequest = z.infer<
  typeof encounterManagementGetPatientHistoryRequestSchema
>
export type EncounterManagementAddAddendumRequest = z.infer<
  typeof encounterManagementAddAddendumRequestSchema
>
export type EncounterManagementOpenFlagRequest = z.infer<
  typeof encounterManagementOpenFlagRequestSchema
>
export type EncounterManagementResolveFlagRequest = z.infer<
  typeof encounterManagementResolveFlagRequestSchema
>
export type EncounterManagementVoidEmptyDraftRequest = z.infer<
  typeof encounterManagementVoidEmptyDraftRequestSchema
>
export type EncounterCancellationReasonCode = z.infer<typeof encounterCancellationReasonCodeSchema>
export type EncounterManagementCancelDraftRequest = z.infer<
  typeof encounterManagementCancelDraftRequestSchema
>
export type PublicManagedEncounterSummary = z.infer<typeof publicManagedEncounterSummarySchema>
export type PublicEncounterAddendum = z.infer<typeof publicEncounterAddendumSchema>
export type PublicEncounterReviewFlag = z.infer<typeof publicEncounterReviewFlagSchema>
export type PublicManagedEncounterDetail = z.infer<typeof publicManagedEncounterDetailSchema>
export type PublicPatientContextEncounter = z.infer<typeof publicPatientContextEncounterSchema>
export type PublicPatientContextReferral = z.infer<typeof publicPatientContextReferralSchema>
export type PublicPatientScreeningContext = z.infer<typeof publicPatientScreeningContextSchema>
export type PublicPatientHistoryEncounter = z.infer<typeof publicPatientHistoryEncounterSchema>
export type PublicPatientScreeningHistory = z.infer<typeof publicPatientScreeningHistorySchema>
export type EncounterManagementSearchResult = z.infer<typeof encounterManagementSearchResultSchema>
export type EncounterManagementGetDetailResult = z.infer<
  typeof encounterManagementGetDetailResultSchema
>
export type EncounterManagementGetPatientContextResult = z.infer<
  typeof encounterManagementGetPatientContextResultSchema
>
export type EncounterManagementGetPatientHistoryResult = z.infer<
  typeof encounterManagementGetPatientHistoryResultSchema
>
export type EncounterManagementAddAddendumResult = z.infer<
  typeof encounterManagementAddAddendumResultSchema
>
export type EncounterManagementOpenFlagResult = z.infer<
  typeof encounterManagementOpenFlagResultSchema
>
export type EncounterManagementResolveFlagResult = z.infer<
  typeof encounterManagementResolveFlagResultSchema
>
export type EncounterManagementVoidEmptyDraftResult = z.infer<
  typeof encounterManagementVoidEmptyDraftResultSchema
>
export type EncounterManagementCancelDraftResult = z.infer<
  typeof encounterManagementCancelDraftResultSchema
>
export type ScreeningEncounterStartRequest = z.infer<typeof screeningEncounterStartRequestSchema>
export type ScreeningCompletionSection = z.infer<typeof screeningCompletionSectionSchema>
export type ScreeningEncounterCompleteRequest = z.infer<
  typeof screeningEncounterCompleteRequestSchema
>
export type PublicScreeningEncounterStartSummary = z.infer<
  typeof publicScreeningEncounterStartSummarySchema
>
export type PublicCompletedScreeningEncounterSummary = z.infer<
  typeof publicCompletedScreeningEncounterSummarySchema
>
export type ScreeningEncounterCompleteSuccessData = z.infer<
  typeof screeningEncounterCompleteSuccessDataSchema
>
export type ScreeningEncounterCompleteResult = z.infer<
  typeof screeningEncounterCompleteResultSchema
>
export type ScreeningEncounterStartSuccessData = z.infer<
  typeof screeningEncounterStartSuccessDataSchema
>
export type ScreeningEncounterStartResult = z.infer<typeof screeningEncounterStartResultSchema>
export type ScreeningVitalsDraftStatus = z.infer<typeof screeningVitalsDraftStatusSchema>
export type ScreeningVitalsMeasurementSite = z.infer<typeof screeningVitalsMeasurementSiteSchema>
export type ScreeningVitalsPatientPosition = z.infer<typeof screeningVitalsPatientPositionSchema>
export type ScreeningVitalsDraftReadingRequest = z.infer<
  typeof screeningVitalsDraftReadingRequestSchema
>
export type ScreeningVitalsGetDraftRequest = z.infer<typeof screeningVitalsGetDraftRequestSchema>
export type ScreeningVitalsSaveDraftRequest = z.infer<typeof screeningVitalsSaveDraftRequestSchema>
export type PublicScreeningVitalsDraft = z.infer<typeof publicScreeningVitalsDraftSchema>
export type ScreeningVitalsGetDraftSuccessData = z.infer<
  typeof screeningVitalsGetDraftSuccessDataSchema
>
export type ScreeningVitalsSaveDraftSuccessData = z.infer<
  typeof screeningVitalsSaveDraftSuccessDataSchema
>
export type ScreeningVitalsCompleteStepSuccessData = z.infer<
  typeof screeningVitalsCompleteStepSuccessDataSchema
>
export type ScreeningVitalsGetDraftResult = z.infer<typeof screeningVitalsGetDraftResultSchema>
export type ScreeningVitalsSaveDraftResult = z.infer<typeof screeningVitalsSaveDraftResultSchema>
export type ScreeningVitalsCompleteStepResult = z.infer<
  typeof screeningVitalsCompleteStepResultSchema
>

export function createScreeningEncounterIpcFailure<TCode extends ScreeningEncounterIpcErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof screeningEncounterSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: screeningEncounterSafeErrorMessages[code]
    }
  }
}

export function createScreeningEncounterStartStatusResult<
  TStatus extends Exclude<
    ScreeningEncounterStartSuccessData['status'],
    'STARTED' | 'ALREADY_EXISTS'
  >
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

export function createScreeningVitalsGetDraftLoadedResult(
  draft: PublicScreeningVitalsDraft | null
): {
  ok: true
  data: { status: 'LOADED'; draft: PublicScreeningVitalsDraft | null }
} {
  return createIpcSuccess({ status: 'LOADED', draft })
}

export function createScreeningVitalsSaveDraftStatusResult<
  TStatus extends Exclude<ScreeningVitalsSaveDraftSuccessData['status'], 'SAVED'>
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

export function createScreeningVitalsCompleteStepStatusResult<
  TStatus extends Exclude<ScreeningVitalsCompleteStepSuccessData['status'], 'COMPLETED'>
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

function createScreeningEncounterErrorSchema<TCode extends ScreeningEncounterIpcErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof screeningEncounterSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(screeningEncounterSafeErrorMessages[code])
    })
    .strict()
}

function exactObject<TShape extends z.ZodRawShape>(
  shape: TShape
): z.ZodType<z.infer<z.ZodObject<TShape>>> {
  return withSafeTransportPreprocess(z.object(shape).strict())
}

function withSafeTransportPreprocess<TSchema extends z.ZodType>(
  schema: TSchema
): z.ZodPreprocess<TSchema> {
  return z.preprocess((value) => copySafeTransportValue(value), schema)
}

function copySafeTransportValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null) {
    return null
  }

  let valueType: string

  try {
    valueType = typeof value
  } catch {
    return unsafeTransportValue
  }

  if (valueType !== 'object') {
    return isRejectedPrimitive(value) ? unsafeTransportValue : value
  }

  let isArrayValue: boolean

  try {
    isArrayValue = Array.isArray(value as object)
  } catch {
    return unsafeTransportValue
  }

  const objectValue = value as object

  if (active.has(objectValue)) {
    return unsafeTransportValue
  }

  active.add(objectValue)

  try {
    if (isArrayValue) {
      return copySafeTransportArray(objectValue, active)
    }

    let prototype: object | null
    let descriptors: PropertyDescriptorMap

    try {
      prototype = Object.getPrototypeOf(objectValue)
      descriptors = Object.getOwnPropertyDescriptors(objectValue)
    } catch {
      return unsafeTransportValue
    }

    if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
      return unsafeTransportValue
    }

    const copy: Record<string, unknown> = {}

    for (const key of Object.getOwnPropertyNames(descriptors)) {
      if (key === '__proto__') {
        return unsafeTransportValue
      }
      const descriptor = descriptors[key]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return unsafeTransportValue
      }

      const copiedValue = copySafeTransportValue(descriptor.value, active)

      if (copiedValue === unsafeTransportValue) {
        return unsafeTransportValue
      }

      Object.defineProperty(copy, key, {
        value: copiedValue,
        enumerable: true,
        writable: true,
        configurable: true
      })
    }

    return copy
  } finally {
    active.delete(objectValue)
  }
}

function copySafeTransportArray(value: object, active: WeakSet<object>): unknown {
  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return unsafeTransportValue
  }

  if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
    return unsafeTransportValue
  }

  const lengthDescriptor = descriptors['length']

  if (
    lengthDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return unsafeTransportValue
  }

  const length = lengthDescriptor.value
  const copy: unknown[] = []

  for (const key of Object.getOwnPropertyNames(descriptors)) {
    if (key === 'length') {
      continue
    }

    if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length) {
      return unsafeTransportValue
    }
  }

  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return unsafeTransportValue
    }

    const copiedValue = copySafeTransportValue(descriptor.value, active)

    if (copiedValue === unsafeTransportValue) {
      return unsafeTransportValue
    }

    copy.push(copiedValue)
  }

  return copy
}

function isRejectedPrimitive(value: unknown): boolean {
  return typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol'
}

function isUtcTimestamp(value: string): boolean {
  if (!utcTimestampPattern.test(value)) {
    return false
  }

  const parsed = new Date(value)

  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}
