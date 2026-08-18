import type {
  ScreeningLifestyleSaveDraftRequest,
  ScreeningLifestyleSaveWorkBaselineRequest,
  ScreeningLifestyleWorkspace
} from '@shared/ipc'

export type PhysicalActivityResponse =
  | 'YES'
  | 'NO'
  | 'UNKNOWN'
  | 'DECLINED'
  | 'NOT_APPLICABLE'
  | 'UNABLE_TO_ANSWER'
  | 'PREFER_NOT_TO_ANSWER'
  | ''
export type SedentaryTimeResponse =
  'RECORDED' | 'UNKNOWN' | 'UNABLE_TO_ANSWER' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
export type ActivityDomain = 'WORK_OR_FARMING' | 'TRANSPORT' | 'HOUSEHOLD' | 'EXERCISE' | ''
export type ActivityIntensity = 'LIGHT' | 'MODERATE' | 'VIGOROUS' | ''
export type WorkEmploymentStatus =
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
  | ''
export type PhysicalDemand =
  'SITTING' | 'STANDING' | 'WALKING' | 'MODERATE_LABOR' | 'HEAVY_LABOR' | 'VARIES' | ''
export type ShiftPattern =
  | 'DAY'
  | 'EVENING'
  | 'NIGHT'
  | 'ROTATING'
  | 'IRREGULAR'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'DECLINED'
  | ''
export type WorkResponse =
  | 'USUAL'
  | 'LESS_THAN_USUAL'
  | 'MORE_THAN_USUAL'
  | 'NO_WORK'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'DECLINED'
  | 'PREFER_NOT_TO_ANSWER'
  | ''
export type OtherActivityResponse =
  'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
export type OtherActivityCategory =
  'FARMING_GARDENING' | 'HOUSEHOLD' | 'CAREGIVING' | 'COMMUNITY' | 'COMMUTE' | 'SPORT' | 'OTHER'

export interface ActivityFieldError {
  readonly fieldId: string
  readonly message: string
}

export interface ActivityRowForm {
  readonly clientKey: string
  readonly id: string | null
  readonly sequenceNumber: number
  readonly activityDomain: ActivityDomain
  readonly description: string
  readonly intensity: ActivityIntensity
  readonly daysInPastSevenDays: string
  readonly averageHoursPerActiveDay: string
  readonly averageMinutesPerActiveDay: string
}

export interface PhysicalActivityForm {
  readonly id: string | null
  readonly weeklyResponse: PhysicalActivityResponse
  readonly sedentaryTimeResponse: SedentaryTimeResponse
  readonly sedentaryMinutesPerDay: string
  readonly activities: readonly ActivityRowForm[]
}

export interface WorkBaselineForm {
  readonly status: WorkEmploymentStatus
  readonly occupationJobTitle: string
  readonly usualPhysicalDemand: PhysicalDemand
  readonly typicalWorkdaysPerWeek: string
  readonly typicalHoursPerWorkday: string
  readonly shiftPattern: ShiftPattern
  readonly description: string
}

export interface WorkWeeklyForm {
  readonly id: string | null
  readonly weeklyResponse: WorkResponse
}

export interface OtherActivityRowForm {
  readonly clientKey: string
  readonly id: string | null
  readonly sequenceNumber: number
  readonly category: OtherActivityCategory | ''
  readonly description: string
  readonly daysInPastSevenDays: string
  readonly averageHoursPerDay: string
  readonly averageMinutesPerDay: string
  readonly intensity: ActivityIntensity
}

export interface OtherActivityForm {
  readonly weeklyResponse: OtherActivityResponse
  readonly activities: readonly OtherActivityRowForm[]
}

