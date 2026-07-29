export type CspDirectives = ReadonlyArray<readonly [directive: string, sources: readonly string[]]>

export const contentSecurityPolicyHeaderName = 'Content-Security-Policy'
export const viteDevelopmentCspNonce = 'health-screening-vite-dev'

const baseDirectives = [
  ['default-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]],
  ['object-src', ["'none'"]],
  ['frame-src', ["'none'"]],
  ['script-src', ["'self'"]],
  ['img-src', ["'self'", 'data:']],
  ['font-src', ["'self'"]],
  ['worker-src', ["'none'"]],
  ['media-src', ["'none'"]],
  ['manifest-src', ["'none'"]]
] as const

export function createProductionContentSecurityPolicy(): string {
  return serializeContentSecurityPolicy([
    ...baseDirectives.slice(0, 6),
    ['style-src', ["'self'"]],
    ...baseDirectives.slice(6, 8),
    ['connect-src', ["'none'"]],
    ...baseDirectives.slice(8)
  ])
}

export function createDevelopmentContentSecurityPolicy(rendererUrl: string): string {
  return serializeContentSecurityPolicy([
    ...baseDirectives.slice(0, 5),
    ['script-src', ["'self'", `'nonce-${viteDevelopmentCspNonce}'`]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ...baseDirectives.slice(6, 8),
    ['connect-src', ["'self'", createViteWebSocketOrigin(rendererUrl)]],
    ...baseDirectives.slice(8)
  ])
}

export function createViteWebSocketOrigin(rendererUrl: string): string {
  const url = new URL(rendererUrl)

  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.origin
  }

  if (url.protocol === 'https:') {
    url.protocol = 'wss:'
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.origin
  }

  throw new Error('Development renderer URL must use HTTP(S) for CSP.')
}

export function serializeContentSecurityPolicy(directives: CspDirectives): string {
  return directives.map(([directive, sources]) => `${directive} ${sources.join(' ')}`).join(';')
}

export type ResponseHeaders = Record<string, string[] | string | undefined>

export function withContentSecurityPolicyHeader(
  responseHeaders: ResponseHeaders | undefined,
  policy: string
): Record<string, string[]> {
  const nextHeaders: Record<string, string[]> = {}

  for (const [name, value] of Object.entries(responseHeaders ?? {})) {
    if (name.toLowerCase() === contentSecurityPolicyHeaderName.toLowerCase()) {
      continue
    }

    if (Array.isArray(value)) {
      nextHeaders[name] = value
      continue
    }

    if (typeof value === 'string') {
      nextHeaders[name] = [value]
    }
  }

  nextHeaders[contentSecurityPolicyHeaderName] = [policy]

  return nextHeaders
}

export function injectContentSecurityPolicyMeta(html: string, policy: string): string {
  const cspMetaPattern =
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'])[^>]*>\s*/gi
  const htmlWithoutExistingCsp = html.replace(cspMetaPattern, '')
  const meta = `    <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}" />`

  return htmlWithoutExistingCsp.replace(/<head>/i, `<head>\n${meta}`)
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
