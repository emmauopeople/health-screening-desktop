import { DatabaseTransactionStateError } from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { compareLifestyleDecimalQuantities } from '@shared/lifestyle-alcohol-quantity'

import { getRepositoryErrorType, RepositoryValidationError } from '../repository-errors'
import { readDataProperties } from '../screening-encounter'
import type {
  LifestyleActivityDomain,
  LifestyleActivityInput,
  LifestyleActivityIntensity,
  LifestyleAlcoholBaselineInput,
  LifestyleAlcoholEverConsumed,
  LifestyleAlcoholStatus,
  LifestyleAlcoholWeeklyInput,
  LifestyleBeverageType,
  LifestyleDate,
  LifestyleDraftOwnershipInput,
  LifestyleDraftStatus,
  LifestyleDraftUpdateInput,
  LifestyleEmploymentStatus,
  LifestyleOtherActivityCategory,
  LifestyleOtherActivityInput,
  LifestylePhysicalActivityWeeklyInput,
  LifestylePhysicalDemand,
  LifestyleResponse,
  LifestyleShiftPattern,
  LifestyleTobaccoBaselineInput,
  LifestyleTobaccoEverUsed,
  LifestyleTobaccoFrequency,
  LifestyleTobaccoProductInput,
  LifestyleTobaccoProductType,
  LifestyleTobaccoQuantityUnit,
  LifestyleTobaccoWeeklyInput,
  LifestyleWorkBaselineInput,
  LifestyleWorkWeeklyInput,
  LifestyleWorkWeeklyResponse
} from './lifestyle-types'

