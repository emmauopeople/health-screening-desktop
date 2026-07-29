export type CspDirectives = ReadonlyArray<readonly [directive: string, sources: readonly string[]]>

export const contentSecurityPolicyHeaderName = 'Content-Security-Policy'

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
    ['script-src', ["'self'"]],
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
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy\b))[^>]*>\s*/gi
  const htmlWithoutExistingCsp = html.replace(cspMetaPattern, '')
  const meta = `    <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}" />`
  const headMatch = /<head\b[^>]*>/i.exec(htmlWithoutExistingCsp)

  if (!headMatch) {
    throw new ContentSecurityPolicyInjectionError(
      'Renderer HTML must include a head element for CSP injection.'
    )
  }

  const insertionIndex = headMatch.index + headMatch[0].length

  return `${htmlWithoutExistingCsp.slice(0, insertionIndex)}\n${meta}${htmlWithoutExistingCsp.slice(insertionIndex)}`
}

export class ContentSecurityPolicyInjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentSecurityPolicyInjectionError'
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
