import { z } from 'zod'
import {
  historyReasonCodes,
  historyResourceTypes,
  isHistoryPage,
  type HistoryPage
} from '../central-history/contract.mjs'
import { createIpcResultSchema } from './result'

const common = {
  patientId: z.uuid(),
  reasonCode: z.enum(historyReasonCodes)
}

export const centralHistoryReadRequestSchema = z
  .object({
    ...common,
    offset: z.number().int().min(0).max(5000).default(0),
    snapshotId: z.uuid().optional(),
    resourceType: z.enum(historyResourceTypes).optional()
  })
  .strict()

export const centralHistoryRefreshRequestSchema = z
  .object({
    ...common,
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    restart: z.boolean().default(false)
  })
  .strict()
  .refine((value) => {
    const days = (Date.parse(value.toDate) - Date.parse(value.fromDate)) / 86400000 + 1
    return days >= 1 && days <= 366
  })

export const centralHistoryMessages = {
  NO_CACHE: 'No saved central history is available. Connect to the central server and refresh.',
  NOT_CONFIGURED: 'Central synchronization must be configured before retrieving history.',
  IDENTITY_NOT_READY:
    'This patient needs an accepted central identity. Allow synchronization to finish first.',
  UNAUTHENTICATED: 'Sign in and unlock the desktop to view central history.',
  FORBIDDEN: 'Central history is available to active nurses and local administrators.',
  ACCESS_DENIED:
    'Central access could not be confirmed. Saved history has been removed. Check installation access and patient identity.',
  OFFLINE: 'The central server could not be reached. You can still view previously saved history.',
  CURSOR_STALE:
    'Central records changed or the download expired. Start a new refresh; previously saved history is unchanged.',
  CACHE_CHANGED: 'Saved history changed. Open the first page again.',
  INVALID_RESPONSE:
    'The server returned history that could not be verified. Previously saved history is unchanged.',
  LIMIT_REACHED: 'This history exceeds the download limit. Choose a shorter date range.',
  BUSY: 'A history download is already in progress. Try again shortly.',
  VALIDATION_FAILED: 'Choose a valid patient, reason, and date range of at most 366 days.',
  UNAVAILABLE: 'Central history is temporarily unavailable.'
} as const

export type CentralHistoryStatus = keyof typeof centralHistoryMessages
const statusSchema = z
  .object({
    status: z.enum(
      Object.keys(centralHistoryMessages) as [CentralHistoryStatus, ...CentralHistoryStatus[]]
    )
  })
  .strict()
const pageSchema = z.custom<HistoryPage>(isHistoryPage)

export const centralHistoryReadDataSchema = z.union([
  statusSchema,
  z
    .object({
      status: z.literal('READY'),
      snapshotId: z.uuid(),
      savedAt: z.iso.datetime(),
      page: pageSchema,
      offset: z.number().int().min(0).max(5000),
      nextOffset: z.number().int().min(1).max(5000).nullable(),
      total: z.number().int().min(0).max(5000)
    })
    .strict()
])
export const centralHistoryRefreshDataSchema = z.union([
  statusSchema,
  z
    .object({
      status: z.enum(['IN_PROGRESS', 'COMPLETE']),
      downloaded: z.number().int().min(0).max(5000)
    })
    .strict()
])
export const centralHistoryReadResultSchema = createIpcResultSchema(centralHistoryReadDataSchema)
export const centralHistoryRefreshResultSchema = createIpcResultSchema(
  centralHistoryRefreshDataSchema
)
export type CentralHistoryReadRequest = z.input<typeof centralHistoryReadRequestSchema>
export type CentralHistoryRefreshRequest = z.input<typeof centralHistoryRefreshRequestSchema>
export type CentralHistoryReadData = z.infer<typeof centralHistoryReadDataSchema>
export type CentralHistoryRefreshData = z.infer<typeof centralHistoryRefreshDataSchema>
export type CentralHistoryReadResult = z.infer<typeof centralHistoryReadResultSchema>
export type CentralHistoryRefreshResult = z.infer<typeof centralHistoryRefreshResultSchema>
export interface CentralHistoryApi {
  read(request: CentralHistoryReadRequest): Promise<CentralHistoryReadResult>
  refresh(request: CentralHistoryRefreshRequest): Promise<CentralHistoryRefreshResult>
}
