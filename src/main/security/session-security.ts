import type { Session, WebRequestFilter } from 'electron'

import {
  createDevelopmentContentSecurityPolicy,
  withContentSecurityPolicyHeader
} from '@main/security/content-security-policy'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'

export interface SessionSecurityConfiguration {
  isDevelopment: boolean
  rendererUrl?: string
}

export function configureSessionSecurity(
  targetSession: Session,
  configuration: SessionSecurityConfiguration
): void {
  targetSession.setPermissionCheckHandler((_webContents, permission) =>
    isSessionPermissionAllowed(permission)
  )
  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isSessionPermissionAllowed(permission))
  })

  if (configuration.isDevelopment) {
    if (!configuration.rendererUrl) {
      throw new Error('Development renderer URL is required for session CSP.')
    }

    installDevelopmentContentSecurityPolicy(targetSession, configuration.rendererUrl)
  }
}

export function isSessionPermissionAllowed(permission: string): false {
  void permission

  return false
}

export function createDevelopmentContentSecurityPolicyFilter(
  rendererUrl: string
): WebRequestFilter {
  const policy = createDevelopmentNavigationPolicy(rendererUrl)

  if (policy.mode !== 'development') {
    throw new Error('Development renderer URL must create a development navigation policy.')
  }

  return {
    urls: [`${policy.allowedOrigin}/*`]
  }
}

function installDevelopmentContentSecurityPolicy(
  targetSession: Session,
  rendererUrl: string
): void {
  const policy = createDevelopmentContentSecurityPolicy(rendererUrl)
  const filter = createDevelopmentContentSecurityPolicyFilter(rendererUrl)

  targetSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({
      responseHeaders: withContentSecurityPolicyHeader(details.responseHeaders, policy)
    })
  })
}
