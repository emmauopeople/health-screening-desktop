import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type LifestyleResponse =
  'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'NOT_APPLICABLE' | 'PREFER_NOT_TO_ANSWER'

export type LifestyleAlcoholStatus = 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
export type LifestyleAlcoholEverConsumed = 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED'
export type LifestyleBeverageType =
  'BEER' | 'WINE' | 'SPIRITS' | 'COCKTAILS' | 'FORTIFIED_WINE' | 'OTHER'

export type LifestyleTobaccoStatus =
  'CURRENT_DAILY' | 'CURRENT_SOME_DAYS' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
export type LifestyleTobaccoEverUsed = 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED'
export type LifestyleTobaccoFrequency =
  'EVERY_DAY' | 'SOME_DAYS' | 'NOT_AT_ALL' | 'UNKNOWN' | 'DECLINED'
export type LifestyleTobaccoProductType =
  | 'CIGARETTE'
  | 'ROLLED_TOBACCO'
  | 'CIGAR_PIPE'
  | 'SMOKELESS'
  | 'SNUFF'
  | 'HOOKAH'
  | 'VAPE'
  | 'OTHER'
export type LifestyleTobaccoQuantityUnit =
  'STICKS_CIGARETTES' | 'SESSIONS' | 'PORTIONS' | 'PINS' | 'PODS_CARTRIDGES' | 'OTHER'

export type LifestyleActivityDomain = 'WORK_OR_FARMING' | 'TRANSPORT' | 'HOUSEHOLD' | 'EXERCISE'
export type LifestyleActivityIntensity = 'LIGHT' | 'MODERATE' | 'VIGOROUS'
export type LifestyleEmploymentStatus =
  | 'EMPLOYED'
  | 'SELF_EMPLOYED'
  | 'FARMING'
  | 'STUDENT'
  | 'HOMEMAKER_CAREGIVER'
  | 'UNEMPLOYED'
  | 'RETIRED'
  | 'UNABLE_TO_WORK'
  | 'OTHER'
  | 'DECLINED'
export type LifestylePhysicalDemand =
  'SITTING' | 'STANDING' | 'WALKING' | 'MODERATE_LABOR' | 'HEAVY_LABOR' | 'VARIES'
export type LifestyleShiftPattern =
  'DAY' | 'EVENING' | 'NIGHT' | 'ROTATING' | 'IRREGULAR' | 'NOT_APPLICABLE' | 'UNKNOWN' | 'DECLINED'
export type LifestyleWorkWeeklyResponse =
  | 'USUAL'
  | 'LESS_THAN_USUAL'
  | 'MORE_THAN_USUAL'
  | 'NO_WORK'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'DECLINED'
  | 'PREFER_NOT_TO_ANSWER'
export type LifestyleOtherActivityCategory =
  'FARMING_GARDENING' | 'HOUSEHOLD' | 'CAREGIVING' | 'COMMUNITY' | 'COMMUTE' | 'SPORT' | 'OTHER'

export type LifestyleDraftStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETE'
export type LifestyleDate = string & { readonly __brand: 'LifestyleDate' }

export interface LifestyleAlcoholBaselineRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly version: number
  readonly status: LifestyleAlcoholStatus
  readonly everConsumed: LifestyleAlcoholEverConsumed
  readonly consumedPast12Months: LifestyleAlcoholEverConsumed
  readonly commonBeverageTypes: readonly LifestyleBeverageType[]
  readonly otherBeverageDescription: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoBaselineRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly version: number
  readonly status: LifestyleTobaccoStatus
  readonly everRegularlyUsed: LifestyleTobaccoEverUsed
  readonly formerUseApproximateStopDate: string | null
  readonly currentUseFrequency: LifestyleTobaccoFrequency
  readonly productTypes: readonly LifestyleTobaccoProductType[]
  readonly otherProductDescription: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleWorkBaselineRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly version: number
  readonly status: LifestyleEmploymentStatus
  readonly occupationJobTitle: string | null
  readonly usualPhysicalDemand: LifestylePhysicalDemand | null
  readonly typicalWorkdaysPerWeek: number | null
  readonly typicalHoursPerWorkday: number | null
  readonly shiftPattern: LifestyleShiftPattern | null
  readonly description: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleAlcoholBaselineInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly expectedCurrentVersion: number | null
  readonly status: LifestyleAlcoholStatus
  readonly everConsumed: LifestyleAlcoholEverConsumed
  readonly consumedPast12Months: LifestyleAlcoholEverConsumed
  readonly commonBeverageTypes: readonly LifestyleBeverageType[]
  readonly otherBeverageDescription: string | null
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface LifestyleTobaccoBaselineInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly expectedCurrentVersion: number | null
  readonly status: LifestyleTobaccoStatus
  readonly everRegularlyUsed: LifestyleTobaccoEverUsed
  readonly formerUseApproximateStopDate: string | null
  readonly currentUseFrequency: LifestyleTobaccoFrequency
  readonly productTypes: readonly LifestyleTobaccoProductType[]
  readonly otherProductDescription: string | null
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface LifestyleWorkBaselineInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly installationId: EntityId
  readonly expectedCurrentVersion: number | null
  readonly status: LifestyleEmploymentStatus
  readonly occupationJobTitle: string | null
  readonly usualPhysicalDemand: LifestylePhysicalDemand | null
  readonly typicalWorkdaysPerWeek: number | null
  readonly typicalHoursPerWorkday: number | null
  readonly shiftPattern: LifestyleShiftPattern | null
  readonly description: string | null
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface LifestyleAlcoholWeeklyRecord {
  readonly id: EntityId
  readonly lifestyleDraftId: EntityId
  readonly weeklyResponse: LifestyleResponse | null
  readonly drinkingDays: number | null
  readonly totalStandardizedDrinks: number | null
  readonly largestOneDayAmount: number | null
  readonly daysAtLargestAmount: number | null
  readonly commonBeverageTypes: readonly LifestyleBeverageType[]
  readonly otherBeverageDescription: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoProductRow {
  readonly id: EntityId
  readonly tobaccoWeeklyRecordId: EntityId
  readonly sequenceNumber: number
  readonly productType: LifestyleTobaccoProductType
  readonly daysUsed: number
  readonly averageQuantityPerUseDay: number
  readonly unit: LifestyleTobaccoQuantityUnit
  readonly secondhandSmokeExposure: boolean | null
  readonly otherProductDescription: string | null
  readonly otherUnitDescription: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoWeeklyRecord {
  readonly id: EntityId
  readonly lifestyleDraftId: EntityId
  readonly weeklyResponse: LifestyleResponse | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly products: readonly LifestyleTobaccoProductRow[]
}

export interface LifestyleActivityRow {
  readonly id: EntityId
  readonly physicalActivityWeeklyRecordId: EntityId
  readonly sequenceNumber: number
  readonly activityDomain: LifestyleActivityDomain
  readonly description: string | null
  readonly intensity: LifestyleActivityIntensity
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerActiveDay: number
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly weeklyMinutes: number
}

export interface LifestylePhysicalActivityWeeklyRecord {
  readonly id: EntityId
  readonly lifestyleDraftId: EntityId
  readonly weeklyResponse: LifestyleResponse | 'UNABLE_TO_ANSWER' | null
  readonly sedentaryMinutesPerDay: number | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly activities: readonly LifestyleActivityRow[]
}

export interface LifestyleWorkWeeklyRecord {
  readonly id: EntityId
  readonly lifestyleDraftId: EntityId
  readonly weeklyResponse: LifestyleWorkWeeklyResponse | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleOtherActivityRow {
  readonly id: EntityId
  readonly lifestyleDraftId: EntityId
  readonly sequenceNumber: number
  readonly category: LifestyleOtherActivityCategory
  readonly description: string
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerDay: number
  readonly intensity: LifestyleActivityIntensity
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleDraftRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: LifestyleDraftStatus
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: LifestyleDate
  readonly periodEnd: LifestyleDate
  readonly alcoholBaselineVersionId: EntityId | null
  readonly tobaccoBaselineVersionId: EntityId | null
  readonly workBaselineVersionId: EntityId | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly rowVersion: number
  readonly alcohol: LifestyleAlcoholWeeklyRecord | null
  readonly tobacco: LifestyleTobaccoWeeklyRecord | null
  readonly physicalActivity: LifestylePhysicalActivityWeeklyRecord | null
  readonly work: LifestyleWorkWeeklyRecord | null
  readonly otherActivities: readonly LifestyleOtherActivityRow[]
}

export interface LifestyleDraftOwnershipInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: LifestyleDate
  readonly periodEnd: LifestyleDate
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface LifestyleDraftUpdateInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly status: LifestyleDraftStatus
  readonly alcoholBaselineVersionId: EntityId | null
  readonly tobaccoBaselineVersionId: EntityId | null
  readonly workBaselineVersionId: EntityId | null
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
  readonly alcohol: LifestyleAlcoholWeeklyInput | null
  readonly tobacco: LifestyleTobaccoWeeklyInput | null
  readonly physicalActivity: LifestylePhysicalActivityWeeklyInput | null
  readonly work: LifestyleWorkWeeklyInput | null
  readonly otherActivities: readonly LifestyleOtherActivityInput[]
}

export interface LifestyleAlcoholWeeklyInput {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleResponse | null
  readonly drinkingDays: number | null
  readonly totalStandardizedDrinks: number | null
  readonly largestOneDayAmount: number | null
  readonly daysAtLargestAmount: number | null
  readonly commonBeverageTypes: readonly LifestyleBeverageType[]
  readonly otherBeverageDescription: string | null
}

export interface LifestyleTobaccoProductInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly productType: LifestyleTobaccoProductType
  readonly daysUsed: number
  readonly averageQuantityPerUseDay: number
  readonly unit: LifestyleTobaccoQuantityUnit
  readonly secondhandSmokeExposure: boolean | null
  readonly otherProductDescription: string | null
  readonly otherUnitDescription: string | null
}

export interface LifestyleTobaccoWeeklyInput {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleResponse | null
  readonly products: readonly LifestyleTobaccoProductInput[]
}

export interface LifestyleActivityInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly activityDomain: LifestyleActivityDomain
  readonly description: string | null
  readonly intensity: LifestyleActivityIntensity
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerActiveDay: number
}

