// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createInstallationSettingsFailure,
  type HealthScreeningApi,
  type InstallationSettingsErrorCode,
  type LocalUserRole,
  type PublicInstallationSettingsLocation
} from '@shared/ipc'
import { InstallationLocationAdministrationWorkspace } from '../../../src/renderer/src/app/administration/InstallationLocationAdministrationWorkspace'

type MockedHealthScreeningApi = HealthScreeningApi & {
  installationSettings: {
    getConfiguredLocation: ReturnType<
      typeof vi.fn<HealthScreeningApi['installationSettings']['getConfiguredLocation']>
    >
    listEligibleLocations: ReturnType<
      typeof vi.fn<HealthScreeningApi['installationSettings']['listEligibleLocations']>
    >
    assignInitialLocation: ReturnType<
      typeof vi.fn<HealthScreeningApi['installationSettings']['assignInitialLocation']>
    >
    reconfigureLocation: ReturnType<
      typeof vi.fn<HealthScreeningApi['installationSettings']['reconfigureLocation']>
    >
  } & HealthScreeningApi['installationSettings']
}

interface MountedWorkspace {
  readonly api: MockedHealthScreeningApi
  readonly container: HTMLElement
  readonly onAuthenticationFailure: ReturnType<
    typeof vi.fn<(code: InstallationSettingsErrorCode) => void>
  >
  unmount(): Promise<void>
}

const locationId = '11111111-1111-4111-8111-111111111111'
const secondLocationId = '22222222-2222-4222-8222-222222222222'
const location = Object.freeze({ id: locationId, name: 'Bastos Hall' })
const secondLocation = Object.freeze({ id: secondLocationId, name: 'Central Church' })

describe('installation location administration workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('lets an authorized administrator assign an unconfigured installation location', async () => {
    const api = createApi({ configuredStatus: 'LOCATION_NOT_CONFIGURED' })
    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('Administration')
    expect(text(mounted)).toContain('Screening Location')
    expect(assignedLocationText(mounted)).toBe('Not configured')
    expect(text(mounted)).not.toContain(locationId)

    await clickButton(mounted, 'Assign location')

    expect(locationSelect(mounted).value).toBe('')
    expect(buttonByText(mounted, 'Save').disabled).toBe(true)
    expect(api.installationSettings.assignInitialLocation).not.toHaveBeenCalled()

    await changeSelect(locationSelect(mounted), locationId)
    await clickButton(mounted, 'Save')

    expect(api.installationSettings.assignInitialLocation).toHaveBeenCalledWith({ locationId })
    expect(api.installationSettings.assignInitialLocation.mock.calls[0]?.[0]).not.toHaveProperty(
      'role'
    )
    expect(api.installationSettings.assignInitialLocation.mock.calls[0]?.[0]).not.toHaveProperty(
      'actor'
    )
    expect(api.installationSettings.reconfigureLocation).not.toHaveBeenCalled()
    expect(assignedLocationText(mounted)).toBe('Bastos Hall')
    expect(text(mounted)).toContain('Assigned location updated.')
    expect(mounted.container.querySelector('#installation-location-select')).toBeNull()

    await mounted.unmount()
  })

  it('keeps configured location visible until an authorized reconfiguration succeeds', async () => {
    const api = createApi({ configuredLocation: location })
    api.installationSettings.reconfigureLocation.mockResolvedValueOnce(
      createIpcSuccess({ status: 'UPDATED', location: secondLocation })
    )
    const mounted = await mountWorkspace({ api })

    expect(assignedLocationText(mounted)).toBe('Bastos Hall')

    await clickButton(mounted, 'Change location')
    await clickButton(mounted, 'Cancel')

    expect(assignedLocationText(mounted)).toBe('Bastos Hall')
    expect(api.installationSettings.reconfigureLocation).not.toHaveBeenCalled()

    await clickButton(mounted, 'Change location')
    await changeSelect(locationSelect(mounted), secondLocationId)

    expect(text(mounted)).toContain('Central Church')
    expect(text(mounted)).toContain(
      'This installation will use the new location for future screening work.'
    )

    await clickButton(mounted, 'Save')

    expect(api.installationSettings.reconfigureLocation).toHaveBeenCalledWith({
      locationId: secondLocationId
    })
    expect(api.installationSettings.reconfigureLocation.mock.calls[0]?.[0]).not.toHaveProperty(
      'force'
    )
    expect(api.installationSettings.reconfigureLocation.mock.calls[0]?.[0]).not.toHaveProperty(
      'bypass'
    )
    expect(assignedLocationText(mounted)).toBe('Central Church')

    await mounted.unmount()
  })

  it('preserves the current assignment when active screening work blocks reconfiguration', async () => {
    const api = createApi({ configuredLocation: location })
    api.installationSettings.reconfigureLocation.mockResolvedValueOnce(
      createIpcSuccess({ status: 'ACTIVE_SCREENING_WORK' })
    )
    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Change location')
    await changeSelect(locationSelect(mounted), secondLocationId)
    await clickButton(mounted, 'Save')

    expect(text(mounted)).toContain('Location cannot be changed while screening work is active.')
    expect(assignedLocationText(mounted)).toBe('Bastos Hall')
    expect(api.screeningSessions?.close).toBeUndefined()
    expect(api.screeningEncounters?.start).toBeUndefined()

    await mounted.unmount()
  })

  it('does not expose location controls to unauthorized users', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api, userRole: 'NURSE' })

    expect(text(mounted)).toContain(
      'Only local administrators can configure the installation location.'
    )
    expect(mounted.container.querySelector('#installation-location-select')).toBeNull()
    expect(api.installationSettings.getConfiguredLocation).not.toHaveBeenCalled()
    expect(api.installationSettings.listEligibleLocations).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('keeps stale asynchronous completion from mutating after unmount', async () => {
    const assignment =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['installationSettings']['assignInitialLocation']>>
      >()
    const api = createApi({ configuredStatus: 'LOCATION_NOT_CONFIGURED' })
    api.installationSettings.assignInitialLocation.mockReturnValueOnce(assignment.promise)
    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Assign location')
    await changeSelect(locationSelect(mounted), locationId)
    await clickButton(mounted, 'Save', { flush: false })
    await clickButton(mounted, 'Save', { flush: false })

    expect(api.installationSettings.assignInitialLocation).toHaveBeenCalledOnce()

    await mounted.unmount()

    assignment.resolve(createIpcSuccess({ status: 'ASSIGNED', location }))
    await flushReact()
  })

  it('renders sanitized configuration read failures without raw details', async () => {
    const api = createApi()
    api.installationSettings.getConfiguredLocation.mockResolvedValueOnce(
      createInstallationSettingsFailure('INTERNAL_ERROR')
    )
    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('Location settings unavailable.')
    expect(text(mounted)).not.toContain('sqlite')
    expect(text(mounted)).not.toContain('SELECT')

    await mounted.unmount()
  })
})

