// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, createRef, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  type HealthScreeningApi,
  type PatientErrorCode,
  type PublicPatientSummary,
  type PublicScreeningEncounterStartSummary,
  type PublicScreeningSession,
  type ScreeningSessionErrorCode
} from '@shared/ipc'
import { ScreeningWorkspace } from '../../../src/renderer/src/app/screening/ScreeningWorkspace'
import type { WorkspaceNavigationGuard } from '../../../src/renderer/src/app/shell/application-shell-types'

type MockedHealthScreeningApi = HealthScreeningApi & {
  patient: {
    search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  }
  screeningSessions: {
    getWorkspaceContext: ReturnType<
      typeof vi.fn<HealthScreeningApi['screeningSessions']['getWorkspaceContext']>
    >
    list: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['list']>>
  }
  screeningEncounters: {
    start: ReturnType<typeof vi.fn<HealthScreeningApi['screeningEncounters']['start']>>
  }
}

interface MountedWorkspace {
  readonly api: MockedHealthScreeningApi
  readonly container: HTMLElement
  readonly onAuthenticationFailure: ReturnType<
    typeof vi.fn<(code: PatientErrorCode | ScreeningSessionErrorCode) => void>
  >
  getRegisteredGuard(): WorkspaceNavigationGuard | null
  unmount(): Promise<void>
}

const locationId = '11111111-1111-4111-8111-111111111111'
const sessionId = '33333333-3333-4333-8333-333333333333'
const patientId = '44444444-4444-4444-8444-444444444444'
const secondPatientId = '55555555-5555-4555-8555-555555555555'
const thirdPatientId = '66666666-6666-4666-8666-666666666666'
const fourthPatientId = '77777777-7777-4777-8777-777777777777'
const fifthPatientId = '88888888-8888-4888-8888-888888888888'
const protocolVersionId = '99999999-9999-4999-8999-999999999999'
const encounterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const deploymentLocalDate = '2026-08-06'
const baseTimestamp = '2026-08-06T08:15:00.000Z'