export const physicalActivityResponseOptions = Object.freeze([
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
  { value: 'UNABLE_TO_ANSWER', label: 'Unable to answer' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
] as const)
export const sedentaryTimeResponseOptions = Object.freeze([
  { value: 'RECORDED', label: 'Recorded' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'UNABLE_TO_ANSWER', label: 'Unable to answer' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
] as const)
export const activityDomainOptions = Object.freeze([
  { value: 'WORK_OR_FARMING', label: 'Work or farming' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'HOUSEHOLD', label: 'Household' },
  { value: 'EXERCISE', label: 'Exercise' }
] as const)
export const intensityOptions = Object.freeze([
  { value: 'LIGHT', label: 'Light' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'VIGOROUS', label: 'Vigorous' }
] as const)
export const workStatusOptions = Object.freeze([
  ['EMPLOYED', 'Employed'],
  ['SELF_EMPLOYED', 'Self-employed'],
  ['FARMING', 'Farming'],
  ['STUDENT', 'Student'],
  ['HOMEMAKER_CAREGIVER', 'Homemaker or caregiver'],
  ['UNEMPLOYED', 'Unemployed'],
  ['RETIRED', 'Retired'],
  ['UNABLE_TO_WORK', 'Unable to work'],
  ['OTHER', 'Other'],
  ['DECLINED', 'Declined']
] as const)
export const physicalDemandOptions = Object.freeze([
  ['SITTING', 'Mostly sitting'],
  ['STANDING', 'Mostly standing'],
  ['WALKING', 'Mostly walking'],
  ['MODERATE_LABOR', 'Moderate labor'],
  ['HEAVY_LABOR', 'Heavy labor'],
  ['VARIES', 'Varies']
] as const)
export const shiftPatternOptions = Object.freeze([
  ['DAY', 'Day'],
  ['EVENING', 'Evening'],
  ['NIGHT', 'Night'],
  ['ROTATING', 'Rotating'],
  ['IRREGULAR', 'Irregular'],
  ['NOT_APPLICABLE', 'Not applicable'],
  ['UNKNOWN', 'Unknown'],
  ['DECLINED', 'Declined']
] as const)
export const workResponseOptions = Object.freeze([
  ['USUAL', 'Usual'],
  ['LESS_THAN_USUAL', 'Less than usual'],
  ['MORE_THAN_USUAL', 'More than usual'],
  ['NO_WORK', 'No work'],
  ['NOT_APPLICABLE', 'Not applicable'],
  ['UNKNOWN', 'Unknown'],
  ['DECLINED', 'Declined'],
  ['PREFER_NOT_TO_ANSWER', 'Prefer not to answer']
] as const)
export const otherActivityResponseOptions = Object.freeze([
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'PREFER_NOT_TO_ANSWER', label: 'Prefer not to answer' }
] as const)
export const otherActivityCategoryOptions = Object.freeze([
  ['FARMING_GARDENING', 'Farming or gardening'],
  ['HOUSEHOLD', 'Household'],
  ['CAREGIVING', 'Caregiving'],
  ['COMMUNITY', 'Community'],
  ['COMMUTE', 'Commute'],
  ['SPORT', 'Sport'],
  ['OTHER', 'Other']
] as const)

let nextActivityClientKey = 0

export function createInitialPhysicalActivityForm(): PhysicalActivityForm {
  return {
    id: null,
    weeklyResponse: '',
    sedentaryTimeResponse: '',
    sedentaryMinutesPerDay: '',
    activities: []
  }
}
export function createInitialWorkBaselineForm(): WorkBaselineForm {
  return {
    status: '',
    occupationJobTitle: '',
    usualPhysicalDemand: '',
    typicalWorkdaysPerWeek: '',
    typicalHoursPerWorkday: '',
    shiftPattern: '',
    description: ''
  }
}
export function createInitialWorkWeeklyForm(): WorkWeeklyForm {
  return { id: null, weeklyResponse: '' }
}
export function createInitialOtherActivityForm(): OtherActivityForm {
  return { weeklyResponse: '', activities: [] }
}
export function createEmptyActivityRow(sequenceNumber: number): ActivityRowForm {
  nextActivityClientKey += 1
  return {
    clientKey: `new-activity-${nextActivityClientKey}`,
    id: null,
    sequenceNumber,
    activityDomain: '',
    description: '',
    intensity: '',
    daysInPastSevenDays: '',
    averageHoursPerActiveDay: '',
    averageMinutesPerActiveDay: ''
  }
}
export function createEmptyOtherActivityRow(sequenceNumber: number): OtherActivityRowForm {
  nextActivityClientKey += 1
  return {
    clientKey: `new-other-activity-${nextActivityClientKey}`,
    id: null,
    sequenceNumber,
    category: '',
    description: '',
    daysInPastSevenDays: '',
    averageHoursPerDay: '',
    averageMinutesPerDay: '',
    intensity: ''
  }
}

export function physicalActivityToForm(
  value: NonNullable<NonNullable<ScreeningLifestyleWorkspace['draft']>['physicalActivity']>
): PhysicalActivityForm {
  return {
    id: value.id,
    weeklyResponse: toPhysicalResponse(value.weeklyResponse),
    sedentaryTimeResponse: value.sedentaryTimeResponse ?? '',
    sedentaryMinutesPerDay:
      value.sedentaryMinutesPerDay === null ? '' : String(value.sedentaryMinutesPerDay),
    activities: value.activities.map((item) => ({
      clientKey: item.id,
      id: item.id,
      sequenceNumber: item.sequenceNumber,
      activityDomain: item.activityDomain,
      description: item.description ?? '',
      intensity: item.intensity,
      daysInPastSevenDays: String(item.daysInPastSevenDays),
      averageHoursPerActiveDay: splitDurationMinutes(item.averageMinutesPerActiveDay).hours,
      averageMinutesPerActiveDay: splitDurationMinutes(item.averageMinutesPerActiveDay).minutes
    }))
  }
}
export function workBaselineToForm(
  value: NonNullable<ScreeningLifestyleWorkspace['activeWorkBaseline']>
): WorkBaselineForm {
  return {
    status: value.status,
    occupationJobTitle: value.occupationJobTitle ?? '',
    usualPhysicalDemand: value.usualPhysicalDemand ?? '',
    typicalWorkdaysPerWeek:
      value.typicalWorkdaysPerWeek === null ? '' : String(value.typicalWorkdaysPerWeek),
    typicalHoursPerWorkday:
      value.typicalHoursPerWorkday === null ? '' : String(value.typicalHoursPerWorkday),
    shiftPattern: value.shiftPattern ?? '',
    description: value.description ?? ''
  }
}
export function workWeeklyToForm(
  value: NonNullable<NonNullable<ScreeningLifestyleWorkspace['draft']>['work']>
): WorkWeeklyForm {
  return { id: value.id, weeklyResponse: toWorkResponse(value.weeklyResponse) }
}
export function otherActivityToForm(workspace: ScreeningLifestyleWorkspace): OtherActivityForm {
  return {
    weeklyResponse: workspace.draft?.otherActivityResponse ?? '',
    activities: (workspace.draft?.otherActivities ?? []).map((item) => ({
      clientKey: item.id,
      id: item.id,
      sequenceNumber: item.sequenceNumber,
      category: item.category,
      description: item.description ?? '',
      daysInPastSevenDays: String(item.daysInPastSevenDays),
      averageHoursPerDay: splitDurationMinutes(item.averageMinutesPerDay).hours,
      averageMinutesPerDay: splitDurationMinutes(item.averageMinutesPerDay).minutes,
      intensity: item.intensity
    }))
  }
}

export function validatePhysicalActivity(
  form: PhysicalActivityForm
): readonly ActivityFieldError[] {
  const errors: ActivityFieldError[] = []
  if (form.sedentaryTimeResponse === '' && form.sedentaryMinutesPerDay !== '')
    errors.push({
      fieldId: 'physical-sedentary-response',
      message: 'Select how sedentary time was recorded.'
    })
  if (form.sedentaryTimeResponse !== 'RECORDED' && form.sedentaryMinutesPerDay !== '')
    errors.push({
      fieldId: 'physical-sedentary-minutes',
      message: 'Clear sedentary minutes for this response.'
    })
  if (
    form.sedentaryMinutesPerDay !== '' &&
    (!/^\d+$/u.test(form.sedentaryMinutesPerDay) || Number(form.sedentaryMinutesPerDay) > 1439)
  )
    errors.push({
      fieldId: 'physical-sedentary-minutes',
      message: 'Enter a whole number from 0 to 1439.'
    })
  if (form.weeklyResponse !== 'YES' && form.activities.length > 0)
    errors.push({ fieldId: 'physical-weekly-response', message: 'Clear the hidden activity rows.' })
  if (form.activities.length > 20)
    errors.push({ fieldId: 'physical-activities', message: 'Use 20 activity rows or fewer.' })
  if (new Set(form.activities.map((item) => item.sequenceNumber)).size !== form.activities.length)
    errors.push({
      fieldId: 'physical-activities',
      message: 'Activity rows must have unique order.'
    })
  form.activities.forEach((item) => {
    const prefix = `physical-activity-${item.clientKey}`
    if (item.activityDomain === '')
      errors.push({ fieldId: `${prefix}-domain`, message: 'Select an activity domain.' })
    if (item.intensity === '')
      errors.push({ fieldId: `${prefix}-intensity`, message: 'Select an intensity.' })
    if (
      !/^\d+$/.test(item.daysInPastSevenDays) ||
      Number(item.daysInPastSevenDays) < 1 ||
      Number(item.daysInPastSevenDays) > 7
    )
      errors.push({ fieldId: `${prefix}-days`, message: 'Enter a whole number from 1 to 7.' })
    validateDuration(
      item.averageHoursPerActiveDay,
      item.averageMinutesPerActiveDay,
      `${prefix}-hours`,
      `${prefix}-minutes`,
      errors
    )
    if (item.description.length > 500)
      errors.push({ fieldId: `${prefix}-description`, message: 'Use 500 characters or fewer.' })
  })
  return errors
}
export function validateOtherActivity(form: OtherActivityForm): readonly ActivityFieldError[] {
  const errors: ActivityFieldError[] = []
  if (form.weeklyResponse !== 'YES' && form.activities.length > 0)
    errors.push({ fieldId: 'other-weekly-response', message: 'Clear the hidden activity rows.' })
  if (form.activities.length > 50)
    errors.push({ fieldId: 'other-activities', message: 'Use 50 activity rows or fewer.' })
  if (new Set(form.activities.map((item) => item.sequenceNumber)).size !== form.activities.length)
    errors.push({ fieldId: 'other-activities', message: 'Activity rows must have unique order.' })
  form.activities.forEach((item) => {
    const prefix = `other-activity-${item.clientKey}`
    if (item.category === '')
      errors.push({ fieldId: `${prefix}-category`, message: 'Select a category.' })
    if (item.description.length > 500)
      errors.push({ fieldId: `${prefix}-description`, message: 'Use 500 characters or fewer.' })
    if (
      !/^\d+$/.test(item.daysInPastSevenDays) ||
      Number(item.daysInPastSevenDays) < 1 ||
      Number(item.daysInPastSevenDays) > 7
    )
      errors.push({ fieldId: `${prefix}-days`, message: 'Enter a whole number from 1 to 7.' })
    validateDuration(
      item.averageHoursPerDay,
      item.averageMinutesPerDay,
      `${prefix}-hours`,
      `${prefix}-minutes`,
      errors
    )
    if (item.intensity === '')
      errors.push({ fieldId: `${prefix}-intensity`, message: 'Select an intensity.' })
  })
  return errors
}
export function validateWorkBaseline(form: WorkBaselineForm): readonly ActivityFieldError[] {
  const errors: ActivityFieldError[] = []
  if (form.status === '')
    errors.push({ fieldId: 'work-baseline-status', message: 'Select an employment status.' })
  if (form.occupationJobTitle.length > 500)
    errors.push({ fieldId: 'work-baseline-title', message: 'Use 500 characters or fewer.' })
  if (
    form.typicalWorkdaysPerWeek !== '' &&
    (!/^\d+$/.test(form.typicalWorkdaysPerWeek) || Number(form.typicalWorkdaysPerWeek) > 7)
  )
    errors.push({ fieldId: 'work-baseline-days', message: 'Enter a whole number from 0 to 7.' })
  if (
    form.typicalHoursPerWorkday !== '' &&
    (!/^\d+(?:\.\d+)?$/.test(form.typicalHoursPerWorkday) ||
      Number(form.typicalHoursPerWorkday) > 24)
  )
    errors.push({ fieldId: 'work-baseline-hours', message: 'Enter a number from 0 to 24.' })
  if (form.description.length > 500)
    errors.push({ fieldId: 'work-baseline-description', message: 'Use 500 characters or fewer.' })
  return errors
}

export function physicalActivityToRequest(
  form: PhysicalActivityForm
): ScreeningLifestyleSaveDraftRequest['physicalActivity'] {
  const response = form.weeklyResponse === '' ? null : form.weeklyResponse
  return {
    id: form.id,
    weeklyResponse: response,
    sedentaryTimeResponse: form.sedentaryTimeResponse === '' ? null : form.sedentaryTimeResponse,
    sedentaryMinutesPerDay:
      form.sedentaryTimeResponse === 'RECORDED' && form.sedentaryMinutesPerDay !== ''
        ? Number(form.sedentaryMinutesPerDay)
        : null,
    activities:
      response === 'YES'
        ? form.activities.map((item) => ({
            id: item.id,
            sequenceNumber: item.sequenceNumber,
            activityDomain: item.activityDomain as Exclude<ActivityDomain, ''>,
            description: item.description.trim() === '' ? null : item.description.trim(),
            intensity: item.intensity as Exclude<ActivityIntensity, ''>,
            daysInPastSevenDays: Number(item.daysInPastSevenDays),
            averageMinutesPerActiveDay:
              combineDurationMinutes(
                item.averageHoursPerActiveDay,
                item.averageMinutesPerActiveDay
              ) ?? 0
          }))
        : []
  }
}
export function workBaselineToRequest(
  encounterId: string,
  workspace: ScreeningLifestyleWorkspace | null,
  form: WorkBaselineForm
): ScreeningLifestyleSaveWorkBaselineRequest | null {
  if (form.status === '') return null
  return {
    encounterId,
    expectedBaselineVersion: workspace?.activeWorkBaseline?.version ?? null,
    expectedDraftVersion: workspace?.draft?.rowVersion ?? null,
    status: form.status,
    occupationJobTitle: nullable(form.occupationJobTitle),
    usualPhysicalDemand: form.usualPhysicalDemand === '' ? null : form.usualPhysicalDemand,
    typicalWorkdaysPerWeek:
      form.typicalWorkdaysPerWeek === '' ? null : Number(form.typicalWorkdaysPerWeek),
    typicalHoursPerWorkday:
      form.typicalHoursPerWorkday === '' ? null : Number(form.typicalHoursPerWorkday),
    shiftPattern: form.shiftPattern === '' ? null : form.shiftPattern,
    description: nullable(form.description)
  }
}
export function workWeeklyToRequest(
  form: WorkWeeklyForm
): ScreeningLifestyleSaveDraftRequest['work'] {
  return { id: form.id, weeklyResponse: form.weeklyResponse === '' ? null : form.weeklyResponse }
}
export function otherActivityToRequest(
  form: OtherActivityForm
): Pick<ScreeningLifestyleSaveDraftRequest, 'otherActivityResponse' | 'otherActivities'> {
  return {
    otherActivityResponse: form.weeklyResponse === '' ? null : form.weeklyResponse,
    otherActivities:
      form.weeklyResponse === 'YES'
        ? form.activities.map((item) => ({
            id: item.id,
            sequenceNumber: item.sequenceNumber,
            category: item.category as Exclude<OtherActivityCategory, ''>,
            description: item.description.trim() === '' ? null : item.description.trim(),
            daysInPastSevenDays: Number(item.daysInPastSevenDays),
            averageMinutesPerDay:
              combineDurationMinutes(item.averageHoursPerDay, item.averageMinutesPerDay) ?? 0,
            intensity: item.intensity as Exclude<ActivityIntensity, ''>
          }))
        : []
  }
}

export function isPhysicalActivityComplete(form: PhysicalActivityForm): boolean {
  return validateCompletePhysicalActivity(form).length === 0
}
export function isOtherActivityComplete(form: OtherActivityForm): boolean {
  return validateCompleteOtherActivity(form).length === 0
}
export function isWorkComplete(form: WorkWeeklyForm): boolean {
  return form.weeklyResponse !== ''
}

export function validateCompletePhysicalActivity(
  form: PhysicalActivityForm
): readonly ActivityFieldError[] {
  const errors = [...validatePhysicalActivity(form)]
  if (form.weeklyResponse === '') {
    errors.push({
      fieldId: 'physical-weekly-response',
      message: 'Select a weekly exercise response.'
    })
  } else if (form.weeklyResponse === 'YES' && form.activities.length === 0) {
    errors.push({
      fieldId: 'physical-activities',
      message: 'Add an activity to complete this answer.'
    })
  }
  if (form.sedentaryTimeResponse === '') {
    errors.push({
      fieldId: 'physical-sedentary-response',
      message: 'Select a sedentary-time response.'
    })
  } else if (form.sedentaryTimeResponse === 'RECORDED' && form.sedentaryMinutesPerDay === '') {
    errors.push({
      fieldId: 'physical-sedentary-minutes',
      message: 'Enter sedentary minutes to complete this answer.'
    })
  }
  return errors
}

export function validateCompleteOtherActivity(
  form: OtherActivityForm
): readonly ActivityFieldError[] {
  const errors = [...validateOtherActivity(form)]
  if (form.weeklyResponse === '') {
    errors.push({ fieldId: 'other-weekly-response', message: 'Select an Other Activity response.' })
  } else if (form.weeklyResponse === 'YES' && form.activities.length === 0) {
    errors.push({
      fieldId: 'other-activities',
      message: 'Add an activity to complete this answer.'
    })
  }
  return errors
}

export function validateCompleteWork(
  form: WorkWeeklyForm,
  hasReferencedBaseline: boolean,
  baselineErrors: readonly ActivityFieldError[]
): readonly ActivityFieldError[] {
  const errors = [...baselineErrors]
  if (!hasReferencedBaseline) {
    errors.push({
      fieldId: 'work-baseline-status',
      message: 'Save a Work baseline to complete this answer.'
    })
  }
  if (form.weeklyResponse === '') {
    errors.push({ fieldId: 'work-weekly-response', message: 'Select a weekly Work response.' })
  }
  return errors
}

export function validateWorkCompletionReadiness(state: {
  readonly workspace: ScreeningLifestyleWorkspace | null
  readonly workBaselineForm: WorkBaselineForm
  readonly work: WorkWeeklyForm
}): readonly ActivityFieldError[] {
  const baselineErrors = validateWorkBaseline(state.workBaselineForm)
  const baseline = state.workspace ? getWorkBaselineForInterpretation(state.workspace) : null
  const hasReferencedBaseline =
    state.workspace?.draft?.workBaselineVersionId !== null &&
    state.workspace?.draft?.workBaselineVersionId !== undefined &&
    baseline !== null &&
    baseline !== undefined
  return validateCompleteWork(state.work, hasReferencedBaseline, baselineErrors)
}
export function physicalActivitySummary(form: PhysicalActivityForm): string {
  const activitySummary =
    form.weeklyResponse === 'YES'
      ? 'Activity reported'
      : form.weeklyResponse === 'NO'
        ? 'No activity'
        : form.weeklyResponse === 'UNKNOWN'
          ? 'Activity unknown'
          : form.weeklyResponse === 'DECLINED'
            ? 'Response declined'
            : form.weeklyResponse === 'NOT_APPLICABLE'
              ? 'Not applicable'
              : form.weeklyResponse === 'UNABLE_TO_ANSWER'
                ? 'Unable to answer'
                : form.weeklyResponse === 'PREFER_NOT_TO_ANSWER'
                  ? 'Prefer not to answer'
                  : 'Exercise draft in progress'
  const sedentarySummary =
    form.sedentaryTimeResponse === 'RECORDED'
      ? form.sedentaryMinutesPerDay === ''
        ? 'Sedentary time recorded'
        : `Sedentary: ${form.sedentaryMinutesPerDay} minutes/day`
      : form.sedentaryTimeResponse === 'UNKNOWN'
        ? 'Sedentary time unknown'
        : form.sedentaryTimeResponse === 'UNABLE_TO_ANSWER'
          ? 'Sedentary time unable to answer'
          : form.sedentaryTimeResponse === 'DECLINED'
            ? 'Sedentary response declined'
            : form.sedentaryTimeResponse === 'PREFER_NOT_TO_ANSWER'
              ? 'Prefer not to answer sedentary time'
              : 'Sedentary time not answered'
  return `${activitySummary} ${String.fromCodePoint(0x2022)} ${sedentarySummary}`
}
export function otherActivitySummary(form: OtherActivityForm): string {
  return form.weeklyResponse === 'YES'
    ? 'Activity reported'
    : form.weeklyResponse === 'NO'
      ? 'No other activity'
      : form.weeklyResponse === 'UNKNOWN'
        ? 'Activity unknown'
        : form.weeklyResponse === 'DECLINED'
          ? 'Response declined'
          : form.weeklyResponse === 'PREFER_NOT_TO_ANSWER'
            ? 'Prefer not to answer'
            : 'Draft in progress'
}
export function workStatusLabel(status: string): string {
  return status === 'EMPLOYED'
    ? 'Employed'
    : status === 'SELF_EMPLOYED'
      ? 'Self-employed'
      : status === 'FARMING'
        ? 'Farming'
        : status === 'STUDENT'
          ? 'Student'
          : status === 'HOMEMAKER_CAREGIVER'
            ? 'Homemaker or caregiver'
            : status === 'UNEMPLOYED'
              ? 'Unemployed'
              : status === 'RETIRED'
                ? 'Retired'
                : status === 'UNABLE_TO_WORK'
                  ? 'Unable to work'
                  : status === 'OTHER'
                    ? 'Other'
                    : status === 'DECLINED'
                      ? 'Declined'
                      : 'Unknown'
}
export function workSummary(
  work: WorkWeeklyForm,
  baseline: ScreeningLifestyleWorkspace['activeWorkBaseline']
): string {
  if (!baseline) return 'Work baseline required'
  return `${workStatusLabel(baseline.status)} • ${work.weeklyResponse === '' ? 'Work draft in progress' : work.weeklyResponse === 'USUAL' ? 'Usual work' : work.weeklyResponse === 'LESS_THAN_USUAL' ? 'Less than usual' : work.weeklyResponse === 'MORE_THAN_USUAL' ? 'More than usual' : work.weeklyResponse === 'NO_WORK' ? 'No work' : work.weeklyResponse === 'UNKNOWN' ? 'Weekly work unknown' : work.weeklyResponse === 'DECLINED' ? 'Weekly response declined' : work.weeklyResponse === 'NOT_APPLICABLE' ? 'Not applicable' : 'Prefer not to answer'}`
}
export function getWorkBaselineForInterpretation(
  workspace: ScreeningLifestyleWorkspace
): ScreeningLifestyleWorkspace['activeWorkBaseline'] {
  return workspace.draft?.workBaselineVersionId
    ? (workspace.referencedWorkBaseline ?? workspace.activeWorkBaseline)
    : workspace.activeWorkBaseline
}

function nullable(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function splitDurationMinutes(totalMinutes: number): {
  readonly hours: string
  readonly minutes: string
} {
  return {
    hours: String(Math.floor(totalMinutes / 60)),
    minutes: String(totalMinutes % 60)
  }
}

export function combineDurationMinutes(hours: string, minutes: string): number | null {
  const normalizedHours = hours.trim()
  const normalizedMinutes = minutes.trim()
  if (normalizedHours === '' && normalizedMinutes === '') return null
  if (
    (normalizedHours !== '' && !/^\d+$/u.test(normalizedHours)) ||
    (normalizedMinutes !== '' && !/^\d+$/u.test(normalizedMinutes))
  )
    return null
  return (
    (normalizedHours === '' ? 0 : Number(normalizedHours)) * 60 +
    (normalizedMinutes === '' ? 0 : Number(normalizedMinutes))
  )
}

function validateDuration(
  hours: string,
  minutes: string,
  hoursFieldId: string,
  minutesFieldId: string,
  errors: ActivityFieldError[]
): void {
  const hoursValid = /^\d+$/u.test(hours) && Number(hours) <= 24
  const minutesValid = /^\d+$/u.test(minutes) && Number(minutes) >= 0 && Number(minutes) <= 59
  if (hours === '' && minutes === '') {
    errors.push({ fieldId: hoursFieldId, message: 'Enter hours or minutes.' })
    return
  }
  if (!hoursValid && hours !== '') {
    errors.push({ fieldId: hoursFieldId, message: 'Enter a whole number of hours from 0 to 24.' })
  }
  if (!minutesValid && minutes !== '') {
    errors.push({
      fieldId: minutesFieldId,
      message: 'Enter a whole number of minutes from 0 to 59.'
    })
  }
  if ((hours === '' || hoursValid) && (minutes === '' || minutesValid)) {
    const totalMinutes = combineDurationMinutes(hours, minutes)
    if (totalMinutes === null || totalMinutes < 1 || totalMinutes > 1440) {
      errors.push({
        fieldId: hoursFieldId,
        message: 'Average time per day must be between 1 and 1440 minutes.'
      })
    }
  }
}
function toPhysicalResponse(value: string | null): PhysicalActivityResponse {
  return [
    'YES',
    'NO',
    'UNKNOWN',
    'DECLINED',
    'NOT_APPLICABLE',
    'UNABLE_TO_ANSWER',
    'PREFER_NOT_TO_ANSWER'
  ].includes(value ?? '')
    ? (value as PhysicalActivityResponse)
    : ''
}
function toWorkResponse(value: string | null): WorkResponse {
  return [
    'USUAL',
    'LESS_THAN_USUAL',
    'MORE_THAN_USUAL',
    'NO_WORK',
    'NOT_APPLICABLE',
    'UNKNOWN',
    'DECLINED',
    'PREFER_NOT_TO_ANSWER'
  ].includes(value ?? '')
    ? (value as WorkResponse)
    : ''
}
