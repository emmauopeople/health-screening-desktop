import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { ScreeningSessionDate, ScreeningSessionStatus } from './screening-session-types'

export interface ScreeningSessionSummaryRecord {
  readonly id: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly status: ScreeningSessionStatus
  readonly location: { readonly id: EntityId; readonly name: string }
  readonly openedAt: UtcTimestamp
  readonly openedBy: { readonly id: EntityId; readonly displayName: string }
  readonly closedAt: UtcTimestamp | null
  readonly closedBy: { readonly id: EntityId; readonly displayName: string } | null
  readonly operational: {
    readonly totalEncounters: number
    readonly activeDrafts: number
    readonly emptyDrafts: number
    readonly finalizedEncounters: number
    readonly voidedEncounters: number
  }
  readonly recommendations: {
    readonly routine: number
    readonly standardReferral: number
    readonly urgentReferral: number
  }
  readonly referrals: { readonly open: number; readonly closed: number }
}

export interface ScreeningSessionSummaryRepository {
  getBySessionId(sessionId: EntityId): ScreeningSessionSummaryRecord | null
}
