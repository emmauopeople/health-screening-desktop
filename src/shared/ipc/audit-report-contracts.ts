import { z } from 'zod'

import { createIpcSuccessResultSchema, ipcFailureResultSchema } from './result'

export const auditReportUuidSchema = z.string().uuid()
export const auditReportUtcTimestampSchema = z.string().datetime({ offset: false })
export const auditReportPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)])
export const auditReportActionCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u)
export const auditReportEntityTypeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u)

const reservedAuditMetadataKeys = new Set(['__proto__', 'prototype', 'constructor'])
const auditMetadataKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u)
  .refine((value) => !reservedAuditMetadataKeys.has(value))
const auditMetadataScalarSchema = z.union([
  z.null(),
  z.boolean(),
  z.number().int().safe(),
  z.string().max(256)
])

interface AuditMetadataObject {
  readonly [key: string]: AuditMetadataValue
}

type AuditMetadataValue =
  null | boolean | number | string | readonly AuditMetadataValue[] | AuditMetadataObject

const auditMetadataValueSchema: z.ZodType<AuditMetadataValue> = z.lazy(() =>
  z.union([
    auditMetadataScalarSchema,
    z.array(auditMetadataValueSchema).max(50),
    z
      .record(auditMetadataKeySchema, auditMetadataValueSchema)
      .refine((value) => Object.keys(value).length <= 50)
  ])
)

export const publicAuditMetadataSchema = z
  .record(auditMetadataKeySchema, auditMetadataValueSchema)
  .refine((value) => Object.keys(value).length <= 50)

export const auditReportActorFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }).strict(),
  z.object({ kind: z.literal('SYSTEM') }).strict(),
  z.object({ kind: z.literal('USER'), userId: auditReportUuidSchema }).strict()
])

export const auditReportGetContextRequestSchema = z.object({}).strict()

export const auditReportSearchRequestSchema = z
  .object({
    query: z.string().trim().max(100),
    occurredFromInclusive: auditReportUtcTimestampSchema.nullable(),
    occurredToExclusive: auditReportUtcTimestampSchema.nullable(),
    actor: auditReportActorFilterSchema,
    action: auditReportActionCodeSchema.nullable(),
    entityType: auditReportEntityTypeSchema.nullable(),
    entityId: auditReportUuidSchema.nullable(),
    page: z.number().int().min(1).max(10000).safe(),
    pageSize: auditReportPageSizeSchema
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.occurredFromInclusive !== null &&
      request.occurredToExclusive !== null &&
      request.occurredFromInclusive >= request.occurredToExclusive
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredToExclusive'],
        message: 'The exclusive end must be after the inclusive start.'
      })
    }

    if (request.entityId !== null && request.entityType === null) {
      context.addIssue({
        code: 'custom',
        path: ['entityType'],
        message: 'An entity type is required when filtering by entity ID.'
      })
    }
  })

export const publicAuditReportActorSchema = z
  .object({
    id: auditReportUuidSchema,
    username: z.string().min(1).max(64),
    displayName: z.string().min(1).max(160),
    role: z.enum(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'])
  })
  .strict()

export const publicAuditReportDeploymentSchema = z
  .object({
    id: auditReportUuidSchema,
    name: z.string().min(1).max(120),
    timeZone: z.string().min(1).max(64)
  })
  .strict()

export const publicAuditReportEventSchema = z
  .object({
    id: auditReportUuidSchema,
    action: auditReportActionCodeSchema,
    entityType: auditReportEntityTypeSchema,
    entityId: auditReportUuidSchema.nullable(),
    occurredAt: auditReportUtcTimestampSchema,
    actor: publicAuditReportActorSchema.nullable(),
    deployment: publicAuditReportDeploymentSchema,
    metadata: publicAuditMetadataSchema
  })
  .strict()

const controlledStatusSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'UNAVAILABLE'
])

const contextDataSchema = z.union([
  z
    .object({
      status: z.literal('LOADED'),
      deployment: publicAuditReportDeploymentSchema,
      actors: z.array(publicAuditReportActorSchema).max(250),
      actions: z.array(auditReportActionCodeSchema).max(250),
      entityTypes: z.array(auditReportEntityTypeSchema).max(250),
      hasSystemEvents: z.boolean()
    })
    .strict(),
  z.object({ status: controlledStatusSchema }).strict()
])

const searchDataSchema = z.union([
  z
    .object({
      status: z.literal('LOADED'),
      items: z.array(publicAuditReportEventSchema).max(100),
      page: z.number().int().min(1).max(10000).safe(),
      pageSize: auditReportPageSizeSchema,
      total: z.number().int().min(0).safe()
    })
    .strict(),
  z.object({ status: controlledStatusSchema }).strict()
])

export const auditReportGetContextResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(contextDataSchema),
  ipcFailureResultSchema
])

export const auditReportSearchResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(searchDataSchema),
  ipcFailureResultSchema
])

export type AuditReportActorFilter = z.infer<typeof auditReportActorFilterSchema>
export type AuditReportGetContextRequest = z.infer<typeof auditReportGetContextRequestSchema>
export type AuditReportSearchRequest = z.infer<typeof auditReportSearchRequestSchema>
export type AuditReportGetContextResult = z.infer<typeof auditReportGetContextResultSchema>
export type AuditReportSearchResult = z.infer<typeof auditReportSearchResultSchema>
export type PublicAuditMetadata = z.infer<typeof publicAuditMetadataSchema>
export type PublicAuditReportActor = z.infer<typeof publicAuditReportActorSchema>
export type PublicAuditReportDeployment = z.infer<typeof publicAuditReportDeploymentSchema>
export type PublicAuditReportEvent = z.infer<typeof publicAuditReportEventSchema>

export interface AuditReportApi {
  getContext(): Promise<AuditReportGetContextResult>
  search(request: AuditReportSearchRequest): Promise<AuditReportSearchResult>
}