describe('screening workspace renderer', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('loads workspace context and current open sessions through approved preload APIs', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('New Screening')
    expect(text(mounted)).toContain('Find a patient, choose today')
    expect(text(mounted)).toContain(deploymentLocalDate)
    expect(api.screeningSessions.getWorkspaceContext).toHaveBeenCalledOnce()
    expect(api.screeningSessions.list).toHaveBeenCalledWith({
      locationId,
      status: 'OPEN',
      dateFrom: deploymentLocalDate,
      dateTo: deploymentLocalDate,
      page: 1,
      pageSize: 25
    })
    expect(mounted.getRegisteredGuard()).toBeNull()

    await mounted.unmount()
  })

  it('uses concise loading wording while context is pending', async () => {
    const contextResult =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningSessions']['getWorkspaceContext']>>
      >()
    const api = createApi()
    api.screeningSessions.getWorkspaceContext.mockReturnValueOnce(contextResult.promise)

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('Loading locations...')
    expect(text(mounted)).not.toContain('trusted screening-session context')

    contextResult.resolve(
      createIpcSuccess({
        deploymentLocalDate,
        activeLocations: [{ id: locationId, name: 'Bastos Hall' }]
      })
    )
    await flushReact()

    await mounted.unmount()
  })

  it('opens patient-name-only tabs, enforces the four-patient limit, and closes deterministically', async () => {
    const patients = [
      patientSummary({ id: patientId, displayName: 'Grace N.', patientCode: 'PT-000001' }),
      patientSummary({ id: secondPatientId, displayName: 'Peter M.', patientCode: 'PT-000002' }),
      patientSummary({ id: thirdPatientId, displayName: 'Anne T.', patientCode: 'PT-000003' }),
      patientSummary({ id: fourthPatientId, displayName: 'Samuel B.', patientCode: 'PT-000004' }),
      patientSummary({ id: fifthPatientId, displayName: 'Marie K.', patientCode: 'PT-000005' })
    ]
    const api = createApi({ searchItems: patients })
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'screening')
    await openPatientFromResults(mounted, 'Grace N.')
    expect(patientTabLabels(mounted)).toEqual(['Grace N.'])
    expect(patientTabText(mounted)).not.toContain(patientId)
    expect(patientTabText(mounted)).not.toContain('PT-000001')

    await openPatientFromResults(mounted, 'Grace N.')
    expect(patientTabLabels(mounted)).toEqual(['Grace N.'])

    await openPatientFromResults(mounted, 'Peter M.')
    await openPatientFromResults(mounted, 'Anne T.')
    await openPatientFromResults(mounted, 'Samuel B.')
    expect(patientTabLabels(mounted)).toEqual(['Grace N.', 'Peter M.', 'Anne T.', 'Samuel B.'])

    await openPatientFromResults(mounted, 'Marie K.')
    expect(patientTabLabels(mounted)).toEqual(['Grace N.', 'Peter M.', 'Anne T.', 'Samuel B.'])
    expect(text(mounted)).toContain(
      'Close one of the four open patient tabs before opening another patient.'
    )

    await closePatientTab(mounted, 'Samuel B.')
    expect(activeTabLabel(mounted)).toBe('Anne T.')

    await closePatientTab(mounted, 'Anne T.')
    await closePatientTab(mounted, 'Peter M.')
    await closePatientTab(mounted, 'Grace N.')
    expect(patientTabLabels(mounted)).toEqual([])
    expect(text(mounted)).toContain('Select a patient to open the screening workspace.')

    await mounted.unmount()
  })

  it('preserves independent non-authoritative step state per patient and supports keyboard tab navigation', async () => {
    const api = createApi({
      searchItems: [
        patientSummary({ id: patientId, displayName: 'Grace N.' }),
        patientSummary({ id: secondPatientId, displayName: 'Peter M.' })
      ]
    })
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'screening')
    await openPatientFromResults(mounted, 'Grace N.')
    await clickStepButton(mounted, 'Lifestyle')
    expect(text(mounted)).toContain('Tobacco exposure')

    await openPatientFromResults(mounted, 'Peter M.')
    expect(activeTabLabel(mounted)).toBe('Peter M.')
    expect(text(mounted)).toContain('Blood pressure readings')

    await dispatchKeyboard(tabButtonByLabel(mounted, 'Peter M.'), 'ArrowLeft')
    expect(activeTabLabel(mounted)).toBe('Grace N.')
    expect(text(mounted)).toContain('Tobacco exposure')

    await mounted.unmount()
  })

  it('starts an encounter with exactly patientId and screeningSessionId and waits for authoritative success', async () => {
    const startResult =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['screeningEncounters']['start']>>>()
    const api = createApi({ searchItems: [patientSummary()] })
    api.screeningEncounters.start.mockReturnValueOnce(startResult.promise)
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'Grace')
    await openPatientFromResults(mounted, 'Grace N.')
    expect(text(mounted)).toContain('Ready to start')

    await clickButton(mounted, 'Begin screening', { flush: false })
    await clickButton(mounted, 'Begin screening', { flush: false })

    expect(api.screeningEncounters.start).toHaveBeenCalledOnce()
    expect(api.screeningEncounters.start).toHaveBeenCalledWith({
      patientId,
      screeningSessionId: sessionId
    })
    expect(Object.keys(api.screeningEncounters.start.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'patientId',
      'screeningSessionId'
    ])
    expect(buttonByText(mounted, 'Begin screening').disabled).toBe(true)
    expect(text(mounted)).toContain('Ready to start')

    startResult.resolve(createIpcSuccess({ status: 'STARTED', encounter: encounterSummary() }))
    await flushReact()

    expect(text(mounted)).toContain('Screening encounter started.')
    expect(text(mounted)).toContain('Encounter draft open')
    expect(buttonByText(mounted, 'Resume screening').disabled).toBe(false)

    await mounted.unmount()
  })

  it.each([
    ['ALREADY_EXISTS', 'Existing screening encounter opened.'],
    ['PATIENT_NOT_FOUND', 'The selected patient is no longer available.'],
    ['PATIENT_INELIGIBLE', 'This patient is not eligible for screening.'],
    ['SESSION_NOT_FOUND', 'The selected screening session is no longer available.'],
    ['SESSION_CLOSED', 'This screening session is closed.'],
    ['SESSION_NOT_CURRENT', 'Use an open screening session for today.'],
    ['LOCATION_NOT_FOUND', 'The session location is no longer available.'],
    ['LOCATION_INACTIVE', 'The session location is inactive.'],
    ['FORBIDDEN', 'You are not authorized to start screening here.'],
    ['VALIDATION_FAILED', 'Review the selected patient and session.'],
    ['AUTHENTICATION_REQUIRED', 'Sign in is required before screening.'],
    ['UNAVAILABLE', 'Screening start is unavailable. Try again.']
  ] as const)(
    'maps encounter-start %s to controlled renderer behavior',
    async (status, expectedMessage) => {
      const api = createApi({ searchItems: [patientSummary()] })
      api.screeningEncounters.start.mockResolvedValueOnce(
        status === 'ALREADY_EXISTS'
          ? createIpcSuccess({ status, encounter: encounterSummary() })
          : createScreeningEncounterStartStatusResult(status)
      )
      const mounted = await mountWorkspace({ api })

      await searchPatients(mounted, 'Grace')
      await openPatientFromResults(mounted, 'Grace N.')
      await clickButton(mounted, 'Begin screening')

      expect(text(mounted)).toContain(expectedMessage)
      expect(text(mounted)).not.toContain('SQL')
      expect(text(mounted)).not.toContain('stack')

      if (status === 'AUTHENTICATION_REQUIRED') {
        expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('AUTH_UNAUTHENTICATED')
      }

      await mounted.unmount()
    }
  )

  it('renders all five step surfaces, patient-context empty regions, empty graphs, and neutral action safety', async () => {
    const api = createApi({ searchItems: [patientSummary()] })
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'Grace')
    await openPatientFromResults(mounted, 'Grace N.')

    for (const label of ['Vitals', 'Lifestyle', 'Food', 'OTC Medications', 'Review']) {
      expect(text(mounted)).toContain(label)
    }

    expect(text(mounted)).toContain('Patient context')
    expect(text(mounted)).toContain('Last three screening encounters')
    expect(text(mounted)).toContain('30-day average BP')
    expect(text(mounted)).toContain('Blood pressure trend')
    expect(text(mounted)).toContain('Weight trend')
    expect(text(mounted)).toContain('OTC medication use')
    expect(text(mounted)).toContain('Follow-up date')
    expect(text(mounted)).toContain('Screening count')
    expect(text(mounted)).toContain('Blood pressure readings')
    expect(text(mounted)).toContain('Weight (kg)')
    expect(text(mounted)).toContain('Awaiting completed screening data')
    expect(text(mounted)).toContain('Screening action, not a diagnosis.')
    expect(mounted.container.querySelectorAll('.screening-empty-graph svg')).toHaveLength(0)
    expect(text(mounted)).not.toContain('Referral required')
    expect(text(mounted)).not.toContain('Urgent referral required')

    await clickStepButton(mounted, 'Food')
    expect(text(mounted)).toContain('Food catalog search')
    expect(text(mounted)).toContain('Available after the clinical data contract is enabled.')

    await mounted.unmount()
  })

  it('does not call encounter start without a selected patient or current open session', async () => {
    const noSessionApi = createApi({ listItems: [] })
    const noPatientMounted = await mountWorkspace({ api: noSessionApi })

    expect(buttonByText(noPatientMounted, 'Search')).not.toBeNull()
    expect(noSessionApi.screeningEncounters.start).not.toHaveBeenCalled()
    await noPatientMounted.unmount()

    const api = createApi({ listItems: [], searchItems: [patientSummary()] })
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'Grace')
    await openPatientFromResults(mounted, 'Grace N.')
    expect(buttonByText(mounted, 'Begin screening').disabled).toBe(true)
    expect(api.screeningEncounters.start).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('contains no browser storage dependency in workspace behavior', async () => {
    const localStorageSpy = vi.spyOn(window.localStorage, 'getItem')
    const sessionStorageSpy = vi.spyOn(window.sessionStorage, 'getItem')
    const api = createApi({ searchItems: [patientSummary()] })
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'Grace')
    await openPatientFromResults(mounted, 'Grace N.')

    expect(localStorageSpy).not.toHaveBeenCalled()
    expect(sessionStorageSpy).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('renders IPC boundary failures through sanitized messages only', async () => {
    const api = createApi({ searchItems: [patientSummary()] })
    api.screeningEncounters.start.mockResolvedValueOnce(
      createScreeningEncounterIpcFailure('IPC_UNAVAILABLE')
    )
    const mounted = await mountWorkspace({ api })

    await searchPatients(mounted, 'Grace')
    await openPatientFromResults(mounted, 'Grace N.')
    await clickButton(mounted, 'Begin screening')

    expect(text(mounted)).toContain('Screening start is unavailable. Try again.')
    expect(text(mounted)).not.toContain('ipcRenderer')
    expect(text(mounted)).not.toContain('database')

    await mounted.unmount()
  })
})

