import { describe, expect, it } from 'vitest'

import {
  contentSecurityPolicyHeaderName,
  createDevelopmentContentSecurityPolicy,
  createProductionContentSecurityPolicy,
  createViteWebSocketOrigin,
  injectContentSecurityPolicyMeta,
  viteDevelopmentCspNonce,
  withContentSecurityPolicyHeader
} from '@main/security/content-security-policy'

describe('content security policy', () => {
  it('creates the strict production policy', () => {
    const policy = createProductionContentSecurityPolicy()

    expect(policy).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';object-src 'none';frame-src 'none';script-src 'self';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'none';worker-src 'none';media-src 'none';manifest-src 'none'"
    )
    expect(policy).not.toContain('*')
    expect(policy).not.toContain("'unsafe-inline'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('http:')
    expect(policy).not.toContain('https:')
    expect(policy).not.toContain('ws:')
    expect(policy).not.toContain('wss:')
  })

  it('creates the development policy with only Vite style and exact WebSocket exceptions', () => {
    const policy = createDevelopmentContentSecurityPolicy('http://localhost:5173/')

    expect(policy).toBe(
      `default-src 'none';base-uri 'none';form-action 'none';object-src 'none';frame-src 'none';script-src 'self' 'nonce-${viteDevelopmentCspNonce}';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self' ws://localhost:5173;worker-src 'none';media-src 'none';manifest-src 'none'`
    )
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('connect-src ws:')
    expect(policy).not.toContain('connect-src wss:')
    expect(policy).not.toContain('http://')
  })

  it('converts the renderer origin to the exact Vite WebSocket origin', () => {
    expect(createViteWebSocketOrigin('http://127.0.0.1:5173/')).toBe('ws://127.0.0.1:5173')
    expect(createViteWebSocketOrigin('https://localhost:5173/')).toBe('wss://localhost:5173')
    expect(createViteWebSocketOrigin('http://[::1]:5173/')).toBe('ws://[::1]:5173')
  })

  it('replaces pre-existing CSP headers case-insensitively and preserves unrelated headers', () => {
    const headers = withContentSecurityPolicyHeader(
      {
        'content-security-policy': ["default-src 'self'"],
        'Content-Security-Policy': ["script-src 'self'"],
        'X-Frame-Options': ['DENY'],
        'X-Text': 'kept'
      },
      createProductionContentSecurityPolicy()
    )

    const cspHeaderNames = Object.keys(headers).filter(
      (name) => name.toLowerCase() === contentSecurityPolicyHeaderName.toLowerCase()
    )

    expect(cspHeaderNames).toEqual([contentSecurityPolicyHeaderName])
    expect(headers['X-Frame-Options']).toEqual(['DENY'])
    expect(headers['X-Text']).toEqual(['kept'])
    expect(headers[contentSecurityPolicyHeaderName]).toEqual([
      createProductionContentSecurityPolicy()
    ])
  })

  it('injects exactly one production CSP meta element into renderer HTML', () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="old" /><title>App</title></head><body></body></html>`
    const transformed = injectContentSecurityPolicyMeta(
      html,
      createProductionContentSecurityPolicy()
    )

    expect(transformed.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(transformed).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${createProductionContentSecurityPolicy()}" />`
    )
    expect(transformed).not.toContain('content="old"')
  })
})
