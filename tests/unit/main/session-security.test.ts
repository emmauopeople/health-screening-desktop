import { describe, expect, it, vi } from 'vitest'
import type { Session, WebRequestFilter } from 'electron'

import { createDevelopmentContentSecurityPolicy } from '@main/security/content-security-policy'

import {
  configureSessionSecurity,
  createDevelopmentContentSecurityPolicyFilter,
  isSessionPermissionAllowed
} from '@main/security/session-security'

type PermissionCheckHandler = (webContents: unknown, permission: string) => boolean
type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (allowed: boolean) => void
) => void
type HeadersReceivedListener = (
  details: { responseHeaders?: Record<string, string[] | string | undefined> },
  callback: (response: { responseHeaders: Record<string, string[]> }) => void
) => void

interface MockSession {
  setPermissionCheckHandler: ReturnType<typeof vi.fn>
  setPermissionRequestHandler: ReturnType<typeof vi.fn>
  webRequest: {
    onHeadersReceived: ReturnType<typeof vi.fn>
  }
}

describe('session security policy', () => {
  it.each([
    'notifications',
    'geolocation',
    'media',
    'clipboard-read',
    'display-capture',
    'midi',
    'serial',
    'hid',
    'usb',
    'bluetooth',
    'unknown-future-permission'
  ])('denies %s permission by default', (permission) => {
    expect(isSessionPermissionAllowed(permission)).toBe(false)
  })

  it('denies permission requests through the same decision helper', () => {
    const callback = vi.fn()

    callback(isSessionPermissionAllowed('unknown'))

    expect(callback).toHaveBeenCalledWith(false)
  })

  it('limits the development CSP header filter to the exact renderer origin', () => {
    expect(createDevelopmentContentSecurityPolicyFilter('http://localhost:5173/')).toEqual({
      urls: ['http://localhost:5173/*']
    })
    expect(createDevelopmentContentSecurityPolicyFilter('http://[::1]:5173/')).toEqual({
      urls: ['http://[::1]:5173/*']
    })
  })

  it('configures production permission denial without a response-header listener', () => {
    const targetSession = createMockSession()

    configureSessionSecurity(targetSession, { isDevelopment: false })

    expect(targetSession.setPermissionCheckHandler).toHaveBeenCalledOnce()
    expect(targetSession.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(targetSession.webRequest.onHeadersReceived).not.toHaveBeenCalled()

    const checkHandler = targetSession.setPermissionCheckHandler.mock
      .calls[0]?.[0] as PermissionCheckHandler
    const requestHandler = targetSession.setPermissionRequestHandler.mock
      .calls[0]?.[0] as PermissionRequestHandler
    const permissionCallback = vi.fn()

    expect(checkHandler(undefined, 'notifications')).toBe(false)
    requestHandler(undefined, 'geolocation', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
  })

  it('installs the development CSP header listener for only the renderer origin', () => {
    const targetSession = createMockSession()

    configureSessionSecurity(targetSession, {
      isDevelopment: true,
      rendererUrl: 'http://localhost:5173/'
    })

    expect(targetSession.webRequest.onHeadersReceived).toHaveBeenCalledOnce()

    const [filter, listener] = targetSession.webRequest.onHeadersReceived.mock.calls[0] as [
      WebRequestFilter,
      HeadersReceivedListener
    ]
    const callback = vi.fn()

    expect(filter).toEqual({ urls: ['http://localhost:5173/*'] })

    listener(
      {
        responseHeaders: {
          'content-security-policy': ["default-src 'self'"],
          'X-Test': ['kept']
        }
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Test': ['kept'],
        'Content-Security-Policy': [
          createDevelopmentContentSecurityPolicy('http://localhost:5173/')
        ]
      }
    })
  })
})

function createMockSession(): MockSession & Session {
  return {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    webRequest: {
      onHeadersReceived: vi.fn()
    }
  } as unknown as MockSession & Session
}
