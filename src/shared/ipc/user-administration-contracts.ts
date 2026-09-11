import { z } from 'zod'
import { localUserRoleSchema } from './authentication-contracts'
import { createIpcSuccessResultSchema, ipcFailureResultSchema } from './result'

const timestamp = z.string().datetime({ offset: false })
export const publicManagedUserSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().min(3).max(64),
    displayName: z
      .string()
      .min(1)
      .max(240)
      .refine((value) => Array.from(value).length <= 120),
    role: localUserRoleSchema,
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
    failedLoginCount: z.number().int().nonnegative().safe(),
    lockedUntil: timestamp.nullable(),
    lastLoginAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strict()
export const userAdministrationSearchRequestSchema = z
  .object({
    query: z.string().trim().max(100),
    status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']),
    page: z.number().int().min(1).max(10000).safe()
  })
  .strict()
const expected = { userId: z.string().uuid(), expectedUpdatedAt: timestamp }
const reason = z.string().trim().min(1).max(500)
// Main-process password validation applies the canonical Unicode/byte policy.
const password = z.string().min(12).max(256)
export const userAdministrationMutationRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('CREATE'),
      username: z.string().min(3).max(128),
      displayName: z.string().min(1).max(240),
      role: localUserRoleSchema,
      temporaryPassword: password
    })
    .strict(),
  z
    .object({
      action: z.literal('UPDATE'),
      ...expected,
      displayName: z.string().min(1).max(240),
      role: localUserRoleSchema,
      isActive: z.boolean(),
      reason
    })
    .strict(),
  z
    .object({
      action: z.literal('RESET_PASSWORD'),
      ...expected,
      temporaryPassword: password,
      reason
    })
    .strict(),
  z.object({ action: z.literal('UNLOCK'), ...expected, reason }).strict()
])
export const userAdministrationFailureStatusSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'UNAVAILABLE',
  'USERNAME_EXISTS',
  'USER_NOT_FOUND',
  'VERSION_CONFLICT',
  'SELF_CHANGE_FORBIDDEN',
  'LAST_ADMIN',
  'SESSION_CHANGED'
])
const failure = z.object({ status: userAdministrationFailureStatusSchema }).strict()
export const userAdministrationSearchResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(
    z.union([
      failure,
      z
        .object({
          status: z.literal('LOADED'),
          items: z.array(publicManagedUserSchema).max(25),
          total: z.number().int().nonnegative().safe(),
          page: z.number().int().min(1).max(10000),
          currentUserId: z.string().uuid()
        })
        .strict()
    ])
  ),
  ipcFailureResultSchema
])
export const userAdministrationMutationResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(
    z.union([
      failure,
      z.object({ status: z.literal('SAVED'), user: publicManagedUserSchema }).strict()
    ])
  ),
  ipcFailureResultSchema
])
export type PublicManagedUser = z.infer<typeof publicManagedUserSchema>
export type UserAdministrationSearchRequest = z.infer<typeof userAdministrationSearchRequestSchema>
export type UserAdministrationMutationRequest = z.infer<
  typeof userAdministrationMutationRequestSchema
>
export type UserAdministrationSearchResult = z.infer<typeof userAdministrationSearchResultSchema>
export type UserAdministrationMutationResult = z.infer<
  typeof userAdministrationMutationResultSchema
>
export type UserAdministrationFailureStatus = z.infer<typeof userAdministrationFailureStatusSchema>
export interface UserAdministrationApi {
  search(request: UserAdministrationSearchRequest): Promise<UserAdministrationSearchResult>
  mutate(request: UserAdministrationMutationRequest): Promise<UserAdministrationMutationResult>
}
