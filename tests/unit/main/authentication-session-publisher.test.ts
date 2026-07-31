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

    publisher.publish(activeSession)

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

      publisher.publish(activeSession)
      expect(destroyedTarget.send).not.toHaveBeenCalled()
      expect(unauthorizedTarget.send).not.toHaveBeenCalled()
    }
  })

  it('drops malformed payloads and stops after disposal', () => {
    const target = createTarget('http://localhost:5173/')
    const publisher = createAuthenticationSessionPublisher({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      getWebContents: () => target
    })

    publisher.publish({
      ...activeSession,
      user: {
        ...activeSession.user,
        id: '22222222-2222-4222-8222-222222222222'
      }
    } as unknown as PublicAuthenticationSession)
    publisher.dispose()
    publisher.publish(activeSession)

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
