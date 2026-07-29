import { describe, expect, it } from 'vitest'

import {
  ContentSecurityPolicyInjectionError,
  contentSecurityPolicyHeaderName,
  createDevelopmentContentSecurityPolicy,
  createProductionContentSecurityPolicy,
  createViteWebSocketOrigin,
  injectContentSecurityPolicyMeta,
  withContentSecurityPolicyHeader
} from '@main/security/content-security-policy'
import {
  createDevelopmentReactRefreshPreambleModule,
  developmentReactRefreshPreamblePath,
  externalizeInlineReactRefreshPreamble
} from '@main/security/development-react-refresh-preamble'

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
      "default-src 'none';base-uri 'none';form-action 'none';object-src 'none';frame-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self' ws://localhost:5173;worker-src 'none';media-src 'none';manifest-src 'none'"
    )
    expect(policy).not.toContain('nonce-')
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('connect-src ws:')
    expect(policy).not.toContain('connect-src wss:')
    expect(policy).not.toContain('http://')
  })

  it('externalizes the React refresh preamble so development scripts remain self-only', () => {
    const html = `<html><head><script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;</script><title>App</title></head></html>`
    const transformed = externalizeInlineReactRefreshPreamble(html)

    expect(transformed).toContain(
      `<script type="module" src="${developmentReactRefreshPreamblePath}"></script>`
    )
    expect(transformed).not.toContain('injectIntoGlobalHook(window)')
    expect(createDevelopmentReactRefreshPreambleModule()).toBe(
      [
        'import { injectIntoGlobalHook } from "/@react-refresh";',
        'injectIntoGlobalHook(window);',
        'window.$RefreshReg$ = () => {};',
        'window.$RefreshSig$ = () => (type) => type;',
        ''
      ].join('\n')
    )
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

  it('injects exactly one production CSP meta element into a valid head', () => {
    const html = `<html><head><title>App</title></head><body></body></html>`
    const transformed = injectContentSecurityPolicyMeta(
      html,
      createProductionContentSecurityPolicy()
    )

    expect(transformed.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(transformed).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${createProductionContentSecurityPolicy()}" />`
    )
  })

  it('injects production CSP after a head tag with attributes', () => {
    const transformed = injectContentSecurityPolicyMeta(
      `<html><head data-app="renderer"><title>App</title></head></html>`,
      createProductionContentSecurityPolicy()
    )

    expect(transformed).toContain(
      `<head data-app="renderer">\n    <meta http-equiv="Content-Security-Policy"`
    )
    expect(transformed.match(/Content-Security-Policy/g)).toHaveLength(1)
  })

  it('replaces an existing CSP meta element with the application CSP', () => {
    const html = `<html><head><meta data-old="true" http-equiv="Content-Security-Policy" content="old" /><title>App</title></head><body></body></html>`
    const transformed = injectContentSecurityPolicyMeta(
      html,
      createProductionContentSecurityPolicy()
    )

    expect(transformed.match(/Content-Security-Policy/g)).toHaveLength(1)
    expect(transformed).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${createProductionContentSecurityPolicy()}" />`
    )
    expect(transformed).not.toContain('content="old"')
    expect(transformed).not.toContain('data-old="true"')
  })

  it('rejects HTML without a head element', () => {
    expect(() =>
      injectContentSecurityPolicyMeta(
        `<html><body><div id="root"></div></body></html>`,
        createProductionContentSecurityPolicy()
      )
    ).toThrow(ContentSecurityPolicyInjectionError)
    expect(() =>
      injectContentSecurityPolicyMeta(
        `<html><body><div id="root"></div></body></html>`,
        createProductionContentSecurityPolicy()
      )
    ).toThrow('Renderer HTML must include a head element for CSP injection.')
  })
})
