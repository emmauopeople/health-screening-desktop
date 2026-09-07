// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SynchronizationAdministrationWorkspace } from '../../../src/renderer/src/app/administration/SynchronizationAdministrationWorkspace'
import {
  createIpcSuccess,
  createSyncAdministrationFailure,
  type HealthScreeningApi,
  type SyncAdministrationErrorCode
} from '@shared/ipc'

const token = `chs_inst_v1_${'A'.repeat(43)}`
const now = '2026-09-04T12:00:00.000Z'

describe('synchronization administration workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders a minimum-necessary automatic synchronization summary', async () => {
    const mounted = await mountWorkspace()
    expect(mounted.container.textContent).toContain('Synchronization Center')
    expect(mounted.container.textContent).toContain('Retry scheduled')
    expect(mounted.container.textContent).toContain('Pending changes3')
    expect(mounted.container.textContent).toContain('Pending acknowledgments1')
    expect(mounted.container.textContent).toContain('Central serverNot configured')
    expect(mounted.container.textContent).toContain('There is no manual sync action.')
    expect(mounted.container.textContent).not.toContain(token)
    expect(mounted.container.querySelector('button')?.textContent).not.toBe('Run sync')
    await mounted.unmount()
  })

  it('configures the protected transport and clears the entered credential', async () => {
    const mounted = await mountWorkspace()
    await click(mounted.container, 'Configure')
    const url = mounted.container.querySelector<HTMLInputElement>('#sync-api-base-url')
    const credential = mounted.container.querySelector<HTMLInputElement>('#sync-installation-token')
    expect(url).not.toBeNull()
    expect(credential?.type).toBe('password')
    await change(url!, 'https://sync.example.org')
    await change(credential!, token)
    await click(mounted.container, 'Save configuration')

    expect(mounted.api.syncAdministration.configure).toHaveBeenCalledWith({
      apiBaseUrl: 'https://sync.example.org',
      installationToken: token
    })
    expect(mounted.container.querySelector('#sync-installation-token')).toBeNull()
    expect(mounted.container.textContent).toContain('https://sync.example.org')
    expect(mounted.container.textContent).toContain(`${token.slice(0, 20)}…`)
    expect(mounted.container.textContent).not.toContain(token)
    expect(mounted.container.textContent).toContain(
      'Background synchronization will continue automatically.'
    )
    await mounted.unmount()
  })

  it('keeps secure-storage and authorization failures bounded', async () => {
    const mounted = await mountWorkspace()
    mounted.api.syncAdministration.configure.mockResolvedValueOnce(
      createSyncAdministrationFailure('PROTECTION_UNAVAILABLE')
    )
    await click(mounted.container, 'Configure')
    await change(mounted.container.querySelector('#sync-api-base-url')!, 'https://sync.example.org')
    await change(mounted.container.querySelector('#sync-installation-token')!, token)
    await click(mounted.container, 'Save configuration')
    expect(mounted.container.textContent).toContain('Secure credential storage is unavailable')
    expect(mounted.container.textContent).not.toContain(token)
    await mounted.unmount()

    const nurse = await mountWorkspace('NURSE')
    expect(nurse.container.textContent).toContain(
      'Only local administrators can manage synchronization.'
    )
    expect(nurse.api.syncAdministration.getState).not.toHaveBeenCalled()
    await nurse.unmount()
  })
})

type MockApi = HealthScreeningApi & {
  syncAdministration: {
    getState: ReturnType<typeof vi.fn<HealthScreeningApi['syncAdministration']['getState']>>
    configure: ReturnType<typeof vi.fn<HealthScreeningApi['syncAdministration']['configure']>>
  }
}

interface MountedWorkspace {
  readonly api: MockApi
  readonly container: HTMLElement
  unmount(): Promise<void>
}

async function mountWorkspace(
  role: 'LOCAL_ADMIN' | 'NURSE' = 'LOCAL_ADMIN'
): Promise<MountedWorkspace> {
  const api = createApi()
  const onAuthenticationFailure = vi.fn<(code: SyncAdministrationErrorCode) => void>()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(SynchronizationAdministrationWorkspace, {
        api,
        headingId: 'heading',
        headingRef: createRef<HTMLHeadingElement>(),
        userRole: role,
        onAuthenticationFailure
      })
    )
  })
  await flush()
  return {
    api,
    container,
    async unmount(): Promise<void> {
      await act(async () => root.unmount())
    }
  }
}

function createApi(): MockApi {
  return {
    syncAdministration: {
      getState: vi.fn(async () =>
        createIpcSuccess({
          status: 'READY' as const,
          configuration: { status: 'NOT_CONFIGURED' as const },
          activity: {
            state: 'RETRY_SCHEDULED' as const,
            pendingChangeCount: 3,
            pendingAcknowledgmentCount: 1,
            lastSuccessfulSyncAt: null,
            nextRetryAt: '2026-09-04T12:05:00.000Z'
          }
        })
      ),
      configure: vi.fn(async () =>
        createIpcSuccess({
          status: 'CONFIGURED' as const,
          configuration: {
            status: 'CONFIGURED' as const,
            apiBaseUrl: 'https://sync.example.org',
            tokenPrefix: token.slice(0, 20),
            updatedAt: now
          }
        })
      )
    }
  } as unknown as MockApi
}

async function click(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label
  )
  if (button === undefined) throw new Error(`Missing button: ${label}`)
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
}

async function change(input: Element, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
