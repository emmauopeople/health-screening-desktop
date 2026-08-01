import type { LocalUserRole } from '@shared/ipc'

export const authenticationRoleLabels: Record<LocalUserRole, string> = Object.freeze({
  LOCAL_ADMIN: 'Local administrator',
  NURSE: 'Nurse',
  TRAINED_SCREENER: 'Trained screener'
})

export function formatAuthenticationRole(role: LocalUserRole): string {
  return authenticationRoleLabels[role]
}
