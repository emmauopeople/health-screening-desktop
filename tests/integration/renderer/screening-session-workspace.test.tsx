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
  type ScreeningFoodWorkspace,
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
      saveWorkBaseline: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['saveWorkBaseline']>
      >
      saveDraft: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['saveDraft']>
      >
      complete: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['complete']>
      >
      reopen: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['lifestyle']['reopen']>
      >
    }
    food: {
      getWorkspace: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['food']['getWorkspace']>
      >
      saveDraft: ReturnType<
        typeof vi.fn<HealthScreeningApi['screeningEncounters']['food']['saveDraft']>
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
const thirdEncounterId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'
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

  it('enforces Vitals field bounds with inline association and invalid-field focus', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    const systolic = inputByLabel(mounted, 'Reading 1 systolic')
    await changeInput(systolic, '301')
    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.vitals.saveDraft).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Systolic blood pressure cannot be more than 300.')
    expect(systolic.getAttribute('aria-invalid')).toBe('true')
    const describedBy = systolic.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(mounted.container.querySelector(`#${describedBy}`)?.textContent).toContain(
      'Systolic blood pressure cannot be more than 300.'
    )
    expect(
      mounted.container
        .querySelector('.screening-vitals-validation')
        ?.classList.contains('screening-vitals-validation-error')
    ).toBe(true)
    expect(document.activeElement).toBe(systolic)

    await changeInput(systolic, '300')
    const diastolic = inputByLabel(mounted, 'Reading 1 diastolic')
    await changeInput(diastolic, '121')
    await clickButton(mounted, 'Save draft')
    expect(text(mounted)).toContain('Diastolic blood pressure cannot be more than 120.')
    expect(document.activeElement).toBe(diastolic)

    await changeInput(diastolic, '120')
    const pulse = inputByLabel(mounted, 'Reading 1 pulse')
    await changeInput(pulse, '301')
    await clickButton(mounted, 'Save draft')
    expect(text(mounted)).toContain('Pulse cannot be more than 300.')
    expect(document.activeElement).toBe(pulse)

    await changeInput(pulse, '300')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)

    await mounted.unmount()
  })

  it('shows an accessible advisory independently for each valid low reading and not at thresholds', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')
    const systolic = inputByLabel(mounted, 'Reading 1 systolic')
    const diastolic = inputByLabel(mounted, 'Reading 1 diastolic')
    const pulse = inputByLabel(mounted, 'Reading 1 pulse')

    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(0)

    await changeInput(systolic, '89')
    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(1)
    expect(text(mounted)).toContain(
      'This reading is lower than the screening threshold. Recommend medical review, especially if the patient has symptoms.'
    )

    await changeInput(systolic, '90')
    await changeInput(diastolic, '49')
    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(1)
    await changeInput(diastolic, '50')
    await changeInput(pulse, '44')
    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(1)
    await changeInput(pulse, '45')
    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(0)

    for (const invalidValue of ['', '0', '301', 'not-a-number']) {
      await changeInput(systolic, invalidValue)
      expect(
        mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
      ).toHaveLength(0)
    }

    expect(text(mounted)).toContain('Referral status')
    expect(
      mounted.container.querySelector('#screening-referral-title')?.parentElement?.textContent
    ).toContain('—')

    await mounted.unmount()
  })

  it('shows the advisory for a low reading restored from persisted data', async () => {
    const api = createApi({
      vitalsDraft: publicVitalsDraftFromRequest(
        {
          encounterId,
          expectedVersion: null,
          readings: [
            {
              id: null,
              sequenceNumber: 1,
              systolic: 89,
              diastolic: 50,
              pulse: 45,
              measurementSite: null,
              patientPosition: null,
              measurementTime: null
            }
          ],
          weightKg: null,
          waistCm: null,
          notes: null
        },
        { status: 'DRAFT', rowVersion: 2 }
      )
    })
    const mounted = await mountWorkspace({ api })

    await clickRow(mounted, 'Ada Lovelace')

    expect(
      mounted.container.querySelectorAll('.screening-vitals-low-reading-advisory')
    ).toHaveLength(1)
    expect(text(mounted)).toContain(
      'This reading is lower than the screening threshold. Recommend medical review, especially if the patient has symptoms.'
    )

    await mounted.unmount()
  })

  it('loads all five Lifestyle sections in the approved order', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(api.screeningEncounters.lifestyle.getWorkspace).toHaveBeenCalledWith({ encounterId })
    expect(mounted.container.querySelectorAll('.lifestyle-card')).toHaveLength(5)
    expect(mounted.container.querySelector('.screening-workspace-active-encounter')).not.toBeNull()
    expect(
      mounted.container.querySelector('.screening-new-screening-workspace-bounded')
    ).not.toBeNull()
    expect(mounted.container.querySelector('.screening-split-workspace-bounded')).not.toBeNull()
    expect(text(mounted)).toContain('Alcohol')
    expect(text(mounted)).toContain('Tobacco and nicotine')
    expect(text(mounted)).toContain('Weekly exercise')
    expect(text(mounted)).toContain('Job type')
    expect(text(mounted)).toContain('Other activity')
    expect(text(mounted)).toContain('Baseline required.')
    expect(text(mounted)).not.toContain('Continue to food')
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)

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
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
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

  it('collapses all Lifestyle panels after a successful draft save and preserves values', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithTobacco()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    await clickButton(mounted, 'Save draft')

    expect(text(mounted)).toContain('Draft saved')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-alcohol-baseline-panel')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')).toBeNull()
    expect(text(mounted)).toContain('Alcohol complete')
    expect(text(mounted)).toContain('Use reported')

    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'How many drinks did you have in total during the past 7 days?').value
    ).toBe('3')
    await clickButton(mounted, 'Tobacco and nicotine')
    expect(inputByLabel(mounted, 'Days used during the past 7 days').value).toBe('2')

    await mounted.unmount()
  })

  it('closes nested baseline panels when switching or collapsing cards', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithTobacco()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Alcohol Baseline')
    expect(mounted.container.querySelector('#lifestyle-alcohol-baseline-panel')).not.toBeNull()

    await clickButton(mounted, 'Tobacco and nicotine')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-alcohol-baseline-panel')).toBeNull()

    await clickButton(mounted, 'Tobacco Baseline')
    expect(mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')).not.toBeNull()
    await clickButton(mounted, 'Tobacco and nicotine')
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')).toBeNull()

    await clickButton(mounted, 'Tobacco and nicotine')
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).not.toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')).toBeNull()

    await mounted.unmount()
  })

  it('preserves unsaved weekly Work while accepting the returned Work baseline', async () => {
    const api = createApi()
    const workBaseline = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 2,
      status: 'EMPLOYED' as const,
      occupationJobTitle: 'Farmer',
      usualPhysicalDemand: 'MODERATE_LABOR' as const,
      typicalWorkdaysPerWeek: 5,
      typicalHoursPerWorkday: 8,
      shiftPattern: 'DAY' as const,
      description: null,
      updatedAt: baseTimestamp
    }
    const workspace = publicLifestyleWorkspaceWithAlcohol({ includeOtherSections: true })
    const authoritative = {
      ...workspace,
      draft: { ...workspace.draft!, workBaselineVersionId: workBaseline.id },
      activeWorkBaseline: workBaseline,
      referencedWorkBaseline: workBaseline
    }
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: authoritative })
    )
    api.screeningEncounters.lifestyle.saveWorkBaseline.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace: authoritative })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Job type')
    const noWork = mounted.container.querySelector<HTMLInputElement>('#work-weekly-NO_WORK')
    if (noWork === null) throw new Error('Expected weekly Work response control.')
    await act(async () => {
      noWork.click()
      await flushPromises()
    })
    await flushReact()
    await clickButton(mounted, 'Job Type Baseline')
    await clickButton(mounted, 'Save baseline')

    expect(api.screeningEncounters.lifestyle.saveWorkBaseline).toHaveBeenCalledOnce()
    expect(mounted.container.querySelector<HTMLInputElement>('#work-weekly-NO_WORK')?.checked).toBe(
      true
    )
    expect(text(mounted)).toContain('Work baseline saved')
    await mounted.unmount()
  })

  it('saves a valid Lifestyle workspace on Continue without making the draft read-only', async () => {
    const api = createApi()
    const workBaseline = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      version: 2,
      status: 'EMPLOYED' as const,
      occupationJobTitle: 'Farmer',
      usualPhysicalDemand: 'MODERATE_LABOR' as const,
      typicalWorkdaysPerWeek: 5,
      typicalHoursPerWorkday: 8,
      shiftPattern: 'DAY' as const,
      description: null,
      updatedAt: baseTimestamp
    }
    const workspace = publicLifestyleWorkspaceWithTobacco()
    const savedWorkspace = {
      ...workspace,
      draft: {
        ...workspace.draft!,
        status: 'DRAFT' as const,
        workBaselineVersionId: workBaseline.id
      },
      activeWorkBaseline: workBaseline,
      referencedWorkBaseline: workBaseline
    }
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'LOADED',
        workspace: {
          ...savedWorkspace,
          draft: { ...savedWorkspace.draft!, status: 'DRAFT' }
        }
      })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace: savedWorkspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')

    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(api.screeningEncounters.lifestyle.saveDraft.mock.calls[0]?.[0].expectedVersion).toBe(4)
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    expect(api.screeningEncounters.food.getWorkspace).toHaveBeenCalledOnce()
    expect(buttonByText(mounted, 'Continue').disabled).toBe(true)
    await clickButton(mounted, 'Previous')
    expect(text(mounted)).toContain('Editable')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)
    expect(text(mounted)).toContain('Lifestyle saved')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-physical-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-work-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-other-content')).toBeNull()
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-ready')).toHaveLength(5)
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-complete')).toHaveLength(0)

    await clickButton(mounted, 'Alcohol')
    await changeInput(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?'),
      '3'
    )
    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledTimes(2)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)
    await clickButton(mounted, 'Continue')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledTimes(3)
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()

    await mounted.unmount()
  })

  it('opens Food after valid Lifestyle Continue and saves reported Food draft rows', async () => {
    const api = createApi()
    const lifestyleWorkspace = publicCompleteLifestyleWorkspace()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: lifestyleWorkspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace: lifestyleWorkspace })
    )
    api.screeningEncounters.food.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicFoodWorkspace() })
    )
    api.screeningEncounters.food.saveDraft.mockImplementation((request) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'SAVED',
          workspace: publicFoodWorkspaceFromRequest(request)
        })
      )
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')

    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    expect(api.screeningEncounters.food.getWorkspace).toHaveBeenCalledWith({ encounterId })
    expect(buttonByText(mounted, 'Continue').disabled).toBe(true)

    await changeRadio(mounted, 'food-response', 'REPORTED')
    await clickButton(mounted, 'Add food')
    await clickButton(mounted, 'Rice')
    await changeSelect(selectByLabel(mounted, 'Food 1 frequency'), '2_TO_3_DAYS')
    await changeInput(inputByLabel(mounted, 'Food 1 preparation or note'), ' steamed ')
    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.food.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.food.saveDraft.mock.calls[0]?.[0]).toEqual({
      encounterId,
      expectedVersion: 1,
      foodResponse: 'REPORTED',
      rows: [
        {
          id: null,
          sequenceNumber: 1,
          catalogCode: 'RICE',
          foodName: 'Rice',
          frequencyCode: '2_TO_3_DAYS',
          preparationNote: 'steamed'
        }
      ]
    })
    expect(JSON.stringify(api.screeningEncounters.food.saveDraft.mock.calls[0]?.[0])).not.toContain(
      'foodNameNormalized'
    )
    expect(text(mounted)).toContain('Draft saved')

    await clickButton(mounted, 'Previous')
    expect(mounted.container.querySelector('#screening-lifestyle-step-title')).not.toBeNull()
    await clickButton(mounted, 'Continue')
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    expect(inputByLabel(mounted, 'Food 1 name').value).toBe('Rice')

    await mounted.unmount()
  })

  it('keeps Food rendered when changing row frequency through React state updates', async () => {
    const api = createApi()
    const lifestyleWorkspace = publicCompleteLifestyleWorkspace()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: lifestyleWorkspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace: lifestyleWorkspace })
    )
    api.screeningEncounters.food.saveDraft.mockImplementation((request) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'SAVED',
          workspace: publicFoodWorkspaceFromRequest(request)
        })
      )
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const mounted = await mountWorkspaceWithReactTabState({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')
    await changeRadio(mounted, 'food-response', 'REPORTED')
    await clickButton(mounted, 'Add food')
    await clickButton(mounted, 'Rice')
    const firstName = inputByLabel(mounted, 'Food 1 name')
    const firstFrequency = selectByLabel(mounted, 'Food 1 frequency')

    for (const frequency of ['1_DAY', '2_TO_3_DAYS', '4_TO_6_DAYS', 'EVERY_DAY', '']) {
      await changeSelect(firstFrequency, frequency)
      expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
      expect(mounted.container.querySelector('#screening-patient-context-title')).not.toBeNull()
      expect(firstName.value).toBe('Rice')
      expect(firstFrequency.value).toBe(frequency)
    }
    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.food.saveDraft.mock.calls[0]?.[0].rows).toEqual([
      {
        id: null,
        sequenceNumber: 1,
        catalogCode: 'RICE',
        foodName: 'Rice',
        frequencyCode: null,
        preparationNote: null
      }
    ])

    const recoveredFirstName = inputByLabel(mounted, 'Food 1 name')
    const recoveredFirstFrequency = selectByLabel(mounted, 'Food 1 frequency')
    await changeSelect(recoveredFirstFrequency, 'EVERY_DAY')
    await clickButton(mounted, 'Add food')
    await changeInput(inputByLabel(mounted, 'Food 2 name'), 'Custom yam')
    await changeInput(inputByLabel(mounted, 'Food 2 preparation or note'), 'boiled')
    await changeSelect(selectByLabel(mounted, 'Food 2 frequency'), '2_TO_3_DAYS')

    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    expect(recoveredFirstName.value).toBe('Rice')
    expect(recoveredFirstFrequency.value).toBe('EVERY_DAY')
    expect(inputByLabel(mounted, 'Food 2 name').value).toBe('Custom yam')
    expect(inputByLabel(mounted, 'Food 2 preparation or note').value).toBe('boiled')
    expect(consoleError).not.toHaveBeenCalled()

    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.food.saveDraft.mock.calls[1]?.[0].rows).toEqual([
      {
        id: '56565656-5656-4565-8565-565656565650',
        sequenceNumber: 1,
        catalogCode: 'RICE',
        foodName: 'Rice',
        frequencyCode: 'EVERY_DAY',
        preparationNote: null
      },
      {
        id: null,
        sequenceNumber: 2,
        catalogCode: null,
        foodName: 'Custom yam',
        frequencyCode: '2_TO_3_DAYS',
        preparationNote: 'boiled'
      }
    ])

    await mounted.unmount()
  })

  it('keeps Food Save Draft permissive but blocks invalid row transport once per attempt', async () => {
    const api = createApi()
    const lifestyleWorkspace = publicCompleteLifestyleWorkspace()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: lifestyleWorkspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace: lifestyleWorkspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')
    await changeRadio(mounted, 'food-response', 'REPORTED')
    await clickButton(mounted, 'Add food')
    const note = inputByLabel(mounted, 'Food 1 preparation or note')
    await changeInput(note, 'x'.repeat(201))
    await clickButton(mounted, 'Save draft')

    const foodName = inputByLabel(mounted, 'Food 1 name')
    expect(api.screeningEncounters.food.saveDraft).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(foodName)
    await changeInput(foodName, 'R')
    expect(document.activeElement).toBe(foodName)
    await changeInput(foodName, 'Ri')
    expect(document.activeElement).toBe(foodName)

    await clickButton(mounted, 'Save draft')
    expect(document.activeElement).toBe(note)

    await mounted.unmount()
  })

  it('preserves exact baseline review confirmation across Save Draft and then saves on Continue', async () => {
    const api = createApi()
    const workspace = publicCompleteLifestyleWorkspace({ alcoholBaselineStatus: 'FORMER' })
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    const reviewConfirmation = mounted.container.querySelector<HTMLInputElement>(
      '#alcohol-baseline-review-confirmation'
    )
    if (reviewConfirmation === null) throw new Error('Expected Alcohol review confirmation.')
    await act(async () => {
      reviewConfirmation.click()
      await flushPromises()
    })
    await flushReact()

    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Draft saved')
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-ready')).toHaveLength(5)
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-complete')).toHaveLength(0)

    await clickButton(mounted, 'Continue')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledTimes(2)
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(text(mounted)).not.toContain('Cannot continue')
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    await clickButton(mounted, 'Previous')
    expect(text(mounted)).toContain('Lifestyle saved')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)

    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')

    await mounted.unmount()
  })

  it.each([
    [
      'Alcohol',
      async (mounted: MountedWorkspace) => {
        await openCardIfCollapsed(mounted, 'Alcohol', '#lifestyle-alcohol-content')
        await changeInput(
          inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?'),
          '0'
        )
      }
    ],
    [
      'Tobacco',
      async (mounted: MountedWorkspace) => {
        await openCardIfCollapsed(mounted, 'Tobacco and nicotine', '#lifestyle-tobacco-content')
        await changeInput(inputByLabel(mounted, 'Days used during the past 7 days'), '')
      }
    ],
    [
      'Weekly exercise',
      async (mounted: MountedWorkspace) => {
        await openCardIfCollapsed(mounted, 'Weekly exercise', '#lifestyle-physical-content')
        const days = mounted.container.querySelector<HTMLInputElement>(
          '#lifestyle-physical-content input[id$="-days"]'
        )
        if (days === null) throw new Error('Expected Weekly exercise days field.')
        await changeInput(days, '')
      }
    ],
    [
      'Job type',
      async (mounted: MountedWorkspace) => {
        await openCardIfCollapsed(mounted, 'Job type', '#lifestyle-work-content')
        await clickButton(mounted, 'Job Type Baseline')
        const status = mounted.container.querySelector<HTMLSelectElement>('#work-baseline-status')
        if (status === null) throw new Error('Expected Work baseline status select.')
        await changeSelect(status, '')
      }
    ],
    [
      'Other activity',
      async (mounted: MountedWorkspace) => {
        await openCardIfCollapsed(mounted, 'Other activity', '#lifestyle-other-content')
        const days = mounted.container.querySelector<HTMLInputElement>(
          '#lifestyle-other-content input[id$="-days"]'
        )
        if (days === null) throw new Error('Expected Other activity days field.')
        await changeInput(days, '')
      }
    ]
  ] as const)(
    'shows only %s as invalid for section-specific validation errors',
    async (card, makeInvalid) => {
      const api = createApi()
      const workspace = publicCompleteLifestyleWorkspace()
      api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
        createIpcSuccess({ status: 'LOADED', workspace })
      )
      const mounted = await mountWorkspace({ api })

      await openLifestyle(mounted)
      await makeInvalid(mounted)
      await clickButton(mounted, 'Save draft')

      for (const label of ['Alcohol', 'Tobacco', 'Weekly exercise', 'Job type', 'Other activity']) {
        expect(cardStatus(mounted, label)).toBe(label === card ? 'Validation error' : 'Ready')
      }
      expect(api.screeningEncounters.lifestyle.saveDraft).not.toHaveBeenCalled()
      expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()

      await mounted.unmount()
    }
  )

  it('keeps transport save failures at module level without changing ready card statuses', async () => {
    const api = createApi()
    const workspace = publicCompleteLifestyleWorkspace()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValueOnce(
      createScreeningEncounterIpcFailure('IPC_UNAVAILABLE')
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Save draft')

    expect(text(mounted)).toContain('Draft could not be saved. Try again.')
    for (const label of ['Alcohol', 'Tobacco', 'Weekly exercise', 'Job type', 'Other activity']) {
      expect(cardStatus(mounted, label)).toBe('Ready')
    }

    await mounted.unmount()
  })

  it('does not mark an unconfirmed exact Alcohol baseline review complete after Save Draft', async () => {
    const api = createApi()
    const workspace = publicCompleteLifestyleWorkspace({ alcoholBaselineStatus: 'FORMER' })
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveDraft.mockResolvedValue(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Save draft')

    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(
      mounted.container.querySelector('.lifestyle-card-alcohol .lifestyle-card-status')?.textContent
    ).toContain('Baseline review required')
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-ready')).toHaveLength(4)
    expect(mounted.container.querySelectorAll('.lifestyle-card-status-complete')).toHaveLength(0)

    await clickButton(mounted, 'Continue')
    await flushReact()

    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Cannot continue')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).not.toBeNull()
    expect(mounted.container.querySelector('#alcohol-baseline-review-confirmation')).not.toBeNull()
    expect(document.activeElement?.id).toBe('alcohol-baseline-review-confirmation')

    await mounted.unmount()
  })

  it('shows Edit Lifestyle for a completed Lifestyle under a draft encounter and reopens it authoritatively', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithAlcohol({ draftStatus: 'COMPLETE' })
    const reopenedWorkspace = {
      ...workspace,
      draft: { ...workspace.draft!, status: 'DRAFT' as const, rowVersion: 5 }
    }
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.reopen.mockResolvedValueOnce(
      createIpcSuccess({ status: 'REOPENED', workspace: reopenedWorkspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(text(mounted)).toContain('Read only')
    expect(text(mounted)).not.toContain('Editable')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(true)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(true)
    expect(buttonByText(mounted, 'Edit Lifestyle').disabled).toBe(false)
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-physical-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-work-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-other-content')).toBeNull()
    expect(
      [...mounted.container.querySelectorAll<HTMLButtonElement>('.lifestyle-card-header')].map(
        (button) => ({ text: button.textContent, disabled: button.disabled })
      )
    ).toEqual([
      { text: expect.stringContaining('Alcohol'), disabled: false },
      { text: expect.stringContaining('Tobacco'), disabled: false },
      { text: expect.stringContaining('Weekly exercise'), disabled: false },
      { text: expect.stringContaining('Job type'), disabled: false },
      { text: expect.stringContaining('Other activity'), disabled: false }
    ])
    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').disabled
    ).toBe(true)
    await clickButton(mounted, 'Alcohol Baseline')
    expect(
      mounted.container.querySelector<HTMLInputElement>('#alcohol-baseline-ever-YES')?.disabled
    ).toBe(true)
    expect(buttonByText(mounted, 'Save baseline').disabled).toBe(true)

    await clickButton(mounted, 'Edit Lifestyle')

    expect(api.screeningEncounters.lifestyle.reopen).toHaveBeenCalledWith({
      encounterId,
      expectedVersion: 4
    })
    expect(text(mounted)).toContain('Editable')
    expect(text(mounted)).not.toContain('Read only')
    expect(text(mounted)).toContain('Lifestyle reopened')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)
    expect(text(mounted)).not.toContain('Edit Lifestyle')
    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').disabled
    ).toBe(false)

    await mounted.unmount()
  })

  it('keeps finalized encounters read-only without offering a renderer-only edit action', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithAlcohol({ draftStatus: 'COMPLETE' })
    api.screeningEncounters.start.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'STARTED',
        encounter: encounterSummary({ status: 'COMPLETED' })
      })
    )
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)

    expect(text(mounted)).toContain('Read only')
    expect(text(mounted)).not.toContain('Editable')
    expect(text(mounted)).not.toContain('Edit Lifestyle')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(true)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(true)
    expect(api.screeningEncounters.lifestyle.reopen).not.toHaveBeenCalled()
    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').disabled
    ).toBe(true)
    await clickButton(mounted, 'Alcohol Baseline')
    expect(
      mounted.container.querySelector<HTMLInputElement>('#alcohol-baseline-ever-YES')?.disabled
    ).toBe(true)
    expect(buttonByText(mounted, 'Save baseline').disabled).toBe(true)

    await mounted.unmount()
  })

  it('keeps reopen state isolated across three patient tabs', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace' }),
        patientSummary({ id: secondPatientId, displayName: 'Grace Hopper' }),
        patientSummary({ id: thirdPatientId, displayName: 'Katherine Johnson' })
      ]
    })
    const completedA = publicCompleteLifestyleWorkspace({
      encounterIdOverride: encounterId,
      alcoholDrinkingDays: 2,
      draftStatus: 'COMPLETE'
    })
    const draftB = publicCompleteLifestyleWorkspace({
      encounterIdOverride: secondEncounterId,
      alcoholDrinkingDays: 5
    })
    const completedC = publicCompleteLifestyleWorkspace({
      encounterIdOverride: thirdEncounterId,
      alcoholDrinkingDays: 7,
      draftStatus: 'COMPLETE'
    })
    const reopenedA = {
      ...completedA,
      draft: { ...completedA.draft!, status: 'DRAFT' as const, rowVersion: 5 }
    }
    api.screeningEncounters.start.mockImplementation((request) => {
      const id =
        request.patientId === secondPatientId
          ? secondEncounterId
          : request.patientId === thirdPatientId
            ? thirdEncounterId
            : encounterId
      return Promise.resolve(
        createIpcSuccess({
          status: 'STARTED',
          encounter: encounterSummary({ id, patientId: request.patientId })
        })
      )
    })
    api.screeningEncounters.lifestyle.getWorkspace.mockImplementation(({ encounterId: id }) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED',
          workspace:
            id === secondEncounterId ? draftB : id === thirdEncounterId ? completedC : completedA
        })
      )
    )
    api.screeningEncounters.lifestyle.reopen.mockImplementation((request) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'REOPENED',
          workspace: request.encounterId === encounterId ? reopenedA : completedC
        })
      )
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    expect(text(mounted)).toContain('Read only')
    await clickButton(mounted, 'Edit Lifestyle')
    expect(api.screeningEncounters.lifestyle.reopen).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.lifestyle.reopen.mock.calls[0]?.[0]).toEqual({
      encounterId,
      expectedVersion: 4
    })
    expect(text(mounted)).toContain('Editable')

    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    expect(text(mounted)).toContain('Editable')
    expect(text(mounted)).not.toContain('Read only')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')

    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Katherine Johnson')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    expect(text(mounted)).toContain('Read only')
    expect(buttonByText(mounted, 'Edit Lifestyle').disabled).toBe(false)
    expect(api.screeningEncounters.lifestyle.reopen).toHaveBeenCalledOnce()

    await clickButton(mounted, 'Ada Lovelace')
    expect(text(mounted)).toContain('Editable')
    expect(text(mounted)).toContain('Lifestyle reopened')
    expect(text(mounted)).not.toContain('Read only')
    await clickButton(mounted, 'Grace Hopper')
    expect(text(mounted)).toContain('Editable')
    expect(text(mounted)).not.toContain('Read only')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')

    await mounted.unmount()
  })

  it('keeps Continue strict and opens the first required baseline on validation failure', async () => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'LOADED',
        workspace: publicLifestyleWorkspaceWithAlcohol()
      })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')

    expect(api.screeningEncounters.lifestyle.saveDraft).not.toHaveBeenCalled()
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Cannot continue')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).not.toBeNull()
    expect(mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')).not.toBeNull()
    expect(document.activeElement?.id).toBe('lifestyle-tobacco-baseline-button')

    await mounted.unmount()
  })

  it('keeps the open card open after failed or wrong-encounter draft responses', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithTobacco()
    const failedSave =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningEncounters']['lifestyle']['saveDraft']>>
      >()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    const wrongEncounterWorkspace = publicLifestyleWorkspaceWithTobacco()
    api.screeningEncounters.lifestyle.saveDraft
      .mockReturnValueOnce(failedSave.promise)
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'SAVED',
          workspace: {
            ...wrongEncounterWorkspace,
            encounterId: secondEncounterId,
            draft: wrongEncounterWorkspace.draft
              ? { ...wrongEncounterWorkspace.draft, encounterId: secondEncounterId }
              : null
          }
        })
      )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    await clickButton(mounted, 'Save draft')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).not.toBeNull()

    failedSave.resolve(createScreeningEncounterIpcFailure('IPC_UNAVAILABLE'))
    await flushReact()
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).not.toBeNull()
    expect(text(mounted)).not.toContain('Draft saved')

    await clickButton(mounted, 'Save draft')
    expect(mounted.container.querySelector('#lifestyle-tobacco-content')).not.toBeNull()
    expect(text(mounted)).not.toContain('Draft saved')

    await mounted.unmount()
  })

  it.each([
    ['CURRENT_DAILY', 'YES', 'Current • Use reported'],
    ['CURRENT_DAILY', 'NO', 'Current • No use this week'],
    ['CURRENT_DAILY', 'UNKNOWN', 'Current • Weekly use unknown'],
    ['CURRENT_DAILY', 'DECLINED', 'Current • Weekly response declined'],
    ['CURRENT_DAILY', 'PREFER_NOT_TO_ANSWER', 'Current • Prefer not to answer'],
    ['CURRENT_DAILY', '', 'Current • Tobacco draft in progress'],
    ['FORMER', 'YES', 'Former • Use reported • Review baseline'],
    ['FORMER', 'NO', 'Former • No use this week'],
    ['FORMER', 'UNKNOWN', 'Former • Weekly use unknown'],
    ['FORMER', 'DECLINED', 'Former • Weekly response declined'],
    ['FORMER', 'PREFER_NOT_TO_ANSWER', 'Former • Prefer not to answer'],
    ['FORMER', '', 'Former • Tobacco draft in progress'],
    ['NEVER', 'YES', 'Never • Use reported • Review baseline'],
    ['NEVER', 'NO', 'Never • No use this week'],
    ['NEVER', 'UNKNOWN', 'Never • Weekly use unknown'],
    ['NEVER', 'DECLINED', 'Never • Weekly response declined'],
    ['NEVER', 'PREFER_NOT_TO_ANSWER', 'Never • Prefer not to answer'],
    ['NEVER', '', 'Never • Tobacco draft in progress'],
    ['UNKNOWN', 'YES', 'Unknown • Use reported'],
    ['UNKNOWN', 'NO', 'Unknown • No use this week'],
    ['UNKNOWN', 'UNKNOWN', 'Unknown • Weekly use unknown'],
    ['UNKNOWN', 'DECLINED', 'Unknown • Weekly response declined'],
    ['UNKNOWN', 'PREFER_NOT_TO_ANSWER', 'Unknown • Prefer not to answer'],
    ['UNKNOWN', '', 'Unknown • Tobacco draft in progress'],
    ['DECLINED', 'YES', 'Declined • Use reported'],
    ['DECLINED', 'NO', 'Declined • No use this week'],
    ['DECLINED', 'UNKNOWN', 'Declined • Weekly use unknown'],
    ['DECLINED', 'DECLINED', 'Declined • Weekly response declined'],
    ['DECLINED', 'PREFER_NOT_TO_ANSWER', 'Declined • Prefer not to answer'],
    ['DECLINED', '', 'Declined • Tobacco draft in progress']
  ] as const)('renders %s/%s Tobacco summary as %s', async (status, response, summary) => {
    const api = createApi()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'LOADED',
        workspace: publicLifestyleWorkspaceWithTobaccoStatus(status, response)
      })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    expect(
      mounted.container.querySelector('.lifestyle-card:nth-child(2) .lifestyle-card-summary')
        ?.textContent
    ).toContain(summary)

    await mounted.unmount()
  })

  it('clears a deselected Tobacco baseline Other description and keeps its error target isolated', async () => {
    const api = createApi()
    const workspace = publicLifestyleWorkspaceWithTobacco()
    api.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace })
    )
    api.screeningEncounters.lifestyle.saveTobaccoBaseline.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    await clickButton(mounted, 'Tobacco Baseline')
    const otherCheckbox = mounted.container.querySelector<HTMLInputElement>(
      '#tobacco-baseline-product-OTHER'
    )
    if (otherCheckbox === null) throw new Error('Expected Tobacco baseline Other checkbox.')
    await act(async () => {
      otherCheckbox.click()
      await flushPromises()
    })
    await flushReact()
    const otherInput = inputByLabel(mounted, 'Other product')
    await changeInput(otherInput, 'A local product')
    expect(otherInput.value).toBe('A local product')

    await act(async () => {
      otherCheckbox.click()
      await flushPromises()
    })
    await flushReact()
    expect(mounted.container.querySelector('#tobacco-baseline-other-product')).toBeNull()

    const panel = mounted.container.querySelector('#lifestyle-tobacco-baseline-panel')
    expect(panel?.querySelector('#tobacco-baseline-product-OTHER')).not.toBeNull()
    await clickButton(mounted, 'Save baseline')
    expect(api.screeningEncounters.lifestyle.saveTobaccoBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        productTypes: ['CIGARETTE'],
        otherProductDescription: null
      })
    )
    expect(mounted.container.querySelector('#tobacco-weekly-response-error')).toBeNull()

    await mounted.unmount()
  })

  it('focuses the first invalid Tobacco control and keeps product errors associated with real elements', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Tobacco and nicotine')
    await clickButton(mounted, 'Tobacco Baseline')
    await clickButton(mounted, 'Save baseline')

    const everGroup = mounted.container.querySelector('#tobacco-baseline-ever-used')
    const everRadio = mounted.container.querySelector<HTMLInputElement>(
      '#tobacco-baseline-ever-YES'
    )
    expect(everGroup?.getAttribute('aria-invalid')).toBe('true')
    expect(everGroup?.getAttribute('aria-describedby')).toBe('tobacco-baseline-ever-used-error')
    expect(mounted.container.querySelector('#tobacco-baseline-ever-used-error')).not.toBeNull()
    expect(document.activeElement).toBe(everRadio)

    await mounted.unmount()

    const tobaccoApi = createApi()
    tobaccoApi.screeningEncounters.lifestyle.getWorkspace.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOADED', workspace: publicLifestyleWorkspaceWithTobacco() })
    )
    const tobaccoMounted = await mountWorkspace({ api: tobaccoApi })
    await openLifestyle(tobaccoMounted)
    await clickButton(tobaccoMounted, 'Tobacco and nicotine')
    await clickButton(tobaccoMounted, 'Add product')

    const newProductType = tobaccoMounted.container.querySelector<HTMLSelectElement>(
      'select[id^="tobacco-product-new-"][id$="-type"]'
    )
    expect(newProductType).not.toBeNull()
    expect(newProductType?.getAttribute('aria-describedby')).toMatch(
      /^tobacco-product-new-.*-type-error$/
    )
    await clickButton(tobaccoMounted, 'Save draft')

    const productError = tobaccoMounted.container.querySelector<HTMLParagraphElement>(
      '[id^="tobacco-product-new-"][id$="-type-error"]'
    )
    expect(productError).not.toBeNull()
    expect(newProductType?.getAttribute('aria-describedby')).toBe(productError?.id)
    expect(newProductType?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(newProductType)

    const newProductRow = newProductType?.closest('.lifestyle-product-row')
    const newProductDays = newProductRow?.querySelector<HTMLInputElement>('input[id$="-days"]')
    if (newProductDays === null || newProductDays === undefined) {
      throw new Error('Expected days input for the new Tobacco product row.')
    }
    newProductDays.focus()
    expect(document.activeElement).toBe(newProductDays)
    await changeInput(newProductDays, '2')
    expect(document.activeElement).toBe(newProductDays)
    expect(newProductType?.getAttribute('aria-invalid')).toBe('true')

    const removeNewProduct = newProductRow?.querySelector<HTMLButtonElement>('button')
    if (removeNewProduct === null || removeNewProduct === undefined) {
      throw new Error('Expected remove button for the new Tobacco product row.')
    }
    await act(async () => {
      removeNewProduct.click()
      await flushPromises()
    })
    await flushReact()
    expect(document.activeElement?.id).toBe(
      'tobacco-product-16161616-1616-4161-8161-161616161616-type'
    )
    const remainingProductRow = tobaccoMounted.container.querySelector('.lifestyle-product-row')
    const removeRemainingProduct = remainingProductRow?.querySelector<HTMLButtonElement>('button')
    if (removeRemainingProduct === null || removeRemainingProduct === undefined) {
      throw new Error('Expected remove button for the remaining Tobacco product row.')
    }
    await act(async () => {
      removeRemainingProduct.click()
      await flushPromises()
    })
    await flushReact()
    expect(document.activeElement?.id).toBe('tobacco-add-product')
    await tobaccoMounted.unmount()
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

  it('focuses a later validation failure after a successful baseline save rebuilds state', async () => {
    const api = createApi()
    const savedBaselineWorkspace = publicLifestyleWorkspaceWithAlcohol({ weeklyResponse: 'NO' })
    api.screeningEncounters.lifestyle.saveAlcoholBaseline.mockResolvedValueOnce(
      createIpcSuccess({ status: 'SAVED', workspace: savedBaselineWorkspace })
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Alcohol Baseline')
    await clickButton(mounted, 'Save baseline')
    expect(document.activeElement?.id).toBe('alcohol-baseline-ever-YES')

    await changeRadio(mounted, 'alcohol-ever-consumed', 'YES')
    await changeRadio(mounted, 'alcohol-past-year', 'YES')
    await clickCheckbox(mounted, 'BEER')
    await clickButton(mounted, 'Save baseline')
    expect(text(mounted)).toContain('Baseline saved')

    await changeRadio(mounted, 'alcohol-weekly-response', 'YES')
    await clickButton(mounted, 'Continue')

    const drinkingDays = mounted.container.querySelector<HTMLInputElement>('#alcohol-drinking-days')
    expect(drinkingDays?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(drinkingDays)

    const totalDrinks = mounted.container.querySelector<HTMLInputElement>('#alcohol-total-drinks')
    if (totalDrinks === null) throw new Error('Expected total drinks field.')
    totalDrinks.focus()
    await changeInput(totalDrinks, '3')
    expect(document.activeElement).toBe(totalDrinks)

    await mounted.unmount()
  })

  it('keeps validation focus requests scoped to the active patient encounter', async () => {
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
          workspace: { ...publicLifestyleWorkspace(), encounterId: id }
        })
      )
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')
    expect(document.activeElement?.id).toBe('lifestyle-alcohol-baseline-button')

    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    await clickButton(mounted, 'Continue')
    expect(document.activeElement?.id).toBe('lifestyle-alcohol-baseline-button')

    const adaTab = buttonByText(mounted, 'Ada Lovelace')
    adaTab.focus()
    expect(document.activeElement).toBe(adaTab)
    await clickButton(mounted, 'Ada Lovelace')
    expect(document.activeElement?.id).not.toBe('lifestyle-alcohol-baseline-button')

    await clickButton(mounted, 'Continue')
    expect(document.activeElement?.id).toBe('lifestyle-alcohol-baseline-button')

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

  it('keeps Continue, summaries, errors, and read-only state isolated between patient tabs', async () => {
    const api = createApi({
      patients: [
        patientSummary({ id: patientId, displayName: 'Ada Lovelace' }),
        patientSummary({ id: secondPatientId, displayName: 'Grace Hopper' })
      ]
    })
    const workspaceA = publicCompleteLifestyleWorkspace({
      encounterIdOverride: encounterId,
      alcoholDrinkingDays: 2
    })
    const workspaceB = publicCompleteLifestyleWorkspace({
      encounterIdOverride: secondEncounterId,
      alcoholDrinkingDays: 5
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
          workspace: id === secondEncounterId ? workspaceB : workspaceA
        })
      )
    )
    api.screeningEncounters.lifestyle.saveDraft.mockImplementation((request) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'SAVED',
          workspace: request.encounterId === secondEncounterId ? workspaceB : workspaceA
        })
      )
    )
    const mounted = await mountWorkspace({ api })

    await openLifestyle(mounted)
    await clickButton(mounted, 'Continue')

    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.lifestyle.saveDraft.mock.calls[0]?.[0].encounterId).toBe(
      encounterId
    )
    expect(api.screeningEncounters.lifestyle.complete).not.toHaveBeenCalled()
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    expect(text(mounted)).not.toContain('Read only')

    await clickButton(mounted, 'Search / open patient')
    await clickRow(mounted, 'Grace Hopper')
    await fillCompleteVitalsReading(mounted, 1)
    await clickButton(mounted, 'Continue to Lifestyle')
    await flushReact()

    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()
    expect(text(mounted)).toContain('Editable')
    expect(text(mounted)).not.toContain('Read only')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')
    expect(buttonByText(mounted, 'Save draft').disabled).toBe(false)
    expect(buttonByText(mounted, 'Continue').disabled).toBe(false)

    await clickButton(mounted, 'Ada Lovelace')
    expect(mounted.container.querySelector('#screening-food-step-title')).not.toBeNull()
    await clickButton(mounted, 'Previous')
    expect(mounted.container.querySelector('#lifestyle-alcohol-content')).toBeNull()
    await clickButton(mounted, 'Alcohol')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('2')

    await clickButton(mounted, 'Grace Hopper')
    expect(
      inputByLabel(mounted, 'On how many of the past 7 days did you drink alcohol?').value
    ).toBe('5')
    expect(text(mounted)).not.toContain('Cannot continue')
    expect(api.screeningEncounters.lifestyle.saveDraft).toHaveBeenCalledOnce()

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
  session = publicCurrentSession(),
  vitalsDraft = null
}: {
  readonly patients?: readonly PublicPatientSummary[]
  readonly session?: PublicCurrentScreeningSession
  readonly vitalsDraft?: PublicScreeningVitalsDraft | null
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
        getDraft: vi.fn(() =>
          Promise.resolve(createIpcSuccess({ status: 'LOADED', draft: vitalsDraft }))
        ),
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
        saveWorkBaseline: vi.fn(() =>
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
        ),
        reopen: vi.fn(() =>
          Promise.resolve(
            createIpcSuccess({ status: 'REOPENED', workspace: publicLifestyleWorkspace() })
          )
        )
      },
      food: {
        getWorkspace: vi.fn(() =>
          Promise.resolve(createIpcSuccess({ status: 'LOADED', workspace: publicFoodWorkspace() }))
        ),
        saveDraft: vi.fn(() =>
          Promise.resolve(createIpcSuccess({ status: 'SAVED', workspace: publicFoodWorkspace() }))
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

function publicFoodWorkspace(
  overrides: Partial<ScreeningFoodWorkspace> = {}
): ScreeningFoodWorkspace {
  return {
    encounterId,
    draft: {
      id: '45454545-4545-4454-8454-454545454545',
      encounterId,
      foodResponse: null,
      rowVersion: 1,
      periodStart: '2026-07-31',
      periodEnd: operationalDate,
      rows: [],
      updatedAt: baseTimestamp
    },
    catalogItems: [
      {
        code: 'RICE',
        displayName: 'Rice',
        normalizedSearchName: 'rice',
        sortOrder: 1
      },
      {
        code: 'BEANS',
        displayName: 'Beans',
        normalizedSearchName: 'beans',
        sortOrder: 2
      }
    ],
    recentFoods: [
      {
        catalogCode: null,
        foodNameSnapshot: 'Cassava',
        foodNameNormalized: 'cassava',
        lastRecordedAt: baseTimestamp
      }
    ],
    ...overrides
  }
}

function publicFoodWorkspaceFromRequest(
  request: Parameters<HealthScreeningApi['screeningEncounters']['food']['saveDraft']>[0]
): ScreeningFoodWorkspace {
  return publicFoodWorkspace({
    draft: {
      id: '45454545-4545-4454-8454-454545454545',
      encounterId: request.encounterId,
      foodResponse: request.foodResponse,
      rowVersion: (request.expectedVersion ?? 0) + 1,
      periodStart: '2026-07-31',
      periodEnd: operationalDate,
      rows: request.rows.map((row, index) => ({
        id: row.id ?? `56565656-5656-4565-8565-56565656565${index}`,
        sequenceNumber: row.sequenceNumber,
        catalogCode: row.catalogCode,
        foodNameSnapshot: row.foodName,
        foodNameNormalized: row.foodName.trim().toLocaleLowerCase('en-US'),
        frequencyCode: row.frequencyCode,
        preparationNote: row.preparationNote,
        updatedAt: baseTimestamp
      })),
      updatedAt: baseTimestamp
    }
  })
}

function publicLifestyleWorkspaceWithAlcohol({
  baselineStatus = 'CURRENT',
  includeOtherSections = false,
  drinkingDays = 2,
  weeklyResponse = 'YES',
  draftStatus = 'DRAFT',
  encounterIdOverride = encounterId
}: {
  readonly baselineStatus?: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly includeOtherSections?: boolean
  readonly drinkingDays?: number
  readonly weeklyResponse?: 'YES' | 'NO'
  readonly draftStatus?: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETE'
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
      otherActivityResponse: includeOtherSections ? 'YES' : null,
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
            sedentaryTimeResponse: 'RECORDED',
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

function publicCompleteLifestyleWorkspace({
  encounterIdOverride = encounterId,
  alcoholBaselineStatus = 'CURRENT',
  tobaccoBaselineStatus = 'CURRENT_DAILY',
  alcoholDrinkingDays = 2,
  draftStatus = 'DRAFT'
}: {
  readonly encounterIdOverride?: string
  readonly alcoholBaselineStatus?: 'CURRENT' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly tobaccoBaselineStatus?:
    'CURRENT_DAILY' | 'CURRENT_SOME_DAYS' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED'
  readonly alcoholDrinkingDays?: number
  readonly draftStatus?: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETE'
} = {}): ScreeningLifestyleWorkspace {
  const workspace = publicLifestyleWorkspaceWithTobacco()
  const alcoholBaseline = {
    ...workspace.activeAlcoholBaseline!,
    status: alcoholBaselineStatus,
    everConsumed: alcoholBaselineStatus === 'NEVER' ? ('NO' as const) : ('YES' as const),
    consumedPast12Months: alcoholBaselineStatus === 'CURRENT' ? ('YES' as const) : ('NO' as const)
  }
  const tobaccoBaseline = {
    ...workspace.activeTobaccoBaseline!,
    status: tobaccoBaselineStatus,
    everRegularlyUsed: tobaccoBaselineStatus === 'NEVER' ? ('NO' as const) : ('YES' as const),
    currentUseFrequency:
      tobaccoBaselineStatus === 'CURRENT_DAILY'
        ? ('EVERY_DAY' as const)
        : tobaccoBaselineStatus === 'CURRENT_SOME_DAYS'
          ? ('SOME_DAYS' as const)
          : tobaccoBaselineStatus === 'FORMER' || tobaccoBaselineStatus === 'NEVER'
            ? ('NOT_AT_ALL' as const)
            : tobaccoBaselineStatus === 'DECLINED'
              ? ('DECLINED' as const)
              : ('UNKNOWN' as const),
    formerUseApproximateStopDate: tobaccoBaselineStatus === 'FORMER' ? '2024' : null
  }
  const workBaseline = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    version: 2,
    status: 'EMPLOYED' as const,
    occupationJobTitle: 'Farmer',
    usualPhysicalDemand: 'MODERATE_LABOR' as const,
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY' as const,
    description: null,
    updatedAt: baseTimestamp
  }
  return {
    ...workspace,
    encounterId: encounterIdOverride,
    draft: {
      ...workspace.draft!,
      encounterId: encounterIdOverride,
      status: draftStatus,
      alcoholBaselineVersionId: alcoholBaseline.id,
      tobaccoBaselineVersionId: tobaccoBaseline.id,
      workBaselineVersionId: workBaseline.id,
      alcohol: {
        ...workspace.draft!.alcohol!,
        drinkingDays: alcoholDrinkingDays
      }
    },
    activeAlcoholBaseline: alcoholBaseline,
    referencedAlcoholBaseline: alcoholBaseline,
    activeTobaccoBaseline: tobaccoBaseline,
    referencedTobaccoBaseline: tobaccoBaseline,
    activeWorkBaseline: workBaseline,
    referencedWorkBaseline: workBaseline
  }
}

function publicLifestyleWorkspaceWithTobaccoStatus(
  status: 'CURRENT_DAILY' | 'FORMER' | 'NEVER' | 'UNKNOWN' | 'DECLINED',
  response: 'YES' | 'NO' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER' | ''
): ScreeningLifestyleWorkspace {
  const workspace = publicLifestyleWorkspaceWithTobacco()
  const baseline = {
    ...workspace.activeTobaccoBaseline!,
    status,
    everRegularlyUsed: status === 'NEVER' ? ('NO' as const) : ('YES' as const),
    currentUseFrequency:
      status === 'CURRENT_DAILY'
        ? ('EVERY_DAY' as const)
        : status === 'FORMER' || status === 'NEVER'
          ? ('NOT_AT_ALL' as const)
          : status === 'DECLINED'
            ? ('DECLINED' as const)
            : ('UNKNOWN' as const),
    formerUseApproximateStopDate: status === 'FORMER' ? '2024' : null
  }
  return {
    ...workspace,
    draft: {
      ...workspace.draft!,
      tobacco: {
        ...workspace.draft!.tobacco!,
        weeklyResponse: response === '' ? null : response,
        products: []
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

async function openCardIfCollapsed(
  mounted: MountedWorkspace,
  label: string,
  contentSelector: string
): Promise<void> {
  if (mounted.container.querySelector(contentSelector) !== null) return
  await clickButton(mounted, label)
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

function cardStatus(mounted: MountedWorkspace, label: string): string {
  const status = Array.from(
    mounted.container.querySelectorAll<HTMLSpanElement>('.lifestyle-card-status')
  ).find((candidate) => candidate.getAttribute('aria-label')?.startsWith(`${label} status:`))

  if (status === undefined) {
    throw new Error(`Expected card status for ${label}.`)
  }

  return status.textContent?.trim() ?? ''
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