async function mountWorkspace({
  api = createApi()
}: {
  readonly api?: MockedHealthScreeningApi
} = {}): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const headingRef: RefObject<HTMLHeadingElement | null> = createRef()
  let registeredGuard: WorkspaceNavigationGuard | null = null
  const onAuthenticationFailure =
    vi.fn<(code: PatientErrorCode | ScreeningSessionErrorCode) => void>()

  await act(async () => {
    root.render(
      createElement(ScreeningWorkspace, {
        api,
        headingId: 'screening-workspace-heading',
        headingRef,
        onScreeningAuthenticationFailure: onAuthenticationFailure,
        registerNavigationGuard: (guard) => {
          registeredGuard = guard
        }
      })
    )
    await flushPromises()
  })
  await flushReact()

  return {
    api,
    container,
    onAuthenticationFailure,
    getRegisteredGuard: () => registeredGuard,
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
  activeLocations = [{ id: locationId, name: 'Bastos Hall' }],
  listItems = [publicSession()],
  searchItems = [],
  deploymentLocalDate: workspaceDate = deploymentLocalDate
}: {
  readonly activeLocations?: readonly { readonly id: string; readonly name: string }[]
  readonly listItems?: readonly PublicScreeningSession[]
  readonly searchItems?: readonly PublicPatientSummary[]
  readonly deploymentLocalDate?: string
} = {}): MockedHealthScreeningApi {
  return {
    patient: {
      search: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'LISTED',
            items: searchItems,
            page: 1,
            pageSize: 25,
            total: searchItems.length
          })
        )
      )
    },
    screeningSessions: {
      getWorkspaceContext: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ deploymentLocalDate: workspaceDate, activeLocations }))
      ),
      list: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'LISTED',
            items: listItems,
            page: 1,
            pageSize: 25,
            total: listItems.length
          })
        )
      )
    },
    screeningEncounters: {
      start: vi.fn(() => Promise.resolve(createScreeningEncounterIpcFailure('IPC_UNAVAILABLE')))
    }
  } as unknown as MockedHealthScreeningApi
}

