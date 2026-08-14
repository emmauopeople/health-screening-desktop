// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, useState, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createPatientFailure,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  createScreeningSessionFailure,
  type HealthScreeningApi,
  type LocalUserRole,
  type PublicCurrentScreeningSession,
  type PublicPatientSummary,
  type PublicScreeningEncounterStartSummary,
  type PublicScreeningVitalsDraft,
  type ScreeningLifestyleWorkspace,
  type ScreeningSessionErrorCode
} from '@shared/ipc'
import {
  ScreeningSessionWorkspace,
  type PatientScreeningTab
} from '../../../src/renderer/src/app/screening/ScreeningSessionWorkspace'
import type { WorkspaceNavigationGuard } from '../../../src/renderer/src/app/shell/application-shell-types'

type MockedHealthScreeningApi = HealthScreeningApi & {
  patient: {
    search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  } & HealthScreeningApi['patient']
  screeningEncounters: {
    start: ReturnType<typeof vi.fn<HealthScreeningApi['screeningEncounters']['start']>>
    vitals: {
      getDraft: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['vitals']['getDraft']>
      >
      saveDraft: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']>
      >
      completeStep: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['vitals']['completeStep']>
      >
    }
    lifestyle: {
      getWorkspace: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['getWorkspace']>
      >
      saveAlcoholBaseline: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['saveAlcoholBaseline']>
      >
      saveTobaccoBaseline: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['saveTobaccoBaseline']>
      >
      saveDraft: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['saveDraft']>
      >
      complete: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['complete']>
      >
    }
  } & HealthScreeningApi['screeningEncounters']
  screeningSessions: {
    getWorkspaceContext: ReturnType<
      typeof vi.fn<HealthScreeningApi['screeningSessions']['getWorkspaceContext']>
    >
    ensureCurrent: ReturnType<
      typeof vi.fn<HealthScreeningApi['screeningSessions']['ensureCurrent']>
    >
    create: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['create']>>
    close: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['close']>>
    reopen: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['reopen']>>
    getById: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['getById']>>
    list: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['list']>>
  } & HealthScreeningApi['screeningSessions']
}

interface MountedWorkspace {
  readonly api: MockedHealthScreeningApi
  readonly container: HTMLElement
  readonly onSelectCommand: ReturnType<
    typeof vi.fn<(commandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING') => void>
  >
  readonly onAuthenticationFailure: ReturnType<
    typeof vi.fn<(code: ScreeningSessionErrorCode) => void>
  >
  getRegisteredGuard(): WorkspaceNavigationGuard | null
  setCommandId(commandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'): Promise<void>
  hideWorkspace(): Promise<void>
  showWorkspace(commandId?: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'): Promise<void>
  unmount(): Promise<void>
}

const locationId = '77777777-7777-4777-8777-777777777777'
const sessionId = '99999999-9999-4999-8999-999999999999'
const protocolVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const encounterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondEncounterId = 'abababab-abab-4bab-8bab-abababababab'
const patientId = '11111111-1111-4111-8111-111111111111'
const secondPatientId = '22222222-2222-4222-8222-222222222222'
const thirdPatientId = '33333333-3333-4333-8333-333333333333'
const fourthPatientId = '44444444-4444-4444-8444-444444444444'
const fifthPatientId = '55555555-5555-4555-8555-555555555555'
const operationalDate = '2026-08-06'
const baseTimestamp = '2026-08-06T08:15:00.000Z'

describe('screening patient entry workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('gates the Patients workspace on the trusted current screening session', async () => {
    const ensureResult =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningSessions']['ensureCurrent']>>
      >()
    const api = createApi()
    api.screeningSessions.ensureCurrent.mockReturnValueOnce(ensureResult.promise)

    const mounted = await mountWorkspace({ api })

    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledOnce()
    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledWith()
    expect(text(mounted)).toContain('Resolving screening session...')
    expect(api.patient.search).not.toHaveBeenCalled()
    expect(mounted.container.querySelector('#screening-patient-search')).toBeNull()

    ensureResult.resolve(
      createIpcSuccess({
        status: 'RESOLVED',
        session: publicCurrentSession(),
        location: { id: locationId, name: 'Bastos Hall' }
      })
    )
    await flushReact()

    expectWorkspaceHeading(mounted, 'Patients')
    expect(api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('Ada Lovelace')
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).toBeNull()

    await mounted.unmount()
  })

  it('renders the approved Patients table without session controls or internal ids', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    expect(tableHeaders(mounted)).toEqual(['Name', 'Date of birth', 'Patient ID', 'Sex'])
    expect(text(mounted)).toContain('Search patients')
    expect(text(mounted)).toContain(operationalDate)
    expect(text(mounted)).toContain('Female')
    expect(patientRowCells(mounted, 'Ada Lovelace')).toEqual([
      'Ada Lovelace',
      '1990-08-06',
      'PT-000001',
      'Female'
    ])
    expect(text(mounted)).not.toContain('Action')
    expect(text(mounted)).not.toContain('Select')
    expect(text(mounted)).not.toContain('Last Screening')
    expect(text(mounted)).not.toContain('Follow-up')
    expect(text(mounted)).not.toContain('Vitals')
    expect(text(mounted)).not.toContain('Lifestyle')
    expect(text(mounted)).not.toContain('Food')
    expect(text(mounted)).not.toContain('OTC')
    expect(text(mounted)).not.toContain('Review')
    expect(text(mounted)).not.toContain('Close session')
    expect(text(mounted)).not.toContain('Reopen session')
    expect(text(mounted)).not.toContain(sessionId)
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).toBeNull()
    expect(api.screeningSessions.getWorkspaceContext).not.toHaveBeenCalled()
    expect(api.screeningSessions.create).not.toHaveBeenCalled()
    expect(api.screeningSessions.list).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('shows controlled session failures and supports safe retry after unavailable', async () => {
    const api = createApi()
    api.screeningSessions.ensureCurrent
      .mockResolvedValueOnce(createIpcSuccess({ status: 'LOCATION_NOT_CONFIGURED' }))
      .mockResolvedValueOnce(createIpcSuccess({ status: 'UNAVAILABLE' }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'RESOLVED',
          session: publicCurrentSession(),
          location: { id: locationId, name: 'Bastos Hall' }
        })
      )

    const mounted = await mountWorkspace({ api })

    expect(countTextOccurrences(mounted, 'Screening location is not configured.')).toBe(1)
    expect(mounted.container.querySelector('.screening-patient-table')).toBeNull()
    expect(api.patient.search).not.toHaveBeenCalled()

    await mounted.unmount()

    const retryMounted = await mountWorkspace({ api })

    expect(text(retryMounted)).toContain('Session unavailable')
    await clickButton(retryMounted, 'Retry')
    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledTimes(3)
    expect(text(retryMounted)).toContain('Ada Lovelace')

    await retryMounted.unmount()
  })

