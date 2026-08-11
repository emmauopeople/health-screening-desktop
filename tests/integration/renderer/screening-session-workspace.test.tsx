// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, type RefObject } from 'react'
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
      'Ada Lovelace • PT-000001'
    )
    expect(mounted.container.querySelector('.screening-patient-table')).toBeNull()
    expect(mounted.container.querySelector('.screening-context-panel')).not.toBeNull()
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).not.toBeNull()
    expect(text(mounted)).toContain('Patient context')
    expect(text(mounted)).toContain('Current screening encounter')
    expect(text(mounted)).toContain('Date of birth 1990-08-06')
    expect(text(mounted)).toContain('Vitals')
    expect(text(mounted)).toContain('Lifestyle')
    expect(text(mounted)).toContain('Food')
    expect(text(mounted)).toContain('OTC')
    expect(text(mounted)).toContain('Review')
    expect(text(mounted)).toContain('Screening guidance—not a diagnosis.')
    expect(text(mounted)).toContain('Screening history unavailable.')
    expect(text(mounted)).not.toContain('151 / 93')
    expect(text(mounted)).not.toContain('158')

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
      'Ada Lovelace • PT-000001',
      'Grace Hopper • PT-000002'
    ])

    await clickButton(mounted, 'Search / open patient')

    expectWorkspaceHeading(mounted, 'Patients')
    expect(mounted.container.querySelector('.screening-current-encounter-panel')).toBeNull()

    await mounted.setCommandId('SCREENING_NEW_SCREENING')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace • PT-000001',
      'Grace Hopper • PT-000002'
    ])
    expect(text(mounted)).toContain('Current screening encounter')

    await clickButton(mounted, 'Close Grace Hopper')
    await clickButton(mounted, 'Close Ada Lovelace')

    expect(text(mounted)).toContain('Select a patient from the Patients tab to begin screening.')

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
      'Ada Lovelace • PT-000001',
      'Grace Hopper • PT-000002'
    ])

    await mounted.hideWorkspace()

    expect(text(mounted)).toContain('Draft Encounters')

    await mounted.showWorkspace('SCREENING_NEW_SCREENING')

    expectWorkspaceHeading(mounted, 'New Screening')
    expect(api.screeningEncounters.start).toHaveBeenCalledTimes(2)
    expect(tabButtons(mounted).map((button) => button.textContent?.trim())).toEqual([
      'Ada Lovelace • PT-000001',
      'Grace Hopper • PT-000002'
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
      tabButtons(mounted).filter(
        (button) => button.textContent?.trim() === 'Ada Lovelace • PT-000001'
      )
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
      )
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
  }
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
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
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
