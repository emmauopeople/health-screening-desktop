import { describe, expect, it } from 'vitest'

import {
  createEmptyActivityRow,
  createEmptyOtherActivityRow,
  createInitialOtherActivityForm,
  createInitialPhysicalActivityForm,
  createInitialWorkBaselineForm,
  createInitialWorkWeeklyForm,
  otherActivitySummary,
  otherActivityToForm,
  otherActivityToRequest,
  physicalActivitySummary,
  physicalActivityToForm,
  physicalActivityToRequest,
  combineDurationMinutes,
  splitDurationMinutes,
  validateOtherActivity,
  validateCompleteOtherActivity,
  validateCompletePhysicalActivity,
  validateCompleteWork,
  validatePhysicalActivity,
  validateWorkBaseline,
  workBaselineToRequest,
  type OtherActivityForm,
  type PhysicalActivityForm,
  type WorkBaselineForm
} from '../../../src/renderer/src/app/screening/lifestyle/activity-workspace-model'

const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('Lifestyle activity and work renderer models', () => {
  it('keeps sedentary response semantics distinct and clears hidden minutes', () => {
    const form = {
      ...createInitialPhysicalActivityForm(),
      sedentaryTimeResponse: 'RECORDED' as const,
      sedentaryMinutesPerDay: '0'
    }
    expect(validatePhysicalActivity(form)).toEqual([])
    const cleared = {
      ...form,
      sedentaryTimeResponse: 'UNKNOWN' as const,
      sedentaryMinutesPerDay: ''
    }
    expect(physicalActivityToRequest(cleared)).toMatchObject({
      sedentaryTimeResponse: 'UNKNOWN',
      sedentaryMinutesPerDay: null
    })
    expect(physicalActivitySummary({ ...cleared, weeklyResponse: 'UNKNOWN' })).toBe(
      `Activity unknown ${String.fromCodePoint(0x2022)} Sedentary time unknown`
    )
  })

  it('allows an incomplete Yes exercise draft but rejects incomplete submitted rows', () => {
    const incomplete = { ...createInitialPhysicalActivityForm(), weeklyResponse: 'YES' as const }
    expect(validatePhysicalActivity(incomplete)).toEqual([])
    const row = createEmptyActivityRow(1)
    expect(validatePhysicalActivity({ ...incomplete, activities: [row] }).length).toBeGreaterThan(0)
  })

  it('separates permissive draft validation from completion validation', () => {
    const yesDraft = { ...createInitialPhysicalActivityForm(), weeklyResponse: 'YES' as const }
    expect(validatePhysicalActivity(yesDraft)).toEqual([])
    expect(validateCompletePhysicalActivity(yesDraft).map((error) => error.fieldId)).toEqual(
      expect.arrayContaining(['physical-activities', 'physical-sedentary-response'])
    )

    const otherDraft = { ...createInitialOtherActivityForm(), weeklyResponse: 'YES' as const }
    expect(validateOtherActivity(otherDraft)).toEqual([])
    expect(validateCompleteOtherActivity(otherDraft).map((error) => error.fieldId)).toContain(
      'other-activities'
    )
  })

  it.each([
    ['RECORDED', '30', 'Activity reported', 'Sedentary: 30 minutes/day'],
    ['UNKNOWN', '', 'No activity', 'Sedentary time unknown'],
    ['UNABLE_TO_ANSWER', '', 'No activity', 'Sedentary time unable to answer'],
    ['DECLINED', '', 'No activity', 'Sedentary response declined'],
    ['PREFER_NOT_TO_ANSWER', '', 'No activity', 'Prefer not to answer sedentary time'],
    ['', '', 'No activity', 'Sedentary time not answered']
  ] as const)(
    'summarizes activity and sedentary response %s distinctly',
    (sedentary, minutes, activity, sedentarySummary) => {
      const form = {
        ...createInitialPhysicalActivityForm(),
        weeklyResponse: sedentary === 'RECORDED' ? ('YES' as const) : ('NO' as const),
        sedentaryTimeResponse: sedentary as PhysicalActivityForm['sedentaryTimeResponse'],
        sedentaryMinutesPerDay: minutes
      }
      expect(physicalActivitySummary(form)).toBe(
        `${activity} ${String.fromCodePoint(0x2022)} ${sedentarySummary}`
      )
    }
  )

  it('maps activity rows without derived or persistence-only fields', () => {
    const form: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [
        {
          ...createEmptyActivityRow(1),
          activityDomain: 'EXERCISE',
          intensity: 'MODERATE',
          daysInPastSevenDays: '3',
          averageHoursPerActiveDay: '',
          averageMinutesPerActiveDay: '30'
        }
      ]
    }
    expect(physicalActivityToRequest(form)).toEqual(
      expect.objectContaining({
        activities: [
          expect.objectContaining({
            id: null,
            sequenceNumber: 1,
            daysInPastSevenDays: 3,
            averageMinutesPerActiveDay: 30
          })
        ]
      })
    )
    expect(physicalActivityToRequest(form)?.activities[0]).not.toHaveProperty('weeklyMinutes')
  })

  it('splits and combines persisted activity duration without changing the contract', () => {
    expect(splitDurationMinutes(95)).toEqual({ hours: '1', minutes: '35' })
    expect(combineDurationMinutes('1', '35')).toBe(95)
    expect(combineDurationMinutes('1', '')).toBe(60)
    expect(combineDurationMinutes('', '35')).toBe(35)
    expect(combineDurationMinutes('', '')).toBeNull()
  })

  it('hydrates total persisted minutes into separate hours and minutes fields', () => {
    const physical = physicalActivityToForm({
      id: '13131313-1313-4131-8131-131313131313',
      weeklyResponse: 'YES',
      sedentaryTimeResponse: null,
      sedentaryMinutesPerDay: null,
      activities: [
        {
          id: '17171717-1717-4171-8171-171717171717',
          sequenceNumber: 1,
          activityDomain: 'EXERCISE',
          description: null,
          intensity: 'LIGHT',
          daysInPastSevenDays: 2,
          averageMinutesPerActiveDay: 95,
          weeklyMinutes: 190,
          updatedAt: '2026-08-06T08:15:00.000Z'
        }
      ],
      updatedAt: '2026-08-06T08:15:00.000Z'
    } as never)
    expect(physical.activities[0]).toMatchObject({
      averageHoursPerActiveDay: '1',
      averageMinutesPerActiveDay: '35'
    })

    const other = otherActivityToForm({
      draft: {
        otherActivityResponse: 'YES',
        otherActivities: [
          {
            id: '15151515-1515-4151-8151-151515151515',
            sequenceNumber: 1,
            category: 'SPORT',
            description: 'Football',
            daysInPastSevenDays: 2,
            averageMinutesPerDay: 65,
            intensity: 'MODERATE',
            updatedAt: '2026-08-06T08:15:00.000Z'
          }
        ]
      }
    } as never)
    expect(other.activities[0]).toMatchObject({
      averageHoursPerDay: '1',
      averageMinutesPerDay: '5'
    })
  })

  it('rejects duration minutes above 59 and an entirely blank activity duration', () => {
    const row = {
      ...createEmptyActivityRow(1),
      activityDomain: 'EXERCISE' as const,
      intensity: 'MODERATE' as const,
      daysInPastSevenDays: '2',
      averageHoursPerActiveDay: '1',
      averageMinutesPerActiveDay: '60'
    }
    const invalidMinutes: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [row]
    }
    expect(validatePhysicalActivity(invalidMinutes).map((error) => error.fieldId)).toContain(
      `physical-activity-${row.clientKey}-minutes`
    )
    const blankDuration: PhysicalActivityForm = {
      ...invalidMinutes,
      activities: [{ ...row, averageHoursPerActiveDay: '', averageMinutesPerActiveDay: '' }]
    }
    expect(validatePhysicalActivity(blankDuration).map((error) => error.fieldId)).toContain(
      `physical-activity-${row.clientKey}-hours`
    )
  })

  it('treats blank descriptions as optional for both activity sections', () => {
    const physicalRow: PhysicalActivityForm['activities'][number] = {
      ...createEmptyActivityRow(1),
      activityDomain: 'EXERCISE',
      intensity: 'MODERATE',
      daysInPastSevenDays: '2',
      averageHoursPerActiveDay: '1',
      averageMinutesPerActiveDay: '30'
    }
    const physicalForm: PhysicalActivityForm = {
      ...createInitialPhysicalActivityForm(),
      weeklyResponse: 'YES',
      activities: [physicalRow]
    }
    expect(validatePhysicalActivity(physicalForm)).toEqual([])
    expect(physicalActivityToRequest(physicalForm)?.activities[0]?.description).toBeNull()

    const otherRow = {
      ...createEmptyOtherActivityRow(1),
      category: 'SPORT' as const,
      intensity: 'MODERATE' as const,
      daysInPastSevenDays: '2',
      averageHoursPerDay: '1',
      averageMinutesPerDay: '30'
    }
    const otherForm: OtherActivityForm = {
      weeklyResponse: 'YES',
      activities: [otherRow]
    }
    expect(validateOtherActivity(otherForm)).toEqual([])
    expect(validateCompleteOtherActivity(otherForm)).toEqual([])
    expect(otherActivityToRequest(otherForm).otherActivities[0]?.description).toBeNull()
  })

  it('keeps entered description length validation while restoring blank descriptions as empty fields', () => {
    const workspace = {
      draft: {
        otherActivityResponse: 'YES',
        otherActivities: [
          {
            id: '15151515-1515-4151-8151-151515151515',
            sequenceNumber: 1,
            category: 'SPORT',
            description: null,
            daysInPastSevenDays: 2,
            averageMinutesPerDay: 65,
            intensity: 'MODERATE',
            updatedAt: '2026-08-06T08:15:00.000Z'
          }
        ]
      }
    } as never
    expect(otherActivityToForm(workspace).activities[0]?.description).toBe('')

    const overlong: OtherActivityForm = {
      weeklyResponse: 'YES',
      activities: [
        {
          ...createEmptyOtherActivityRow(1),
          category: 'SPORT',
          intensity: 'MODERATE',
          description: 'x'.repeat(501),
          daysInPastSevenDays: '2',
          averageHoursPerDay: '1',
          averageMinutesPerDay: '30'
        }
      ]
    }
    expect(validateOtherActivity(overlong).map((error) => error.fieldId)).toContain(
      `other-activity-${overlong.activities[0]?.clientKey}-description`
    )
  })

  it.each([
    ['YES', 'Activity reported'],
    ['NO', 'No other activity'],
    ['UNKNOWN', 'Activity unknown'],
    ['DECLINED', 'Response declined'],
    ['PREFER_NOT_TO_ANSWER', 'Prefer not to answer'],
    ['', 'Draft in progress']
  ] as const)('summarizes Other Activity response %s distinctly', (response, summary) => {
    expect(
      otherActivitySummary({ ...createInitialOtherActivityForm(), weeklyResponse: response })
    ).toBe(summary)
  })

  it('clears Other Activity details when leaving Yes', () => {
    const form: OtherActivityForm = {
      weeklyResponse: 'YES',
      activities: [
        {
          ...createEmptyOtherActivityRow(1),
          category: 'SPORT',
          description: 'Football',
          intensity: 'LIGHT',
          daysInPastSevenDays: '2',
          averageHoursPerDay: '',
          averageMinutesPerDay: '30'
        }
      ]
    }
    const cleared: OtherActivityForm = { ...form, weeklyResponse: 'NO', activities: [] }
    expect(otherActivityToRequest(cleared)).toEqual({
      otherActivityResponse: 'NO',
      otherActivities: []
    })
    expect(validateOtherActivity(cleared)).toEqual([])
  })

  it('validates work baseline bounds and uses the active expected version', () => {
    const form: WorkBaselineForm = {
      ...createInitialWorkBaselineForm(),
      status: 'EMPLOYED',
      typicalWorkdaysPerWeek: '5',
      typicalHoursPerWorkday: '8'
    }
    expect(validateWorkBaseline(form)).toEqual([])
    const workspace = { activeWorkBaseline: { version: 4 } } as never
    expect(workBaselineToRequest(encounterId, workspace, form)).toMatchObject({
      expectedBaselineVersion: 4,
      status: 'EMPLOYED',
      typicalWorkdaysPerWeek: 5,
      typicalHoursPerWorkday: 8
    })
    expect(
      validateWorkBaseline({ ...form, typicalWorkdaysPerWeek: '8' }).map((error) => error.fieldId)
    ).toContain('work-baseline-days')
  })

  it('requires a referenced Work baseline and weekly response only for completion', () => {
    const weekly = createInitialWorkWeeklyForm()
    expect(validateCompleteWork(weekly, false, [])).toEqual([
      {
        fieldId: 'work-baseline-status',
        message: 'Save a Work baseline to complete this answer.'
      },
      { fieldId: 'work-weekly-response', message: 'Select a weekly Work response.' }
    ])
    expect(validateCompleteWork({ ...weekly, weeklyResponse: 'USUAL' }, true, [])).toEqual([])
  })

  it('starts new work and activity forms empty without manufacturing records', () => {
    expect(createInitialWorkWeeklyForm()).toEqual({ id: null, weeklyResponse: '' })
    expect(createInitialOtherActivityForm()).toEqual({ weeklyResponse: '', activities: [] })
    expect(createInitialWorkBaselineForm().status).toBe('')
  })
})
