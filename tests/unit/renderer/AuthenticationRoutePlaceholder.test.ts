import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AuthenticationRoutePlaceholder } from '../../../src/renderer/src/app/authentication/AuthenticationRoutePlaceholder'
import type { RendererAuthenticationRoute } from '../../../src/renderer/src/app/authentication/authentication-route-types'

describe('authentication route placeholder rendering', () => {
  it('renders safe public identity only and no authentication form controls', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthenticationRoutePlaceholder, {
        route: {
          status: 'SESSION_ACTIVE',
          user: {
            username: 'Admin.User',
            displayName: 'Admin User',
            role: 'LOCAL_ADMIN'
          },
          idleExpiresAt: '2026-07-31T12:15:00.000Z' as never,
          absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
          revision: 3
        } as RendererAuthenticationRoute
      })
    )

    expect(markup).toContain('Session active.')
    expect(markup).toContain('Admin User')
    expect(markup).toContain('Admin.User')
    expect(markup).toContain('LOCAL_ADMIN')

    for (const unsafeFragment of [
      'password',
      'credential',
      'hash',
      'salt',
      '22222222-2222-4222-8222-222222222222',
      '<input',
      '<button'
    ]) {
      expect(markup).not.toContain(unsafeFragment)
    }
  })
})