export interface LifestylePhysicalActivityWeeklyInput {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleResponse | 'UNABLE_TO_ANSWER' | null
  readonly sedentaryMinutesPerDay: number | null
  readonly activities: readonly LifestyleActivityInput[]
}

export interface LifestyleWorkWeeklyInput {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleWorkWeeklyResponse | null
}

export interface LifestyleOtherActivityInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly category: LifestyleOtherActivityCategory
  readonly description: string
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerDay: number
  readonly intensity: LifestyleActivityIntensity
}

export type LifestyleVersionResult<T> =
  | { readonly status: 'INSERTED'; readonly record: T }
  | { readonly status: 'VERSION_CONFLICT'; readonly currentVersion: number | null }

export type LifestyleDraftUpdateResult =
  | { readonly status: 'UPDATED'; readonly draft: LifestyleDraftRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'VERSION_CONFLICT'; readonly draft: LifestyleDraftRecord }

export interface LifestyleRepository {
  findActiveAlcoholBaseline(
    patientId: EntityId,
    installationId: EntityId
  ): LifestyleAlcoholBaselineRecord | null
  listAlcoholBaselineHistory(
    patientId: EntityId,
    installationId: EntityId
  ): readonly LifestyleAlcoholBaselineRecord[]
  insertAlcoholBaseline(
    connection: DatabaseTransactionConnection,
    input: LifestyleAlcoholBaselineInput
  ): LifestyleVersionResult<LifestyleAlcoholBaselineRecord>
  findActiveTobaccoBaseline(
    patientId: EntityId,
    installationId: EntityId
  ): LifestyleTobaccoBaselineRecord | null
  listTobaccoBaselineHistory(
    patientId: EntityId,
    installationId: EntityId
  ): readonly LifestyleTobaccoBaselineRecord[]
  insertTobaccoBaseline(
    connection: DatabaseTransactionConnection,
    input: LifestyleTobaccoBaselineInput
  ): LifestyleVersionResult<LifestyleTobaccoBaselineRecord>
  findActiveWorkBaseline(
    patientId: EntityId,
    installationId: EntityId
  ): LifestyleWorkBaselineRecord | null
  listWorkBaselineHistory(
    patientId: EntityId,
    installationId: EntityId
  ): readonly LifestyleWorkBaselineRecord[]
  insertWorkBaseline(
    connection: DatabaseTransactionConnection,
    input: LifestyleWorkBaselineInput
  ): LifestyleVersionResult<LifestyleWorkBaselineRecord>
  findDraftByEncounter(encounterId: EntityId): LifestyleDraftRecord | null
  findDraftByEncounterForWrite(
    connection: DatabaseTransactionConnection,
    encounterId: EntityId
  ): LifestyleDraftRecord | null
  insertDraft(
    connection: DatabaseTransactionConnection,
    input: LifestyleDraftOwnershipInput
  ): LifestyleDraftRecord
  updateDraft(
    connection: DatabaseTransactionConnection,
    input: LifestyleDraftUpdateInput
  ): LifestyleDraftUpdateResult
}
