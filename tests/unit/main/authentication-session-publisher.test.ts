import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createAuthenticationSessionPublisher,
  type AuthenticationSessionPublishTarget
} from '@main/ipc/authentication'
import {
  ipcChannels,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession
} from '@shared/ipc'

const activeSession: PublicActiveAuthenticationSession = {
  status: 'ACTIVE',
  user: {
    username: 'Admin.User',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN'
  },
  idleExpiresAt: '2026-07-31T12:15:00.000Z' as never,
  absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
  revision: 2
}

describe('authentication session publisher', () => {
  it('sends validated public session events only to the authorized main frame', () => {
    const target = createTarget('http://localhost:5173/')
    const publisher = createAuthenticationSessionPublisher({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      getWebContents: () => target
    })

    expect(publisher.publish(activeSession)).toBe(true)

    expect(target.send).toHaveBeenCalledWith(ipcChannels.auth.sessionChanged, activeSession)
  })

  it('drops destroyed, missing, unauthorized, and malformed targets without broadcasting', () => {
    const destroyedTarget = createTarget('http://localhost:5173/', true)
    const unauthorizedTarget = createTarget('https://example.invalid/')

    for (const target of [null, destroyedTarget, unauthorizedTarget]) {
      const publisher = createAuthenticationSessionPublisher({
        navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
        getWebContents: () => target
      })

      expect(publisher.publish(activeSession)).toBe(false)
      expect(destroyedTarget.send).not.toHaveBeenCalled()
      expect(unauthorizedTarget.send).not.toHaveBeenCalled()
    }
  })

  it('contains target lookup, property access, and send failures as failed delivery', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')
    const throwingMainFrameTarget = {
      get mainFrame() {
        throw new Error('C:\\secret\\mainFrame')
      },
      isDestroyed: () => false,
      send: vi.fn<(channel: string, payload: unknown) => void>()
    } as unknown as AuthenticationSessionPublishTarget & { send: ReturnType<typeof vi.fn> }
    const throwingUrlTarget = {
      mainFrame: {
        get url() {
          throw new Error('C:\\secret\\url')
        }
      },
      isDestroyed: () => false,
      send: vi.fn<(channel: string, payload: unknown) => void>()
    } as unknown as AuthenticationSessionPublishTarget & { send: ReturnType<typeof vi.fn> }
    const throwingIsDestroyedTarget = {
      mainFrame: { url: 'http://localhost:5173/' },
      get isDestroyed() {
        throw new Error('C:\\secret\\destroyed')
      },
      send: vi.fn<(channel: string, payload: unknown) => void>()
    } as unknown as AuthenticationSessionPublishTarget & { send: ReturnType<typeof vi.fn> }
    const throwingSendTarget = createTarget('http://localhost:5173/')
    throwingSendTarget.send.mockImplementationOnce(() => {
      throw new Error('C:\\secret\\send')
    })

    expect(
      createAuthenticationSessionPublisher({
        navigationPolicy: policy,
        getWebContents: () => {
          throw new Error('C:\\secret\\webContents')
        }
      }).publish(activeSession)
    ).toBe(false)
    expect(
      createAuthenticationSessionPublisher({
        navigationPolicy: policy,
        getWebContents: () => throwingMainFrameTarget
      }).publish(activeSession)
    ).toBe(false)
    expect(
      createAuthenticationSessionPublisher({
        navigationPolicy: policy,
        getWebContents: () => throwingUrlTarget
      }).publish(activeSession)
    ).toBe(false)
    expect(
      createAuthenticationSessionPublisher({
        navigationPolicy: policy,
        getWebContents: () => throwingIsDestroyedTarget
      }).publish(activeSession)
    ).toBe(false)
    expect(
      createAuthenticationSessionPublisher({
        navigationPolicy: policy,
        getWebContents: () => throwingSendTarget
      }).publish(activeSession)
    ).toBe(false)
  })

  it('drops malformed payloads and stops after disposal', () => {
    const target = createTarget('http://localhost:5173/')
    const publisher = createAuthenticationSessionPublisher({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      getWebContents: () => target
    })

    expect(
      publisher.publish({
        ...activeSession,
        user: {
          ...activeSession.user,
          id: '22222222-2222-4222-8222-222222222222'
        }
      } as unknown as PublicAuthenticationSession)
    ).toBe(false)
    publisher.dispose()
    expect(publisher.publish(activeSession)).toBe(false)

    expect(target.send).not.toHaveBeenCalled()
  })
})

function createTarget(
  url: string,
  destroyed = false
): AuthenticationSessionPublishTarget & {
  send: ReturnType<typeof vi.fn>
} {
  return {
    mainFrame: { url },
    isDestroyed: () => destroyed,
    send: vi.fn<(channel: string, payload: unknown) => void>()
  }
}