  it('uses patient search with bounded requests and ignores stale results', async () => {
    const oldSearch = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    api.patient.search.mockReturnValueOnce(oldSearch.promise).mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary({ id: secondPatientId, displayName: 'Grace Hopper' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )

    await changeInput(screeningSearchInput(mounted), 'old')
    await changeInput(screeningSearchInput(mounted), 'new')

    oldSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ id: thirdPatientId, displayName: 'Old Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'new', page: 1, pageSize: 25 })
    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledOnce()
    expect(text(mounted)).toContain('Grace Hopper')
    expect(text(mounted)).not.toContain('Old Result')

    await mounted.unmount()
  })

  it('clicking a patient row starts the approved encounter and switches to New Screening', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(api.screeningEncounters.start).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.start).toHaveBeenCalledWith({
      patientId,
      screeningSessionId: sessionId
    })
    expect(api.screeningEncounters.start.mock.calls[0]?.[0]).not.toHaveProperty('locationId')
    expect(api.screeningEncounters.start.mock.calls[0]?.[0]).not.toHaveProperty('role')
    expect(api.screeningEncounters.start.mock.calls[0]?.[0]).not.toHaveProperty('actor')
    expect(mounted.onSelectCommand).toHaveBeenCalledWith('SCREENING_NEW_SCREENING')
    expectWorkspaceHeading(mounted, 'New Screening')
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toContain(
      'Ada Lovelace'
    )
    expect(mounted.container.querySelector('.screening-patient-table')).toBeNull()
    expect(mounted.container.querySelector('.screening-context-panel')).not.toBeNull()
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).not.toBeNull()
    expect(text(mounted)).toContain('Patient context')
    expect(text(mounted)).toContain('Current screening encounter')
    expect(text(mounted)).toContain('08/06/1990 • Female')
    expect(text(mounted)).not.toContain('Date of birth')
    expect(text(mounted)).toContain('Vitals')
    expect(text(mounted)).toContain('Lifestyle')
    expect(text(mounted)).toContain('Food')
    expect(text(mounted)).toContain('OTC')
    expect(text(mounted)).toContain('Review')
    expect(vitalsTableHeaders(mounted)).toEqual([
      'Reading',
      'Systolic',
      'Diastolic',
      'Pulse',
      'Site',
      'Position',
      'Time',
      'Remove'
    ])
    expect(text(mounted)).toContain('Blood pressure readings')
    expect(text(mounted)).toContain('Weight (kg)')
    expect(text(mounted)).toContain('Waist (optional)')
    expect(text(mounted)).toContain('Notes')
    expect(text(mounted)).not.toContain('Additional current measurements')
    expect(text(mounted)).toContain('Screening guidance—not a diagnosis.')
    expect(text(mounted)).toContain('Screening history unavailable.')
    expect(text(mounted)).not.toContain('151 / 93')
    expect(text(mounted)).not.toContain('158')

