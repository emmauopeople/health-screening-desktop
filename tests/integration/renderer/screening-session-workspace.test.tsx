// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createScreeningSessionFailure,
  type HealthScreeningApi,
  type LocalUserRole,
  type PublicCurrentScreeningSession,
  type PublicScreeningSession,
  type ScreeningSessionErrorCode
} from '@shared/ipc'
import { ScreeningSessionWorkspace } from '../../../src/renderer/src/app/screening/ScreeningSessionWorkspace'
import type { WorkspaceNavigationGuard } from '../../../src/renderer/src/app/shell/application-shell-types'

type MockedScreeningSessionApi = {
  getWorkspaceContext: ReturnType<
    typeof vi.fn<HealthScreeningApi['screeningSessions']['getWorkspaceContext']>
  >
  ensureCurrent: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['ensureCurrent']>>
  create: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['create']>>
  close: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['close']>>
  reopen: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['reopen']>>
  getById: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['getById']>>
  list: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['list']>>
}

type MockedHealthScreeningApi = HealthScreeningApi & {
  screeningSessions: MockedScreeningSessionApi
}

interface MountedWorkspace {
  readonly api: MockedHealthScreeningApi
  readonly container: HTMLElement
  readonly onAuthenticationFailure: ReturnType<
    typeof vi.fn<(code: ScreeningSessionErrorCode) => void>
  >
  getRegisteredGuard(): WorkspaceNavigationGuard | null
  unmount(): Promise<void>
}

const locationId = '77777777-7777-4777-8777-777777777777'
const secondLocationId = '88888888-8888-4888-8888-888888888888'
const sessionId = '99999999-9999-4999-8999-999999999999'
const protocolVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const deploymentLocalDate = '2026-08-06'
const baseTimestamp = '2026-08-06T08:15:00.000Z'

