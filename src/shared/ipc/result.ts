import { z } from 'zod'

export const ipcErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR'
])

export type IpcErrorCode = z.infer<typeof ipcErrorCodeSchema>

export const safeIpcErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.'
} as const satisfies Record<IpcErrorCode, string>

export const ipcErrorSchema = z
  .object({
    code: ipcErrorCodeSchema,
    message: z.string().min(1)
  })
  .strict()

export type IpcSafeError = z.infer<typeof ipcErrorSchema>

export const ipcFailureResultSchema = z
  .object({
    ok: z.literal(false),
    error: ipcErrorSchema
  })
  .strict()

export type IpcResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: IpcSafeError
    }

export function createIpcSuccess<T>(data: T): IpcResult<T> {
  return {
    ok: true,
    data
  }
}

export function createIpcFailure(code: IpcErrorCode): IpcResult<never> {
  return {
    ok: false,
    error: {
      code,
      message: safeIpcErrorMessages[code]
    }
  }
}

export function createIpcSuccessResultSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema
): z.ZodObject<{
  ok: z.ZodLiteral<true>
  data: TSchema
}> {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema
    })
    .strict()
}

export function createIpcResultSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema
): z.ZodDiscriminatedUnion<
  [ReturnType<typeof createIpcSuccessResultSchema<TSchema>>, typeof ipcFailureResultSchema]
> {
  return z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(dataSchema),
    ipcFailureResultSchema
  ])
}
