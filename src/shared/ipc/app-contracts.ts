import { z } from 'zod'

import type {
  FirstRunGetStateResult,
  FirstRunInitializeRequest,
  FirstRunInitializeResult
} from './first-run-contracts'
import { createIpcResultSchema } from './result'

export const appGetInfoRequestSchema = z.object({}).strict()
export const appGetHealthRequestSchema = z.object({}).strict()

export type AppGetInfoRequest = z.infer<typeof appGetInfoRequestSchema>
export type AppGetHealthRequest = z.infer<typeof appGetHealthRequestSchema>

export const appInfoSchema = z
  .object({
    applicationName: z.literal('Health Screening Offline Desktop'),
    applicationVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    packaged: z.boolean()
  })
  .strict()

export type AppInfo = z.infer<typeof appInfoSchema>

export const appHealthSchema = z
  .object({
    status: z.literal('ready'),
    ipc: z.literal('available'),
    database: z.union([z.literal('ready'), z.literal('unavailable')]),
    clinicalFeatures: z.literal('not-implemented')
  })
  .strict()

export type AppHealth = z.infer<typeof appHealthSchema>

export const appGetInfoResultSchema = createIpcResultSchema(appInfoSchema)
export const appGetHealthResultSchema = createIpcResultSchema(appHealthSchema)

export type AppGetInfoResult = z.infer<typeof appGetInfoResultSchema>
export type AppGetHealthResult = z.infer<typeof appGetHealthResultSchema>

export interface HealthScreeningApi {
  app: {
    getInfo(): Promise<AppGetInfoResult>
    getHealth(): Promise<AppGetHealthResult>
  }
  firstRun: {
    getState(): Promise<FirstRunGetStateResult>
    initialize(request: FirstRunInitializeRequest): Promise<FirstRunInitializeResult>
  }
}