async function mountWorkspace({
  api = createApi(),
  userRole = 'LOCAL_ADMIN'
}: {
  readonly api?: MockedHealthScreeningApi
  readonly userRole?: LocalUserRole
} = {}): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const headingRef = { current: null } as RefObject<HTMLHeadingElement | null>
  const onAuthenticationFailure = vi.fn<(code: InstallationSettingsErrorCode) => void>()

  await act(async () => {
    root.render(
      createElement(InstallationLocationAdministrationWorkspace, {
        api,
        headingId: 'administration-workspace-heading',
        headingRef,
        userRole,
        onAuthenticationFailure
      })
    )
    await flushPromises()
  })
  await flushReact()

  return {
    api,
    container,
    onAuthenticationFailure,
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
  configuredLocation = location,
  configuredStatus = 'RESOLVED',
  locations = [location, secondLocation]
}: {
  readonly configuredLocation?: PublicInstallationSettingsLocation
  readonly configuredStatus?:
    | 'RESOLVED'
    | 'LOCATION_NOT_CONFIGURED'
    | 'LOCATION_NOT_FOUND'
    | 'LOCATION_INACTIVE'
    | 'UNAVAILABLE'
  readonly locations?: readonly PublicInstallationSettingsLocation[]
} = {}): MockedHealthScreeningApi {
  return {
    installationSettings: {
      getConfiguredLocation: vi.fn(() =>
        Promise.resolve(
          configuredStatus === 'RESOLVED'
            ? createIpcSuccess({ status: 'RESOLVED', location: configuredLocation })
            : createIpcSuccess({ status: configuredStatus })
        )
      ),
      listEligibleLocations: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ status: 'LISTED', locations }))
      ),
      assignInitialLocation: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ status: 'ASSIGNED', location: configuredLocation }))
      ),
      reconfigureLocation: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ status: 'UPDATED', location: configuredLocation }))
      )
    }
  } as unknown as MockedHealthScreeningApi
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

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

function buttonByText(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  const button = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
}

function locationSelect(mounted: MountedWorkspace): HTMLSelectElement {
  const select = mounted.container.querySelector<HTMLSelectElement>('#installation-location-select')

  if (select === null) {
    throw new Error('Expected installation location select.')
  }

  return select
}

function assignedLocationText(mounted: MountedWorkspace): string {
  const value = mounted.container.querySelector<HTMLElement>(
    '.administration-definition-list strong'
  )

  if (value === null) {
    throw new Error('Expected assigned location value.')
  }

  return value.textContent?.trim() ?? ''
}

function text(mounted: MountedWorkspace): string {
  return mounted.container.textContent ?? ''
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
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