const responseCodes = new Set<LifestyleResponse>([
  'YES',
  'NO',
  'UNKNOWN',
  'DECLINED',
  'NOT_APPLICABLE',
  'PREFER_NOT_TO_ANSWER'
])
const alcoholStatusCodes = new Set<LifestyleAlcoholStatus>([
  'CURRENT',
  'FORMER',
  'NEVER',
  'UNKNOWN',
  'DECLINED'
])
const alcoholEverCodes = new Set<LifestyleAlcoholEverConsumed>(['YES', 'NO', 'UNKNOWN', 'DECLINED'])
const beverageCodes = new Set<LifestyleBeverageType>([
  'BEER',
  'WINE',
  'SPIRITS',
  'COCKTAILS',
  'FORTIFIED_WINE',
  'OTHER'
])
const tobaccoStatusCodes = new Set([
  'CURRENT_DAILY',
  'CURRENT_SOME_DAYS',
  'FORMER',
  'NEVER',
  'UNKNOWN',
  'DECLINED'
] satisfies readonly LifestyleTobaccoBaselineInput['status'][])
const tobaccoEverCodes = new Set<LifestyleTobaccoEverUsed>(['YES', 'NO', 'UNKNOWN', 'DECLINED'])
const tobaccoFrequencyCodes = new Set<LifestyleTobaccoFrequency>([
  'EVERY_DAY',
  'SOME_DAYS',
  'NOT_AT_ALL',
  'UNKNOWN',
  'DECLINED'
])
const tobaccoProductCodes = new Set<LifestyleTobaccoProductType>([
  'CIGARETTE',
  'ROLLED_TOBACCO',
  'CIGAR_PIPE',
  'SMOKELESS',
  'SNUFF',
  'HOOKAH',
  'VAPE',
  'OTHER'
])
const tobaccoUnitCodes = new Set<LifestyleTobaccoQuantityUnit>([
  'STICKS_CIGARETTES',
  'SESSIONS',
  'PORTIONS',
  'PINS',
  'PODS_CARTRIDGES',
  'OTHER'
])
const activityDomainCodes = new Set<LifestyleActivityDomain>([
  'WORK_OR_FARMING',
  'TRANSPORT',
  'HOUSEHOLD',
  'EXERCISE'
])
const intensityCodes = new Set<LifestyleActivityIntensity>(['LIGHT', 'MODERATE', 'VIGOROUS'])
const employmentCodes = new Set<LifestyleEmploymentStatus>([
  'EMPLOYED',
  'SELF_EMPLOYED',
  'FARMING',
  'STUDENT',
  'HOMEMAKER_CAREGIVER',
  'UNEMPLOYED',
  'RETIRED',
  'UNABLE_TO_WORK',
  'OTHER',
  'DECLINED'
])
const physicalDemandCodes = new Set<LifestylePhysicalDemand>([
  'SITTING',
  'STANDING',
  'WALKING',
  'MODERATE_LABOR',
  'HEAVY_LABOR',
  'VARIES'
])
const shiftCodes = new Set<LifestyleShiftPattern>([
  'DAY',
  'EVENING',
  'NIGHT',
  'ROTATING',
  'IRREGULAR',
  'NOT_APPLICABLE',
  'UNKNOWN',
  'DECLINED'
])
const workResponseCodes = new Set<LifestyleWorkWeeklyResponse>([
  'USUAL',
  'LESS_THAN_USUAL',
  'MORE_THAN_USUAL',
  'NO_WORK',
  'NOT_APPLICABLE',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
type LifestylePhysicalActivityResponse = Exclude<
  LifestylePhysicalActivityWeeklyInput['weeklyResponse'],
  null
>
const physicalActivityResponseCodes = new Set<LifestylePhysicalActivityResponse>([
  'YES',
  'NO',
  'UNKNOWN',
  'DECLINED',
  'NOT_APPLICABLE',
  'UNABLE_TO_ANSWER',
  'PREFER_NOT_TO_ANSWER'
])
const otherCategoryCodes = new Set<LifestyleOtherActivityCategory>([
  'FARMING_GARDENING',
  'HOUSEHOLD',
  'CAREGIVING',
  'COMMUNITY',
  'COMMUTE',
  'SPORT',
  'OTHER'
])

const draftStatusCodes = new Set<LifestyleDraftStatus>(['DRAFT', 'IN_PROGRESS', 'COMPLETE'])
const datePattern = /^\d{4}-\d{2}-\d{2}$/u
const approximateDatePattern = /^\d{4}(?:-\d{2})?$/u

const ownershipKeys = Object.freeze([
  'id',
  'encounterId',
  'patientId',
  'screeningSessionId',
  'locationId',
  'installationId',
  'periodStart',
  'periodEnd',
  'actorId',
  'occurredAt'
] as const)

export function parseLifestyleAlcoholBaselineInput(
  input: LifestyleAlcoholBaselineInput
): ReturnType<typeof parseLifestyleAlcoholBaselineInputInternal> {
  return parseLifestyleAlcoholBaselineInputInternal(input)
}
function parseLifestyleAlcoholBaselineInputInternal(
  input: LifestyleAlcoholBaselineInput
): LifestyleAlcoholBaselineInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'patientId',
      'installationId',
      'expectedCurrentVersion',
      'status',
      'everConsumed',
      'consumedPast12Months',
      'commonBeverageTypes',
      'otherBeverageDescription',
      'actorId',
      'occurredAt'
    ] as const)
    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patientId),
      installationId: parseEntityId(data.installationId),
      expectedCurrentVersion: parseNullableVersion(data.expectedCurrentVersion),
      status: parseCode(data.status, alcoholStatusCodes),
      everConsumed: parseCode(data.everConsumed, alcoholEverCodes),
      consumedPast12Months: parseCode(data.consumedPast12Months, alcoholEverCodes),
      commonBeverageTypes: parseCodeList(data.commonBeverageTypes, beverageCodes),
      otherBeverageDescription: parseOtherDescription(
        data.otherBeverageDescription,
        data.commonBeverageTypes
      ),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLifestyleTobaccoBaselineInput(
  input: LifestyleTobaccoBaselineInput
): ReturnType<typeof parseLifestyleTobaccoBaselineInputInternal> {
  return parseLifestyleTobaccoBaselineInputInternal(input)
}
function parseLifestyleTobaccoBaselineInputInternal(
  input: LifestyleTobaccoBaselineInput
): LifestyleTobaccoBaselineInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'patientId',
      'installationId',
      'expectedCurrentVersion',
      'status',
      'everRegularlyUsed',
      'formerUseApproximateStopDate',
      'currentUseFrequency',
      'productTypes',
      'otherProductDescription',
      'actorId',
      'occurredAt'
    ] as const)
    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patientId),
      installationId: parseEntityId(data.installationId),
      expectedCurrentVersion: parseNullableVersion(data.expectedCurrentVersion),
      status: parseCode(data.status, tobaccoStatusCodes),
      everRegularlyUsed: parseCode(data.everRegularlyUsed, tobaccoEverCodes),
      formerUseApproximateStopDate: parseApproximateDate(data.formerUseApproximateStopDate),
      currentUseFrequency: parseCode(data.currentUseFrequency, tobaccoFrequencyCodes),
      productTypes: parseCodeList(data.productTypes, tobaccoProductCodes),
      otherProductDescription: parseOtherDescription(
        data.otherProductDescription,
        data.productTypes
      ),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLifestyleWorkBaselineInput(
  input: LifestyleWorkBaselineInput
): ReturnType<typeof parseLifestyleWorkBaselineInputInternal> {
  return parseLifestyleWorkBaselineInputInternal(input)
}
function parseLifestyleWorkBaselineInputInternal(
  input: LifestyleWorkBaselineInput
): LifestyleWorkBaselineInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'patientId',
      'installationId',
      'expectedCurrentVersion',
      'status',
      'occupationJobTitle',
      'usualPhysicalDemand',
      'typicalWorkdaysPerWeek',
      'typicalHoursPerWorkday',
      'shiftPattern',
      'description',
      'actorId',
      'occurredAt'
    ] as const)
    return Object.freeze({
      id: parseEntityId(data.id),
      patientId: parseEntityId(data.patientId),
      installationId: parseEntityId(data.installationId),
      expectedCurrentVersion: parseNullableVersion(data.expectedCurrentVersion),
      status: parseCode(data.status, employmentCodes),
      occupationJobTitle: parseNullableText(data.occupationJobTitle),
      usualPhysicalDemand: parseNullableCode(data.usualPhysicalDemand, physicalDemandCodes),
      typicalWorkdaysPerWeek: parseNullableInteger(data.typicalWorkdaysPerWeek, 0, 7),
      typicalHoursPerWorkday: parseNullableReal(data.typicalHoursPerWorkday, 0, 24),
      shiftPattern: parseNullableCode(data.shiftPattern, shiftCodes),
      description: parseNullableText(data.description),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLifestyleDraftOwnershipInput(
  input: LifestyleDraftOwnershipInput
): ReturnType<typeof parseLifestyleDraftOwnershipInputInternal> {
  return parseLifestyleDraftOwnershipInputInternal(input)
}
function parseLifestyleDraftOwnershipInputInternal(
  input: LifestyleDraftOwnershipInput
): LifestyleDraftOwnershipInput {
  try {
    const data = readDataProperties(input, ownershipKeys)
    const periodStart = parseDate(data.periodStart)
    const periodEnd = parseDate(data.periodEnd)
    if (periodStart > periodEnd) throw new RepositoryValidationError()
    return Object.freeze({
      id: parseEntityId(data.id),
      encounterId: parseEntityId(data.encounterId),
      patientId: parseEntityId(data.patientId),
      screeningSessionId: parseEntityId(data.screeningSessionId),
      locationId: parseEntityId(data.locationId),
      installationId: parseEntityId(data.installationId),
      periodStart,
      periodEnd,
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function parseLifestyleDraftUpdateInput(
  input: LifestyleDraftUpdateInput
): ReturnType<typeof parseLifestyleDraftUpdateInputInternal> {
  return parseLifestyleDraftUpdateInputInternal(input)
}
function parseLifestyleDraftUpdateInputInternal(
  input: LifestyleDraftUpdateInput
): LifestyleDraftUpdateInput {
  try {
    const data = readDataProperties(input, [
      'id',
      'expectedRowVersion',
      'status',
      'alcoholBaselineVersionId',
      'tobaccoBaselineVersionId',
      'workBaselineVersionId',
      'actorId',
      'occurredAt',
      'alcohol',
      'tobacco',
      'physicalActivity',
      'work',
      'otherActivities'
    ] as const)
    return Object.freeze({
      id: parseEntityId(data.id),
      expectedRowVersion: parseVersion(data.expectedRowVersion),
      status: parseCode(data.status, draftStatusCodes),
      alcoholBaselineVersionId: parseNullableEntityId(data.alcoholBaselineVersionId),
      tobaccoBaselineVersionId: parseNullableEntityId(data.tobaccoBaselineVersionId),
      workBaselineVersionId: parseNullableEntityId(data.workBaselineVersionId),
      actorId: parseEntityId(data.actorId),
      occurredAt: parseUtcTimestamp(data.occurredAt),
      alcohol: data.alcohol === null ? null : parseAlcoholWeekly(data.alcohol),
      tobacco: data.tobacco === null ? null : parseTobaccoWeekly(data.tobacco),
      physicalActivity:
        data.physicalActivity === null ? null : parsePhysicalWeekly(data.physicalActivity),
      work: data.work === null ? null : parseWorkWeekly(data.work),
      otherActivities: parseOtherActivities(data.otherActivities)
    })
  } catch (error) {
    throw toValidationError(error)
  }
}

export function calculateLifestyleWeeklyMinutes(days: number, minutesPerDay: number): number {
  if (
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > 7 ||
    !Number.isSafeInteger(minutesPerDay) ||
    minutesPerDay <= 0
  ) {
    throw new RepositoryValidationError()
  }
  return days * minutesPerDay
}

function parseAlcoholWeekly(value: unknown): LifestyleAlcoholWeeklyInput {
  const data = readDataProperties(value, [
    'id',
    'weeklyResponse',
    'drinkingDays',
    'totalStandardizedDrinks',
    'largestOneDayAmount',
    'daysAtLargestAmount',
    'commonBeverageTypes',
    'otherBeverageDescription'
  ] as const)
  const weeklyResponse = parseNullableCode(data.weeklyResponse, responseCodes)
  const drinkingDays = parseNullableInteger(data.drinkingDays, 0, 7)
  const total = parseNullableNonnegativeReal(data.totalStandardizedDrinks)
  const largest = parseNullableNonnegativeReal(data.largestOneDayAmount)
  const largestDays = parseNullableInteger(data.daysAtLargestAmount, 0, 7)
  const commonBeverageTypes = parseCodeList(data.commonBeverageTypes, beverageCodes)
  const otherBeverageDescription = parseDraftOtherDescription(
    data.otherBeverageDescription,
    commonBeverageTypes
  )
  if (weeklyResponse === 'NO') {
    if (
      drinkingDays !== null ||
      total !== null ||
      largest !== null ||
      largestDays !== null ||
      commonBeverageTypes.length > 0 ||
      otherBeverageDescription !== null
    )
      throw new RepositoryValidationError()
  } else if (weeklyResponse === 'YES') {
    if (
      (drinkingDays !== null && drinkingDays < 1) ||
      (total !== null && total <= 0) ||
      (largest !== null && largest <= 0) ||
      (largestDays !== null && largestDays < 1)
    )
      throw new RepositoryValidationError()
  } else if (
    drinkingDays !== null ||
    total !== null ||
    largest !== null ||
    largestDays !== null ||
    commonBeverageTypes.length > 0 ||
    otherBeverageDescription !== null
  )
    throw new RepositoryValidationError()
  if (largest !== null && total !== null && largest > total) throw new RepositoryValidationError()
  if (largestDays !== null && drinkingDays !== null && largestDays > drinkingDays)
    throw new RepositoryValidationError()
  if (total !== null && largest !== null && largestDays !== null) {
    const highestAmountSubtotal = largest * largestDays
    const subtotalComparison = compareLifestyleDecimalQuantities(total, highestAmountSubtotal)
    const sameNumberOfDaysRequiresExactTotal =
      drinkingDays !== null && drinkingDays === largestDays && subtotalComparison !== 0
    const additionalDaysRequireAdditionalDrinks =
      drinkingDays !== null && drinkingDays > largestDays && subtotalComparison <= 0
    if (
      subtotalComparison < 0 ||
      sameNumberOfDaysRequiresExactTotal ||
      additionalDaysRequireAdditionalDrinks
    )
      throw new RepositoryValidationError()
  }
  return {
    id: parseEntityId(data.id),
    weeklyResponse,
    drinkingDays,
    totalStandardizedDrinks: total,
    largestOneDayAmount: largest,
    daysAtLargestAmount: largestDays,
    commonBeverageTypes,
    otherBeverageDescription
  }
}

export function parseCompleteLifestyleAlcoholWeeklyInput(
  input: LifestyleAlcoholWeeklyInput
): LifestyleAlcoholWeeklyInput {
  const parsed = parseAlcoholWeekly(input)
  if (parsed.weeklyResponse === null) throw new RepositoryValidationError()
  if (parsed.weeklyResponse === 'YES') {
    if (
      parsed.drinkingDays === null ||
      parsed.totalStandardizedDrinks === null ||
      parsed.largestOneDayAmount === null ||
      parsed.daysAtLargestAmount === null
    )
      throw new RepositoryValidationError()
    if (parsed.commonBeverageTypes.includes('OTHER') && parsed.otherBeverageDescription === null)
      throw new RepositoryValidationError()
  }
  return parsed
}

function parseTobaccoWeekly(value: unknown): LifestyleTobaccoWeeklyInput {
  const data = readDataProperties(value, ['id', 'weeklyResponse', 'products'] as const)
  const weeklyResponse = parseNullableCode(data.weeklyResponse, responseCodes)
  const products = parseUniqueList(data.products, parseTobaccoProduct)
  if (weeklyResponse !== 'YES' && products.length > 0) throw new RepositoryValidationError()
  return {
    id: parseEntityId(data.id),
    weeklyResponse,
    products
  }
}

export function parseCompleteLifestyleTobaccoWeeklyInput(
  input: LifestyleTobaccoWeeklyInput
): LifestyleTobaccoWeeklyInput {
  const parsed = parseTobaccoWeekly(input)
  if (parsed.weeklyResponse === null) throw new RepositoryValidationError()
  if (parsed.weeklyResponse === 'YES' && parsed.products.length === 0)
    throw new RepositoryValidationError()
  return parsed
}

function parseTobaccoProduct(value: unknown): LifestyleTobaccoProductInput {
  const data = readDataProperties(value, [
    'id',
    'sequenceNumber',
    'productType',
    'daysUsed',
    'averageQuantityPerUseDay',
    'unit',
    'secondhandSmokeExposure',
    'otherProductDescription',
    'otherUnitDescription'
  ] as const)
  return {
    id: parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    productType: parseCode(data.productType, tobaccoProductCodes),
    daysUsed: parseInteger(data.daysUsed, 1, 7),
    averageQuantityPerUseDay: parseReal(data.averageQuantityPerUseDay, 0, Number.MAX_SAFE_INTEGER),
    unit: parseCode(data.unit, tobaccoUnitCodes),
    secondhandSmokeExposure: parseNullableBoolean(data.secondhandSmokeExposure),
    otherProductDescription: parseOtherDescription(data.otherProductDescription, [
      data.productType
    ]),
    otherUnitDescription: parseOtherDescription(data.otherUnitDescription, [data.unit])
  }
}

function parsePhysicalWeekly(value: unknown): LifestylePhysicalActivityWeeklyInput {
  const data = readDataProperties(value, [
    'id',
    'weeklyResponse',
    'sedentaryMinutesPerDay',
    'activities'
  ] as const)
  const weeklyResponse = parseNullableCode(data.weeklyResponse, physicalActivityResponseCodes)
  const activities = parseUniqueList(data.activities, parseActivity)
  if (weeklyResponse !== 'YES' && activities.length > 0) throw new RepositoryValidationError()
  return {
    id: parseEntityId(data.id),
    weeklyResponse,
    sedentaryMinutesPerDay: parseNullableInteger(data.sedentaryMinutesPerDay, 0, 1439),
    activities
  }
}

export function parseCompleteLifestylePhysicalActivityWeeklyInput(
  input: LifestylePhysicalActivityWeeklyInput
): LifestylePhysicalActivityWeeklyInput {
  const parsed = parsePhysicalWeekly(input)
  if (parsed.weeklyResponse === null) throw new RepositoryValidationError()
  if (parsed.weeklyResponse === 'YES' && parsed.activities.length === 0)
    throw new RepositoryValidationError()
  return parsed
}

function parseActivity(value: unknown): LifestyleActivityInput {
  const data = readDataProperties(value, [
    'id',
    'sequenceNumber',
    'activityDomain',
    'description',
    'intensity',
    'daysInPastSevenDays',
    'averageMinutesPerActiveDay'
  ] as const)
  return {
    id: parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    activityDomain: parseCode(data.activityDomain, activityDomainCodes),
    description: parseNullableText(data.description),
    intensity: parseCode(data.intensity, intensityCodes),
    daysInPastSevenDays: parseInteger(data.daysInPastSevenDays, 1, 7),
    averageMinutesPerActiveDay: parseInteger(data.averageMinutesPerActiveDay, 1, 1440)
  }
}

function parseWorkWeekly(value: unknown): LifestyleWorkWeeklyInput {
  const data = readDataProperties(value, ['id', 'weeklyResponse'] as const)
  return {
    id: parseEntityId(data.id),
    weeklyResponse: parseNullableCode(data.weeklyResponse, workResponseCodes)
  }
}

function parseOtherActivities(value: unknown): readonly LifestyleOtherActivityInput[] {
  return parseUniqueList(value, parseOtherActivity)
}
function parseOtherActivity(value: unknown): LifestyleOtherActivityInput {
  const data = readDataProperties(value, [
    'id',
    'sequenceNumber',
    'category',
    'description',
    'daysInPastSevenDays',
    'averageMinutesPerDay',
    'intensity'
  ] as const)
  const description = parseRequiredText(data.description)
  return {
    id: parseEntityId(data.id),
    sequenceNumber: parsePositiveInteger(data.sequenceNumber),
    category: parseCode(data.category, otherCategoryCodes),
    description,
    daysInPastSevenDays: parseInteger(data.daysInPastSevenDays, 1, 7),
    averageMinutesPerDay: parseInteger(data.averageMinutesPerDay, 1, 1440),
    intensity: parseCode(data.intensity, intensityCodes)
  }
}

function parseUniqueList<T extends { id: string }>(
  value: unknown,
  parser: (value: unknown) => T
): readonly T[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  const result = value.map(parser)
  const ids = new Set(result.map((item) => item.id))
  if (ids.size !== result.length || result.some((item) => item.id.length === 0))
    throw new RepositoryValidationError()
  const sequences = result
    .map((item) => (item as T & { sequenceNumber?: number }).sequenceNumber)
    .filter((item): item is number => item !== undefined)
  if (new Set(sequences).size !== sequences.length) throw new RepositoryValidationError()
  return Object.freeze(result)
}

function parseCodeList<T extends string>(value: unknown, codes: Set<T>): readonly T[] {
  if (!Array.isArray(value)) throw new RepositoryValidationError()
  const result = value.map((item) => parseCode(item, codes))
  if (new Set(result).size !== result.length) throw new RepositoryValidationError()
  return Object.freeze(result)
}

function parseCode<T extends string>(value: unknown, codes: Set<T>): T {
  if (typeof value !== 'string' || !codes.has(value as T)) throw new RepositoryValidationError()
  return value as T
}
function parseNullableCode<T extends string>(value: unknown, codes: Set<T>): T | null {
  return value === null ? null : parseCode(value, codes)
}
function parseOtherDescription(value: unknown, selected: unknown): string | null {
  const description = value === null ? null : parseRequiredText(value)
  const containsOther = Array.isArray(selected) && selected.includes('OTHER')
  if (containsOther && description === null) throw new RepositoryValidationError()
  if (!containsOther && description !== null) throw new RepositoryValidationError()
  return description
}
function parseDraftOtherDescription(value: unknown, selected: unknown): string | null {
  const description = value === null ? null : parseRequiredText(value)
  const containsOther = Array.isArray(selected) && selected.includes('OTHER')
  if (!containsOther && description !== null) throw new RepositoryValidationError()
  return description
}
function parseNullableText(value: unknown): string | null {
  return value === null ? null : parseRequiredText(value)
}
function parseRequiredText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500)
    throw new RepositoryValidationError()
  return value
}
function parseNullableBoolean(value: unknown): boolean | null {
  if (value === null) return null
  if (typeof value !== 'boolean') throw new RepositoryValidationError()
  return value
}
function parseNullableInteger(value: unknown, min: number, max: number): number | null {
  return value === null ? null : parseInteger(value, min, max)
}
function parseNullableReal(value: unknown, minExclusive: number, max: number): number | null {
  return value === null ? null : parseReal(value, minExclusive, max)
}
function parseNullableNonnegativeReal(value: unknown): number | null {
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    Object.is(value, -0)
  )
    throw new RepositoryValidationError()
  return value
}
function parseInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max ||
    Object.is(value, -0)
  )
    throw new RepositoryValidationError()
  return value
}
function parsePositiveInteger(value: unknown): number {
  return parseInteger(value, 1, Number.MAX_SAFE_INTEGER)
}
function parseReal(value: unknown, minExclusive: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= minExclusive ||
    value > max ||
    Object.is(value, -0)
  )
    throw new RepositoryValidationError()
  return value
}
function parseNullableVersion(value: unknown): number | null {
  return value === null ? null : parseVersion(value)
}
function parseVersion(value: unknown): number {
  return parseInteger(value, 1, Number.MAX_SAFE_INTEGER)
}
function parseNullableEntityId(value: unknown): ReturnType<typeof parseEntityId> | null {
  return value === null ? null : parseEntityId(value)
}
function parseDate(value: unknown): LifestyleDate {
  if (typeof value !== 'string' || !datePattern.test(value)) throw new RepositoryValidationError()
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    throw new RepositoryValidationError()
  return value as LifestyleDate
}
function parseApproximateDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !approximateDatePattern.test(value))
    throw new RepositoryValidationError()
  const [, monthText] = value.split('-')
  if (monthText !== undefined) {
    const month = Number(monthText)
    if (!Number.isSafeInteger(month) || month < 1 || month > 12)
      throw new RepositoryValidationError()
  }
  return value
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function toValidationError(error: unknown): RepositoryValidationError {
  if (error instanceof DatabaseTransactionStateError)
    throw new DatabaseTransactionStateError(error.errorType)
  if (error instanceof RepositoryValidationError)
    return new RepositoryValidationError(error.errorType)
  return new RepositoryValidationError(getRepositoryErrorType(error))
}
