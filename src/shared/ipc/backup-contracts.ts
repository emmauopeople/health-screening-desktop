import { z } from 'zod'
import { createIpcResultSchema } from './result'

export const backupRequestSchema = z.object({ password: z.string().min(12).max(128) }).strict()
export const backupMetadataSchema = z
  .object({
    formatVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    applicationVersion: z.string().min(1).max(80),
    schemaVersion: z.number().int().positive(),
    installationId: z.uuid(),
    deploymentName: z.string().min(1).max(200),
    timeZone: z.string().min(1).max(100),
    counts: z
      .object({
        patients: z.number().int().nonnegative(),
        encounters: z.number().int().nonnegative(),
        referrals: z.number().int().nonnegative(),
        users: z.number().int().nonnegative()
      })
      .strict(),
    credentialScope: z.literal('ORIGINAL_OS_PROFILE')
  })
  .strict()
const failureStatus = z.enum([
  'CANCELLED',
  'BUSY',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'INVALID_BACKUP',
  'UNSUPPORTED_BACKUP',
  'DESTINATION_EXISTS',
  'UNAVAILABLE'
])
export const backupActionDataSchema = z.union([
  z.object({ status: z.enum(['SAVED', 'VERIFIED']), metadata: backupMetadataSchema }).strict(),
  z.object({ status: failureStatus }).strict()
])
export const backupActionResultSchema = createIpcResultSchema(backupActionDataSchema)
export type BackupMetadata = z.infer<typeof backupMetadataSchema>
export type BackupRequest = z.infer<typeof backupRequestSchema>
export type BackupActionData = z.infer<typeof backupActionDataSchema>
export type BackupActionResult = z.infer<typeof backupActionResultSchema>
export interface BackupApi {
  create(request: BackupRequest): Promise<BackupActionResult>
  inspect(request: BackupRequest): Promise<BackupActionResult>
}