    await mounted.unmount()
  })

  it('collects vitals in an editable readings table before moving to Lifestyle', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(vitalsRows(mounted)).toHaveLength(1)
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue to Lifestyle').disabled).toBe(false)
    expect(selectOptions(selectByLabel(mounted, 'Reading 1 site'))).toEqual([
      'Select',
      'Right arm',
      'Left arm',
      'Left leg',
      'Right leg'
    ])
    expect(selectOptions(selectByLabel(mounted, 'Reading 1 position'))).toEqual([
      'Select',
      'Lying',
      'Standing',
      'Sitting'
    ])

    await clickButton(mounted, 'Add reading')

    expect(vitalsRows(mounted)).toHaveLength(2)

    await changeInput(inputByLabel(mounted, 'Reading 1 systolic'), '150')
    await changeInput(inputByLabel(mounted, 'Reading 1 diastolic'), '92')
    await changeInput(inputByLabel(mounted, 'Reading 1 pulse'), '80')
    await changeSelect(selectByLabel(mounted, 'Reading 1 site'), 'RIGHT_ARM')
    await changeSelect(selectByLabel(mounted, 'Reading 1 position'), 'SITTING')
    await changeInput(inputByLabel(mounted, 'Reading 1 time'), '10:12')
    await changeInput(inputByLabel(mounted, 'Reading 2 systolic'), '146')
    await changeInput(inputByLabel(mounted, 'Reading 2 diastolic'), '88')
    await changeInput(inputByLabel(mounted, 'Reading 2 pulse'), '78')
    await changeSelect(selectByLabel(mounted, 'Reading 2 site'), 'LEFT_ARM')
    await changeSelect(selectByLabel(mounted, 'Reading 2 position'), 'STANDING')
    await changeInput(inputByLabel(mounted, 'Reading 2 time'), '10:18')
    await changeInput(inputByLabel(mounted, 'Weight in kilograms'), '80.5')
    await changeInput(inputByLabel(mounted, 'Waist optional'), '91')
    await changeTextarea(textareaByLabel(mounted, 'Vitals notes'), 'Patient rested before reading.')

    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue to Lifestyle').disabled).toBe(false)

    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.vitals.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.vitals.saveDraft.mock.calls[0]?.[0]).toMatchObject({
      encounterId,
      expectedVersion: null,
      weightKg: 80.5,
      waistCm: 91,
      notes: 'Patient rested before reading.',
      readings: [
        {
          id: null,
          sequenceNumber: 1,
          systolic: 150,
          diastolic: 92,
          pulse: 80,
          measurementSite: 'RIGHT_ARM',
          patientPosition: 'SITTING',
          measurementTime: '10:12'
        },
        {
          id: null,
          sequenceNumber: 2,
          systolic: 146,
          diastolic: 88,
          pulse: 78,
          measurementSite: 'LEFT_ARM',
          patientPosition: 'STANDING',
          measurementTime: '10:18'
        }
      ]
    })
    expect(text(mounted)).toContain('Draft saved')

    await clickButton(mounted, 'Continue to Lifestyle')

    expect(api.screeningEncounters.vitals.completeStep).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.vitals.completeStep.mock.calls[0]?.[0]).toMatchObject({
      encounterId,
      expectedVersion: 1
    })
    expect(text(mounted)).toContain('Lifestyle')
    expect(text(mounted)).toContain('Tobacco and nicotine')
    expect(text(mounted)).toContain('Not started')
    expect(text(mounted)).not.toContain('Continue to food')

    await mounted.unmount()
  })

  it('loads the Lifestyle shell with only Alcohol enabled', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(api.screeningEncounters.lifestyle.getWorkspace).toHaveBeenCalledWith({ encounterId })
    expect(mounted.container.querySelectorAll('.lifestyle-card')).toHaveLength(5)
    expect(text(mounted)).toContain('Alcohol')
    expect(text(mounted)).toContain('Tobacco and nicotine')
    expect(text(mounted)).toContain('Physical activity')
    expect(text(mounted)).toContain('Work and occupation')
    expect(text(mounted)).toContain('Other activity')
    expect(text(mounted)).toContain('Baseline required.')
    expect(text(mounted)).not.toContain('Continue to food')
    expect(buttonByText(mounted, 'Continue').disabled).toBe(true)

    await mounted.unmount()
  })

  it('restores and saves the Tobacco baseline and weekly product rows', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithTobacco()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveTobaccoBaseline.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    expect(text(mounted)).toContain(
      'Did you use any tobacco or nicotine product during the past 7 days?'
    )
    expect(inputByLabel(mounted, 'Days used during the past 7 days').value).toBe('2')
    await clickButton(mounted, 'Tobacco Baseline')
    await clickButton(mounted, 'Save baseline')
    expect(api.screeningEncounters.lifestyle.saveTobaccoBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBaselineVersion: 2,
        expectedDraftVersion: 4,
        status: 'CURRENT_DAILY'
      })
    )
    expect(text(mounted)).toContain('Tobacco baseline saved')

    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.lifestyle.saveDraft.mock.calls[0]?.[0].tobacco).toEqual(
      expect.objectContaining({
        weeklyResponse: 'YES',
        products: [expect.objectContaining({ id: '16161616-1616-4161-8161-161616161616' })]
      })
    )
    await mounted.unmount()
  })

  it('restores persisted Alcohol baseline and weekly values after entering Lifestyle', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')
    expect(
      inputByLabel(mounted, 'How many drinks did you have in total during the past 7 days?').value
    ).toBe('3')
    expect(
      inputByLabel(mounted, 'What was the highest number of drinks you had on any one day?').value
    ).toBe('2')
    expect(inputByLabel(mounted, 'On how many days did you have that highest number?').value).toBe(
      '1'
    )
    expect(selectorsByName(mounted, 'alcohol-weekly-response')).toHaveLength(5)
    expect(text(mounted)).toContain('Weekly alcohol')

    await mounted.unmount()
  })

  it('uses patient-facing weekly labels and an accessible closed drink guidance disclosure', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(text(mounted)).toContain('On how many of the past 7 days did you drink alcohol?')
    expect(text(mounted)).toContain('How many drinks did you have in total during the past 7 days?')
    expect(text(mounted)).toContain('What was the highest number of drinks you had on any one day?')
    expect(text(mounted)).toContain('On how many days did you have that highest number?')
    expect(text(mounted)).toContain('What types of alcoholic drinks did you have?')
    expect(text(mounted)).not.toContain('Drinking days')
    expect(text(mounted)).not.toContain('Total standard drinks')
    expect(text(mounted)).not.toContain('Largest number in one day')
    expect(text(mounted)).not.toContain('Days at largest amount')

    const guidance = buttonByText(mounted, 'What counts as one drink?')
    expect(guidance.getAttribute('aria-expanded')).toBe('false')
    expect(mounted.container.querySelector('#alcohol-drink-guidance')).toBeNull()

    await clickButton(mounted, 'What counts as one drink?')
    expect(guidance.getAttribute('aria-expanded')).toBe('true')
    expect(text(mounted)).toContain(
      'For this screening, one drink contains about 10 grams of pure alcohol.'
    )
    expect(text(mounted)).toContain('250 mL regular beer at 5%')
    expect(text(mounted)).toContain('100 mL wine at 12%')
    expect(text(mounted)).toContain('30 mL spirits at 40%')
    expect(text(mounted)).toContain('Larger or stronger servings may count as more than one drink.')

    guidance.focus()
    expect(document.activeElement).toBe(guidance)
    await act(async () => {
      guidance.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await flushPromises()
    })
    await flushReact()
    expect(guidance.getAttribute('aria-expanded')).toBe('false')

    await mounted.unmount()
  })

  it('blocks an inconsistent weekly quantity combination and focuses the total field', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await changeInput(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?'),
      '4'
    )
    await changeInput(
      inputByLabel(mounted, 'How many drinks did you have in total during the past 7 days?'),
      '3'
    )
    await changeInput(
      inputByLabel(mounted, 'What was the highest number of drinks you had on any one day?'),
      '3'
    )
    await changeInput(
      inputByLabel(mounted, 'On how many days did you have that highest number?'),
      '2'
    )

    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.lifestyle.saveDraft).not.toHaveBeenCalled()
    expect(text(mounted)).toContain(
      'The total number of drinks is too low for the highest amount and number of days entered.'
    )
    const total = inputByLabel(
      mounted,
      'How many drinks did you have in total during the past 7 days?'
    )
    expect(total.getAttribute('aria-invalid')).toBe('true')
    expect(total.getAttribute('aria-describedby')).toBe('alcohol-total-drinks-error')
    expect(document.activeElement).toBe(total)

    await mounted.unmount()
  })

  it('saves the baseline with the mapped status and authoritative versions', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithAlcohol({ baselineStatus: 'FORMER' })
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveAlcoholBaseline.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Alcohol Baseline')
    await clickButton(mounted, 'Save baseline')

    expect(api.screeningEncounters.lifestyle.saveAlcoholBaseline).toHaveBeenCalledWith({
      encounterId,
      expectedBaselineVersion: 2,
      expectedDraftVersion: 4,
      status: 'FORMER',
      everConsumed: 'YES',
      consumedPast12Months: 'NO',
      commonBeverageTypes: ['BEER'],
      otherBeverageDescription: null
    })
    expect(text(mounted)).toContain('Baseline saved')

    await mounted.unmount()
  })

  it('shows conditional baseline questions and saves the approved Alcohol codes', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    await clickButton(mounted, 'Alcohol Baseline')

    expect(selectorsByName(mounted, 'alcohol-past-year')).toHaveLength(0)
    await changeRadio(mounted, 'alcohol-ever-consumed', 'YES')
    expect(selectorsByName(mounted, 'alcohol-past-year')).toHaveLength(4)
    await changeRadio(mounted, 'alcohol-past-year', 'YES')
    expect(text(mounted)).toContain('Common beverage types')
    await clickCheckbox(mounted, 'OTHER')
    expect(inputByLabel(mounted, 'Other beverage').value).toBe('')
    await changeInput(inputByLabel(mounted, 'Other beverage'), 'Local beverage')
    await clickButton(mounted, 'Save baseline')

    expect(api.screeningEncounters.lifestyle.saveAlcoholBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId,
        status: 'CURRENT',
        everConsumed: 'YES',
        consumedPast12Months: 'YES',
        commonBeverageTypes: ['OTHER'],
        otherBeverageDescription: 'Local beverage'
      })
    )

    await mounted.unmount()
  })

  it('associates an empty baseline error with and focuses the first baseline radio', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Alcohol Baseline')
    await clickButton(mounted, 'Save baseline')

    const firstRadio = mounted.container.querySelector<HTMLInputElement>(
      '#alcohol-baseline-ever-YES'
    )
    const group = mounted.container.querySelector<HTMLElement>('#alcohol-baseline-ever-consumed')
    expect(firstRadio).not.toBeNull()
    expect(group?.getAttribute('aria-invalid')).toBe('true')
    expect(group?.getAttribute('aria-describedby')).toBe('lifestyle-error-baselineEverConsumed')
    expect(document.activeElement).toBe(firstRadio)

    await mounted.unmount()
  })

  it('targets baseline and weekly Other errors independently', async () => {
    const baselineApi = createApi()
    const baselineMounted = await mountWorkspace({ api: baselineApi })

    await openLifestyle(baselineMounted)
    await clickButton(baselineMounted, 'Alcohol Baseline')
    await changeRadio(baselineMounted, 'alcohol-ever-consumed', 'YES')
    await changeRadio(baselineMounted, 'alcohol-past-year', 'YES')
    await clickCheckbox(baselineMounted, 'OTHER')
    await clickButton(baselineMounted, 'Save baseline')

    const baselineOther =
      baselineMounted.container.querySelector<HTMLInputElement>('#alcohol-baseline-other')
    expect(baselineOther?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(baselineOther)
    expect(baselineMounted.container.querySelector('#alcohol-weekly-other')).toBeNull()
    await baselineMounted.unmount()

    const weeklyApi = createApi()
    weeklyApi.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const weeklyMounted = await mountWorkspace({ api: weeklyApi })
    await openLifestyle(weeklyMounted)
    await clickCheckbox(weeklyMounted, 'OTHER')

    const weeklyOther =
      weeklyMounted.container.querySelector<HTMLInputElement>('#alcohol-weekly-other')
    await changeInput(weeklyOther!, 'x'.repeat(501))
    await clickButton(weeklyMounted, 'Save draft')
    expect(weeklyOther?.getAttribute('aria-invalid')).toBe('true')
    expect(weeklyOther?.getAttribute('aria-describedby')).toBe('alcohol-weekly-other-error')
    expect(weeklyMounted.container.querySelector('#alcohol-baseline-other')).toBeNull()
    expect(document.activeElement).toBe(weeklyOther)

    await weeklyMounted.unmount()
  })

  it.each([
    ['CURRENT', 'Current • No use this week'],
    ['FORMER', 'Former • No use this week'],
    ['NEVER', 'Never • No use this week'],
    ['UNKNOWN', 'Unknown • No use this week'],
    ['DECLINED', 'Declined • No use this week']
  ] as const)('renders the exact %s no-use summary', async (baselineStatus, summary) => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'LOADED',
        workspace: publicLifestyleWorkspaceWithAlcohol({
          baselineStatus,
          weeklyResponse: 'NO',
          draftStatus: 'COMPLETE'
        })
      })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    expect(text(mounted)).toContain(summary)

    await mounted.unmount()
  })

  it('clears hidden quantitative values when weekly response changes from Yes to No', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await changeRadio(mounted, 'alcohol-weekly-response', 'NO')
    expect(mounted.container.querySelector('#alcohol-drinking-days')).toBeNull()

    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.lifestyle.saveDraft.mock.calls[0]?.[0]).toMatchObject({
      encounterId,
      expectedVersion: 4,
      alcohol: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        weeklyResponse: 'NO',
        drinkingDays: null,
        totalStandardizedDrinks: null,
        largestOneDayAmount: null,
        daysAtLargestAmount: null,
        commonBeverageTypes: [],
        otherBeverageDescription: null
      }
    })

    await mounted.unmount()
  })

  it('preserves unseen Lifestyle sections when saving Alcohol', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithAlcohol({ includeOtherSections: true })
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Save draft')

    const request = api.screeningEncounters.lifestyle.saveDraft.mock.calls[0]?.[0]
    expect(request?.tobacco).toEqual(expect.objectContaining({ weeklyResponse: 'YES' }))
    expect(request?.physicalActivity).toEqual(expect.objectContaining({ weeklyResponse: 'YES' }))
    expect(request?.work).toEqual(expect.objectContaining({ weeklyResponse: 'USUAL' }))
    expect(request?.otherActivities).toHaveLength(1)
    expect(request?.tobacco?.products[0]).not.toHaveProperty('updatedAt')
    expect(request?.physicalActivity?.activities[0]).not.toHaveProperty('weeklyMinutes')

    await mounted.unmount()
  })

  it('shows a controlled Lifestyle load failure and supports explicit retry', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace
      .mockResolvedValueOnce(createIpcSuccess({ status: 'UNAVAILABLE' }))
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspace() })
      )
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    expect(text(mounted)).toContain('Lifestyle is unavailable.')

    await clickButton(mounted, 'Retry')
    expect(api.screeningEncounters.lifestyle.getWorkspace).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Tobacco and nicotine')

    await mounted.unmount()
  })

  it('keeps weekly values when the Alcohol Baseline panel is cancelled', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    const before = inputByLabel(
      mounted,
      'On how many of the past 7 days did you drink alcohol?'
    ).value
    await clickButton(mounted, 'Alcohol Baseline')
    await clickButton(mounted, 'Cancel')

    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe(before)
    expect(text(mounted)).toContain('Weekly alcohol')

    await mounted.unmount()
  })

  it('shows Review baseline for Former plus weekly Yes without discarding answers', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'LOADED',
        workspace: publicLifestyleWorkspaceWithAlcohol({ baselineStatus: 'FORMER' })
      })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(text(mounted)).toContain('Baseline review required')
    expect(text(mounted)).toContain('Review baseline')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('preserves local Alcohol edits after a draft version conflict', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValueOnce(
      createIpcSuccess({ status: 'VERSION_CONFLICT' })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await changeInput(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?'),
      '4'
    )
    await clickButton(mounted, 'Save draft')

    expect(text(mounted)).toContain('Draft changed elsewhere. Reload and try again.')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('4')
    expect(buttonByText(mounted, 'Reload')).not.toBeNull()

    await mounted.unmount()
  })

  it('restores a persisted Vitals draft without auto-saving or overwriting it on rerender', async () => {
    const api = createApi()
    const persistedDraft = publicVitalsDraftFromRequest(
      {
        encounterId,
        expectedVersion: null,
        readings: [
          {
            id: null,
            sequenceNumber: 1,
            systolic: 138,
            diastolic: 84,
            pulse: 76,
            measurementSite: 'LEFT_ARM',
            patientPosition: 'SITTING',
            measurementTime: '09:45'
          }
        ],
        weightKg: null,
        waistCm: null,
        notes: 'Restored local draft.'
      },
      { status: 'DRAFT', rowVersion: 7 }
    )
    api.screeningEncounters.vitals.getDraft.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', draft: persistedDraft })
    )
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(api.screeningEncounters.vitals.getDraft).toHaveBeenCalledWith({ encounterId })
    expect(api.screeningEncounters.vitals.saveDraft).not.toHaveBeenCalled()
    expect(inputByLabel(mounted, 'Reading 1 systolic').value).toBe('138')
    expect(inputByLabel(mounted, 'Reading 1 diastolic').value).toBe('84')
    expect(inputByLabel(mounted, 'Reading 1 pulse').value).toBe('76')
    expect(selectByLabel(mounted, 'Reading 1 site').value).toBe('LEFT_ARM')
    expect(selectByLabel(mounted, 'Reading 1 position').value).toBe('SITTING')
    expect(inputByLabel(mounted, 'Reading 1 time').value).toBe('09:45')
    expect(textareaByLabel(mounted, 'Vitals notes').value).toBe('Restored local draft.')

    await mounted.hideWorkspace()
    await mounted.showWorkspace('SCREENING_NEW_SCREENING')

    expect(api.screeningEncounters.vitals.getDraft).toHaveBeenCalledOnce()
    expect(textareaByLabel(mounted, 'Vitals notes').value).toBe('Restored local draft.')

    await mounted.unmount()
  })

  it('keeps Reading 1 present and persists removal of later readings after renumbering', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Add reading')
    await clickButton(mounted, 'Add reading')
    await changeInput(inputByLabel(mounted, 'Reading 2 systolic'), '145')
    await changeInput(inputByLabel(mounted, 'Reading 3 systolic'), '152')

    expect(vitalsRows(mounted)).toHaveLength(3)
    expect(
      mounted.container.querySelector('[aria-label="Reading 1 cannot be removed"]')
    ).not.toBeNull()

    await clickButton(mounted, 'Remove')

    expect(confirmSpy).toHaveBeenCalledWith('Remove this reading?')
    expect(vitalsRows(mounted)).toHaveLength(2)
    expect(inputByLabel(mounted, 'Reading 2 systolic').value).toBe('152')

    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.vitals.saveDraft.mock.calls[0]?.[0]).toMatchObject({
      readings: [
        expect.objectContaining({ sequenceNumber: 1 }),
        expect.objectContaining({ sequenceNumber: 2, systolic: 152 })
      ]
    })

    await mounted.unmount()
  })

  it('blocks Continue until Vitals has complete readings while keeping optional fields optional', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Continue to Lifestyle')

    expect(api.screeningEncounters.vitals.completeStep).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Complete Reading 1 before continuing.')
    expect(text(mounted)).toContain('Reading 1 systolic is required.')

    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Add reading')
    await changeInput(inputByLabel(mounted, 'Reading 2 systolic'), '146')
    await clickButton(mounted, 'Continue to Lifestyle')

    expect(api.screeningEncounters.vitals.completeStep).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Reading 2 diastolic is required.')
    expect(text(mounted)).toContain('Complete or remove the highlighted readings.')

    await clickButton(mounted, 'Remove')
    await clickButton(mounted, 'Continue to Lifestyle')

    expect(api.screeningEncounters.vitals.completeStep).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.vitals.completeStep.mock.calls[0]?.[0]).toMatchObject({
      weightKg: null,
      waistCm: null,
      notes: null
    })
    expect(text(mounted)).toContain('Tobacco and nicotine')
    expect(text(mounted)).not.toContain('Continue to food')

    await mounted.unmount()
  })

  it('does not show Draft saved until persistence succeeds and preserves input after save failure', async () => {
    const saveResult =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']>>
      >()
    const api = createApi()
    api.screeningEncounters.vitals.saveDraft.mockReturnValueOnce(saveResult.promise)
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await changeInput(inputByLabel(mounted, 'Reading 1 systolic'), '150')
    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.vitals.saveDraft).toHaveBeenCalledOnce()
    expect(text(mounted)).not.toContain('Draft saved')
    expect(buttonByText(mounted, 'Saving draft...').disabled).toBe(true)

    await act(async () => {
      saveResult.resolve(createIpcSuccess({ status: 'VERSION_CONFLICT' }))
      await flushPromises()
    })
    await flushReact()

    expect(text(mounted)).toContain('Draft changed elsewhere. Reload and try again.')
    expect(text(mounted)).not.toContain('Draft saved')
    expect(inputByLabel(mounted, 'Reading 1 systolic').value).toBe('150')

    await mounted.unmount()
  })

  it('keeps the screening workspace open when vitals fields update with React tab state', async () => {
    const api = createApi()
    const mounted = await mountWorkspaceWithReactTabState({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(text(mounted)).toContain('Ada Lovelace')
    expect(text(mounted)).toContain('PT-000001')

    await changeInput(inputByLabel(mounted, 'Reading 1 systolic'), '150')
    await changeSelect(selectByLabel(mounted, 'Reading 1 site'), 'RIGHT_ARM')
    await changeTextarea(textareaByLabel(mounted, 'Vitals notes'), 'Patient rested.')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(inputByLabel(mounted, 'Reading 1 systolic').value).toBe('150')
    expect(selectByLabel(mounted, 'Reading 1 site').value).toBe('RIGHT_ARM')
    expect(textareaByLabel(mounted, 'Vitals notes').value).toBe('Patient rested.')
    expect(text(mounted)).toContain('Ada Lovelace')
    expect(text(mounted)).toContain('PT-000001')
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).not.toBeNull()

    await mounted.unmount()
  })

  it('renders New Screening only in its separate subtab and shows the empty state without a patient', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api, commandId: 'SCREENING_NEW_SCREENING' })

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(text(mounted)).toContain('Select a patient from the Patients tab to begin screening.')
    expect(mounted.container.querySelector('.screening-patient-table')).toBeNull()
    expect(mounted.container.querySelector('.screening-context-panel')).toBeNull()
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).toBeNull()
    expect(api.screeningEncounters.start).not.toHaveBeenCalled()

    await clickButton(mounted, 'Patients')

    expectWorkspaceHeading(mounted, 'Patients')
    expect(mounted.container.querySelector('.screening-patient-table')).not.toBeNull()

    await mounted.unmount()
  })

  it('preserves open patient tabs when returning between Patients and New Screening', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace',
      'Grace Hopper'
    ])

    await clickButton(mounted, 'Search / open patient')

    expectWorkspaceHeading(mounted, 'Patients')
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).toBeNull()

    await mounted.setCommandId('SCREENING_NEW_SCREENING')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace',
      'Grace Hopper'
    ])
    expect(text(mounted)).toContain('Current screening encounter')

    await clickButton(mounted, 'Close Grace Hopper')
    await clickButton(mounted, 'Close Ada Lovelace')

    expect(text(mounted)).toContain('Select a patient from the Patients tab to begin screening.')

    await mounted.unmount()
  })

  it('keeps Alcohol state isolated between patient encounter tabs', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace' }),
        patientSummary({ id: secondPatientId, displayName: 'Grace Hopper' })
      ]
    })
    api.screeningEncounters.start.mockImplementation((request) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'STARTED',
          encounter: encounterSummary({
            id: request.patientId === secondPatientId ? secondEncounterId : encounterId,
            patientId: request.patientId
          })
        })
      )
    )
    api.screeningEncounters.lifestyle.getWorkspace.mockImplementation(({ encounterId: id }) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED',
          workspace: publicLifestyleWorkspaceWithAlcohol({
            drinkingDays: id === encounterId ? 2 : 5,
            encounterIdOverride: id
          })
        })
      )
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    await flushReact()
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')

    await clickButton(mounted, 'Ada Lovelace')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')
    await clickButton(mounted, 'Grace Hopper')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')

    await mounted.unmount()
  })

  it('drops a Lifestyle response that resolves after leaving and re-entering the tab', async () => {
    const workspaceResult =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningEncounters']['lifestyle']['getWorkspace']>>
      >()
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockReturnValueOnce(workspaceResult.promise)
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    expect(text(mounted)).toContain('Loading Lifestyle.')

    await mounted.setCommandId('SCREENING_TODAYS_SESSION')
    await mounted.setCommandId('SCREENING_NEW_SCREENING')
    workspaceResult.resolve(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithAlcohol() })
    )
    await flushReact()

    expect(text(mounted)).toContain('Loading Lifestyle.')
    expect(mounted.container.querySelector('#alcohol-drinking-days')).toBeNull()

    await mounted.unmount()
  })

  it('preserves open patient tabs after leaving and remounting the Screening workspace', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')

    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace',
      'Grace Hopper'
    ])

    await mounted.hideWorkspace()

    expect(text(mounted)).toContain('Draft Encounters')

    await mounted.showWorkspace('SCREENING_NEW_SCREENING')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(2)
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace',
      'Grace Hopper'
    ])
    expect(text(mounted)).toContain('Current screening encounter')

    await mounted.unmount()
  })

  it('supports Enter and Space activation without a Select button', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await pressRow(mounted, 'Ada Lovelace', 'Enter')
    expectWorkspaceHeading(mounted, 'New Screening')
    await clickButton(mounted, 'Search / open patient')
    expectWorkspaceHeading(mounted, 'Patients')
    expect(rowByName(mounted, 'Grace Hopper').tabIndex).toBe(0)
    expect(rowByName(mounted, 'Grace Hopper').getAttribute('aria-label')).toBe(
      'New Screening for Grace Hopper, Patient ID PT-000002'
    )
    expect(mounted.container.querySelector('.screening-patient-table button')).toBeNull()
    await pressRow(mounted, 'Grace Hopper', ' ')

    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })

  it('activates an existing patient tab without starting another encounter', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Ada Lovelace')

    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(2)
    expect(
      tabButtons(mounted).filter((button) => button.textContent?.trim() === 'Ada Lovelace')
    ).toHaveLength(1)
    expectWorkspaceHeading(mounted, 'New Screening')
    expect(text(mounted)).toContain('Current screening encounter')

    await mounted.unmount()
  })

  it('enforces the four-patient-tab limit without closing tabs or encounters', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        }),
        patientSummary({
          id: thirdPatientId,
          displayName: 'Mary Jackson',
          patientCode: 'PT-000003'
        }),
        patientSummary({
          id: fourthPatientId,
          displayName: 'Katherine Johnson',
          patientCode: 'PT-000004'
        }),
        patientSummary({
          id: fifthPatientId,
          displayName: 'Dorothy Vaughan',
          patientCode: 'PT-000005'
        })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Mary Jackson')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Katherine Johnson')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Dorothy Vaughan')

    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(4)
    expect(text(mounted)).toContain('Close one patient to continue')
    await mounted.setCommandId('SCREENING_NEW_SCREENING')
    expect(tabButtons(mounted)).toHaveLength(4)

    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Ada Lovelace')
    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(4)
    expectWorkspaceHeading(mounted, 'New Screening')

    await clickButton(mounted, 'Close Ada Lovelace')
    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Dorothy Vaughan')

    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(5)
    expect(
      tabButtons(mounted).some((button) => button.textContent?.includes('Dorothy Vaughan'))
    ).toBe(true)

    await mounted.unmount()
  })

  it('opens resumed canonical encounters and does not consume a tab slot on failure', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace', patientCode: 'PT-000001' }),
        patientSummary({
          id: secondPatientId,
          displayName: 'Grace Hopper',
          patientCode: 'PT-000002'
        })
      ]
    })
    api.screeningEncounters.start.mockResolvedValueOnce(
      createScreeningEncounterStartStatusResult('PATIENT_NOT_FOUND')
    )
    api.screeningEncounters.start.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'ALREADY_EXISTS',
        encounter: encounterSummary({
          patientId: secondPatientId,
          screeningSessionId: sessionId,
          recordVersion: 2
        })
      })
    )
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(text(mounted)).toContain('Patient not found.')
    expectWorkspaceHeading(mounted, 'Patients')
    expect(mounted.container.querySelector('.screening-patient-table')).not.toBeNull()
    expect(tabButtons(mounted)).toHaveLength(0)

    await clickRow(mounted, 'Grace Hopper')

    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(2)
    expect(tabButtons(mounted).some((button) => button.textContent?.includes('Grace Hopper'))).toBe(
      true
    )
    expect(text(mounted)).toContain('In progress')

    await mounted.unmount()
  })

  it('prevents duplicate starts while a row is pending and drops late results after unmount', async () => {
    const startResult =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['screeningEncounters']['start']>>>()
    const api = createApi()
    api.screeningEncounters.start.mockReturnValueOnce(startResult.promise)
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace', { flush: false })
    await clickRow(mounted, 'Ada Lovelace', { flush: false })
    expect(api.screeningEncounters.start).toHaveBeenCalledOnce()

    await mounted.unmount()

    startResult.resolve(
      createIpcSuccess({
        status: 'STARTED',
        encounter: encounterSummary({ patientId, screeningSessionId: sessionId })
      })
    )
    await flushReact()
  })

  it('uses only in-memory workflow state and no browser persistence', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('sanitizes raw transport failures from session, patient, and encounter boundaries', async () => {
    const api = createApi()
    api.screeningSessions.ensureCurrent.mockResolvedValueOnce(
      createScreeningSessionFailure('IPC_FORBIDDEN')
    )
    const blocked = await mountWorkspace({ api })

    expect(blocked.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(text(blocked)).toContain('This window is not allowed to open Screening.')
    expect(text(blocked)).not.toContain('sqlite')
    await blocked.unmount()

    const patientApi = createApi()
    patientApi.patient.search.mockResolvedValueOnce(createPatientFailure('IPC_UNAVAILABLE'))
    const patientBlocked = await mountWorkspace({ api: patientApi })

    expect(text(patientBlocked)).toContain('Patient search unavailable.')
    await patientBlocked.unmount()

    const encounterApi = createApi()
    encounterApi.screeningEncounters.start.mockResolvedValueOnce(
      createScreeningEncounterIpcFailure('INTERNAL_ERROR')
    )
    const encounterBlocked = await mountWorkspace({ api: encounterApi })

    await clickRow(encounterBlocked, 'Ada Lovelace')
    expect(text(encounterBlocked)).toContain('Session unavailable')
    expect(text(encounterBlocked)).not.toContain('sqlite')

    await encounterBlocked.unmount()
  })
})

