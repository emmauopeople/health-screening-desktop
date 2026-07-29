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

export const ipcErrorSchema = z.discriminatedUnion('code', [
  z
    .object({
      code: z.literal('VALIDATION_FAILED'),
      message: z.literal(safeIpcErrorMessages.VALIDATION_FAILED)
    })
    .strict(),
  z
    .object({
      code: z.literal('IPC_FORBIDDEN'),
      message: z.literal(safeIpcErrorMessages.IPC_FORBIDDEN)
    })
    .strict(),
  z
    .object({
      code: z.literal('IPC_UNAVAILABLE'),
      message: z.literal(safeIpcErrorMessages.IPC_UNAVAILABLE)
    })
    .strict(),
  z
    .object({
      code: z.literal('INTERNAL_ERROR'),
      message: z.literal(safeIpcErrorMessages.INTERNAL_ERROR)
    })
    .strict()
])

export type IpcSafeError = z.infer<typeof ipcErrorSchema>

export const ipcFailureResultSchema = z
  .object({
    ok: z.literal(false),
    error: ipcErrorSchema
  })
  .strict()

export function createIpcSuccess<T>(data: T): { ok: true; data: T } {
  return {
    ok: true,
    data
  }
}

export function createIpcFailure<TCode extends IpcErrorCode>(
  code: TCode
): { ok: false; error: Extract<IpcSafeError, { code: TCode }> } {
  const message = safeIpcErrorMessages[code]

  return {
    ok: false,
    error: {
      code,
      message
    }
  } as { ok: false; error: Extract<IpcSafeError, { code: TCode }> }
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