describe('screening session workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('ensures the current session on entry without using renderer location authority', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledOnce()
    expect(api.screeningSessions.getWorkspaceContext).not.toHaveBeenCalled()
    expect(api.screeningSessions.create).not.toHaveBeenCalled()
    expect(api.screeningSessions.list).toHaveBeenCalledWith({
      locationId,
      status: null,
      dateFrom: deploymentLocalDate,
      dateTo: deploymentLocalDate,
      page: 1,
      pageSize: 25
    })
    expect(text(mounted)).toContain("Today's Screening Session")
    expect(text(mounted)).toContain(deploymentLocalDate)
    expect(text(mounted)).toContain('Configured location')
    expect(text(mounted)).toContain('Bastos Hall')
    expect(text(mounted)).toContain("Today's session is open.")
    expect(text(mounted)).toContain('Selected for this workspace')
    expect(mounted.container.querySelector('select[aria-label="Active screening location"]')).toBe(
      null
    )
    expect(mounted.getRegisteredGuard()?.('PATIENTS_PATIENT_SEARCH')).toBe(true)

    await mounted.unmount()
  })

  it('uses concise loading wording while ensure-current is pending', async () => {
    const contextResult =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['screeningSessions']['ensureCurrent']>>
      >()
    const api = createApi()
    api.screeningSessions.ensureCurrent.mockReturnValueOnce(contextResult.promise)

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain("Resolving today's screening session...")
    expect(text(mounted)).not.toContain('trusted screening-session context')

    contextResult.resolve(
      createIpcSuccess({
        status: 'RESOLVED',
        session: publicCurrentSession(),
        location: { id: locationId, name: 'Bastos Hall' }
      })
    )
    await flushReact()

    await mounted.unmount()
  })

  it('uses only the location returned by the ensure-current boundary', async () => {
    const api = createApi({
      activeLocations: [
        { id: locationId, name: 'Bastos Hall' },
        { id: secondLocationId, name: 'Mendankwe Clinic' }
      ]
    })
    const mounted = await mountWorkspace({ api })

    expect(api.screeningSessions.list).toHaveBeenCalledWith({
      locationId,
      status: null,
      dateFrom: deploymentLocalDate,
      dateTo: deploymentLocalDate,
      page: 1,
      pageSize: 25
    })
    expect(text(mounted)).toContain('Bastos Hall')
    expect(text(mounted)).not.toContain('Mendankwe Clinic')

    await mounted.unmount()
  })

  it('selects a newly created session returned by ensure-current without manual create IPC', async () => {
    const api = createApi()
    const created = publicCurrentSession({ rowVersion: 1 })
    api.screeningSessions.ensureCurrent.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'CREATED',
        session: created,
        location: { id: locationId, name: 'Bastos Hall' }
      })
    )
    api.screeningSessions.list.mockResolvedValue(
      createIpcSuccess({ status: 'LISTED', items: [created], page: 1, pageSize: 25, total: 1 })
    )

    const mounted = await mountWorkspace({ api })

    expect(api.screeningSessions.ensureCurrent).toHaveBeenCalledOnce()
    expect(api.screeningSessions.create).not.toHaveBeenCalled()
    expect(text(mounted)).toContain("Today's screening session is open.")
    expect(text(mounted)).toContain('Selected for this workspace')
    expect(text(mounted)).toContain("Today's session is open.")

    await mounted.unmount()
  })

  it('shows controlled ensure-current failures and avoids list or create effects', async () => {
    const api = createApi()
    api.screeningSessions.ensureCurrent.mockResolvedValueOnce(
      createIpcSuccess({ status: 'LOCATION_NOT_CONFIGURED' })
    )

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain(
      'This installation does not have a configured screening location.'
    )
    expect(api.screeningSessions.list).not.toHaveBeenCalled()
    expect(api.screeningSessions.create).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('closes and reopens with the current row version and no optimistic success state', async () => {
    const open = publicCurrentSession()
    const closed = publicSession({
      status: 'CLOSED',
      closedAt: '2026-08-06T15:00:00.000Z',
      rowVersion: 2
    })
    const reopened = publicSession({
      status: 'OPEN',
      closedAt: null,
      rowVersion: 3,
      openedAt: '2026-08-06T15:30:00.000Z'
    })
    const api = createApi({ listItems: [open] })
    api.screeningSessions.ensureCurrent.mockResolvedValue(
      createIpcSuccess({
        status: 'RESOLVED',
        session: open,
        location: { id: locationId, name: 'Bastos Hall' }
      })
    )
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: open })
    )
    api.screeningSessions.close.mockResolvedValueOnce(
      createIpcSuccess({ status: 'CLOSED', session: closed })
    )
    api.screeningSessions.reopen.mockResolvedValueOnce(
      createIpcSuccess({ status: 'REOPENED', session: reopened })
    )
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [closed], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [reopened], page: 1, pageSize: 25, total: 1 })
      )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Close session')
    expect(text(mounted)).toContain('Close Bastos Hall on 2026-08-06')
    expect(text(mounted)).toContain('Open')
    await clickDialogButton(mounted, 'Close session')

    expect(api.screeningSessions.close).toHaveBeenCalledWith({
      id: sessionId,
      expectedRowVersion: 1,
      reason: null
    })
    expect(text(mounted)).toContain('Screening session closed.')
    expect(text(mounted)).toContain('Closed')
    expect(text(mounted)).toContain('Not selected')
    expect(text(mounted)).toContain("Today's session is closed.")

    await clickButton(mounted, 'Reopen session')
    await clickDialogButton(mounted, 'Reopen session')
    expect(api.screeningSessions.reopen).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Reopen reason is required.')

    await changeTextarea(textareaByLabel(mounted, 'Reopen reason required'), 'Closed in error')
    await clickDialogButton(mounted, 'Reopen session')

    expect(api.screeningSessions.reopen).toHaveBeenCalledWith({
      id: sessionId,
      expectedRowVersion: 2,
      reason: 'Closed in error'
    })
    expect(text(mounted)).toContain('Screening session reopened.')
    expect(text(mounted)).toContain('Selected for this workspace')

    await mounted.unmount()
  })

  it('clears selected and active session state when authoritative results remove it', async () => {
    const open = publicCurrentSession()
    const api = createApi({ listItems: [open] })
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [], page: 1, pageSize: 25, total: 0 })
      )
    api.screeningSessions.getById.mockResolvedValueOnce(createIpcSuccess({ status: 'NOT_FOUND' }))

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('Selected for this workspace')

    await clickButton(mounted, 'Refresh')

    expect(api.screeningSessions.getById).toHaveBeenCalledWith({ id: sessionId })
    expect(text(mounted)).not.toContain('Selected for this workspace')
    expect(text(mounted)).not.toContain('Current row version')
    expect(text(mounted)).toContain("Today's screening session is not available.")

    await mounted.unmount()
  })

  it('allows a current-date open session for the selected location to become active', async () => {
    const open = publicSession()
    const api = createApi({ listItems: [open] })
    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain("Today's session is open.")
    expect(text(mounted)).toContain('Selected for this workspace')
    expect(buttonByText(mounted, 'Select session').disabled).toBe(false)

    await clickButton(mounted, 'Select session')

    expect(text(mounted)).toContain('Session selected.')
    expect(text(mounted)).toContain('Selected for this workspace')

    await mounted.unmount()
  })

  it('keeps a historical open session inspectable without making it active', async () => {
    const historicalOpen = publicSession({ sessionDate: '2026-08-05' })
    const api = createApi({ listItems: [historicalOpen] })
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: historicalOpen })
    )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Inspect')

    expect(text(mounted)).toContain('2026-08-05')
    expect(text(mounted)).toContain('Current row version')
    expect(text(mounted)).toContain('Not selected')
    expect(buttonByText(mounted, 'Select session').disabled).toBe(true)
    expect(text(mounted)).not.toContain('Selected for this workspace')

    await mounted.unmount()
  })

  it('keeps a missing current-page session when getById confirms it is still valid', async () => {
    const open = publicSession()
    const api = createApi({ listItems: [open] })
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [], page: 2, pageSize: 25, total: 26 })
      )
    api.screeningSessions.getById.mockResolvedValueOnce(
      createIpcSuccess({ status: 'FOUND', session: open })
    )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Select session')
    expect(text(mounted)).toContain('Selected for this workspace')

    await clickButton(mounted, 'Refresh')

    expect(api.screeningSessions.getById).toHaveBeenCalledWith({ id: sessionId })
    expect(text(mounted)).toContain('Selected for this workspace')
    expect(text(mounted)).toContain('Current row version')

    await mounted.unmount()
  })

  it('does not activate a historical session during pagination reconciliation', async () => {
    const historicalOpen = publicSession({ sessionDate: '2026-08-05' })
    const api = createApi({ listItems: [historicalOpen] })
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'LISTED',
          items: [historicalOpen],
          page: 1,
          pageSize: 25,
          total: 26
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [], page: 2, pageSize: 25, total: 26 })
      )
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: historicalOpen })
    )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Inspect')
    expect(text(mounted)).toContain('Not selected')

    await clickButton(mounted, 'Refresh')

    expect(api.screeningSessions.getById).toHaveBeenCalledWith({ id: sessionId })
    expect(text(mounted)).toContain('2026-08-05')
    expect(text(mounted)).toContain('Current row version')
    expect(text(mounted)).toContain('Not selected')
    expect(buttonByText(mounted, 'Select session').disabled).toBe(true)

    await mounted.unmount()
  })

  it('allows only an open session to become active while closed sessions remain inspectable', async () => {
    const closed = publicSession({
      status: 'CLOSED',
      closedAt: '2026-08-06T15:00:00.000Z',
      rowVersion: 2
    })
    const api = createApi({ listItems: [closed] })
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: closed })
    )

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain("Today's session is closed.")
    expect(text(mounted)).toContain('Current row version')
    expect(text(mounted)).toContain('Not selected')
    expect(buttonByText(mounted, 'Select session').disabled).toBe(true)

    await mounted.unmount()
  })

  it('revalidates and clears an incompatible active session after deployment-local date rollover', async () => {
    const open = publicCurrentSession()
    const rolloverDate = '2026-08-07'
    const rolloverSession = publicCurrentSession({ sessionDate: rolloverDate, rowVersion: 2 })
    const api = createApi({ listItems: [open] })
    api.screeningSessions.ensureCurrent
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'RESOLVED',
          session: open,
          location: { id: locationId, name: 'Bastos Hall' }
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'RESOLVED',
          session: rolloverSession,
          location: { id: locationId, name: 'Bastos Hall' }
        })
      )
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'LISTED',
          items: [rolloverSession],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('Selected for this workspace')

    await clickButton(mounted, 'Refresh')

    expect(text(mounted)).toContain(rolloverDate)
    expect(text(mounted)).toContain('Selected for this workspace')
    expect(text(mounted)).toContain('Current row version')

    await mounted.unmount()
  })

  it('does not make a reopened historical session active', async () => {
    const historicalClosed = publicSession({
      sessionDate: '2026-08-05',
      status: 'CLOSED',
      closedAt: '2026-08-05T15:00:00.000Z',
      rowVersion: 2
    })
    const historicalReopened = publicSession({
      sessionDate: '2026-08-05',
      rowVersion: 3,
      openedAt: '2026-08-05T15:30:00.000Z'
    })
    const api = createApi({ listItems: [historicalClosed] })
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: historicalClosed })
    )
    api.screeningSessions.reopen.mockResolvedValueOnce(
      createIpcSuccess({ status: 'REOPENED', session: historicalReopened })
    )
    api.screeningSessions.list.mockResolvedValue(
      createIpcSuccess({
        status: 'LISTED',
        items: [historicalReopened],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Inspect')
    await clickButton(mounted, 'Reopen session')
    await changeTextarea(textareaByLabel(mounted, 'Reopen reason required'), 'Correcting closure')
    await clickDialogButton(mounted, 'Reopen session')

    expect(api.screeningSessions.reopen).toHaveBeenCalledWith({
      id: sessionId,
      expectedRowVersion: 2,
      reason: 'Correcting closure'
    })
    expect(text(mounted)).toContain('Screening session reopened.')
    expect(text(mounted)).toContain('2026-08-05')
    expect(text(mounted)).toContain('Not selected')
    expect(buttonByText(mounted, 'Select session').disabled).toBe(true)

    await mounted.unmount()
  })

  it('updates today-dependent filters after ensure-current date rollover', async () => {
    const rolloverDate = '2026-08-07'
    const open = publicCurrentSession()
    const rolloverSession = publicCurrentSession({ sessionDate: rolloverDate, rowVersion: 2 })
    const api = createApi()
    api.screeningSessions.ensureCurrent
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'RESOLVED',
          session: open,
          location: { id: locationId, name: 'Bastos Hall' }
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'RESOLVED',
          session: rolloverSession,
          location: { id: locationId, name: 'Bastos Hall' }
        })
      )
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'LISTED',
          items: [rolloverSession],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })

    await changeSelect(selectByLabel(mounted, 'Status'), 'CLOSED')
    await clickButton(mounted, 'Refresh')

    expect(text(mounted)).toContain(rolloverDate)
    expect(api.screeningSessions.list).toHaveBeenLastCalledWith({
      locationId,
      status: null,
      dateFrom: rolloverDate,
      dateTo: rolloverDate,
      page: 1,
      pageSize: 25
    })

    expect(api.screeningSessions.create).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('uses the trusted ensure-current date instead of the renderer or operating-system clock', async () => {
    const api = createApi({ deploymentLocalDate: '2030-01-02' })
    const mounted = await mountWorkspace({ api })

    expect(api.screeningSessions.list).toHaveBeenCalledWith({
      locationId,
      status: null,
      dateFrom: '2030-01-02',
      dateTo: '2030-01-02',
      page: 1,
      pageSize: 25
    })
    expect(api.screeningSessions.create).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('handles close version conflicts by requiring explicit retry with the latest row version', async () => {
    const open = publicSession()
    const latest = publicSession({ rowVersion: 2, notes: 'Updated by another workstation' })
    const closed = publicSession({
      status: 'CLOSED',
      notes: 'Updated by another workstation',
      closedAt: '2026-08-06T15:00:00.000Z',
      rowVersion: 3
    })
    const api = createApi({ listItems: [open] })
    api.screeningSessions.close
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'SESSION_VERSION_CONFLICT', session: latest })
      )
      .mockResolvedValueOnce(createIpcSuccess({ status: 'CLOSED', session: closed }))
    api.screeningSessions.list
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [open], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [latest], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'LISTED', items: [closed], page: 1, pageSize: 25, total: 1 })
      )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Close session')
    await clickDialogButton(mounted, 'Close session')

    expect(api.screeningSessions.close).toHaveBeenCalledTimes(1)
    expect(text(mounted)).toContain('This screening session changed')
    expect(text(mounted)).toContain('Updated by another workstation')

    await clickButton(mounted, 'Close session')
    await clickDialogButton(mounted, 'Close session')

    expect(api.screeningSessions.close).toHaveBeenLastCalledWith({
      id: sessionId,
      expectedRowVersion: 2,
      reason: null
    })
    expect(text(mounted)).toContain('Screening session closed.')

    await mounted.unmount()
  })

  it('prevents trained screeners from activating reopen from the UI', async () => {
    const closed = publicSession({
      status: 'CLOSED',
      closedAt: '2026-08-06T15:00:00.000Z',
      rowVersion: 2
    })
    const api = createApi({ listItems: [closed] })
    api.screeningSessions.getById.mockResolvedValue(
      createIpcSuccess({ status: 'FOUND', session: closed })
    )

    const mounted = await mountWorkspace({ api, userRole: 'TRAINED_SCREENER' })

    const reopenButton = buttonByText(mounted, 'Reopen session')
    expect(reopenButton.disabled).toBe(true)
    expect(text(mounted)).toContain(
      'Only nurses and local administrators can reopen a closed session.'
    )
    expect(api.screeningSessions.reopen).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('uses concise unavailable wording for patient enrollment', async () => {
    const open = publicSession()
    const api = createApi({ listItems: [open] })
    const mounted = await mountWorkspace({ api, commandId: 'SCREENING_NEW_SCREENING' })

    expect(text(mounted)).toContain('Patient enrollment is not available yet.')
    expect(text(mounted)).not.toContain('approved screening workflow checkpoint')

    await clickButton(mounted, 'New Screening')

    expect(text(mounted)).toContain('Patient enrollment is not available yet.')
    expect(text(mounted)).not.toContain('checkpoint')

    await mounted.unmount()
  })

  it('clears workspace state for protected failures without rendering raw details', async () => {
    const api = createApi()
    api.screeningSessions.ensureCurrent.mockResolvedValueOnce(
      createScreeningSessionFailure('IPC_FORBIDDEN')
    )

    const mounted = await mountWorkspace({ api })

    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(text(mounted)).toContain('This window is not allowed to manage screening sessions.')
    expect(text(mounted)).not.toContain(deploymentLocalDate)
    expect(text(mounted)).not.toContain('Bastos Hall')
    expect(text(mounted)).not.toContain(sessionId)
    expect(text(mounted)).not.toContain('SELECT')
    expect(text(mounted)).not.toContain('sqlite')

    await mounted.unmount()
  })

  it('uses only in-memory state and introduces no browser persistence', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem')
    const api = createApi()
    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Refresh')

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()

    await mounted.unmount()
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
  const onAuthenticationFailure = vi.fn<(code: ScreeningSessionErrorCode) => void>()

  await act(async () => {
    root.render(
      createElement(ScreeningSessionWorkspace, {
        api,
        commandId,
        headingId: 'screening-workspace-heading',
        headingRef,
        userRole,
        onScreeningSessionAuthenticationFailure: onAuthenticationFailure,
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
  listItems,
  deploymentLocalDate: workspaceDate = deploymentLocalDate
}: {
  readonly activeLocations?: readonly { readonly id: string; readonly name: string }[]
  readonly listItems?: readonly PublicScreeningSession[]
  readonly deploymentLocalDate?: string
} = {}): MockedHealthScreeningApi {
  const ensuredLocation = activeLocations[0] ?? { id: locationId, name: 'Bastos Hall' }
  const ensuredSession = publicCurrentSession({
    locationId: ensuredLocation.id,
    sessionDate: workspaceDate
  })
  const listedSessions = listItems ?? [ensuredSession]

  return {
    screeningSessions: {
      getWorkspaceContext: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ deploymentLocalDate: workspaceDate, activeLocations }))
      ),
      ensureCurrent: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'RESOLVED',
            session: ensuredSession,
            location: ensuredLocation
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
            items: listedSessions,
            page: 1,
            pageSize: 25,
            total: listedSessions.length
          })
        )
      )
    }
  } as unknown as MockedHealthScreeningApi
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