async function mountWorkspace({
  api = createApi(),
  userRole = 'LOCAL_ADMIN',
  commandId = 'SCREENING_TODAYS_SESSION'
}: {
  readonly api?: MockedHealthScreeningApi
  readonly userRole?: LocalUserRole
  readonly commandId?:
    'HOME_TODAYS_SESSION' | 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'
} = {}): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const headingRef = { current: null } as RefObject<HTMLHeadingElement | null>
  let registeredGuard: WorkspaceNavigationGuard | null = null
  let currentCommandId = commandId
  let openTabs: readonly PatientScreeningTab[] = []
  let activePatientId: string | null = null
  const onAuthenticationFailure = vi.fn<(code: ScreeningSessionErrorCode) => void>()
  const onSelectCommand = vi.fn(
    (nextCommandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING') => {
      currentCommandId = nextCommandId
      renderWorkspace()
    }
  )

  const setOpenTabs = (
    nextTabs:
      | readonly PatientScreeningTab[]
      | ((currentTabs: readonly PatientScreeningTab[]) => readonly PatientScreeningTab[])
  ): void => {
    openTabs = typeof nextTabs === 'function' ? nextTabs(openTabs) : nextTabs
    renderWorkspace()
  }

  const setActivePatientId = (
    nextPatientId: string | null | ((currentPatientId: string | null) => string | null)
  ): void => {
    activePatientId =
      typeof nextPatientId === 'function' ? nextPatientId(activePatientId) : nextPatientId
    renderWorkspace()
  }

  function renderWorkspace(): void {
    root.render(
      createElement(ScreeningSessionWorkspace, {
        api,
        activePatientId,
        commandId: currentCommandId,
        headingId: 'screening-workspace-heading',
        headingRef,
        openTabs,
        userRole,
        onActivePatientIdChange: setActivePatientId,
        onOpenTabsChange: setOpenTabs,
        onScreeningSessionAuthenticationFailure: onAuthenticationFailure,
        onSelectCommand,
        registerNavigationGuard: (guard) => {
          registeredGuard = guard
        }
      })
    )
  }

  function renderPlaceholder(): void {
    root.render(createElement('section', null, 'Draft Encounters'))
  }

  await act(async () => {
    renderWorkspace()
    await flushPromises()
  })
  await flushReact()

  return {
    api,
    container,
    onSelectCommand,
    onAuthenticationFailure,
    getRegisteredGuard: () => registeredGuard,
    async setCommandId(nextCommandId): Promise<void> {
      currentCommandId = nextCommandId
      await act(async () => {
        renderWorkspace()
        await flushPromises()
      })
      await flushReact()
    },
    async hideWorkspace(): Promise<void> {
      await act(async () => {
        renderPlaceholder()
        await flushPromises()
      })
      await flushReact()
    },
    async showWorkspace(
      nextCommandId:
        'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING' = 'SCREENING_NEW_SCREENING'
    ): Promise<void> {
      currentCommandId = nextCommandId
      await act(async () => {
        renderWorkspace()
        await flushPromises()
      })
      await flushReact()
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

async function mountWorkspaceWithReactTabState({
  api = createApi(),
  userRole = 'LOCAL_ADMIN',
  commandId = 'SCREENING_TODAYS_SESSION'
}: {
  readonly api?: MockedHealthScreeningApi
  readonly userRole?: LocalUserRole
  readonly commandId?:
    'HOME_TODAYS_SESSION' | 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'
} = {}): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const headingRef = { current: null } as RefObject<HTMLHeadingElement | null>
  let registeredGuard: WorkspaceNavigationGuard | null = null
  let setCommandIdFromHarness:
    ((commandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING') => void) | null = null
  let setVisibleFromHarness: ((visible: boolean) => void) | null = null
  const onAuthenticationFailure = vi.fn<(code: ScreeningSessionErrorCode) => void>()
  const onSelectCommand = vi.fn(
    (nextCommandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING') => {
      setCommandIdFromHarness?.(nextCommandId)
    }
  )

  function WorkspaceHarness(): React.JSX.Element {
    const [currentCommandId, setCurrentCommandId] = useState(commandId)
    const [visible, setVisible] = useState(true)
    const [openTabs, setOpenTabs] = useState<readonly PatientScreeningTab[]>([])
    const [activePatientId, setActivePatientId] = useState<string | null>(null)

    setCommandIdFromHarness = setCurrentCommandId
    setVisibleFromHarness = setVisible

    if (!visible) {
      return createElement('section', null, 'Draft Encounters')
    }

    return createElement(ScreeningSessionWorkspace, {
      api,
      activePatientId,
      commandId: currentCommandId,
      headingId: 'screening-workspace-heading',
      headingRef,
      openTabs,
      userRole,
      onActivePatientIdChange: setActivePatientId,
      onOpenTabsChange: setOpenTabs,
      onScreeningSessionAuthenticationFailure: onAuthenticationFailure,
      onSelectCommand,
      registerNavigationGuard: (guard) => {
        registeredGuard = guard
      }
    })
  }

  await act(async () => {
    root.render(createElement(WorkspaceHarness))
    await flushPromises()
  })
  await flushReact()

  return {
    api,
    container,
    onSelectCommand,
    onAuthenticationFailure,
    getRegisteredGuard: () => registeredGuard,
    async setCommandId(nextCommandId): Promise<void> {
      await act(async () => {
        setCommandIdFromHarness?.(nextCommandId)
        await flushPromises()
      })
      await flushReact()
    },
    async hideWorkspace(): Promise<void> {
      await act(async () => {
        setVisibleFromHarness?.(false)
        await flushPromises()
      })
      await flushReact()
    },
    async showWorkspace(
      nextCommandId:
        'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING' = 'SCREENING_NEW_SCREENING'
    ): Promise<void> {
      await act(async () => {
        setCommandIdFromHarness?.(nextCommandId)
        setVisibleFromHarness?.(true)
        await flushPromises()
      })
      await flushReact()
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

function createApi({
  patients = [patientSummary()],
  session = publicCurrentSession()
}: {
  readonly patients?: readonly PublicPatientSummary[]
  readonly session?: PublicCurrentScreeningSession
} = {}): MockedHealthScreeningApi {
  return {
    patient: {
      search: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({ items: patients, page: 1, pageSize: 25, total: patients.length })
        )
      )
    },
    screeningEncounters: {
      start: vi.fn((request) =>
        Promise.resolve(
          createIpcSuccess({
            status: 'STARTED',
            encounter: encounterSummary({
              patientId: request.patientId,
              screeningSessionId: request.screeningSessionId
            })
          })
        )
      ),
      vitals: {
        getDraft: vi.fn(() => Promise.resolve(createIpcSuccess({ status: 'LOADED', draft: null }))),
        saveDraft: vi.fn((request) =>
          Promise.resolve(
            createIpcSuccess({
              status: 'SAVED',
              draft: publicVitalsDraftFromRequest(request, {
                status: 'DRAFT',
                rowVersion: (request.expectedVersion ?? 0) + 1
              })
            })
          )
        ),
        completeStep: vi.fn((request) =>
          Promise.resolve(
            createIpcSuccess({
              status: 'COMPLETED',
              draft: publicVitalsDraftFromRequest(request, {
                status: 'VITALS_COMPLETE',
                rowVersion: (request.expectedVersion ?? 0) + 1
              })
            })
          )
        )
      },
      lifestyle: {
        getWorkspace: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspace() })
          )
        ),
        saveAlcoholBaseline: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'SAVED', workspace: publicLifestyleWorkspace() })
          )
        ),
        saveTobaccoBaseline: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'SAVED', workspace: publicLifestyleWorkspace() })
          )
        ),
        saveDraft: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'SAVED', workspace: publicLifestyleWorkspace() })
          )
        ),
        complete: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'COMPLETED', workspace: publicLifestyleWorkspace() })
          )
        )
      }
    },
    screeningSessions: {
      getWorkspaceContext: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            deploymentLocalDate: session.sessionDate,
            activeLocations: [{ id: locationId, name: 'Bastos Hall' }]
          })
        )
      ),
      ensureCurrent: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'RESOLVED',
            session,
            location: { id: locationId, name: 'Bastos Hall' }
          })
        )
      ),
      create: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      close: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      reopen: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      getById: vi.fn(() => Promise.resolve(createIpcSuccess({ status: 'NOT_FOUND' }))),
      list: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'LISTED',
            items: [],
            page: 1,
            pageSize: 25,
            total: 0
          })
        )
      )
    }
  } as unknown as MockedHealthScreeningApi
}

