import { pathToFileURL } from 'node:url'

const allowedDevelopmentProtocols = new Set(['http:', 'https:'])
const allowedDevelopmentHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export type NavigationPolicy =
  | {
      mode: 'development'
      applicationUrl: string
      allowedOrigin: string
    }
  | {
      mode: 'production'
      applicationUrl: string
    }

export interface RendererNavigationPolicyInput {
  isDevelopment: boolean
  rendererIndexPath: string
  rendererUrl?: string
}

export function createRendererNavigationPolicy({
  isDevelopment,
  rendererIndexPath,
  rendererUrl
}: RendererNavigationPolicyInput): NavigationPolicy {
  if (isDevelopment) {
    if (!rendererUrl) {
      throw new Error('Development renderer URL is not configured.')
    }

    return createDevelopmentNavigationPolicy(rendererUrl)
  }

  return createProductionNavigationPolicy(rendererIndexPath)
}

export function createDevelopmentNavigationPolicy(rendererUrl: string): NavigationPolicy {
  const applicationUrl = parseUrl(rendererUrl)

  if (!applicationUrl || !isLoopbackHttpUrl(applicationUrl)) {
    throw new Error('Development renderer URL must use an HTTP(S) loopback origin.')
  }

  return {
    mode: 'development',
    applicationUrl: applicationUrl.href,
    allowedOrigin: applicationUrl.origin
  }
}

export function createProductionNavigationPolicy(rendererIndexPath: string): NavigationPolicy {
  return {
    mode: 'production',
    applicationUrl: pathToFileURL(rendererIndexPath).href
  }
}

export function isNavigationAllowed(navigationUrl: string, policy: NavigationPolicy): boolean {
  const targetUrl = parseUrl(navigationUrl)

  if (!targetUrl) {
    return false
  }

  if (policy.mode === 'development') {
    return targetUrl.origin === policy.allowedOrigin
  }

  if (targetUrl.protocol !== 'file:') {
    return false
  }

  return sameDocumentUrl(targetUrl.href) === sameDocumentUrl(policy.applicationUrl)
}

function isLoopbackHttpUrl(url: URL): boolean {
  return allowedDevelopmentProtocols.has(url.protocol) && allowedDevelopmentHosts.has(url.hostname)
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function sameDocumentUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.href
}