function publicCurrentSession(
  overrides: Partial<PublicCurrentScreeningSession> = {}
): PublicCurrentScreeningSession {
  return {
    ...publicSession(),
    ...overrides,
    status: 'OPEN',
    closedAt: null
  }
}

async function clickButton(mounted: MountedWorkspace, label: string): Promise<void> {
  await act(async () => {
    buttonByText(mounted, label).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
    await flushPromises()
  })
  await flushReact()
}

async function clickDialogButton(mounted: MountedWorkspace, label: string): Promise<void> {
  const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]')

  if (dialog === null) {
    throw new Error('Expected dialog to be rendered.')
  }

  await act(async () => {
    buttonByTextWithin(dialog, label).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
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

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
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

function selectByLabel(mounted: MountedWorkspace, label: string): HTMLSelectElement {
  const select = labeledControl<HTMLSelectElement>(mounted, label, 'select')

  if (select === null) {
    throw new Error(`Expected select ${label}`)
  }

  return select
}

function textareaByLabel(mounted: MountedWorkspace, label: string): HTMLTextAreaElement {
  const textarea = labeledControl<HTMLTextAreaElement>(mounted, label, 'textarea')

  if (textarea === null) {
    throw new Error(`Expected textarea ${label}`)
  }

  return textarea
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
