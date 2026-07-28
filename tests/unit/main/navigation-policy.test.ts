import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createDevelopmentNavigationPolicy,
  createProductionNavigationPolicy,
  isNavigationAllowed
} from '@main/app/navigation-policy'

describe('navigation policy', () => {
  it.each([
    'http://localhost:5173/',
    'https://localhost:5173/',
    'http://127.0.0.1:5173/',
    'https://127.0.0.1:5173/',
    'http://[::1]:5173/',
    'https://[::1]:5173/'
  ])('accepts loopback HTTP(S) development renderer URL %s', (rendererUrl) => {
    const policy = createDevelopmentNavigationPolicy(rendererUrl)

    if (policy.mode !== 'development') {
      throw new Error('Expected a development navigation policy.')
    }

    expect(policy.applicationUrl).toBe(new URL(rendererUrl).href)
    expect(policy.allowedOrigin).toBe(new URL(rendererUrl).origin)
  })

  it.each([
    'file:///C:/app/out/renderer/index.html',
    'data:text/html,blocked',
    'javascript:alert("blocked")',
    'custom-scheme://localhost:5173/',
    'http://example.com:5173/',
    'https://192.168.1.20:5173/',
    'http://%',
    'not a url'
  ])('rejects unsafe development renderer URL %s', (rendererUrl) => {
    expect(() => createDevelopmentNavigationPolicy(rendererUrl)).toThrow(
      'Development renderer URL must use an HTTP(S) loopback origin.'
    )
  })

  it('allows the exact development renderer URL and another path on the same origin', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')

    expect(isNavigationAllowed('http://localhost:5173/', policy)).toBe(true)
    expect(isNavigationAllowed('http://localhost:5173/nested/path?view=foundation', policy)).toBe(
      true
    )
  })

  it('rejects navigation to a different HTTP or HTTPS origin in development', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')

    expect(isNavigationAllowed('http://localhost:4000/', policy)).toBe(false)
    expect(isNavigationAllowed('https://localhost:5173/', policy)).toBe(false)
  })

  it('rejects javascript and data URLs', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')

    expect(isNavigationAllowed('javascript:alert("blocked")', policy)).toBe(false)
    expect(isNavigationAllowed('data:text/html,blocked', policy)).toBe(false)
  })

  it('allows the intended packaged renderer file URL and same-document navigation', () => {
    const rendererIndexPath = resolve('out/renderer/index.html')
    const rendererIndexUrl = pathToFileURL(rendererIndexPath).href
    const policy = createProductionNavigationPolicy(rendererIndexPath)

    expect(isNavigationAllowed(rendererIndexUrl, policy)).toBe(true)
    expect(isNavigationAllowed(`${rendererIndexUrl}#application-title`, policy)).toBe(true)
  })

  it('rejects unrelated local file URLs in production', () => {
    const rendererIndexPath = resolve('out/renderer/index.html')
    const unrelatedFileUrl = pathToFileURL(join(resolve('out'), 'other.html')).href
    const policy = createProductionNavigationPolicy(rendererIndexPath)

    expect(isNavigationAllowed(unrelatedFileUrl, policy)).toBe(false)
  })

  it('denies malformed URLs instead of throwing', () => {
    const policy = createDevelopmentNavigationPolicy('http://localhost:5173/')

    expect(() => isNavigationAllowed('http://%', policy)).not.toThrow()
    expect(isNavigationAllowed('http://%', policy)).toBe(false)
  })
})