function publicCurrentSession(
  overrides: Partial<PublicCurrentScreeningSession> = {}
): PublicCurrentScreeningSession {
  return {
    id: sessionId,
    locationId,
    protocolVersionId,
    sessionDate: operationalDate,
    status: 'OPEN',
    notes: null,
    openedAt: baseTimestamp,
    closedAt: null,
    createdAt: baseTimestamp,
    rowVersion: 1,
    ...overrides
  }
}

function publicVitalsDraftFromRequest(
  request: Parameters<HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']>[0],
  overrides: Pick<PublicScreeningVitalsDraft, 'status' | 'rowVersion'>
): PublicScreeningVitalsDraft {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    encounterId: request.encounterId,
    status: overrides.status,
    readings: request.readings.map((reading, index) => ({
      id: reading.id ?? publicVitalsReadingId(index),
      sequenceNumber: reading.sequenceNumber,
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      measurementSite: reading.measurementSite,
      patientPosition: reading.patientPosition,
      measurementTime: reading.measurementTime
    })),
    weightKg: request.weightKg,
    waistCm: request.waistCm,
    notes: request.notes,
    rowVersion: overrides.rowVersion,
    updatedAt: baseTimestamp
  }
}

function publicVitalsReadingId(index: number): string {
  return (
    [
      'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
      'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
      'dddddddd-dddd-4ddd-8ddd-dddddddddd04',
      'dddddddd-dddd-4ddd-8ddd-dddddddddd05'
    ][index] ?? `dddddddd-dddd-4ddd-8ddd-dddddddddd${String(index + 1).padStart(2, '0')}`
  )
}

