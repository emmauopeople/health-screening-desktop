import { z } from 'zod'
import { createIpcResultSchema } from './result'

export const protocolGetRequestSchema = z.object({}).strict()
export const activeProtocolSchema = z
  .object({
    key: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    effectiveAt: z.iso.datetime(),
    rulesMatch: z.boolean()
  })
  .strict()
export const protocolDataSchema = z.union([
  z.object({ status: z.literal('LOADED'), active: activeProtocolSchema }).strict(),
  z
    .object({
      status: z.enum(['NO_ACTIVE_PROTOCOL', 'AUTHENTICATION_REQUIRED', 'FORBIDDEN', 'UNAVAILABLE'])
    })
    .strict()
])
export const protocolResultSchema = createIpcResultSchema(protocolDataSchema)
export type ProtocolData = z.infer<typeof protocolDataSchema>
export type ProtocolResult = z.infer<typeof protocolResultSchema>
export interface ProtocolApi {
  get(): Promise<ProtocolResult>
}