function patientSummary(overrides: Partial<PublicPatientSummary> = {}): PublicPatientSummary {
  return {
    id: patientId,
    patientCode: 'PT-000001',
    displayName: 'Grace N.',
    givenName: 'Grace',
    familyName: 'Ngum',
    otherNames: null,
    dateOfBirth: null,
    approximateAgeYears: 46,
    ageAsOfDate: deploymentLocalDate,
    sex: 'FEMALE',
    village: 'Bastos',
    quarter: null,
    phone: '+237600000000',
    status: 'ACTIVE',
    rowVersion: 1,
    updatedAt: baseTimestamp,
    ...overrides
  }
}

function publicSession(overrides: Partial<PublicScreeningSession> = {}): PublicScreeningSession {
  return {
    id: sessionId,
    locationId,
    protocolVersionId,
    sessionDate: deploymentLocalDate,
    status: 'OPEN',
    notes: null,
    openedAt: baseTimestamp,
    closedAt: null,
    createdAt: baseTimestamp,
    rowVersion: 1,
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

async function searchPatients(mounted: MountedWorkspace, query: string): Promise<void> {
  await changeInput(inputByLabel(mounted, 'Patient search'), query)
  await clickButton(mounted, 'Search')
}

async function openPatientFromResults(
  mounted: MountedWorkspace,
  displayName: string
): Promise<void> {
  const result = Array.from(
    mounted.container.querySelectorAll<HTMLElement>('.screening-patient-result')
  ).find((candidate) => normalizedText(candidate).includes(displayName))

  if (result === undefined) {
    throw new Error(`Expected patient result ${displayName}`)
  }

  await act(async () => {
    buttonByTextWithin(result, 'Open patient').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await flushPromises()
  })
  await flushReact()
}

async function closePatientTab(mounted: MountedWorkspace, label: string): Promise<void> {
  const closeButton = Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>('button')
  ).find((button) => button.getAttribute('aria-label') === `Close ${label}`)

  if (closeButton === undefined) {
    throw new Error(`Expected close button for ${label}`)
  }

  await act(async () => {
    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function clickButton(
  mounted: MountedWorkspace,
  label: string,
  options: { readonly flush?: boolean } = {}
): Promise<void> {
  await act(async () => {
    buttonByText(mounted, label).dispatchEvent(
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

async function clickStepButton(mounted: MountedWorkspace, label: string): Promise<void> {
  await act(async () => {
    stepButtonByLabel(mounted, label).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await flushPromises()
  })
  await flushReact()
}

async function dispatchKeyboard(element: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
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

function buttonByText(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  return buttonByTextWithin(mounted.container, label)
}

function buttonByTextWithin(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => normalizedText(candidate) === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
}

function inputByLabel(mounted: MountedWorkspace, label: string): HTMLInputElement {
  const input = labeledControl<HTMLInputElement>(mounted, label, 'input')

  if (input === null) {
    throw new Error(`Expected input ${label}`)
  }

  return input
}

function labeledControl<TElement extends HTMLElement>(
  mounted: MountedWorkspace,
  label: string,
  selector: string
): TElement | null {
  for (const candidate of Array.from(
    mounted.container.querySelectorAll<HTMLLabelElement>('label')
  )) {
    if (normalizedText(candidate.querySelector('span') ?? candidate) === label) {
      return candidate.querySelector<TElement>(selector)
    }
  }

  return null
}

function patientTabLabels(mounted: MountedWorkspace): string[] {
  return Array.from(mounted.container.querySelectorAll<HTMLElement>('[role="tab"]'))
    .filter((tab) => tab.closest('.screening-patient-tabs') !== null)
    .map((tab) => normalizedText(tab))
}

function patientTabText(mounted: MountedWorkspace): string {
  return mounted.container.querySelector('.screening-patient-tabs')?.textContent ?? ''
}

function activeTabLabel(mounted: MountedWorkspace): string | null {
  const activeTab = Array.from(
    mounted.container.querySelectorAll<HTMLElement>('[role="tab"]')
  ).find(
    (tab) =>
      tab.closest('.screening-patient-tabs') !== null &&
      tab.getAttribute('aria-selected') === 'true'
  )

  return activeTab === undefined ? null : normalizedText(activeTab)
}

function tabButtonByLabel(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  const tab = Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  ).find(
    (candidate) =>
      candidate.closest('.screening-patient-tabs') !== null && normalizedText(candidate) === label
  )

  if (tab === undefined) {
    throw new Error(`Expected patient tab ${label}`)
  }

  return tab
}

function stepButtonByLabel(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  const tab = Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  ).find(
    (candidate) =>
      candidate.closest('.screening-stepper') !== null && normalizedText(candidate).endsWith(label)
  )

  if (tab === undefined) {
    throw new Error(`Expected step tab ${label}`)
  }

  return tab
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/gu, ' ').trim()
}

function text(mounted: MountedWorkspace): string {
  return mounted.container.textContent ?? ''
}

async function flushReact(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await flushPromises()
    })
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<TValue>(): {
  readonly promise: Promise<TValue>
  resolve(value: TValue): void
} {
  let resolvePromise: ((value: TValue) => void) | null = null
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value: TValue): void {
      resolvePromise?.(value)
    }
  }
}