function publicLifestyleWorkspace(): ScreeningLifestyleWorkspace {
  return {
    encounterId,
    draft: null,
    activeAlcoholBaseline: null,
    activeTobaccoBaseline: null,
    activeWorkBaseline: null,
    referencedAlcoholBaseline: null,
    referencedTobaccoBaseline: null,
    referencedWorkBaseline: null
  }
}

function publicLifestyleWorkspaceWithAlcohol({
  baselineStatus = 'CURRENT',
  includeOtherSections = false,
  drinkingDays = 2,
  weeklyResponse = 'YES',
  draftStatus = 'IN_PROGRESS',
  encounterIdOverride = encounterId
}: {
  readonly baselineStatus?: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly includeOtherSections?: boolean
  readonly drinkingDays?: number
  readonly weeklyResponse?: 'YES' | 'NO'
  readonly draftStatus?: 'IN_PROGRESS' | 'COMPLETE'
  readonly encounterIdOverride?: string
} = {}): ScreeningLifestyleWorkspace {
  const baseline = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version: 2,
    status: baselineStatus,
    everConsumed: baselineStatus === 'NEVER' ? ('NO' as const) : ('YES' as const),
    consumedPast12Months: baselineStatus === 'CURRENT' ? ('YES' as const) : ('NO' as const),
    commonBeverageTypes: ['BEER' as const],
    otherBeverageDescription: null,
    updatedAt: baseTimestamp
  }
  const base = publicLifestyleWorkspace()
  return {
    ...base,
    encounterId: encounterIdOverride,
    draft: {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      encounterId: encounterIdOverride,
      status: draftStatus,
      rowVersion: 4,
      periodStart: '2026-07-31',
      periodEnd: operationalDate,
      alcoholBaselineVersionId: baseline.id,
      tobaccoBaselineVersionId: includeOtherSections
        ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        : null,
      workBaselineVersionId: includeOtherSections ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' : null,
      alcohol: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        weeklyResponse,
        drinkingDays: weeklyResponse === 'YES' ? drinkingDays : null,
        totalStandardizedDrinks: weeklyResponse === 'YES' ? 3 : null,
        largestOneDayAmount: weeklyResponse === 'YES' ? 2 : null,
        daysAtLargestAmount: weeklyResponse === 'YES' ? 1 : null,
        commonBeverageTypes: weeklyResponse === 'YES' ? ['BEER'] : [],
        otherBeverageDescription: null,
        updatedAt: baseTimestamp
      },
      tobacco: includeOtherSections
        ? {
            id: '12121212-1212-4121-8121-121212121212',
            weeklyResponse: 'YES',
            products: [
              {
                id: '16161616-1616-4161-8161-161616161616',
                sequenceNumber: 1,
                productType: 'CIGARETTE',
                daysUsed: 2,
                averageQuantityPerUseDay: 3,
                unit: 'STICKS_CIGARETTES',
                secondhandSmokeExposure: null,
                otherProductDescription: null,
                otherUnitDescription: null,
                updatedAt: baseTimestamp
              }
            ],
            updatedAt: baseTimestamp
          }
        : null,
      physicalActivity: includeOtherSections
        ? {
            id: '13131313-1313-4131-8131-131313131313',
            weeklyResponse: 'YES',
            sedentaryMinutesPerDay: 30,
            activities: [
              {
                id: '17171717-1717-4171-8171-171717171717',
                sequenceNumber: 1,
                activityDomain: 'EXERCISE',
                description: null,
                intensity: 'LIGHT',
                daysInPastSevenDays: 2,
                averageMinutesPerActiveDay: 30,
                weeklyMinutes: 60,
                updatedAt: baseTimestamp
              }
            ],
            updatedAt: baseTimestamp
          }
        : null,
      work: includeOtherSections
        ? {
            id: '14141414-1414-4141-8141-141414141414',
            weeklyResponse: 'USUAL',
            updatedAt: baseTimestamp
          }
        : null,
      otherActivities: includeOtherSections
        ? [
            {
              id: '15151515-1515-4151-8151-151515151515',
              sequenceNumber: 1,
              category: 'SPORT',
              description: 'Walking',
              daysInPastSevenDays: 2,
              averageMinutesPerDay: 30,
              intensity: 'LIGHT',
              updatedAt: baseTimestamp
            }
          ]
        : [],
      updatedAt: baseTimestamp
    },
    activeAlcoholBaseline: baseline,
    referencedAlcoholBaseline: baseline,
    activeTobaccoBaseline: null,
    activeWorkBaseline: null,
    referencedTobaccoBaseline: null,
    referencedWorkBaseline: null
  }
}

function publicLifestyleWorkspaceWithTobacco(): ScreeningLifestyleWorkspace {
  const workspace = publicLifestyleWorkspaceWithAlcohol({ includeOtherSections: true })
  const baseline = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    version: 2,
    status: 'CURRENT_DAILY' as const,
    everRegularlyUsed: 'YES' as const,
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'EVERY_DAY' as const,
    productTypes: ['CIGARETTE' as const],
    otherProductDescription: null,
    updatedAt: baseTimestamp
  }
  return {
    ...workspace,
    draft: {
      ...workspace.draft!,
      tobaccoBaselineVersionId: baseline.id,
      tobacco: {
        id: '12121212-1212-4121-8121-121212121212',
        weeklyResponse: 'YES',
        products: [
          {
            id: '16161616-1616-4161-8161-161616161616',
            sequenceNumber: 1,
            productType: 'CIGARETTE',
            daysUsed: 2,
            averageQuantityPerUseDay: 3,
            unit: 'STICKS_CIGARETTES',
            secondhandSmokeExposure: null,
            otherProductDescription: null,
            otherUnitDescription: null,
            updatedAt: baseTimestamp
          }
        ],
        updatedAt: baseTimestamp
      }
    },
    activeTobaccoBaseline: baseline,
    referencedTobaccoBaseline: baseline
  }
}

function patientSummary(overrides: Partial<PublicPatientSummary> = {}): PublicPatientSummary {
  return {
    id: patientId,
    patientCode: 'PT-000001',
    displayName: 'Ada Lovelace',
    givenName: 'Ada',
    familyName: 'Lovelace',
    otherNames: null,
    dateOfBirth: '1990-08-06',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: null,
    quarter: null,
    phone: null,
    status: 'ACTIVE',
    rowVersion: 1,
    updatedAt: baseTimestamp,
    ...overrides
  }
}

function encounterSummary(
  overrides: Partial<PublicScreeningEncounterStartSummary> = {}
): PublicScreeningEncounterStartSummary {
  return {
    id: encounterId,
    patientId,
    screeningSessionId: sessionId,
    status: 'DRAFT',
    startedAt: baseTimestamp,
    recordVersion: 1,
    ...overrides
  }
}

async function clickRow(
  mounted: MountedWorkspace,
  name: string,
  options: { readonly flush?: boolean } = {}
): Promise<void> {
  await act(async () => {
    rowByName(mounted, name).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )

    if (options.flush !== false) {
      await flushPromises()
    }
  })

  if (options.flush !== false) {
    await flushReact()
    await flushReact()
  }
}

async function openLifestyle(mounted: MountedWorkspace): Promise<void> {
  await clickRow(mounted, 'Ada Lovelace')
  await fillCompleteVitalsReading(mounted, 1)
  await clickButton(mounted, 'Continue to Lifestyle')
  await flushReact()
}

async function pressRow(mounted: MountedWorkspace, name: string, key: string): Promise<void> {
  await act(async () => {
    rowByName(mounted, name).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    )
    await flushPromises()
  })
  await flushReact()
}

async function clickButton(mounted: MountedWorkspace, label: string): Promise<void> {
  const button = buttonByText(mounted, label)

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeRadio(mounted: MountedWorkspace, name: string, value: string): Promise<void> {
  const radio = mounted.container.querySelector<HTMLInputElement>(
    `input[type="radio"][name="${name}"][value="${value}"]`
  )
  if (radio === null) throw new Error(`Expected radio ${name}=${value}.`)
  await act(async () => {
    radio.click()
    await flushPromises()
  })
  await flushReact()
}

async function clickCheckbox(mounted: MountedWorkspace, value: string): Promise<void> {
  const checkbox = mounted.container.querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${value}"]`
  )
  if (checkbox === null) throw new Error(`Expected checkbox ${value}.`)
  await act(async () => {
    checkbox.click()
    await flushPromises()
  })
  await flushReact()
}

function selectorsByName(mounted: MountedWorkspace, name: string): HTMLInputElement[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)
  )
}

async function fillCompleteVitalsReading(
  mounted: MountedWorkspace,
  readingNumber: number
): Promise<void> {
  await changeInput(inputByLabel(mounted, `Reading ${readingNumber} systolic`), '150')
  await changeInput(inputByLabel(mounted, `Reading ${readingNumber} diastolic`), '92')
  await changeInput(inputByLabel(mounted, `Reading ${readingNumber} pulse`), '80')
  await changeSelect(selectByLabel(mounted, `Reading ${readingNumber} site`), 'RIGHT_ARM')
  await changeSelect(selectByLabel(mounted, `Reading ${readingNumber} position`), 'SITTING')
  await changeInput(inputByLabel(mounted, `Reading ${readingNumber} time`), '10:12')
}

function rowByName(mounted: MountedWorkspace, name: string): HTMLTableRowElement {
  const row = Array.from(
    mounted.container.querySelectorAll<HTMLTableRowElement>('.screening-patient-row')
  ).find((candidate) => candidate.textContent?.includes(name))

  if (row === undefined) {
    throw new Error(`Expected patient row ${name} to be rendered.`)
  }

  return row
}

function buttonByText(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  const button = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute('aria-label') === label ||
      candidate.textContent?.includes(label)
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
}

function inputByLabel(mounted: MountedWorkspace, label: string): HTMLInputElement {
  const input = Array.from(mounted.container.querySelectorAll<HTMLInputElement>('input')).find(
    (candidate) => candidate.getAttribute('aria-label') === label
  )

  if (input === undefined) {
    throw new Error(`Expected input ${label} to be rendered.`)
  }

  return input
}

function selectByLabel(mounted: MountedWorkspace, label: string): HTMLSelectElement {
  const select = Array.from(mounted.container.querySelectorAll<HTMLSelectElement>('select')).find(
    (candidate) => candidate.getAttribute('aria-label') === label
  )

  if (select === undefined) {
    throw new Error(`Expected select ${label} to be rendered.`)
  }

  return select
}

function textareaByLabel(mounted: MountedWorkspace, label: string): HTMLTextAreaElement {
  const textarea = Array.from(
    mounted.container.querySelectorAll<HTMLTextAreaElement>('textarea')
  ).find((candidate) => candidate.getAttribute('aria-label') === label)

  if (textarea === undefined) {
    throw new Error(`Expected textarea ${label} to be rendered.`)
  }

  return textarea
}

function selectOptions(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.textContent?.trim() ?? '')
}

function vitalsRows(mounted: MountedWorkspace): HTMLTableRowElement[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLTableRowElement>('.screening-vitals-table tbody tr')
  )
}

function screeningSearchInput(mounted: MountedWorkspace): HTMLInputElement {
  const input = mounted.container.querySelector<HTMLInputElement>('#screening-patient-search')

  if (input === null) {
    throw new Error('Expected Screening patient search input.')
  }

  return input
}

function tableHeaders(mounted: MountedWorkspace): string[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLTableCellElement>('.screening-patient-table th')
  ).map((header) => header.textContent?.trim() ?? '')
}

function vitalsTableHeaders(mounted: MountedWorkspace): string[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLTableCellElement>('.screening-vitals-table thead th')
  ).map((header) => header.textContent?.trim() ?? '')
}

function patientRowCells(mounted: MountedWorkspace, name: string): string[] {
  return Array.from(rowByName(mounted, name).querySelectorAll<HTMLTableCellElement>('td')).map(
    (cell) => cell.textContent?.trim() ?? ''
  )
}

function tabButtons(mounted: MountedWorkspace): HTMLButtonElement[] {
  return Array.from(mounted.container.querySelectorAll<HTMLButtonElement>('.screening-patient-tab'))
}

function workspaceHeading(mounted: MountedWorkspace): HTMLHeadingElement {
  const heading = mounted.container.querySelector<HTMLHeadingElement>(
    '#screening-workspace-heading'
  )

  if (heading === null) {
    throw new Error('Expected workspace heading.')
  }

  return heading
}

function expectWorkspaceHeading(mounted: MountedWorkspace, expected: string): void {
  expect(workspaceHeading(mounted).textContent?.trim()).toBe(expected)
}

function text(mounted: MountedWorkspace): string {
  return mounted.container.textContent ?? ''
}

function countTextOccurrences(mounted: MountedWorkspace, phrase: string): number {
  return text(mounted).split(phrase).length - 1
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

async function flushReact(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await flushPromises()
    })
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
